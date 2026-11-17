/**
 * 정비계획 기준 자료 — master_schema.sql 시드 값을 그대로 옮긴 것(DB 적재 전 예시 단계).
 * 배점·구간·단가·지원율·가중치·보상배율·단계 기준은 계산 코드에 직접 쓰지 않고 여기서만 읽는다.
 */

import type { SmallPublicFacType } from '../smallPublicConfig'

export type StdNotice = {
  id: string
  title: string
  agency: string
  no: string | null
  effective: string | null
  reviewDue: string | null
  note: string
}

export const STD_NOTICES: StdNotice[] = [
  { id: 'MOLIT_2026_90', title: '자연재난 복구비용 산정기준 및 사회재난 생활안정지원 항목별 단가', agency: '국토교통부', no: '고시 제2026-90호', effective: '2026-02-19', reviewDue: '2027-12-31', note: '주택파손·침수·소파 단가' },
  { id: 'MOIS_2026_14', title: '자연재난 복구비용 산정기준', agency: '행정안전부', no: '고시 제2026-14호', effective: '2026-03-19', reviewDue: '2028-12-31', note: '구호금, 세입자 보조 단가' },
  { id: 'MAFRA_2026_78', title: '자연재난 복구비용 산정기준', agency: '농림축산식품부', no: '고시 제2026-78호', effective: '2026-07-31', reviewDue: '2029-12-31', note: '농경지·농작물·농림시설·수리시설 단가. 파일명은 개정안이므로 최종 고시본 대조 필요' },
  { id: 'MOIS_DIR_427', title: '자연재난조사 및 복구계획수립 요령', agency: '행정안전부', no: '훈령 제427호', effective: '2026-03-19', reviewDue: '2029-06-30', note: '지원율(부담률), 지원기준지수 산식, 토지보상비 산정 방법' },
  { id: 'GUIDE_2017', title: '자연재해위험개선지구 관리지침', agency: '행정안전부', no: null, effective: null, reviewDue: null, note: '투자우선순위 평가, 가중치(표 4.2.2-5), B/C' },
  { id: 'REPORT_CH4', title: '울진군 소규모 공공시설 정비계획 보고서 4장(용역)', agency: '울진군/용역사', no: null, effective: null, reviewDue: null, note: '배점 15/25/30/20/10, 단계 구분, 시설 170개소 시드' },
  { id: 'FOREST_2026_85', title: '자연재난 복구비용 산정기준 일부개정', agency: '산림청', no: '고시 제2026-85호', effective: null, reviewDue: null, note: '산림작물·임업시설. 현재 시드 미포함(후순위)' },
]

export function stdNoticeOf(id: string | null | undefined): StdNotice | null {
  return STD_NOTICES.find((n) => n.id === id) ?? null
}

export const FACILITY_TYPE_CODE: Record<SmallPublicFacType, string> = {
  세천: 'SEECHEON',
  마을진입로: 'VILLAGE_ROAD',
  농로: 'FARM_ROAD',
  소교량: 'SMALL_BRIDGE',
  낙차공: 'DROP_STRUCT',
  취입보: 'INTAKE_WEIR',
}

/** 선형 시설(길이 기반) */
export const FACILITY_LINE_BASED: Record<SmallPublicFacType, boolean> = {
  세천: true,
  마을진입로: true,
  농로: true,
  소교량: false,
  낙차공: false,
  취입보: false,
}

export type WorkType = { code: string; name: string; unit: string; manualOnly: boolean; note: string }

