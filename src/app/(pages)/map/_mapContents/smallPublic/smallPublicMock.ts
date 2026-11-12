/** 소규모 공공시설 — 화면 확인용 예시 자료 (울진군 전산화 자료 일부, 연계·DB 전) */

import {
  type SmallPublicCandidate,
  type SmallPublicClass,
  type SmallPublicFacType,
  type SmallPublicGrade,
} from './smallPublicConfig'
import { withBasePath } from '@/lib/basePath'
import {
  smallPublicCheckFormFor,
  smallPublicCheckGradeOf,
  smallPublicMockCheckValues,
  type SmallPublicCheckForm,
  type SmallPublicCheckValues,
} from './smallPublicCheckForms'
import { SMALL_PUBLIC_MOCK_ROWS } from './smallPublicMockData'
import {
  smallPublicClassFormFor,
  smallPublicClassOf,
  smallPublicClassTotal,
  smallPublicMockClassValues,
  type SmallPublicClassForm,
  type SmallPublicClassValues,
} from './smallPublicClassForms'
import { type SmallPublicCandidateResult } from './smallPublicCandidateForms'

/** 첨부 용도 — 후보지평가 / 안전점검 / 그 외(요약·대장) */
export type SmallPublicFileKind = 'candidate' | 'safety' | 'other'

/** 안전점검 자료 종류 */
export type SmallPublicSafetyKind = 'risk' | 'class' | 'field'

/** 첨부 — url 은 이 화면에서 직접 올린 파일만 있음(예시 자료는 이름만) */
export type SmallPublicFile = {
  id: string
  name: string
  url?: string
  kind: SmallPublicFileKind
}

/** 시설 피해이력 — 정비계획 분석 피해이력지수의 원본 */
export type SmallPublicDamageEvent = {
  id: string
  occurredOn: string
  itemCode: string | null
  qty: number | null
  overrideSupportIndex: number | null
  note?: string
}

/** 속성은 전산화 자료 항목과 같음(관리번호·시설명·도형코드·유형·읍면명·리명·주소·시점·종점좌표·위험도등급·점수·수혜지역·위험시설지정일·현장조사일자·조사자·후보지·연장·폭·높이) */
export type SmallPublicFacility = {
  id: string
  mngNo: string
  name: string
  geomCode: string
  type: SmallPublicFacType
  emd: string
  ri: string
  address: string
  startXy: string
  endXy: string
  /** 자료에 들어 있던 위험도 — 점검 이력이 있으면 화면은 최근 점검을 보여 줌 */
  riskRank: string
  riskScore: string
  benefitArea: string
  riskDate: string
  surveyDate: string
  surveyor: string
  candidate: SmallPublicCandidate
  length: string
  width: string
  height: string
  /** EPSG:5187 — 선은 좌표 목록, 점은 한 좌표. 새로 등록하며 위치를 아직 안 찍었으면 null */
  coords: [number, number] | [number, number][] | null
  /** 첨부파일 탭(요약·대장 등). 평가·점검 파일은 각 이력에 둔다 */
  planFiles: SmallPublicFile[]
  /** 시설 피해이력(정비계획 분석이 읽어 감) */
  damageEvents: SmallPublicDamageEvent[]
  /** 계속 점검 대상(예외) — 일반·관리가 아니어도 새 안전점검 보고서에 들어감(위험시설 재점검 등) */
  inspectionTarget: boolean
}

export type SmallPublicInspection = {
  id: string
  facilityId: string
  date: string
  inspector: string
  score: number
  grade: SmallPublicGrade
  /** 평가구분(일반·관리·위험) — 구분 평가 결과. 가장 최근 점검의 값이 시설 구분이 된다 */
  classResult: SmallPublicClass
  /** 그해 일반시설·관리시설 구분 평가(없으면 그해는 구분 평가 안 함) */
  classEval: { form: SmallPublicClassForm; values: SmallPublicClassValues; total: number } | null
  /** 이 점검을 넣은 안전점검 보고서 — 같은 연도라도 보고서마다 점검을 따로 본다(현장조사 자료는 없음) */
  reportId?: string | null
  /** 기타의견 */
  remark: string
  /** 평가할 때 쓴 평가표 양식 복사본 — 양식이 바뀌어도 이 기록은 이 양식대로 보인다 */
  form: SmallPublicCheckForm
  /** 항목별 점수·상태등급 */
  values: SmallPublicCheckValues
  /** 위험도 평가 첨부 */
  file?: SmallPublicFile | null
  /** 일반·관리 평가 첨부 */
  classFile?: SmallPublicFile | null
}

