/**
 * 소규모 공공시설 — 유형별 물리 테이블 (도형 타입 분리).
 * 점검·평가·정비·첨부는 cons_code(관리번호)로 이 테이블들을 찾아간다.
 */
export const SPF_TYPE_TABLES = [
  { type: '세천', table: 'spf_creek', shpFile: '세천', geom: 'LineString', kor: '세천', consPrefix: 'SSF01FAC' },
  { type: '소교량', table: 'spf_bridge', shpFile: '소교량', geom: 'Point', kor: '소교량', consPrefix: 'SSF04FAC' },
  { type: '취입보', table: 'spf_intake', shpFile: '취입보', geom: 'Point', kor: '취입보', consPrefix: 'SSF06FAC' },
  { type: '마을진입로', table: 'spf_village', shpFile: '마을진입로', geom: 'LineString', kor: '마을진입로', consPrefix: 'SSF02FAC' },
  { type: '농로', table: 'spf_farm', shpFile: '농로', geom: 'LineString', kor: '농로', consPrefix: 'SSF03FAC' },
  { type: '낙차공', table: 'spf_drop', shpFile: '낙차공', geom: 'Point', kor: '낙차공', consPrefix: 'SSF06FAC' },
] as const

export type SpfFacTypeName = (typeof SPF_TYPE_TABLES)[number]['type']
export type SpfTypeTableName = (typeof SPF_TYPE_TABLES)[number]['table']

export function spfTypeTableByType(type: string): (typeof SPF_TYPE_TABLES)[number] | undefined {
  const t = String(type ?? '').trim()
  return SPF_TYPE_TABLES.find((x) => x.type === t)
}

export function spfTypeTableByName(table: string): (typeof SPF_TYPE_TABLES)[number] | undefined {
  const t = String(table ?? '').trim().toLowerCase()
  return SPF_TYPE_TABLES.find((x) => x.table === t)
}

/** 화면·API 시설 id: 관리번호 있으면 그대로, 없으면 excl:{table}:{localId} */
export function spfFacilityUiId(consCode: string | null | undefined, table: string, localId: number): string {
  const c = String(consCode ?? '').trim()
  if (c) return c
  return `excl:${table}:${localId}`
}

export function parseSpfFacilityUiId(
  id: string
): { kind: 'cons'; consCode: string } | { kind: 'excl'; table: string; localId: number } | null {
  const raw = String(id ?? '').trim()
  if (!raw) return null
  if (raw.startsWith('excl:')) {
    const parts = raw.split(':')
    const table = parts[1] ?? ''
    const localId = Number(parts[2])
    if (!spfTypeTableByName(table) || !Number.isFinite(localId)) return null
    return { kind: 'excl', table, localId }
  }
  return { kind: 'cons', consCode: raw }
}