export const WORK_TYPES: WorkType[] = [
  { code: 'RIVERBANK', name: '호안정비', unit: 'm', manualOnly: false, note: '세천' },
  { code: 'EMBANK_WIDEN', name: '축제 및 확폭', unit: 'm', manualOnly: false, note: '세천' },
  { code: 'PAVE_NEW', name: '비포장→포장', unit: 'm', manualOnly: false, note: '마을진입로·농로' },
  { code: 'REPAVE', name: '재포장', unit: 'm', manualOnly: false, note: '마을진입로·농로' },
  { code: 'ALIGN_IMPROVE', name: '선형개선', unit: 'm', manualOnly: true, note: '길이와 금액 상관 없음(4장 역산 결과) → 시설별 수기' },
  { code: 'BRIDGE_REINSTALL', name: '소교량 재설치', unit: '개소', manualOnly: false, note: '세천·소교량 통합은 규격(L×B) 기반 별도 산정 필요' },
  { code: 'DROP_REINSTALL_L', name: '낙차공 재설치(규모 L 기준)', unit: 'm', manualOnly: false, note: '우선 사용' },
  { code: 'DROP_REINSTALL_EA', name: '낙차공 재설치(개소 기준)', unit: '개소', manualOnly: false, note: '규모 미상일 때 대체' },
  { code: 'INTAKE_WEIR_H08', name: '취입보 언체 H=0.8m', unit: 'm', manualOnly: false, note: '농식품부 고시 복구단가' },
  { code: 'INTAKE_WEIR_H10', name: '취입보 언체 H=1.0m', unit: 'm', manualOnly: false, note: '농식품부 고시 복구단가' },
  { code: 'INTAKE_WEIR_H15', name: '취입보 언체 H=1.5m', unit: 'm', manualOnly: false, note: '농식품부 고시 복구단가' },
  { code: 'INTAKE_GATE', name: '취입수문 0.6×0.6m(문비포함)', unit: '개소', manualOnly: false, note: '농식품부 고시 복구단가' },
]

export function workTypeOf(code: string): WorkType | null {
  return WORK_TYPES.find((w) => w.code === code) ?? null
}

/** 시설 유형별로 먼저 보여 줄 공종(나머지 공종도 고를 수 있음) */
export const WORK_TYPES_BY_FACILITY: Record<SmallPublicFacType, string[]> = {
  세천: ['RIVERBANK', 'EMBANK_WIDEN', 'BRIDGE_REINSTALL', 'DROP_REINSTALL_L', 'ALIGN_IMPROVE'],
  마을진입로: ['PAVE_NEW', 'REPAVE', 'BRIDGE_REINSTALL', 'ALIGN_IMPROVE'],
  농로: ['PAVE_NEW', 'REPAVE', 'BRIDGE_REINSTALL', 'ALIGN_IMPROVE'],
  소교량: ['BRIDGE_REINSTALL'],
  낙차공: ['DROP_REINSTALL_L', 'DROP_REINSTALL_EA'],
  취입보: ['INTAKE_WEIR_H08', 'INTAKE_WEIR_H10', 'INTAKE_WEIR_H15', 'INTAKE_GATE'],
}

export type PriceBasis = 'PROVISIONAL' | 'NOTICE' | 'DESIGN' | 'ESTIMATE'

export const PRICE_BASIS_LABEL: Record<PriceBasis, string> = {
  PROVISIONAL: '임시 단가',
  NOTICE: '고시 단가',
  DESIGN: '설계 단가',
  ESTIMATE: '견적 단가',
}

export type UnitPrice = {
  id: string
  workCode: string
  priceWon: number
  basis: PriceBasis
  noticeId: string | null
  validFrom: string
  validTo: string | null
  note: string
}

