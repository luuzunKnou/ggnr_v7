import { existsSync } from "fs";
import path from "path";
import { stat } from "fs/promises";
import { NextResponse } from "next/server";
import { tryGenerateCadPreviewPng } from "@/lib/roadDocCadPreviewPng";
import { roadDocPreviewPngFileName } from "@/lib/roadDocPreviewPngName";
import { getRoadCadFileDir } from "@/lib/roadDocServerPaths";
import { listRoadCadFilesRecursive, roadCadAbsPathFromRel } from "@/lib/roadCadListFiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ItemResult = { name: string; status: "skipped" | "generated" | "failed"; reason?: string };

/**
 * POST /api/roadCad/ensure-cad-previews — `roadDoc/cad` 전체의 DWG/DXF에 대해 `_${stem}.png`가 없으면 생성 (원본과 같은 폴더)
 */
export async function POST() {
  const dir = getRoadCadFileDir();
  let files: Awaited<ReturnType<typeof listRoadCadFilesRecursive>>;
  try {
    files = await listRoadCadFilesRecursive();
  } catch (e) {
    console.error("[roadCad/ensure-cad-previews] list", e);
    return NextResponse.json({ error: "폴더를 읽을 수 없습니다.", results: [] as ItemResult[] }, { status: 500 });
  }

  const results: ItemResult[] = [];

  for (const { name: relPosix } of files) {
    const lower = relPosix.toLowerCase();
    if (!lower.endsWith(".dwg") && !lower.endsWith(".dxf")) continue;

    const full = roadCadAbsPathFromRel(relPosix);
    try {
      const st = await stat(full);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }

    const pngRel = roadDocPreviewPngFileName(relPosix);
    const pngPath = path.join(dir, ...pngRel.split("/").filter(Boolean));
    if (existsSync(pngPath)) {
      results.push({ name: relPosix, status: "skipped" });
      continue;
    }

    const r = await tryGenerateCadPreviewPng(full, pngPath);
    if (r.ok) {
      results.push({ name: relPosix, status: "generated" });
    } else {
      results.push({ name: relPosix, status: "failed", reason: r.reason });
    }
  }

  return NextResponse.json({ ok: true, results });
}
