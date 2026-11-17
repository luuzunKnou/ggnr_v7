/**
 * 일반시설·관리시설 구분 평가표 — 10항목(배점 각 10), 평가 등급을 고르면 점수가 정해진다.
 * 합계 50점 미만 일반시설, 50점 이상 관리시설. 위험도 평가가 불량이거나 이미 위험시설이면 위험시설.
 * 세천은 원본 양식(두천리_세천_004 구분평가). 등급별 점수(2·5·9, 두 단계는 2·9)는 원본 평가표 점수에서 읽은 값.
 * 그 밖의 유형은 양식 확인 전 임시 항목(세천 항목을 유형 이름으로 바꿈).
 */

import type { SmallPublicClass, SmallPublicFacType, SmallPublicGrade } from './smallPublicConfig'

export type SmallPublicClassItem = {
  key: string
  group: string
  label: string
  levels: string[]
  scores: number[]
  /** risk = 그해 위험도 평가 등급, length = 시설 연장 */
  auto?: 'risk' | 'length'
}

export type SmallPublicClassForm = {
  id: string
  facType: SmallPublicFacType
  version: string
  note?: string
  /** 이 점수 이상이면 관리시설 */
  threshold: number
  items: SmallPublicClassItem[]
}

/** 항목별 고른 등급(0부터) */
export type SmallPublicClassValues = Record<string, number>

const TWO = [2, 9]
const THREE = [2, 5, 9]
const RISK_LEVELS = ['양호', '보통', '불량']

function formFor(facType: SmallPublicFacType, name: string, provisional: boolean): SmallPublicClassForm {
  return {
    id: `class-${facType}-${provisional ? '임시' : '1'}`,
    facType,
    version: provisional ? '임시 항목' : '1판(2020 정비계획)',
    note: provisional ? `${facType}은 원본 양식 확인 전 임시 항목입니다.` : undefined,
    threshold: 50,
    items: [
      { key: 'damage', group: '피해이력 및 의견', label: '피해이력', levels: ['없음', '있음'], scores: TWO },
      { key: 'opinion', group: '피해이력 및 의견', label: '주민 및 관계기관 의견', levels: ['없음', '있음'], scores: TWO },
      { key: 'scale', group: '시설규모', label: `${name} 규모`, levels: ['300m미만', '300m~700m', '700m이상'], scores: THREE, auto: 'length' },
      { key: 'attached', group: '시설규모', label: `${name}내 부속시설물`, levels: ['3개소미만', '3~5개소', '5개소이상'], scores: THREE },
      { key: 'landUse', group: '시설 중요도', label: '주변 토지이용현황', levels: ['산지', '농경지', '주거지'], scores: THREE },
      { key: 'proximity', group: '시설 중요도', label: '주택·마을인접도', levels: ['이격', '보통', '인접'], scores: THREE },
      { key: 'impact', group: '시설 중요도', label: '피해영향범위', levels: ['작음', '보통', '넓음'], scores: THREE },
      { key: 'section', group: '시설 중요도', label: '정비필요구간', levels: ['50m미만', '50m~100m', '100m이상'], scores: THREE },
      { key: 'risk', group: '시설 안전성', label: '위험도 평가', levels: RISK_LEVELS, scores: THREE, auto: 'risk' },
      { key: 'flood', group: '시설 안전성', label: '치수안전도 평가', levels: ['안전', '보통', '위험'], scores: THREE },
    ],
  }
}

export function smallPublicClassFormFor(facType: SmallPublicFacType): SmallPublicClassForm {
  return facType === '세천' ? formFor('세천', '세천', false) : formFor(facType, facType, true)
}

/** 시설 연장 → 규모 등급 */
export function smallPublicScaleLevel(lengthM: string | number): number {
  const n = Number(lengthM) || 0
  return n >= 700 ? 2 : n >= 300 ? 1 : 0
}

/** 자동 항목(위험도 등급·시설 연장)을 채운 값 */
export function smallPublicClassValuesWithAuto(
  form: SmallPublicClassForm,
  values: SmallPublicClassValues,
  grade: SmallPublicGrade,
  lengthM: string | number
): SmallPublicClassValues {
  const next = { ...values }
  for (const item of form.items) {
    if (item.auto === 'risk') next[item.key] = RISK_LEVELS.indexOf(grade)
    if (item.auto === 'length') next[item.key] = smallPublicScaleLevel(lengthM)
  }
  return next
}

export function smallPublicClassTotal(form: SmallPublicClassForm, values: SmallPublicClassValues): number {
  return form.items.reduce((n, item) => n + (item.scores[values[item.key] ?? 0] ?? 0), 0)
}

/** 구분 평가 결과 — 위험도 불량이거나 이미 위험시설이면 위험, 아니면 합계로 일반·관리 */
export function smallPublicClassOf(
  form: SmallPublicClassForm,
  values: SmallPublicClassValues,
  grade: SmallPublicGrade,
  prevClass: SmallPublicClass | '제외' | null
): SmallPublicClass {
  if (grade === '불량' || prevClass === '위험') return '위험'
  return smallPublicClassTotal(form, values) >= form.threshold ? '관리' : '일반'
}

/** 처음 평가할 때 기본값 — 모든 항목 가운데 등급(두 단계는 낮은 쪽) */
export function smallPublicDefaultClassValues(form: SmallPublicClassForm): SmallPublicClassValues {
  return Object.fromEntries(form.items.map((i) => [i.key, i.levels.length === 3 ? 1 : 0]))
}

/**
 * 예시 값 — 관리·위험 시설은 합계 50점 이상, 일반 시설은 50점 미만이 되도록 등급을 고른다.
 * 두천리_세천_004 는 원본 평가표 값 그대로.
 */
export function smallPublicMockClassValues(
  form: SmallPublicClassForm,
  facilityName: string,
  target: SmallPublicClass,
  grade: SmallPublicGrade,
  lengthM: string | number,
  seed: number
): SmallPublicClassValues {
  if (facilityName === '두천리_세천_004') {
    return smallPublicClassValuesWithAuto(
      form,
      { damage: 1, opinion: 0, attached: 1, landUse: 1, proximity: 2, impact: 2, section: 1, flood: 0 },
      grade,
      lengthM
    )
  }
  const high = target !== '일반'
  const base: SmallPublicClassValues = high
    ? { damage: 1, opinion: seed % 2, attached: 1, landUse: 1 + (seed % 2), proximity: 2, impact: 1 + (seed % 2), section: 1, flood: seed % 3 === 0 ? 1 : 0 }
    : { damage: 0, opinion: 0, attached: seed % 2, landUse: seed % 3 === 0 ? 1 : 0, proximity: 1, impact: 0, section: seed % 2, flood: 0 }
  const values = smallPublicClassValuesWithAuto(form, base, grade, lengthM)
  const total = smallPublicClassTotal(form, values)
  if (high && total < form.threshold) values.section = 2
  if (high && smallPublicClassTotal(form, values) < form.threshold) values.flood = 2
  if (!high && total >= form.threshold) values.proximity = 0
  return values
}