export const UNIT_PRICES: UnitPrice[] = [
  { id: 'P1', workCode: 'RIVERBANK', priceWon: 195000, basis: 'PROVISIONAL', noticeId: 'REPORT_CH4', validFrom: '2026-01-01', validTo: null, note: '4장 역산 0.195백만원/m, 단일공종 2개소 일치' },
  { id: 'P2', workCode: 'EMBANK_WIDEN', priceWon: 700000, basis: 'PROVISIONAL', noticeId: 'REPORT_CH4', validFrom: '2026-01-01', validTo: null, note: '4장 역산 0.70백만원/m, 단일공종 7개소 일치' },
  { id: 'P3', workCode: 'PAVE_NEW', priceWon: 153000, basis: 'PROVISIONAL', noticeId: 'REPORT_CH4', validFrom: '2026-01-01', validTo: null, note: '64개소 회귀. 도로폭 차이로 오차 있음' },
  { id: 'P4', workCode: 'REPAVE', priceWon: 134000, basis: 'PROVISIONAL', noticeId: 'REPORT_CH4', validFrom: '2026-01-01', validTo: null, note: '64개소 회귀' },
  { id: 'P5', workCode: 'BRIDGE_REINSTALL', priceWon: 20000000, basis: 'PROVISIONAL', noticeId: 'REPORT_CH4', validFrom: '2026-01-01', validTo: null, note: '마을진입로·농로 소교량 한정(7개소 18~20.6백만원). 세천/통합은 부정확' },
  { id: 'P6', workCode: 'DROP_REINSTALL_L', priceWon: 2190000, basis: 'PROVISIONAL', noticeId: 'REPORT_CH4', validFrom: '2026-01-01', validTo: null, note: '3장 규격 기준 약 2.19백만원/m, 21개소 최대오차 0.56백만원' },
  { id: 'P7', workCode: 'DROP_REINSTALL_EA', priceWon: 8000000, basis: 'PROVISIONAL', noticeId: 'REPORT_CH4', validFrom: '2026-01-01', validTo: null, note: '21개소 평균(4~13백만원)' },
  { id: 'P8', workCode: 'INTAKE_WEIR_H08', priceWon: 3678587, basis: 'NOTICE', noticeId: 'MAFRA_2026_78', validFrom: '2026-07-31', validTo: null, note: '수리시설(취입보) 복구단가' },
  { id: 'P9', workCode: 'INTAKE_WEIR_H10', priceWon: 3672390, basis: 'NOTICE', noticeId: 'MAFRA_2026_78', validFrom: '2026-07-31', validTo: null, note: '' },
  { id: 'P10', workCode: 'INTAKE_WEIR_H15', priceWon: 4755245, basis: 'NOTICE', noticeId: 'MAFRA_2026_78', validFrom: '2026-07-31', validTo: null, note: '' },
  { id: 'P11', workCode: 'INTAKE_GATE', priceWon: 7817073, basis: 'NOTICE', noticeId: 'MAFRA_2026_78', validFrom: '2026-07-31', validTo: null, note: '' },
]

/** 보상배율 48개 권역(요령 별표) — 울진군은 경북 473권역 3.05 */
export const COMP_MULTIPLIERS: { region: string; sido: string; rate: number }[] = [
  ['111', '서울', 1.46], ['112', '서울', 1.44], ['113', '서울', 1.5], ['114', '서울', 1.77], ['115', '서울', 2.3],
  ['261', '부산', 1.92], ['262', '부산', 1.77], ['263', '부산', 2.18], ['264', '부산', 2.51],
  ['271', '대구', 2.0], ['272', '대구', 1.96], ['273', '대구', 2.86],
  ['281', '인천', 1.49], ['282', '인천', 1.8], ['283', '인천', 2.76],
  ['291', '광주', 2.3], ['292', '광주', 2.13], ['301', '대전', 1.69], ['302', '대전', 1.95],
  ['311', '울산', 2.24], ['312', '울산', 2.39], ['361', '세종', 2.76],
  ['411', '경기', 1.83], ['412', '경기', 2.14], ['413', '경기', 1.99], ['414', '경기', 2.36], ['415', '경기', 2.33],
  ['421', '강원', 2.69], ['422', '강원', 2.66], ['423', '강원', 2.63],
  ['431', '충북', 2.22], ['432', '충북', 2.8], ['433', '충북', 2.56],
  ['441', '충남', 2.48], ['442', '충남', 2.4], ['443', '충남', 2.64],
  ['451', '전북', 2.43], ['452', '전북', 2.57],
  ['461', '전남', 2.78], ['462', '전남', 2.93], ['463', '전남', 2.96],
  ['471', '경북', 2.55], ['472', '경북', 2.56], ['473', '경북', 3.05],
  ['481', '경남', 2.28], ['482', '경남', 2.98], ['483', '경남', 3.04],
  ['501', '제주', 3.88],
].map(([region, sido, rate]) => ({ region: String(region), sido: String(sido), rate: Number(rate) }))

/** 시스템 설정값(하드코딩 금지 값) */
export const SYSTEM_PARAMS = {
  ACTIVE_PROFILE: 'CH4_YONGYEOK',
  DAMAGE_DIVISOR: 100000,
  DAMAGE_LOOKBACK_YEARS: 5,
  BC_DEFAULT_SCORE: 15,
  COMP_MULT_MODE: 'REGION' as 'REGION' | 'FIXED',
  COMP_REGION_CODE: '473',
  COMP_FIXED_MULT: 3,
  COMP_PRICE_METHOD: 'SELF' as 'SELF' | 'AVG3_ADJACENT',
  PHASE_MODE: 'RANK_CUT' as 'RANK_CUT' | 'BUDGET',
  PHASE1_RANK_CUT: 80,
  PLAN_PERIOD_YEARS: 5,
}

