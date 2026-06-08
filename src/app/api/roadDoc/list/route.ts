import { readdir, stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getRoadDocFileDir } from "@/lib/roadDocServerPaths";
import type { RoadDocListItem } from "@/lib/roadDocTypes";

export const dynamic = "force-dynamic";

/**
 * GET /api/roadDoc/list — `roadDoc/file` 폴더의 파일 목록 (하위 디렉터리 제외)
 */
export async function GET() {
  const dir = getRoadDocFileDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    console.error("[roadDoc/list] readdir", e);
    return NextResponse.json(
      { error: "파일 목록을 읽을 수 없습니다.", files: [] as RoadDocListItem[] },
      { status: 500 }
    );
  }

  const files: RoadDocListItem[] = [];
  for (const name of names) {
    if (name.startsWith("_")) continue;
    const full = path.join(dir, name);
    try {
      const st = await stat(full);
      if (st.isFile()) {
        files.push({ name, size: st.size });
      }
    } catch {
      // skip
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return NextResponse.json({ files });
}
