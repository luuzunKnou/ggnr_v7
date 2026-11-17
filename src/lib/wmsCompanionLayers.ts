/**
 * 레이어 트리에는 대표 레이어 하나만 두고, 켜질 때 WMS에 함께 붙는 짝 레이어.
 * (도로망도: 선 레이어를 켜면 번호 라벨용 점 레이어가 같이 그려진다)
 */
const WMS_COMPANION_LAYERS: Record<string, readonly string[]> = {
  rdl_network_ls: ['rdl_network_ps'],
};

const COMPANION_NAMES = new Set(
  Object.values(WMS_COMPANION_LAYERS).flatMap((list) => list.map((n) => n.toLowerCase()))
);

/** 트리에 따로 보이지 않아야 하는 짝 레이어인지 */
export function isWmsCompanionLayer(name: string): boolean {
  return COMPANION_NAMES.has(String(name ?? '').trim().toLowerCase());
}

/**
 * 켜진 레이어에 짝 레이어를 덧붙인다. DB에 테이블이 있는 짝만 추가해
 * 점 레이어가 없는 프로젝트는 기존 선 스타일만 유지한다.
 */
export function expandWmsCompanionLayers(
  visible: Set<string>,
  existingTables: ReadonlySet<string> | null
): Set<string> {
  if (!existingTables || existingTables.size === 0) return visible;
  let out: Set<string> | null = null;
  for (const name of visible) {
    const companions = WMS_COMPANION_LAYERS[name.toLowerCase()];
    if (!companions) continue;
    for (const c of companions) {
      if (!existingTables.has(c) || visible.has(c)) continue;
      out ??= new Set(visible);
      out.add(c);
    }
  }
  return out ?? visible;
}
