/** serviceList.ser_eng / systemList 메뉴 키와 동일 */
export const CADASTRAL_RECORD_OPENED_KEY = 'cadastralRecord'

export const CADASTRAL_RECORD_PANEL_DEFAULT_WIDTH = 400
export const CADASTRAL_RECORD_PANEL_MIN_WIDTH = 320
export const CADASTRAL_RECORD_PANEL_MAX_WIDTH = 640
export const CADASTRAL_RECORD_DETAIL_DEFAULT_WIDTH = 440
export const CADASTRAL_RECORD_DETAIL_MIN_WIDTH = 360
export const CADASTRAL_RECORD_DETAIL_MAX_WIDTH = 720

export type CadastralDocType = 'ledger' | 'map' | 'survey' | 'coord' | 'closed' | 'shared'
export type CadastralLedgerType = 'land' | 'forest'

export type CadastralTypeDef<T extends string> = {
  code: T
  label: string
  color: string
}

export const CADASTRAL_DOC_TYPES: CadastralTypeDef<CadastralDocType>[] = [
  { code: 'ledger', label: '대장', color: '#0ea5e9' },
  { code: 'map', label: '도면', color: '#8b5cf6' },
  { code: 'survey', label: '면적측정부', color: '#ef4444' },
  { code: 'coord', label: '좌표등록부', color: '#f59e0b' },
  { code: 'closed', label: '폐쇄대장', color: '#64748b' },
  { code: 'shared', label: '공유지연명부', color: '#2563eb' },
]

export const CADASTRAL_LEDGER_TYPES: CadastralTypeDef<CadastralLedgerType>[] = [
  { code: 'land', label: '토지', color: '#0ea5e9' },
  { code: 'forest', label: '임야', color: '#16a34a' },
]

export function getCadastralDocType(code: CadastralDocType): CadastralTypeDef<CadastralDocType> {
  return CADASTRAL_DOC_TYPES.find((k) => k.code === code) ?? CADASTRAL_DOC_TYPES[0]!
}

export function getCadastralLedgerType(
  code: CadastralLedgerType
): CadastralTypeDef<CadastralLedgerType> {
  return CADASTRAL_LEDGER_TYPES.find((k) => k.code === code) ?? CADASTRAL_LEDGER_TYPES[0]!
}
