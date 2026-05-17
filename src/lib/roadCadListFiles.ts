/**
 * `roadDoc/cad` 트리 전체를 순회해 파일만 수집 (이름은 cad 루트 기준 `/` 구분 상대 경로).
 * `_` 로 시작하는 항목은 제외 (미리보기 PNG 등).
 */
import path from "path";
import { readdir, stat } from "fs/promises";
import { getRoadCadFileDir } from "@/lib/roadDocServerPaths";
import type { RoadDocListItem } from "@/lib/roadDocTypes";

export async function listRoadCadFilesRecursive(): Promise<RoadDocListItem[]> {
  const root = getRoadCadFileDir();
  const out: RoadDocListItem[] = [];

  async function walk(relPosix: string): Promise<void> {
    const absDir = relPosix
      ? path.join(root, ...relPosix.split("/").filter(Boolean))
      : root;
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const baseName = String(ent.name);
      if (baseName.startsWith("_")) continue;
      const childRel = relPosix ? `${relPosix}/${baseName}` : baseName;
      const full = path.join(absDir, baseName);
      if (ent.isDirectory()) {
        await walk(childRel);
      } else if (ent.isFile()) {
        try {
          const st = await stat(full);
          out.push({ name: childRel, size: st.size });
        } catch {
          /* skip */
        }
      }
    }
  }

  await walk("");
  out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return out;
}

/** `relPosix`는 cad 루트 기준 `/` 구분 상대 경로 */
export function roadCadAbsPathFromRel(relPosix: string): string {
  const root = getRoadCadFileDir();
  return path.join(root, ...relPosix.split("/").filter(Boolean));
}