export const SYSTEM_PARAM_NOTES: { key: keyof typeof SYSTEM_PARAMS; note: string }[] = [
  { key: 'ACTIVE_PROFILE', note: '현재 사용하는 평가 프로파일(배점 체계)' },
  { key: 'DAMAGE_DIVISOR', note: '피해이력 점수 = 지수 / 이 값 × 배점 (최대 배점)' },
  { key: 'DAMAGE_LOOKBACK_YEARS', note: '피해이력 집계 기간(최근 N년)' },
  { key: 'BC_DEFAULT_SCORE', note: 'B/C 미입력 시 기본 점수(4장 170개소 전부 15점)' },
  { key: 'COMP_MULT_MODE', note: 'REGION=지역별 보상배율 / FIXED=고정배수' },
  { key: 'COMP_REGION_CODE', note: '울진군 → 경북 473권역 3.05' },
  { key: 'COMP_FIXED_MULT', note: '4장 방식(표준공시지가 3배)' },
  { key: 'COMP_PRICE_METHOD', note: 'SELF=해당 필지 공시지가 / AVG3_ADJACENT=인접 3필지 평균(요령 문구, 해석 확인 필요)' },
  { key: 'PHASE_MODE', note: 'RANK_CUT=순위 컷 / BUDGET=5개년 예산 상한' },
  { key: 'PHASE1_RANK_CUT', note: '4장 표에서 역산: 최종순위 80위까지 1단계(80개소)' },
  { key: 'PLAN_PERIOD_YEARS', note: '중기계획 주기(법 제9조)' },
]

export type EvalItemCode = 'BC' | 'DAMAGE_IDX' | 'RISK' | 'INCONV' | 'ELAPSED'

export type EvalItem = {
  code: EvalItemCode
  name: string
  max: number
  method: 'BAND' | 'FORMULA' | 'LOOKUP' | 'MANUAL'
  inputMode: 'AUTO' | 'MANUAL' | 'DEFAULT'
  note: string
}

export const EVAL_PROFILE = {
  id: 'CH4_YONGYEOK',
  name: '4장 용역 방식(15/25/30/20/10)',
  noticeId: 'REPORT_CH4',
  status: 'ACTIVE' as const,
}

/** 지금 쓰는 배점 체계(4장 용역 방식) — 관리지침 방식은 구간표 미적재(PENDING) */
export const EVAL_ITEMS: EvalItem[] = [
  { code: 'BC', name: '비용-편익비(B/C)', max: 15, method: 'BAND', inputMode: 'DEFAULT', note: '기본값 15점 또는 담당자 입력 편익 ÷ 분석 사업비 → 구간 점수' },
  { code: 'DAMAGE_IDX', name: '피해이력지수', max: 25, method: 'FORMULA', inputMode: 'AUTO', note: 'min(25, 지수/100000×25)' },
  { code: 'RISK', name: '재해위험도', max: 30, method: 'LOOKUP', inputMode: 'MANUAL', note: '위험등급(가20/나10/다5) + 인명피해(사망10/부상5), 최대 30' },
  { code: 'INCONV', name: '주민불편도', max: 20, method: 'BAND', inputMode: 'AUTO', note: '거주인구(명/ha) 구간' },
  { code: 'ELAPSED', name: '지구선정 경과년수', max: 10, method: 'BAND', inputMode: 'AUTO', note: '지정·고시일로 자동 계산' },
]

