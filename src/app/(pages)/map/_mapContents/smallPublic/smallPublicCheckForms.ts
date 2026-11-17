/**
 * 소규모 공공시설 위험도 평가표(점검표) 양식 — 유형·버전별 문서 하나.
 * 항목이 바뀌면 이전 버전을 고치지 않고 새 버전을 추가한다. 점검 기록에는 그때 쓴 양식을 복사해 두므로
 * 옛 기록은 옛 양식대로 다시 그려진다. key 는 버전이 바뀌어도 같은 항목이면 그대로 둔다(항목별 비교용).
 * 출처: 울진군 소규모 공공시설 안전점검 및 정비계획 «소규모 공공시설 위험도 평가 항목»(표 3.2.1-5).
 */

import type { SmallPublicFacType, SmallPublicGrade } from './smallPublicConfig'

export type SmallPublicStateGrade = 'A' | 'B' | 'C'
export const SMALL_PUBLIC_STATE_GRADES: SmallPublicStateGrade[] = ['A', 'B', 'C']

export type SmallPublicCheckItem = {
  key: string
  label: string
  /** 배점 */
  max: number
  /** 이 항목에서 쓰지 않는 상태등급(평가표의 사선 칸) */
  disabled?: SmallPublicStateGrade[]
}

export type SmallPublicCheckGroup = { name: string; items: SmallPublicCheckItem[] }

export type SmallPublicCheckForm = {
  id: string
  facType: SmallPublicFacType
  /** 화면 표시용 버전 이름 */
  version: string
  /** 이 날짜부터 새 점검에 쓴다 */
  effectiveFrom: string
  /** 상태등급별 점수 범위 */
  stateRange: Record<SmallPublicStateGrade, [number, number]>
  /** 합계점수 → 등급(위에서부터, max 이하이면 그 등급. 마지막은 max 없음) */
  gradeRule: { max?: number; grade: SmallPublicGrade }[]
  groups: SmallPublicCheckGroup[]
}

/** 항목별 입력 값 — 점수를 넣으면 상태등급이 정해진다 */
export type SmallPublicCheckValues = Record<string, { score: number; state: SmallPublicStateGrade }>

const STATE_RANGE: SmallPublicCheckForm['stateRange'] = { A: [0, 3], B: [4, 6], C: [7, 10] }
const GRADE_RULE: SmallPublicCheckForm['gradeRule'] = [
  { max: 30, grade: '양호' },
  { max: 70, grade: '보통' },
  { grade: '불량' },
]

const item = (key: string, label: string, disabled?: SmallPublicStateGrade[]): SmallPublicCheckItem => ({
  key,
  label,
  max: 10,
  ...(disabled ? { disabled } : {}),
})

/** 마을진입로·농로 공통(10번만 다름) */
const roadGroups = (place: string): SmallPublicCheckGroup[] => [
  {
    name: '구조적 문제점',
    items: [
      item('road_narrow', '도로폭 협소(교행불가 등)'),
      item('road_alignment', '선형불량(심한완곡, 시야 미확보 등)'),
      item('road_safety_fac', '안전시설(난간 등) 유·무'),
      item('road_subsidence', '지반침하 여부'),
    ],
  },
  {
    name: '기능성',
    items: [
      item('road_pavement', '포장상태 불량 및 파손 여부'),
      item('road_unpaved', '비포장으로 인한 피해 여부'),
      item('road_unevenness', '노면의 요철 여부'),
    ],
  },
  {
    name: '시설물 파손',
    items: [
      item('road_structure_damage', '구조물 파손으로 인한 피해 여부'),
      item('road_drain_capacity', '배수로 통수능 부족 여부'),
    ],
  },
  { name: '기타', items: [item('road_location', `${place} 입지에 따른 위험성`)] },
]

/** 취입보·낙차공 공통(6번만 다름) */
const weirGroups = (functionLabel: string): SmallPublicCheckGroup[] => [
  {
    name: '구조적 안정성',
    items: [
      item('weir_body', '본체 노후 및 파손여부'),
      item('weir_wingwall', '옹벽(본체 양쪽) 파손여부'),
      item('weir_apron', '바닥보호공 파손여부'),
      item('weir_scour', '본체와 제방 접합부 세굴여부'),
      item('weir_overflow', '본체 높이에 따른 제방 월류', ['B']),
    ],
  },
  {
    name: '기능성',
    items: [
      item('weir_function', functionLabel),
      item('weir_machine', '기계장치(조작실, 권양기 등) 파손여부'),
    ],
  },
  { name: '침식/퇴적', items: [item('weir_erosion', '상·하류부 침식/퇴적에 따른 피해')] },
  {
    name: '기타',
    items: [
      item('weir_social', '철거민원 등 사회, 환경적 영향'),
      item('weir_fishway', '어도 유무 및 파손 여부'),
    ],
  },
]

