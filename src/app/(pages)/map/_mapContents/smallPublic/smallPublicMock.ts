/** 소규모 공공시설 — 화면 확인용 예시 자료 (울진군 전산화 자료 일부, 연계·DB 전) */

import {
  SMALL_PUBLIC_GRADES,
  smallPublicGradeFromScore,
  type SmallPublicCandidate,
  type SmallPublicFacType,
  type SmallPublicGrade,
  type SmallPublicInspectionSource,
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

/** 첨부 — url 은 이 화면에서 직접 올린 파일만 있음(예시 자료는 이름만) */
export type SmallPublicFile = {
  id: string
  name: string
  url?: string
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
  planFiles: SmallPublicFile[]
  /** 안전점검 대상으로 등록됨 — 안전점검 «시설 등록»으로 후보지에서 골라 넣음 */
  inspectionTarget: boolean
}

export type SmallPublicInspection = {
  id: string
  facilityId: string
  date: string
  inspector: string
  source: SmallPublicInspectionSource
  score: number
  grade: SmallPublicGrade
  /** 기타의견 */
  remark: string
  /** 원본 점검표 첨부(스캔본 등, 선택) */
  sheet: SmallPublicFile | null
  /** 입력할 때 쓴 평가표 양식 복사본 — 양식이 바뀌어도 이 기록은 이 양식대로 보인다. 연계 결과만 받으면 없음 */
  form?: SmallPublicCheckForm | null
  /** 항목별 점수·상태등급 */
  values?: SmallPublicCheckValues | null
}

/**
 * 실제 조사 자료 PDF(public/mock/smallPublic/{관리번호}/) — 시설 첨부파일(위험도평가 포함).
 * 로그인한 사용자만 받을 수 있는 정적 파일이라 연계·DB 전 화면 확인용으로만 쓴다.
 */
const ATTACHED_DOCS: Record<string, { docs: SmallPublicFile[] }> = (() => {
  const doc = (mngNo: string, file: string, name: string): SmallPublicFile => ({
    id: `${mngNo}-${file}`,
    name,
    url: withBasePath(`/mock/smallPublic/${mngNo}/${file}`),
  })
  const m = 'SSF01FAC00858'
  const n = '두천리_세천_004'
  return {
    [m]: {
      docs: [
        doc(m, 'ledger.pdf', `${n}_소규모공공시설대장.pdf`),
        doc(m, 'summary.pdf', `${n}_요약.pdf`),
        doc(m, 'field-survey.pdf', `${n}_현장조사.pdf`),
        doc(m, 'candidate-eval.pdf', `${n}_후보지평가.pdf`),
        doc(m, 'class-eval.pdf', `${n}_일반·관리시설구분평가.pdf`),
        doc(m, 'risk-eval.pdf', `${n}_안전점검위험도평가.pdf`),
      ],
    },
  }
})()

export function isSmallPublicLine(coords: SmallPublicFacility['coords']): coords is [number, number][] {
  return Array.isArray(coords?.[0])
}

function numText(n: number): string {
  return n ? String(n) : ''
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
    planFiles: ATTACHED_DOCS[r.mngNo]?.docs ?? [],
    inspectionTarget: false,
  }))
}

const REMARK_BY_GRADE: Record<SmallPublicGrade, string> = {
  양호: '',
  보통: '부분 퇴적·마모, 정기 관리 필요',
  불량: '통수단면 부족, 구조물 파손',
}

/**
 * 점검 이력 — 자료의 현장조사(조사일·조사자·위험도)를 첫 점검으로 두고,
 * 일부 시설에 2025·2026년 정기점검을 덧붙인다(점수는 첫 점검 근처).
 * 입력 점검은 항상 평가표 항목 값까지, 연계 점검은 2025년 이후 일부만 항목 값이 넘어온 예시(나머지는 합계·등급만).
 */
export function createSmallPublicMockInspections(facilities: SmallPublicFacility[]): SmallPublicInspection[] {
  const out: SmallPublicInspection[] = []
  facilities.forEach((f, idx) => {
    if (f.candidate === '제외') return
    const base = Number(f.riskScore)
    if (!f.surveyDate || !Number.isFinite(base)) return
    const push = (
      date: string,
      score: number,
      inspector: string,
      source: SmallPublicInspectionSource,
      dataGrade?: string,
      linkedWithItems = false
    ) => {
      const clamped = Math.max(0, Math.min(100, Math.round(score)))
      const grade = (SMALL_PUBLIC_GRADES as readonly string[]).includes(dataGrade ?? '')
        ? (dataGrade as SmallPublicGrade)
        : smallPublicGradeFromScore(clamped)
      /** 입력 점검과 항목이 넘어온 연계 점검은 평가표 항목 값까지, 나머지 연계 점검은 결과(합계·등급)만 */
      if (source === '입력' || linkedWithItems) {
        const form = smallPublicCheckFormFor(f.type, date)
        const values = smallPublicMockCheckValues(form, clamped)
        const total = Object.values(values).reduce((n, v) => n + v.score, 0)
        const formGrade = smallPublicCheckGradeOf(form, total)
        out.push({
          id: `${f.id}-${date}`,
          facilityId: f.id,
          date,
          inspector,
          source,
          score: total,
          grade: formGrade,
          remark: REMARK_BY_GRADE[formGrade],
          sheet: null,
          form,
          values,
        })
        return
      }
      out.push({
        id: `${f.id}-${date}`,
        facilityId: f.id,
        date,
        inspector,
        source,
        score: clamped,
        grade,
        remark: REMARK_BY_GRADE[grade],
        /** 연계 점검은 점검표를 못 받을 수 있어 일단 비움 */
        sheet: null,
      })
    }
    push(f.surveyDate, base, f.surveyor, '연계', f.riskRank)
    if (idx % 2 === 0) {
      push(`2025-03-${String(10 + (idx % 15)).padStart(2, '0')}`, base + ((idx % 5) - 1), '울진군 건설과', '연계', undefined, idx % 4 === 0)
    }
    if (idx % 3 === 0) {
      const source = idx % 6 === 0 ? '입력' : '연계'
      push(`2026-03-${String(12 + (idx % 14)).padStart(2, '0')}`, base + ((idx % 4) - 1), '울진군 건설과', source, undefined, idx % 9 === 3)
    }
  })
  return out
}
