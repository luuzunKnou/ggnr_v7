export const GCP_OPENED_KEY = 'gcp'

export const GCP_PANEL_DEFAULT_WIDTH = 440
export const GCP_PANEL_MIN_WIDTH = 360
export const GCP_PANEL_MAX_WIDTH = 680

export const GCP_DETAIL_DEFAULT_WIDTH = 400
export const GCP_DETAIL_MIN_WIDTH = 320
export const GCP_DETAIL_MAX_WIDTH = 640

/** 시험용 — 점검 주기(일). 업무 기준이 정해지면 바꾼다. */
export const GCP_INSPECT_DUE_DAYS = 180

export const GCP_MAP_COLORS = {
  ok: '#2563EB',
  warn: '#CA8A04',
  bad: '#BE123C',
} as const

export type GcpStatus = 'ok' | 'due' | 'abnormal'
export type GcpDisplayStatus = '정상' | '점검필요' | '비정상'

export const GCP_STATUS_OPTIONS: { value: GcpStatus; label: GcpDisplayStatus }[] = [
  { value: 'ok', label: '정상' },
  { value: 'due', label: '점검필요' },
  { value: 'abnormal', label: '비정상' },
]

export const GCP_STATUS_FILTERS = ['전체', '정상', '점검필요', '비정상'] as const
export type GcpStatusFilter = (typeof GCP_STATUS_FILTERS)[number]