const GROUPS_BY_TYPE: Record<SmallPublicFacType, SmallPublicCheckGroup[]> = {
  세천: [
    {
      name: '과거피해 이력',
      items: [
        item('past_damage', '과거 인명 및 재산피해 이력'),
        item('inundation', '제내지 침수피해 이력'),
      ],
    },
    {
      name: '시설물 안전성',
      items: [
        item('levee_section', '제방단면 부족 및 파손여부'),
        item('revetment', '호안 유·무, 노후화 및 파손상태'),
        item('other_fac_aging', '기타시설물(통관, 문비 등) 노후화'),
      ],
    },
    {
      name: '재해유발 가능성',
      items: [
        item('channel_width', '하폭 부족 또는 급축소'),
        item('channel_erosion', '하도 침식/퇴적에 따른 위험성'),
        item('debris_capacity', '유송잡물, 식생에 따른 통수능 부족'),
        item('location_risk', '입지여건(취락지 등)에 따른 위험성'),
      ],
    },
    { name: '기타', items: [item('artificial_damage', '인위적인 훼손(사람, 동물 등) 및 세천의 점용(경작 등)')] },
  ],
  소교량: [
    {
      name: '구조적 안정성',
      items: [
        item('bridge_crack', '교량 부분파손, 콘크리트 균열'),
        item('bridge_rebar', '철근노출 및 부식 여부'),
        item('bridge_scour', '교각, 교대 등의 세굴피해'),
        item('bridge_aging', '노후교량, 구조물의 안정성 등'),
      ],
    },
    {
      name: '홍수 위험성',
      items: [
        item('bridge_levee_erosion', '제방 접합부 침식에 의한 피해'),
        item('bridge_freeboard', '여유고 부족, 월류로 인한 피해여부'),
        item('bridge_small_scale', '하폭에 비해 작은 규모의 교량', ['B']),
        item('bridge_span', '경간장 부족에 의한 피해 여부'),
      ],
    },
    {
      name: '기타',
      items: [
        item('bridge_traffic', '입지여건(통행량)에 따른 위험'),
        item('bridge_flood_passage', '홍수시 통행자 위험성(세월교 등)'),
      ],
    },
  ],
  취입보: weirGroups('취수기능 상실여부'),
  마을진입로: roadGroups('마을진입로'),
  농로: roadGroups('농로'),
  낙차공: weirGroups('낙차기능 상실여부'),
}

/** 유형별 양식 버전 목록(오래된 것부터). 지금은 1판만 있음 */
export const SMALL_PUBLIC_CHECK_FORMS: SmallPublicCheckForm[] = (
  Object.keys(GROUPS_BY_TYPE) as SmallPublicFacType[]
).map((facType) => ({
  id: `${facType}-1`,
  facType,
  version: '1판(2020 정비계획)',
  effectiveFrom: '2019-01-01',
  stateRange: STATE_RANGE,
  gradeRule: GRADE_RULE,
  groups: GROUPS_BY_TYPE[facType],
}))

/** 이 날짜에 쓰는 양식 — 적용일이 그 날짜 이전인 것 중 가장 최근 */
export function smallPublicCheckFormFor(facType: SmallPublicFacType, date: string): SmallPublicCheckForm {
  const forms = SMALL_PUBLIC_CHECK_FORMS.filter((f) => f.facType === facType)
  let picked = forms[0]!
  for (const f of forms) if (f.effectiveFrom <= date) picked = f
  return picked
}

export function smallPublicCheckItems(form: SmallPublicCheckForm): SmallPublicCheckItem[] {
  return form.groups.flatMap((g) => g.items)
}

/** 점수 → 상태등급(양식의 범위 기준) */
export function smallPublicStateOf(form: SmallPublicCheckForm, score: number): SmallPublicStateGrade | null {
  return SMALL_PUBLIC_STATE_GRADES.find((s) => score >= form.stateRange[s][0] && score <= form.stateRange[s][1]) ?? null
}

/** 합계점수 → 등급(양식의 기준) */
export function smallPublicCheckGradeOf(form: SmallPublicCheckForm, total: number): SmallPublicGrade {
  for (const r of form.gradeRule) if (r.max == null || total <= r.max) return r.grade
  return form.gradeRule[form.gradeRule.length - 1]!.grade
}

/** 등급 기준 안내 글자 — «양호(30점 이하), 보통(31~70점), 불량(71점 이상)» */
export function smallPublicGradeRuleText(form: SmallPublicCheckForm): string {
  let prevMax = -1
  return form.gradeRule
    .map((r) => {
      const text =
        r.max == null
          ? `${r.grade}(${prevMax + 1}점 이상)`
          : prevMax < 0
            ? `${r.grade}(${r.max}점 이하)`
            : `${r.grade}(${prevMax + 1}~${r.max}점)`
      if (r.max != null) prevMax = r.max
      return text
    })
    .join(', ')
}

/**
 * 예시 자료 — 합계점수에 맞춰 항목 점수를 고르게 나눠 채운다(입력 점검 예시의 평가표용).
 * 사선 칸(쓰지 않는 등급)에 걸리면 가까운 허용 점수로 옮긴다.
 */
export function smallPublicMockCheckValues(form: SmallPublicCheckForm, total: number): SmallPublicCheckValues {
  const items = smallPublicCheckItems(form)
  const values: SmallPublicCheckValues = {}
  let left = Math.max(0, Math.min(total, items.length * 10))
  items.forEach((it, idx) => {
    const remainItems = items.length - idx
    let score = Math.min(it.max, Math.round(left / remainItems))
    let state = smallPublicStateOf(form, score)!
    if (it.disabled?.includes(state)) {
      score = form.stateRange.A[1]
      state = 'A'
    }
    values[it.key] = { score, state }
    left -= score
  })
  return values
}
