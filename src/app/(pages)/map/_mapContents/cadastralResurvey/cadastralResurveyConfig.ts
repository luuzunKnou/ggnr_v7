/** serviceList.ser_eng / systemList 메뉴 키와 동일 */
export const CADASTRAL_RESURVEY_OPENED_KEY = 'cadastralResurvey'

export const CADASTRAL_RESURVEY_PANEL_DEFAULT_WIDTH = 600
export const CADASTRAL_RESURVEY_PANEL_MIN_WIDTH = 480
export const CADASTRAL_RESURVEY_PANEL_MAX_WIDTH = 960
export const CADASTRAL_RESURVEY_DETAIL_DEFAULT_WIDTH = 500
export const CADASTRAL_RESURVEY_DETAIL_MIN_WIDTH = 420
export const CADASTRAL_RESURVEY_DETAIL_MAX_WIDTH = 860

export type ResurveyStageGroup = 'plan' | 'survey' | 'notice' | 'boundary' | 'adjust' | 'complete'

export type ResurveyStageGroupDef = {
  code: ResurveyStageGroup
  label: string
  shortLabel: string
  /** 바른땅 진행단계 상세코드(progStateDtlCd) 상한 — 이하이면 이 묶음 */
  maxStageCd: number
  /** 지도 채움·선, 범례 */
  color: string
}

/**
 * 바른땅 진행단계 상세코드를 화면용 6단계로 묶는다.
 * 확인된 코드: 11 지적재조사기준점측량, 14 지적확정예정조서 통지, 17 경계확정 및 통지, 24 등기촉탁.
 * 나머지 경계값은 사업 절차 순서 기준 추정이며 실데이터 연동 시 코드표로 확정한다.
 */
export const RESURVEY_STAGE_GROUPS: ResurveyStageGroupDef[] = [
  { code: 'plan', label: '계획·지구지정', shortLabel: '지정', maxStageCd: 6, color: '#64748b' },
  { code: 'survey', label: '조사·측량', shortLabel: '측량', maxStageCd: 12, color: '#8b5cf6' },
  { code: 'notice', label: '조서 작성·통지', shortLabel: '조서', maxStageCd: 15, color: '#0ea5e9' },
  { code: 'boundary', label: '경계 결정·확정', shortLabel: '경계', maxStageCd: 19, color: '#f59e0b' },
  { code: 'adjust', label: '조정금·완료공고', shortLabel: '조정', maxStageCd: 22, color: '#ef4444' },
  { code: 'complete', label: '공부정리·등기', shortLabel: '등기', maxStageCd: 99, color: '#16a34a' },
]

export function getResurveyStageGroupByCd(stageCd: number): ResurveyStageGroupDef {
  return (
    RESURVEY_STAGE_GROUPS.find((g) => stageCd <= g.maxStageCd) ??
    RESURVEY_STAGE_GROUPS[RESURVEY_STAGE_GROUPS.length - 1]
  )
}

export function getResurveyStageGroup(code: ResurveyStageGroup): ResurveyStageGroupDef {
  return RESURVEY_STAGE_GROUPS.find((g) => g.code === code) ?? RESURVEY_STAGE_GROUPS[0]
}

export function getResurveyStageGroupIndex(code: ResurveyStageGroup): number {
  return Math.max(
    0,
    RESURVEY_STAGE_GROUPS.findIndex((g) => g.code === code)
  )
}

/** 상세 필지 도형 색 */
export const RESURVEY_PARCEL_COLOR = '#2563eb'