/** 후보지 평가 — 첨부 파일 + 평가일·평가자·선정여부 */
export type SmallPublicCandidateEval = {
  id: string
  facilityId: string
  date: string
  evaluator: string
  result: SmallPublicCandidateResult
  remark: string
  file: SmallPublicFile | null
}

/**
 * 안전점검 1건 — 위험도·현장조사·일반·관리 평가 PDF를 한꺼번에 묶을 수 있다.
 * 목록에는 «안전점검»으로만 보인다.
 */
export type SmallPublicSafetyDoc = {
  id: string
  facilityId: string
  date: string
  /** 작성 */
  person: string
  remark: string
  /** 묶음 첨부(위험도·현장조사·일반·관리 등) */
  files: SmallPublicFile[]
  /** 어떤 자료를 넣었는지(위험도만도 가능) */
  includes: { risk: boolean; field: boolean; class: boolean }
}

/**
 * 실제 조사 자료 PDF(public/mock/smallPublic/{관리번호}/) — 용도별로 나눔.
 * 로그인한 사용자만 받을 수 있는 정적 파일이라 연계·DB 전 화면 확인용으로만 쓴다.
 */
const SAMPLE_MNG = 'SSF01FAC00858'

function mockDoc(file: string, name: string, kind: SmallPublicFileKind, idSuffix = ''): SmallPublicFile {
  return {
    id: `${SAMPLE_MNG}-${file}${idSuffix ? `-${idSuffix}` : ''}`,
    name,
    url: withBasePath(`/mock/smallPublic/${SAMPLE_MNG}/${file}`),
    kind,
  }
}

const SAMPLE_LABEL = '두천리_세천_004'

export function isSmallPublicLine(coords: SmallPublicFacility['coords']): coords is [number, number][] {
  return Array.isArray(coords?.[0])
}

function numText(n: number): string {
  return n ? String(n) : ''
}

/** 시험·분석 예시용 피해이력(시설명 기준) */
const SAMPLE_DAMAGE: Record<string, SmallPublicDamageEvent[]> = {
  봉평리_세천_002: [
    { id: 'de-a-1', occurredOn: '2023-08-10', itemCode: 'HOUSE_FLOOD', qty: 2, overrideSupportIndex: null },
    { id: 'de-a-2', occurredOn: '2023-08-10', itemCode: 'TENANT_AID', qty: 1, overrideSupportIndex: null },
  ],
  명도리_낙차공_001: [
    { id: 'de-b-1', occurredOn: '2022-09-06', itemCode: 'HOUSE_HALF_LT66', qty: 1, overrideSupportIndex: null },
    { id: 'de-b-2', occurredOn: '2022-09-06', itemCode: 'INJURY_8_14', qty: 1, overrideSupportIndex: null },
  ],
  온정리_소교량_010: [
    { id: 'de-c-1', occurredOn: '2023-07-15', itemCode: 'HOUSE_FLOOD', qty: 1, overrideSupportIndex: null },
  ],
  [SAMPLE_LABEL]: [
    { id: 'de-sample-1', occurredOn: '2022-08-20', itemCode: 'HOUSE_FLOOD', qty: 1, overrideSupportIndex: null, note: '호우로 주택 침수' },
  ],
}

export function createSmallPublicMockFacilities(): SmallPublicFacility[] {
  return SMALL_PUBLIC_MOCK_ROWS.map((r) => ({
    id: r.mngNo || `${r.type}-${r.geomCode}`,
    mngNo: r.mngNo,
    name: r.name,
    geomCode: r.geomCode,
    type: r.type,
    emd: r.emd,
    ri: r.ri,
    address: r.address,
    startXy: r.startXy,
    endXy: r.endXy,
    riskRank: r.riskRank,
    riskScore: r.riskScore,
    benefitArea: r.benefitArea,
    riskDate: r.riskDate,
    surveyDate: r.surveyDate,
    surveyor: r.surveyor,
    candidate: r.candidate,
    length: numText(r.length),
    width: numText(r.width),
    height: numText(r.height),
    coords: r.coords,
    planFiles:
      r.mngNo === SAMPLE_MNG
        ? [
            mockDoc('ledger.pdf', `${SAMPLE_LABEL}_소규모공공시설대장.pdf`, 'other'),
            mockDoc('summary.pdf', `${SAMPLE_LABEL}_요약.pdf`, 'other'),
          ]
        : [],
    damageEvents: SAMPLE_DAMAGE[r.name] ?? [],
    inspectionTarget: false,
  }))
}

const REMARK_BY_GRADE: Record<SmallPublicGrade, string> = {
  양호: '',
  보통: '부분 퇴적·마모, 정기 관리 필요',
  불량: '통수단면 부족, 구조물 파손',
}

