/**
 * 지도 WMS LAYERS 파라미터 치환.
 * 속성 조회·목록은 원본 테이블 id를 쓰고, 화면 표시만 별칭 레이어로 보낸다.
 */
export const MAP_SERVICE_WMS_LAYER_ALIAS: Record<string, string> = {
  a0070000: 'a0070000_ls',
};

export function applyMapServiceWmsLayerAlias(layerName: string): string {
  const t = String(layerName ?? '').trim();
  if (!t) return t;
  const aliased = MAP_SERVICE_WMS_LAYER_ALIAS[t.toLowerCase()];
  return aliased ?? t;
}

/** 순서 유지·대소문자 무시 중복 제거 + WMS 별칭 적용 */
export function resolveMapServiceWmsLayerNames(names: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const n = applyMapServiceWmsLayerAlias(String(raw ?? '').trim());
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}
