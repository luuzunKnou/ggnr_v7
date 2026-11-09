/** 소규모 공공시설 — 메뉴 키·시설 유형·구분·등급 공통 정의 */

export const SMALL_PUBLIC_CANDIDATE_OPENED_KEY = 'smallPublicCandidate'
export const SMALL_PUBLIC_INSPECTION_OPENED_KEY = 'smallPublicInspection'

export const SMALL_PUBLIC_FAC_TYPES = ['세천', '소교량', '취입보', '마을진입로', '농로', '낙차공'] as const
export type SmallPublicFacType = (typeof SMALL_PUBLIC_FAC_TYPES)[number]

/** 시설 자료 좌표계 — 울진군 전산화 자료(GRS80 동부원점) */
export const SMALL_PUBLIC_DATA_PROJECTION = 'EPSG:5187'

export const SMALL_PUBLIC_CLASSES = ['일반', '관리', '위험'] as const
export type SmallPublicClass = (typeof SMALL_PUBLIC_CLASSES)[number]

/** 후보지 값 — 일반·관리·위험은 선정, 제외는 선정 제외 */
export const SMALL_PUBLIC_CANDIDATES = ['일반', '관리', '위험', '제외'] as const
export type SmallPublicCandidate = (typeof SMALL_PUBLIC_CANDIDATES)[number]

export const SMALL_PUBLIC_GRADES = ['양호', '보통', '불량'] as const
export type SmallPublicGrade = (typeof SMALL_PUBLIC_GRADES)[number]

/** 연계 = 외부 시스템에서 받은 점검, 입력 = 이 시스템에서 등록한 점검 */
export type SmallPublicInspectionSource = '연계' | '입력'

/** 등급 기준 — 등급은 합계점수로만 정해진다 */
export function smallPublicGradeFromScore(score: number): SmallPublicGrade {
  if (score <= 30) return '양호'
  if (score <= 70) return '보통'
  return '불량'
}

export const SMALL_PUBLIC_CLASS_BADGE: Record<SmallPublicCandidate, string> = {
  일반: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  관리: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300',
  위험: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
  제외: 'bg-muted text-muted-foreground',
}

/** 지도 색 — 후보지는 구분, 안전점검은 최근 등급 */
export const SMALL_PUBLIC_CLASS_COLOR: Record<SmallPublicCandidate, string> = {
  일반: '#16a34a',
  관리: '#d97706',
  위험: '#dc2626',
  제외: '#94a3b8',
}

/** 불량은 위험시설과 같은 빨강 */
export const SMALL_PUBLIC_GRADE_COLOR: Record<SmallPublicGrade | '없음', string> = {
  양호: '#16a34a',
  보통: '#d97706',
  불량: '#dc2626',
  없음: '#94a3b8',
}

export const smallPublicBtnPrimary =
  'inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
export const smallPublicBtnGhost =
  'inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-50'
export const smallPublicBtnDanger =
  'inline-flex h-7 items-center gap-1 rounded border border-destructive/30 bg-background px-2 text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50'
export const smallPublicFieldClass =
  'h-7 w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] outline-none focus:border-primary focus:ring-1 focus:ring-primary/25'