/** 구간 점수 [하한, 상한) — null 은 무한 */
export const EVAL_BANDS: Record<'BC' | 'INCONV' | 'ELAPSED', { lower: number | null; upper: number | null; score: number }[]> = {
  BC: [
    { lower: null, upper: 0.5, score: 3 },
    { lower: 0.5, upper: 1.0, score: 6 },
    { lower: 1.0, upper: 2.0, score: 9 },
    { lower: 2.0, upper: 3.0, score: 12 },
    { lower: 3.0, upper: null, score: 15 },
  ],
  INCONV: [
    { lower: null, upper: 5, score: 6 },
    { lower: 5, upper: 20, score: 8 },
    { lower: 20, upper: 50, score: 12 },
    { lower: 50, upper: 100, score: 16 },
    { lower: 100, upper: null, score: 20 },
  ],
  ELAPSED: [
    { lower: null, upper: 1, score: 2 },
    { lower: 1, upper: 3, score: 4 },
    { lower: 3, upper: 5, score: 6 },
    { lower: 5, upper: 10, score: 8 },
    { lower: 10, upper: null, score: 10 },
  ],
}

export type RiskGradeCode = 'GA' | 'NA' | 'DA'
export type RiskCasualtyCode = 'DEATH' | 'INJURY' | 'NONE'

export const RISK_GRADES: { code: RiskGradeCode; name: string; score: number }[] = [
  { code: 'GA', name: '가등급', score: 20 },
  { code: 'NA', name: '나등급', score: 10 },
  { code: 'DA', name: '다등급', score: 5 },
]

export const RISK_CASUALTIES: { code: RiskCasualtyCode; name: string; score: number }[] = [
  { code: 'DEATH', name: '사망', score: 10 },
  { code: 'INJURY', name: '부상', score: 5 },
  { code: 'NONE', name: '없음', score: 0 },
]

/** 동점 처리 순서(4장 4.2.2 나.1) — 피해면적은 입력 항목이 없어 순서만 둔다 */
export const TIE_BREAK: { item: EvalItemCode | 'DAMAGE_AREA'; dir: 'DESC' }[] = [
  { item: 'RISK', dir: 'DESC' },
  { item: 'DAMAGE_IDX', dir: 'DESC' },
  { item: 'INCONV', dir: 'DESC' },
  { item: 'ELAPSED', dir: 'DESC' },
  { item: 'BC', dir: 'DESC' },
  { item: 'DAMAGE_AREA', dir: 'DESC' },
]

export type SuppCode = 'SUSTAIN' | 'POLICY' | 'PLAN'

export const SUPP_ITEMS: { code: SuppCode; name: string; oneWhen: string; zeroWhen: string }[] = [
  { code: 'SUSTAIN', name: '지속성', oneWhen: '민원 없고 주민 호응 좋음', zeroWhen: '민원 있고 호응 낮음' },
  { code: 'POLICY', name: '정책성', oneWhen: '예산확보 가능성·추진의지 높음', zeroWhen: '낮음' },
  { code: 'PLAN', name: '계획성', oneWhen: '관련계획 선행 수립', zeroWhen: '미수립' },
]

/** 최종순위 조정 규칙 — 본문 규칙으로 표가 재현되지 않아 확인 전(UNVERIFIED). 확인 전에는 기초순위를 최종순위로 쓴다 */
export const RANK_ADJUST_RULES: { text: string; status: 'UNVERIFIED' | 'CONFIRMED' }[] = [
  { text: '추진가능성 = 지속성×정책성. 1이면 기초순위 1단계 상향, 0이면 1단계 하향', status: 'UNVERIFIED' },
  { text: '이후 계획성 1이면 1단계 상향, 0이면 1단계 하향. 조정 후 동순위는 기초순위 높은 쪽 우선', status: 'UNVERIFIED' },
  { text: '표 4.2.2-11(170행)과 불일치: 부구리_마을진입로_002(기초155→표111), 월송리_소교량_통합(161→170) 등. 용역사 산식 확인 전까지 표 값을 시드로 사용', status: 'UNVERIFIED' },
]

export type DamageGroupCode = 'DEATH' | 'INJURY' | 'HOUSE_DAMAGE' | 'HOUSE_FLOOD' | 'ETC'

export const DAMAGE_GROUPS: { code: DamageGroupCode; name: string; weight: number }[] = [
  { code: 'DEATH', name: '사망·실종', weight: 10 },
  { code: 'INJURY', name: '부상', weight: 5 },
  { code: 'HOUSE_DAMAGE', name: '주택파손', weight: 4 },
  { code: 'HOUSE_FLOOD', name: '주택침수', weight: 2 },
  { code: 'ETC', name: '기타', weight: 0.5 },
]

