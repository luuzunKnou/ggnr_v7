import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { type CadPreviewResult, tryGenerateCadPreviewPng } from "@/lib/roadDocCadPreviewPng";
import { roadDocPreviewPngFileName } from "@/lib/roadDocPreviewPngName";
import { getRoadCadFileDir } from "@/lib/roadDocServerPaths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 120 * 1024 * 1024; // 120MB

function safeBasename(raw: string): string | null {
  const base = path.basename(raw.trim());
  if (!base || base === "." || base === "..") return null;
  if (base.includes("/") || base.includes("\\")) return null;
  return base;
}

/**
 * POST /api/roadCad/upload — multipart `file` 필드로 `roadDoc/cad`에 저장
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }

  const entry = form.get("file");
  if (!(entry instanceof File)) {
    return NextResponse.json({ error: "file 필드가 필요합니다." }, { status: 400 });
  }

  const name = safeBasename(entry.name);
  if (!name) {
    return NextResponse.json({ error: "유효한 파일명이 아닙니다." }, { status: 400 });
  }

  if (entry.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `파일 크기는 ${MAX_BYTES / 1024 / 1024}MB 이하여야 합니다.` },
      { status: 413 }
    );
  }

  const dir = getRoadCadFileDir();
  const target = path.join(dir, name);
  const resolved = path.resolve(target);
  const rel = path.relative(path.resolve(dir), resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return NextResponse.json({ error: "잘못된 경로입니다." }, { status: 400 });
  }

  try {
    await mkdir(dir, { recursive: true });
    const buf = Buffer.from(await entry.arrayBuffer());
    await writeFile(resolved, buf);
  } catch (e) {
    console.error("[roadCad/upload] writeFile", e);
    return NextResponse.json({ error: "파일을 저장하지 못했습니다." }, { status: 500 });
  }

  const lower = name.toLowerCase();
  let previewPng: string | undefined;
  let previewOk: boolean | undefined;
  let previewReason: string | undefined;
  if (lower.endsWith(".dwg") || lower.endsWith(".dxf")) {
    const pngName = roadDocPreviewPngFileName(name);
    const pngPath = path.join(dir, pngName);
    previewPng = pngName;
    const r: CadPreviewResult = await tryGenerateCadPreviewPng(resolved, pngPath);
    previewOk = r.ok;
    if (!r.ok) {
      previewReason = r.reason;
    }
  }

  return NextResponse.json({
    ok: true,
    name,
    ...(previewPng != null ? { previewPng, previewOk, ...(previewReason ? { previewReason } : {}) } : {}),
  });
}
