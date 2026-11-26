/**
 * WIMS 검침이력 — 목록(show_list) / 상세(show_detail) 컬럼.
 * Oracle V_BLOCKINFO 현재 조회 필드만 (당월검침일·전화·지침·소블록 제외).
 */
import type { WimsHistoryRow } from '@/lib/wimsTypes'

export type WimsHistoryColumnKind = 'code' | 'date' | 'number' | 'text'

export type WimsHistoryColumn = {
  key: keyof WimsHistoryRow
  label: string
  kind: WimsHistoryColumnKind
  /** 목록 열 너비(%) — 목록용만 */
  widthPct?: number
  /** 상세에서 복사 버튼 */
  title?: boolean
}

/** show_list */
export const WIMS_HISTORY_LIST_COLUMNS: WimsHistoryColumn[] = [
  { key: 'gojikind', label: '종류', kind: 'code', widthPct: 10 },
  { key: 'meterDay', label: '검침일', kind: 'date', widthPct: 18 },
  { key: 'nabgiDate', label: '납기마감일', kind: 'date', widthPct: 18 },
  { key: 'useQty', label: '사용량', kind: 'number', widthPct: 16 },
  { key: 'freeQty', label: '상수도 사용료', kind: 'number', widthPct: 20 },
  { key: 'delYn', label: '상태', kind: 'text', widthPct: 18 },
]

/** show_detail — 목록 제외 나머지 */
export const WIMS_HISTORY_DETAIL_COLUMNS: WimsHistoryColumn[] = [
  { key: 'ymCustNo', label: '수용가 검침일련번호', kind: 'text', title: true },
  { key: 'meterYm', label: '검침년월', kind: 'text' },
  { key: 'meterMonth', label: '검침월', kind: 'text' },
  { key: 'customerNo', label: '수용가번호', kind: 'text', title: true },
  { key: 'meterNo', label: '계량기번호', kind: 'text', title: true },
  { key: 'dongcode', label: '동코드', kind: 'text' },
  { key: 'admDong', label: '행정동', kind: 'text' },
  { key: 'suname', label: '수용가성명', kind: 'text' },
  { key: 'lostnoAddr', label: '지번주소', kind: 'text' },
  { key: 'roadAddr', label: '도로명주소', kind: 'text' },
  { key: 'supcode', label: '업종코드', kind: 'text' },
  { key: 'induty', label: '업종', kind: 'text' },
  { key: 'sgucode', label: '구경코드', kind: 'text' },
  { key: 'diam', label: '구경', kind: 'number' },
  { key: 'areaCd', label: '구역(대블록)코드', kind: 'text' },
  { key: 'blockName', label: '대블록명칭', kind: 'text' },
  { key: 'jocode', label: '부과코드', kind: 'code' },
]
