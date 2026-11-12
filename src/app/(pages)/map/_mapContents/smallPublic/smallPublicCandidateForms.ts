/**
 * 후보지 평가표 — 항목마다 여·부. 하나라도 «여»면 선정제외, 모두 «부»면 선정.
 * 세천은 원본 양식(시설규모·시설기능 및 형태·시설위치 8항목). 그 밖의 유형은 양식 확인 전 임시 항목.
 */

import type { SmallPublicFacType } from './smallPublicConfig'
import type { SmallPublicFacility } from './smallPublicMock'

export type SmallPublicCandidateAnswer = '여' | '부'
export type SmallPublicCandidateResult = '선정' | '선정제외'

export type SmallPublicCandidateItem = {
  key: string
  group: string
  label: string
  criterion: string
  /** 제원 칸 — 시설 자료로 채움 */
  spec?: 'length' | 'width'
}

export type SmallPublicCandidateForm = {
  id: string
  facType: SmallPublicFacType
  version: string
  note?: string
  items: SmallPublicCandidateItem[]
}

const LOCATION_ITEMS: SmallPublicCandidateItem[] = [
  { key: 'privateLand', group: '시설위치', label: '사유지내(분쟁 및 민원지역)', criterion: '·' },
  { key: 'devPlanned', group: '시설위치', label: '개발예정지내', criterion: '·' },
  { key: 'restricted', group: '시설위치', label: '제한지역내(군부대 등)', criterion: '·' },
]

const SEECHEON: SmallPublicCandidateForm = {
  id: 'cand-세천-1',
  facType: '세천',
  version: '1판(2020 정비계획)',
  items: [
    { key: 'length', group: '시설규모', label: '세천연장 부족 여부', criterion: '50m 이상', spec: 'length' },
    { key: 'width', group: '시설규모', label: '세천폭 부족 여부', criterion: '1.0m 이상', spec: 'width' },
    { key: 'farmCanal', group: '시설기능 및 형태', label: '농수로', criterion: '·' },
    { key: 'mountainCanal', group: '시설기능 및 형태', label: '산지수로', criterion: '·' },
    { key: 'urbanSewer', group: '시설기능 및 형태', label: '도시지역 우수관거', criterion: '·' },
    ...LOCATION_ITEMS,
  ],
}

function provisionalForm(facType: SmallPublicFacType): SmallPublicCandidateForm {
  return {
    id: `cand-${facType}-임시`,
    facType,
    version: '임시 항목',
    note: '세천 외 유형은 원본 양식 확인 전 임시 항목입니다.',
    items: [
      { key: 'length', group: '시설규모', label: `${facType} 연장 부족 여부`, criterion: '양식 확인', spec: 'length' },
      { key: 'width', group: '시설규모', label: `${facType} 폭 부족 여부`, criterion: '양식 확인', spec: 'width' },
      ...LOCATION_ITEMS,
    ],
  }
}

export function smallPublicCandidateFormFor(facType: SmallPublicFacType): SmallPublicCandidateForm {
  return facType === '세천' ? SEECHEON : provisionalForm(facType)
}

export function smallPublicCandidateSpecOf(f: SmallPublicFacility, item: SmallPublicCandidateItem): string {
  if (item.spec === 'length') return f.length ? `${f.length}m` : '—'
  if (item.spec === 'width') return f.width ? `${f.width}m` : '—'
  return '·'
}

/** 모든 항목을 골라야 결과가 나온다 */
export function smallPublicCandidateResultOf(
  form: SmallPublicCandidateForm,
  values: Record<string, SmallPublicCandidateAnswer>
): SmallPublicCandidateResult | null {
  if (form.items.some((i) => !values[i.key])) return null
  return form.items.some((i) => values[i.key] === '여') ? '선정제외' : '선정'
}