export type DamageItem = {
  code: string
  group: DamageGroupCode
  name: string
  unit: string
  unitPriceWon: number
  supportRate: number
  noticeId: string
  active: boolean
  confirmNote: string
}

const di = (
  code: string,
  group: DamageGroupCode,
  name: string,
  unit: string,
  unitPriceWon: number,
  supportRate: number,
  noticeId: string,
  active = true,
  confirmNote = ''
): DamageItem => ({ code, group, name, unit, unitPriceWon, supportRate, noticeId, active, confirmNote })

export const DAMAGE_ITEMS: DamageItem[] = [
  di('HOUSE_FULL_LT66', 'HOUSE_DAMAGE', '주택파손(유실·전파) 66㎡ 미만', '동', 73000000, 0.3, 'MOLIT_2026_90'),
  di('HOUSE_FULL_66_82', 'HOUSE_DAMAGE', '주택파손(유실·전파) 66~82㎡ 미만', '동', 87000000, 0.3, 'MOLIT_2026_90'),
  di('HOUSE_FULL_82_98', 'HOUSE_DAMAGE', '주택파손(유실·전파) 82~98㎡ 미만', '동', 102000000, 0.3, 'MOLIT_2026_90'),
  di('HOUSE_FULL_98_114', 'HOUSE_DAMAGE', '주택파손(유실·전파) 98~114㎡ 미만', '동', 116000000, 0.3, 'MOLIT_2026_90'),
  di('HOUSE_FULL_GE114', 'HOUSE_DAMAGE', '주택파손(유실·전파) 114㎡ 이상', '동', 131000000, 0.3, 'MOLIT_2026_90'),
  di('HOUSE_HALF_LT66', 'HOUSE_DAMAGE', '주택파손(반파) 66㎡ 미만', '동', 36500000, 0.3, 'MOLIT_2026_90'),
  di('HOUSE_HALF_66_82', 'HOUSE_DAMAGE', '주택파손(반파) 66~82㎡ 미만', '동', 43500000, 0.3, 'MOLIT_2026_90'),
  di('HOUSE_HALF_82_98', 'HOUSE_DAMAGE', '주택파손(반파) 82~98㎡ 미만', '동', 51000000, 0.3, 'MOLIT_2026_90'),
  di('HOUSE_HALF_98_114', 'HOUSE_DAMAGE', '주택파손(반파) 98~114㎡ 미만', '동', 58000000, 0.3, 'MOLIT_2026_90'),
  di('HOUSE_HALF_GE114', 'HOUSE_DAMAGE', '주택파손(반파) 114㎡ 이상', '동', 65500000, 0.3, 'MOLIT_2026_90'),
  di('HOUSE_FLOOD', 'HOUSE_FLOOD', '주택침수', '세대', 3500000, 1.0, 'MOLIT_2026_90'),
  di('HOUSE_MINOR', 'ETC', '주택소파(지진 한정)', '동', 900000, 1.0, 'MOLIT_2026_90', false, '지진 피해에 한정, 4장 가중치 표에 항목 없음 → 비활성'),
  di('TENANT_AID', 'ETC', '세입자 보조(상한 단가, 실금액 입력 가능)', '세대', 6000000, 1.0, 'MOIS_2026_14', true, '실제 보증금 또는 6개월 임대료 입력 시 지원기준지수 직접 입력'),
  di('DEATH_MISSING', 'DEATH', '사망·실종 구호금', '인', 20000000, 1.0, 'MOIS_2026_14', true, '요령은 피해액 산정 제외, 관리지침은 가중치 10 → 반영 방식 발주처 확인'),
  di('INJURY_1_7', 'INJURY', '부상(1~7급) 구호금', '인', 10000000, 1.0, 'MOIS_2026_14', true, '사망·실종과 동일하게 확인 필요'),
  di('INJURY_8_14', 'INJURY', '부상(8~14급) 구호금', '인', 5000000, 1.0, 'MOIS_2026_14', true, '사망·실종과 동일하게 확인 필요'),
]

/** 지원기준지수(천원) = 단가 × 지원율 ÷ 1,000 */
export function damageSupportIndex(item: DamageItem): number {
  return (item.unitPriceWon * item.supportRate) / 1000
}