/**
 * 점검 이력 — 자료의 현장조사(조사일·조사자)를 첫 점검으로 두고, 일부 시설에 2025·2026년 정기점검을 덧붙인다.
 * 일반·관리 시설은 위험도 불량이 나오지 않게 점수를 눌러 자료의 구분과 맞춘다.
 * 구분 평가는 짝수 인덱스만(해마다 없을 수 있음).
 */
export function createSmallPublicMockInspections(facilities: SmallPublicFacility[]): SmallPublicInspection[] {
  const out: SmallPublicInspection[] = []
  facilities.forEach((f, idx) => {
    if (f.candidate === '제외') return
    const target: SmallPublicClass = f.candidate
    const classForm = smallPublicClassFormFor(f.type)
    const base = Number(f.riskScore)
    if (!f.surveyDate || !Number.isFinite(base)) return
    const push = (date: string, score: number, inspector: string, withClass: boolean, attachSample: boolean) => {
      const form = smallPublicCheckFormFor(f.type, date)
      const cap = target === '위험' ? 100 : 68
      const values = smallPublicMockCheckValues(form, Math.max(0, Math.min(cap, Math.round(score))))
      const total = Object.values(values).reduce((n, v) => n + v.score, 0)
      const grade = smallPublicCheckGradeOf(form, total)
      const classValues = withClass ? smallPublicMockClassValues(classForm, f.name, target, grade, f.length, idx) : null
      const classResult = classValues
        ? smallPublicClassOf(classForm, classValues, grade, target === '위험' ? '위험' : null)
        : target
      out.push({
        id: `${f.id}-${date}`,
        facilityId: f.id,
        date,
        inspector,
        score: total,
        grade,
        classResult,
        classEval: classValues
          ? { form: classForm, values: classValues, total: smallPublicClassTotal(classForm, classValues) }
          : null,
        remark: REMARK_BY_GRADE[grade],
        form,
        values,
        file:
          attachSample && f.mngNo === SAMPLE_MNG
            ? mockDoc('risk-eval.pdf', `${SAMPLE_LABEL}_안전점검위험도평가.pdf`, 'safety')
            : null,
        classFile:
          attachSample && withClass && f.mngNo === SAMPLE_MNG
            ? mockDoc('class-eval.pdf', `${SAMPLE_LABEL}_일반·관리시설구분평가.pdf`, 'safety')
            : null,
      })
    }
    const sample = f.mngNo === SAMPLE_MNG
    push(f.surveyDate, base, f.surveyor, idx % 2 === 0, sample)
    if (idx % 2 === 0) {
      push(
        `2025-03-${String(10 + (idx % 15)).padStart(2, '0')}`,
        base + ((idx % 5) - 1),
        '울진군 건설과',
        true,
        sample
      )
    }
    if (idx % 3 === 0) {
      push(
        `2026-03-${String(12 + (idx % 14)).padStart(2, '0')}`,
        base + ((idx % 4) - 1),
        '울진군 건설과',
        idx % 2 === 0,
        false
      )
    }
  })
  return out
}

/** 후보지 과거이력 — 파일+메타(선정·선정제외). 예시 세천은 선정만(선정제외 없음) */
export function createSmallPublicMockCandidateEvals(facilities: SmallPublicFacility[]): SmallPublicCandidateEval[] {
  const out: SmallPublicCandidateEval[] = []
  for (const f of facilities) {
    const baseDate = f.surveyDate || '2019-12-31'
    out.push({
      id: `ce-${f.id}-1`,
      facilityId: f.id,
      date: baseDate,
      evaluator: f.surveyor || '정비계획 용역',
      result: f.candidate === '제외' ? '선정제외' : '선정',
      remark: f.candidate === '제외' ? '사유지 분쟁 지역' : '',
      file:
        f.mngNo === SAMPLE_MNG
          ? mockDoc('candidate-eval.pdf', `${SAMPLE_LABEL}_후보지평가.pdf`, 'candidate', 'ce1')
          : null,
    })
    if (f.mngNo === SAMPLE_MNG) {
      out.push({
        id: `ce-${f.id}-2`,
        facilityId: f.id,
        date: '2024-06-18',
        evaluator: '울진군 건설과',
        result: '선정',
        remark: '보완 조사 후 재평가',
        file: mockDoc('candidate-eval.pdf', `${SAMPLE_LABEL}_후보지평가_보완.pdf`, 'candidate', 'ce2'),
      })
      out.push({
        id: `ce-${f.id}-3`,
        facilityId: f.id,
        date: '2025-03-12',
        evaluator: '동진엔지니어링(주)',
        result: '선정',
        remark: '정기 재평가 — 선정 유지',
        file: mockDoc('candidate-eval.pdf', `${SAMPLE_LABEL}_후보지평가_2025.pdf`, 'candidate', 'ce3'),
      })
    }
  }
  return out
}

