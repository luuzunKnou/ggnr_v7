import { existsSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import { tryGenerateCadPreviewPng } from "@/lib/roadDocCadPreviewPng";
import { roadDocPreviewPngFileName } from "@/lib/roadDocPreviewPngName";
import { getRoadDocFileDir } from "@/lib/roadDocServerPaths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ItemResult = { name: string; status: "skipped" | "generated" | "failed"; reason?: string };

/**
 * POST /api/roadDoc/ensure-cad-previews — `roadDoc/file`의 DWG/DXF에 대해 `_${stem}.png`가 없으면 생성
 */
export async function POST() {
  const dir = getRoadDocFileDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    console.error("[roadDoc/ensure-cad-previews] readdir", e);
    return NextResponse.json({ error: "폴더를 읽을 수 없습니다.", results: [] as ItemResult[] }, { status: 500 });
  }

  const results: ItemResult[] = [];

  for (const name of names) {
    if (name.startsWith("_")) continue;
    const lower = name.toLowerCase();
    if (!lower.endsWith(".dwg") && !lower.endsWith(".dxf")) continue;

    const full = path.join(dir, name);
    try {
      const st = await stat(full);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }

    const pngName = roadDocPreviewPngFileName(name);
    const pngPath = path.join(dir, pngName);
    if (existsSync(pngPath)) {
      results.push({ name, status: "skipped" });
      continue;
    }

    const r = await tryGenerateCadPreviewPng(full, pngPath);
    if (r.ok) {
      results.push({ name, status: "generated" });
    } else {
      results.push({ name, status: "failed", reason: r.reason });
    }
  }

  return NextResponse.json({ ok: true, results });
}