export function damageGroupOf(code: DamageGroupCode) {
  return DAMAGE_GROUPS.find((g) => g.code === code)!
}

/** 설계서 5장 확인 필요 항목 — 임의 확정 금지, 결과 화면 산출근거에 표시 */
export const PLAN_PENDING_ITEMS: string[] = [
  '배점 체계: 4장 방식(15/25/30/20/10) vs 관리지침(8개 항목 확인분)',
  '사망·부상의 피해이력지수 반영 방식(요령 «피해액 제외» vs 관리지침 가중치 10/5), 재해위험도 인명피해 가점과 함께 반영 시 이중 반영 여부',
  '피해이력 집계 기간(최근 5년)의 기준일 — 분석 기준일이면 기존 계획 수립 당시 피해가 빠짐',
  '지구선정 경과년수 기준일 — 기존 계획은 모두 2점(지정 1년 미만 시점)인데 분석은 오늘 기준이라 새 분석이 유리함',
  'B/C — 기존 계획은 모두 기본 15점(만점)이라 편익을 넣으면 점수가 같거나 낮아짐. 전 시설 적용 여부',
  '공시지가 기준(표준 vs 개별), 인접 3필지 평균 해석, 보상배율 3.05 vs 고정 3배 적용 여부',
  '부가평가 이후 최종순위 산식(본문과 표 불일치) — 확인 전까지 기초순위를 최종순위로 사용',
  '1단계 분류 기준이 순위 80위 컷인지 예산 기준인지',
  '공종별 정식 단가표(호안·확폭·포장·소교량·낙차공)와 소교량 규격 표기 순서',
  '농식품부 고시 최종본 대조',
  '주민불편도 영향범위 면적 정의(선형 시설)',
  '정비사업 재원 구분과 e호조 연계 방식',
]

/** 분석 이후 담당자가 할 일(순서) — 협의·실시설계 입력과 명세서 반영은 추후 연결 */
export const PLAN_FOLLOWUP_GUIDE: { title: string; detail: string }[] = [
  { title: '분석 입력·저장', detail: '정비내용·사업비·평가를 채우고 «저장»으로 정비계획에 넣는다.' },
  { title: '유관기관 협의', detail: '하천·농어촌·도로 관리청 등 사업 구간 관련 기관과 협의한다(사업시행 중 영향 조치 포함).' },
  { title: '보상 협의', detail: '편입 필지는 「공익사업을 위한 토지 등의 취득 및 보상에 관한 법률」에 따라 감정평가 후 협의한다.' },
  { title: '실시설계', detail: '실시설계로 공사비·보상비를 확정하고, 개략 사업비를 실시설계 금액으로 바꾼다.' },
  { title: '연차 배분·예산 확보', detail: '연간 예산과 시행주체 협의로 연차를 정한다(1단계는 5년 이내 추진 가능 시설).' },
  { title: '공사 발주·확정', detail: '예산·공사에서 공사대장에 등록하면 정비계획이 확정되고 명세서 연차에 반영된다.' },
]

/** 기본적 평가 항목별 산정기준(보고서 표) */
export const EVAL_CRITERIA: Record<EvalItemCode, { table: string; rule: string }> = {
  BC: { table: '표 4.2.2-4', rule: 'B/C = 편익 ÷ 사업비 · 3.0 이상 15 · 2.0~3.0 12 · 1.0~2.0 9 · 0.5~1.0 6 · 0.5 미만 3 (편익 미입력 시 기본 15)' },
  DAMAGE_IDX: { table: '표 4.2.2-5', rule: '피해이력지수 / 100,000 × 25' },
  RISK: { table: '표 4.2.2-6', rule: '위험등급 가 20 · 나 10 · 다 5 + 인명피해 사망 10 · 부상 5(최대 30)' },
  INCONV: { table: '표 4.2.2-7', rule: '거주인구 ÷ 면적(명/ha) 100 이상 20 · 50~100 16 · 20~50 12 · 5~20 8 · 5 미만 6' },
  ELAPSED: { table: '표 4.2.2-8', rule: '지정 경과 10년 이상 10 · 5~10 8 · 3~5 6 · 1~3 4 · 1년 미만 2' },
}
