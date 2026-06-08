import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { getRoadDocFileDir } from "@/lib/roadDocServerPaths";

function resolveSafeFile(raw: string): string | null {
  const base = path.resolve(getRoadDocFileDir());
  const baseName = path.basename(raw.trim());
  if (!baseName || baseName === "." || baseName === "..") return null;
  const target = path.resolve(base, baseName);
  const rel = path.relative(base, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return target;
}

function guessContentType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".hwp")) return "application/x-hwp";
  if (lower.endsWith(".dxf")) return "application/dxf";
  if (lower.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

/** RFC 2616 호환 `filename=` 용: 공백(0x20)은 유지, 비ASCII는 제거(언더바 치환 없음). */
function legacyAsciiFileName(original: string): string {
  const ext = path.extname(original);
  const base = path.basename(original, ext);
  const norm = base.replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, " ");
  let ascii = "";
  for (const ch of norm) {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 && c <= 0x7e) ascii += ch;
  }
  ascii = ascii.replace(/\s+/g, " ").trim();
  const safeBase = ascii.length > 0 ? ascii.slice(0, 180) : "file";
  const safeExt =
    ext && /^\.[a-zA-Z0-9]+$/i.test(ext) ? ext.toLowerCase() : "";
  return `${safeBase}${safeExt}`;
}

/**
 * HEAD /api/roadDoc/download?name= — 미리보기 PNG 존재 여부 확인
 */
export async function HEAD(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name")?.trim() ?? "";
  if (!name) {
    return new NextResponse(null, { status: 400 });
  }
  const filePath = resolveSafeFile(name);
  if (!filePath) {
    return new NextResponse(null, { status: 400 });
  }
  try {
    const st = await stat(filePath);
    if (!st.isFile()) {
      return new NextResponse(null, { status: 404 });
    }
    return new NextResponse(null, {
      status: 200,
      headers: {
        "Content-Type": guessContentType(name),
        "Content-Length": String(st.size),
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

/**
 * GET /api/roadDoc/download?name=파일명 — `roadDoc/file` 내 파일 다운로드
 */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name")?.trim() ?? "";
  if (!name) {
    return NextResponse.json({ error: "name 파라미터가 필요합니다." }, { status: 400 });
  }

  const filePath = resolveSafeFile(name);
  if (!filePath) {
    return NextResponse.json({ error: "잘못된 파일명입니다." }, { status: 400 });
  }

  try {
    const st = await stat(filePath);
    if (!st.isFile()) {
      return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  }

  const stream = createReadStream(filePath);
  const webStream = Readable.toWeb(stream) as ReadableStream;

  const asciiName = legacyAsciiFileName(name);
  const utf8Encoded = encodeURIComponent(name);

  /** PDF 미리보기(iframe 등): `inline=1` 이면 브라우저에서 열기 */
  const wantInline = req.nextUrl.searchParams.get("inline") === "1";
  const isPdf = name.toLowerCase().endsWith(".pdf");
  const disposition =
    wantInline && isPdf
      ? `inline; filename="${asciiName}"; filename*=UTF-8''${utf8Encoded}`
      : `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Encoded}`;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": guessContentType(name),
      "Content-Disposition": disposition,
    },
  });
}
