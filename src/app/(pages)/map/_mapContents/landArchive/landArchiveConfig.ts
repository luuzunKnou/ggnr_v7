/** serviceList.ser_eng / systemList 메뉴 키와 동일 */
export const LAND_ARCHIVE_OPENED_KEY = 'landArchive'

export const LAND_ARCHIVE_PANEL_DEFAULT_WIDTH = 400
export const LAND_ARCHIVE_PANEL_MIN_WIDTH = 320
export const LAND_ARCHIVE_PANEL_MAX_WIDTH = 640
export const LAND_ARCHIVE_DETAIL_DEFAULT_WIDTH = 440
export const LAND_ARCHIVE_DETAIL_MIN_WIDTH = 360
export const LAND_ARCHIVE_DETAIL_MAX_WIDTH = 720

export type LandArchiveDocType =
  | 'ledger'
  | 'map'
  | 'survey'
  | 'coord'
  | 'closed'
  | 'shared'
  | 'move'
  | 'area'
  | 'landjosa'
  | 'spms'
  | 'survchk'
  | 'topo'
  | 'hwanji'
  | 'nocorp'
export type LandArchiveLedgerType = 'land' | 'forest'

export type LandArchiveTypeDef<T extends string> = {
  code: T
  label: string
  color: string
}

export const LAND_ARCHIVE_PARCEL_COLOR = '#0ea5e9'

export type LandArchiveParcelRef = {
  emd: string
  ri: string
  jibun: string
}

export type LandArchiveParcelGeom = LandArchiveParcelRef & {
  extent: [number, number, number, number]
  geom3857: Record<string, unknown>
}

export function landArchiveParcelKey(p: LandArchiveParcelRef): string {
  return `${p.emd}\t${p.ri}\t${p.jibun}`
}

/** 목록·상세 한 건 = 스캔 파일 한 장 */
export type LandArchiveFile = {
  id: string
  docType: LandArchiveDocType
  docTypeLabel: string
  ledgerType: LandArchiveLedgerType
  ledgerTypeLabel: string
  volumeNo: string
  pageNo: string
  fileName: string
  previewUrl: string
  parcelCount: number
  firstParcel: LandArchiveParcelRef | null
  /** 상세에서만 채움 */
  parcels?: LandArchiveParcelRef[]
}

export const LAND_ARCHIVE_DOC_TYPES: LandArchiveTypeDef<LandArchiveDocType>[] = [
  { code: 'ledger', label: '구대장', color: '#0ea5e9' },
  { code: 'map', label: '지적도', color: '#8b5cf6' },
  { code: 'survey', label: '측량결과도', color: '#ef4444' },
  { code: 'move', label: '이동지결의서', color: '#0d9488' },
  { code: 'coord', label: '좌표등록부', color: '#f59e0b' },
  { code: 'closed', label: '폐쇄대장', color: '#64748b' },
  { code: 'shared', label: '공유지연명부', color: '#2563eb' },
  { code: 'area', label: '면적측정부', color: '#f97316' },
  { code: 'landjosa', label: '토지조사부', color: '#14b8a6' },
  { code: 'spms', label: '특조법', color: '#a855f7' },
  { code: 'survchk', label: '측량성과검사정리부', color: '#e11d48' },
  { code: 'topo', label: '기초측량부', color: '#ca8a04' },
  { code: 'hwanji', label: '환지대장', color: '#7c3aed' },
  { code: 'nocorp', label: '비법인대장', color: '#57534e' },
]

export const LAND_ARCHIVE_LEDGER_TYPES: LandArchiveTypeDef<LandArchiveLedgerType>[] = [
  { code: 'land', label: '토지', color: '#0ea5e9' },
  { code: 'forest', label: '임야', color: '#16a34a' },
]

export function getLandArchiveDocType(code: LandArchiveDocType): LandArchiveTypeDef<LandArchiveDocType> {
  return LAND_ARCHIVE_DOC_TYPES.find((k) => k.code === code) ?? LAND_ARCHIVE_DOC_TYPES[0]!
}

export function getLandArchiveLedgerType(
  code: LandArchiveLedgerType
): LandArchiveTypeDef<LandArchiveLedgerType> {
  return LAND_ARCHIVE_LEDGER_TYPES.find((k) => k.code === code) ?? LAND_ARCHIVE_LEDGER_TYPES[0]!
}

export function formatRecordLocation(row: { emd: string; ri: string }): string {
  return [row.emd, row.ri].filter(Boolean).join(' ')
}

export function formatRecordAddress(row: { emd: string; ri: string; jibun: string }): string {
  return [formatRecordLocation(row), row.jibun].filter(Boolean).join(' ')
}

/** 목록 지번 칸 — «금곡동 180-26 외 48» */
export function formatRelatedParcels(
  first: LandArchiveParcelRef | null | undefined,
  count: number
): string {
  if (!first || count <= 0) return '—'
  const addr = formatRecordAddress(first)
  if (!addr) return '—'
  if (count <= 1) return addr
  return `${addr} 외 ${count - 1}`
}
