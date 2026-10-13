/**
 * 구간 지정 방식
 * - between: 시작·끝 두 선 사이 (+ 합류 지류) — 하천
 * - closed: 경계선 여러 개로 둘러싼 닫힌 범위, 레이어를 하나로 합쳐 사용 — 도로
 */
export type PrivateLandRangeMode = 'between' | 'closed';

/** 사유지분석 — 시스템별 분석 대상 면 레이어 (define 테이블명 = WMS 레이어 id) */
export type PrivateLandAnalysisLayer = {
  table: string;
  label: string;
  /** DB 스키마 (기본 layer) */
  schema?: string;
  /** 기본 between */
  mode?: PrivateLandRangeMode;
};

export const PRIVATE_LAND_ANALYSIS_LAYERS: Record<string, PrivateLandAnalysisLayer[]> = {
  river: [
    { table: 'river_d_as', label: '하천구역' },
    { table: 'river_s_as', label: '소하천구역' },
  ],
  road: [{ table: 'tl_sprd_rw', label: '실폭도로', schema: 'public_layer', mode: 'closed' }],
};

export function privateLandAnalysisLayersFor(system: string | null | undefined): PrivateLandAnalysisLayer[] {
  return PRIVATE_LAND_ANALYSIS_LAYERS[String(system ?? '').trim()] ?? [];
}

export function findPrivateLandAnalysisLayer(table: string | null | undefined): PrivateLandAnalysisLayer | null {
  const key = String(table ?? '').trim().toLowerCase();
  if (!key) return null;
  for (const list of Object.values(PRIVATE_LAND_ANALYSIS_LAYERS)) {
    const hit = list.find((l) => l.table === key);
    if (hit) return hit;
  }
  return null;
}

export function isPrivateLandAnalysisLayer(table: string | null | undefined): boolean {
  return findPrivateLandAnalysisLayer(table) != null;
}

export function privateLandRangeMode(layer: PrivateLandAnalysisLayer | null | undefined): PrivateLandRangeMode {
  return layer?.mode ?? 'between';
}

/** jijuk.own_gbn 코드 → 이름 */
export const OWN_GBN_KO: Record<string, string> = {
  '00': '일본인, 창씨명등',
  '01': '개인',
  '02': '국유지',
  '03': '외국인, 외국공공기관',
  '04': '시, 도유지',
  '05': '군유지',
  '06': '법인',
  '07': '종중',
  '08': '종교단체',
  '09': '기타단체',
};

export function ownGbnLabel(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s || s === '미상') return '미상';
  if (/[가-힣]/.test(s)) return s;
  const digits = s.replace(/\D/g, '');
  if (!digits) return s;
  return OWN_GBN_KO[digits.padStart(2, '0')] ?? s;
}
