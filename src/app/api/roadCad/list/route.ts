import { NextResponse } from "next/server";
import { listRoadCadFilesRecursive } from "@/lib/roadCadListFiles";
import type { RoadDocListItem } from "@/lib/roadDocTypes";

export const dynamic = "force-dynamic";

/**
 * GET /api/roadCad/list — `roadDoc/cad` 트리 전체 파일 (하위 폴더 포함, 이름은 `/` 구분 상대 경로)
 */
export async function GET() {
  try {
    const files = await listRoadCadFilesRecursive();
    return NextResponse.json({ files });
  } catch (e) {
    console.error("[roadCad/list]", e);
    return NextResponse.json(
      { error: "파일 목록을 읽을 수 없습니다.", files: [] as RoadDocListItem[] },
      { status: 500 }
    );
  }
}