/**
 * 정비계획 이관 확인용 — «두천리_세천_004»(관리)를 2026년 보고서 점검에서 위험으로 바꾼다.
 * 정비계획 확정 목록에 없는 시설이라 «정비계획 이관» 대상에 바로 나타난다.
 */
export function applySmallPublicPlanTransferDemo(
  facilities: SmallPublicFacility[],
  inspections: SmallPublicInspection[]
): { facilities: SmallPublicFacility[]; inspections: SmallPublicInspection[] } {
  const demo = facilities.find((f) => f.mngNo === SAMPLE_MNG && (f.candidate === '관리' || f.candidate === '일반'))
  if (!demo) return { facilities, inspections }
  const date = '2026-03-20'
  const form = smallPublicCheckFormFor(demo.type, date)
  const values = smallPublicMockCheckValues(form, 72)
  const demoInsp: SmallPublicInspection = {
    id: `${demo.id}-${date}-xfer-demo`,
    facilityId: demo.id,
    date,
    inspector: '울진군 건설과',
    score: 72,
    grade: '불량',
    classResult: '위험',
    classEval: null,
    remark: '이관 예시 — 점검 결과 위험시설로 전환',
    form,
    values,
    reportId: 'report-sample-2026',
    file: mockDoc('risk-eval.pdf', `${SAMPLE_LABEL}_안전점검위험도평가_이관예시.pdf`, 'safety', 'xfer'),
    classFile: null,
  }
  return {
    inspections: [...inspections, demoInsp],
    facilities: facilities.map((f) =>
      f.id === demo.id
        ? {
            ...f,
            candidate: '위험',
            riskRank: '불량',
            riskScore: '72',
            riskDate: f.riskDate || date,
            inspectionTarget: true,
          }
        : f
    ),
  }
}

/**
 * 안전점검 묶음 — 예시 세천의 점검·이관 서사와 맞춤
 * (현장조사 → 2023 정기 → 2025 보완 → 2026 이관 위험도)
 */
export function createSmallPublicMockSafetyDocs(facilities: SmallPublicFacility[]): SmallPublicSafetyDoc[] {
  const f = facilities.find((x) => x.mngNo === SAMPLE_MNG)
  if (!f) return []
  return [
    {
      id: `sd-${f.id}-1`,
      facilityId: f.id,
      date: f.surveyDate || '2019-12-31',
      person: f.surveyor || '울진군 건설과',
      remark: '최초 현장조사·위험도·구분평가',
      includes: { risk: true, field: true, class: true },
      files: [
        mockDoc('risk-eval.pdf', `${SAMPLE_LABEL}_안전점검위험도평가.pdf`, 'safety', 'sd1'),
        mockDoc('class-eval.pdf', `${SAMPLE_LABEL}_일반·관리시설구분평가.pdf`, 'safety', 'sd1'),
        mockDoc('field-survey.pdf', `${SAMPLE_LABEL}_현장조사.pdf`, 'safety', 'sd1'),
      ],
    },
    {
      id: `sd-${f.id}-2`,
      facilityId: f.id,
      date: '2023-09-21',
      person: '동진엔지니어링(주)',
      remark: '정기 안전점검',
      includes: { risk: true, field: true, class: false },
      files: [
        mockDoc('risk-eval.pdf', `${SAMPLE_LABEL}_안전점검위험도평가_2023.pdf`, 'safety', 'sd2'),
        mockDoc('field-survey.pdf', `${SAMPLE_LABEL}_현장조사_2023.pdf`, 'safety', 'sd2'),
      ],
    },
    {
      id: `sd-${f.id}-3`,
      facilityId: f.id,
      date: '2025-04-08',
      person: '울진군 건설과',
      remark: '2025년 보고서 위험도 보완',
      includes: { risk: true, field: false, class: false },
      files: [mockDoc('risk-eval.pdf', `${SAMPLE_LABEL}_안전점검위험도평가_2025.pdf`, 'safety', 'sd3')],
    },
    {
      id: `sd-${f.id}-4`,
      facilityId: f.id,
      date: '2026-03-20',
      person: '울진군 건설과',
      remark: '2026년 점검 — 위험시설 전환(정비계획 이관)',
      includes: { risk: true, field: false, class: false },
      files: [mockDoc('risk-eval.pdf', `${SAMPLE_LABEL}_안전점검위험도평가_이관예시.pdf`, 'safety', 'sd4')],
    },
  ]
}
