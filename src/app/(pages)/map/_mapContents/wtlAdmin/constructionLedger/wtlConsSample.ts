/** 상수 공사대장 예시 — docs/wtl_cons_as_202610201021.md (엑셀 컬럼) */

export type WtlConsWork = {
  id: string
  consCode: string
  name: string
  location: string
  volume: string
  amountPre: string
  amountVar: string
  amountCha: string
  amountAft: string
  contDate: string
  startDate: string
  doneDate: string
  sdoneDate: string
  company: string
  ceo: string
  companyAddr: string
  companyPhone: string
  directorPos: string
  directorName: string
  reason: string
  descript: string
  /** EPSG:5181 WKT */
  geomWkt5181: string | null
  attachments: WtlConsAttachment[]
}

export type WtlConsAttachment = {
  id: string
  name: string
  kind: 'image' | 'pdf' | 'file'
  sizeLabel: string
  registeredAt: string
  /** 목 썸네일용 색상 */
  thumbHue: number
}

export type WtlConsProject = {
  id: string
  name: string
  periodLabel: string
  totalAmountLabel: string
  totalAmount: number
  workCount: number
  changeCount: number
  location: string
  /** 목업 급수블록 (검색 필터용) */
  supplyBlock: string
  amountPreLabel: string
  amountAftLabel: string
  startDate: string
  doneDate: string
  descript: string
  works: WtlConsWork[]
}

/** 사업목록 급수블록 검색 옵션 */
export const WTL_CONS_SUPPLY_BLOCKS = [
  '춘산1블록',
  '가음1블록',
  '신평1블록',
  '다인1블록',
  '비안1블록',
  '구천1블록',
  '안계1블록',
  '봉양1블록',
] as const

/** 위치·사업명으로 급수블록 추정(목업) */
export function guessSupplyBlock(name: string, location: string): string {
  const s = `${name} ${location}`
  if (/춘산/.test(s)) return '춘산1블록'
  if (/가음/.test(s)) return '가음1블록'
  if (/신평/.test(s)) return '신평1블록'
  if (/다인|가원|달제/.test(s)) return '다인1블록'
  if (/비안/.test(s)) return '비안1블록'
  if (/구천/.test(s)) return '구천1블록'
  if (/안계|안사/.test(s)) return '안계1블록'
  if (/봉양|금성/.test(s)) return '봉양1블록'
  return '춘산1블록'
}

/** 읍면동·리·급수블록·키워드로 사업 필터 */
export function matchProjectFilters(
  project: WtlConsProject,
  opts: {
    query?: string
    emdName?: string
    riName?: string
    supplyBlock?: string
  }
): boolean {
  const q = String(opts.query ?? '').trim().toLowerCase()
  const emd = String(opts.emdName ?? '').trim()
  const ri = String(opts.riName ?? '').trim()
  const block = String(opts.supplyBlock ?? '').trim()

  if (q) {
    const hit =
      project.name.toLowerCase().includes(q) ||
      project.location.toLowerCase().includes(q) ||
      project.periodLabel.toLowerCase().includes(q) ||
      project.works.some(
        (w) =>
          w.name.toLowerCase().includes(q) || w.location.toLowerCase().includes(q)
      )
    if (!hit) return false
  }

  const locBlob = [project.location, project.name, ...project.works.map((w) => w.location)].join(' ')
  if (emd && !locBlob.includes(emd)) return false
  if (ri && !locBlob.includes(ri.replace(/리$/, '') ) && !locBlob.includes(ri)) return false
  if (block && project.supplyBlock !== block) return false
  return true
}

/** 엑셀 컬럼 한글명 (cons_data_as 필드정의와 동일) */
export const WTL_CONS_FIELD_LABEL = {
  consCode: '공사코드',
  name: '공사명',
  location: '공사위치',
  volume: '공사량',
  amountPre: '사업비_전',
  amountVar: '사업비_증가',
  amountCha: '사업비_감소',
  amountAft: '사업비_후',
  contDate: '계약일',
  startDate: '착수일자',
  doneDate: '준공일자',
  sdoneDate: '실준공일자',
  company: '업체명',
  ceo: '대표자명',
  companyAddr: '업체주소',
  companyPhone: '전화번호',
  directorPos: '감독관',
  directorName: '감독관명',
  reason: '변경사유',
  descript: '비고',
  projectName: '사업명',
} as const

function parseAmount(raw: string): number {
  const n = Number(String(raw ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function formatAmount(n: number): string {
  return n > 0 ? n.toLocaleString('ko-KR') + '원' : '—'
}

/** 리스트용: 2021-02-01 → 21.02.01 */
export function shortYearDate(raw: string): string {
  const s = String(raw ?? '').trim()
  if (!s) return '—'
  const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  if (m) {
    const yy = m[1].slice(-2)
    const mm = m[2].padStart(2, '0')
    const dd = m[3].padStart(2, '0')
    return `${yy}.${mm}.${dd}`
  }
  return s.replace(/\b20(\d{2})\b/g, '$1').replace(/-/g, '.')
}

/** 리스트 기간란: 준공일(없으면 실준공일)만 */
function periodOf(works: WtlConsWork[]): string {
  const ends = works.map((w) => w.doneDate || w.sdoneDate).filter(Boolean).sort()
  return shortYearDate(ends[ends.length - 1] ?? '')
}

function mockAttachments(workId: string, name: string): WtlConsAttachment[] {
  const base = name.slice(0, 10)
  return [
    { id: workId + '-f1', name: base + '_현장사진.jpg', kind: 'image', sizeLabel: '1.2MB', registeredAt: '2024-03-12', thumbHue: 210 },
    { id: workId + '-f2', name: base + '_준공도면.pdf', kind: 'pdf', sizeLabel: '840KB', registeredAt: '2024-03-12', thumbHue: 0 },
    { id: workId + '-f3', name: '내역서.pdf', kind: 'pdf', sizeLabel: '620KB', registeredAt: '2024-03-15', thumbHue: 0 },
    { id: workId + '-f4', name: '현황사진2.jpg', kind: 'image', sizeLabel: '980KB', registeredAt: '2024-03-16', thumbHue: 145 },
  ]
}

const RAW = [
  {
    "gid": "14",
    "cons_code": "GS0190",
    "cons_name": "2022년 춘산~가음면 급수구역 확장사업 변경설계서 (총괄 5회) (05월)",
    "cons_locat": "가음면, 금성면, 봉양면, 춘산면 일원",
    "cons_volum": "1. 상수도 관부설공사 -배수지 1개소, 송수가압장 2개소, 배수가압장 8개소, 관로공",
    "amount_pre": "24,963,840,000",
    "amount_var": "",
    "amount_cha": "774,300,000",
    "amount_aft": "24,189,540,000",
    "cont_date": "",
    "start_date": "2021-02-01",
    "done_date": "2022-06-09",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "1. 물가변동 적용 2. 품질관리자 실정보고 3. ASP공법변경 실정보고 4. 수압시험 실정보고 5. 수량산출오류 정산 6. 암판정결과 7. 양지가압장 유량계실 추가 실정보고 8. 춘산배수관로 관부설공법변경 실정보고 9. 소규모유량계 실정보고 10. 사토장 선정 및 운반비 정산",
    "descript": "상수",
    "geomWkt5181": "MULTIPOLYGON (((351628.30991421745 318821.63138119463, 351622.73812080605 318837.13928520377, 351640.9827150246 318843.69433672976, 351646.55450843635 318828.186432722, 351628.30991421745 318821.63138119463)))"
  },
  {
    "gid": "15",
    "cons_code": "GS0200",
    "cons_name": "2022년 춘산~가음면 급수구역 확장사업 변경설계서 (3차 3회)",
    "cons_locat": "가음면, 춘산면 일원",
    "cons_volum": "1. 상수도 관부설공사",
    "amount_pre": "5,704,966,000",
    "amount_var": "234,440,000",
    "amount_cha": "",
    "amount_aft": "5,939,406,000",
    "cont_date": "",
    "start_date": "2021-02-01",
    "done_date": "2022-06-09",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "1. 물가변동 적용 2. 춘산배수관로 관부설공법변경 실정보고 3. 소규모유량계 실정보고 4. 사토장 선정 및 운반비 정산 5. 간접비 6. 차선도색, 과속방지턱 수량증가 7. ASP공법변경 실정보고 8. 수압시험 9. 수량산출오류 정산",
    "descript": "상수",
    "geomWkt5181": "MULTIPOLYGON (((351628.30991421745 318821.63138119463, 351622.73812080605 318837.13928520377, 351640.9827150246 318843.69433672976, 351646.55450843635 318828.186432722, 351628.30991421745 318821.63138119463)))"
  },
  {
    "gid": "8",
    "cons_code": "GS0188",
    "cons_name": "2021년 춘산~가음면 급수구역 확장사업 설계도 2차 3회 변경",
    "cons_locat": "가음면 귀천리 143-2번지 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "9",
    "cons_code": "GS0168",
    "cons_name": "2021년 춘산~가음면 급수구역 확장사업 변경설계서 (2차 3회) (04월)",
    "cons_locat": "가음면, 금성면, 봉양면, 춘산면 일원",
    "cons_volum": "1. 상수도 관부설공사",
    "amount_pre": "5,667,100,000",
    "amount_var": "",
    "amount_cha": "149,600,000",
    "amount_aft": "5,517,500,000",
    "cont_date": "",
    "start_date": "2020-02-03",
    "done_date": "2021-05-01",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "1. 물가변동 적용 2. 혼합골재 이탈방지용 부직포설치 3. 금성가압장 유량계설치 4. 터파기/육상리핑암 적용 5. 차선도색 수용성도색으로 변경 적용 6. 사토장 선정 및 운반비 정산 7. 급수관로 소운반 8. ASP포장 방법 변경 9. 수량산출 오류에 의한 정산보고",
    "descript": "상수",
    "geomWkt5181": "MULTIPOLYGON (((351628.30991421745 318821.63138119463, 351622.73812080605 318837.13928520377, 351640.9827150246 318843.69433672976, 351646.55450843635 318828.186432722, 351628.30991421745 318821.63138119463)))"
  },
  {
    "gid": "10",
    "cons_code": "GS0141",
    "cons_name": "2020년 춘산~가음면 급수구역 확장사업 변경설계서 (1차 2회) (06월)",
    "cons_locat": "금성면, 봉양면, 춘산면 일원",
    "cons_volum": "1. 토목공사 1식",
    "amount_pre": "8,554,270,000",
    "amount_var": "149,740,000",
    "amount_cha": "",
    "amount_aft": "8,704,010,000",
    "cont_date": "",
    "start_date": "2019-03-04",
    "done_date": "2020-06-30",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "1. 물가변동 적용 2. 가설 사무실 E.G.I휀스 설치 3. 품질시험차량 비용 반영 4. 봉양 배수관로D150 추가 시공 및 노후관 병행구간 공제 반영 4. 혼합골재 이탈방지용 부직포 설치 5. 금성급수분구 송수관로 ALINE 내충격관D80㎜ 추가 병행 시공 6. D50㎜ 내충격관 이탈방지",
    "descript": "상수",
    "geomWkt5181": "MULTIPOLYGON (((351628.30991421745 318821.63138119463, 351622.73812080605 318837.13928520377, 351640.9827150246 318843.69433672976, 351646.55450843635 318828.186432722, 351628.30991421745 318821.63138119463)))"
  },
  {
    "gid": "11",
    "cons_code": "GS0166",
    "cons_name": "2020년 춘산~가음면 급수구역 확장사업 설계도 (1차 2회 변경)",
    "cons_locat": "금성면, 봉양면, 춘산면 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "57",
    "cons_code": "GS0264",
    "cons_name": "2012년 다인면 지방상수도 공급사업 기본 및 실시설계 보고서 (부록) (01월)",
    "cons_locat": "다인면 덕지리 1139번지 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "58",
    "cons_code": "GS0266",
    "cons_name": "2012년 다인면 지방상수도 공급사업 기본 및 실시설계용역 관계철",
    "cons_locat": "안계면, 다인면 일원",
    "cons_volum": "1. 기본 및 실시설계: 2. 수도노선측량:74.7km 3. 토질조사:43공 4. 도시계획시설(변경)결정 1식",
    "amount_pre": "953,000,000",
    "amount_var": "163,000,000",
    "amount_cha": "",
    "amount_aft": "1,116,000,000",
    "cont_date": "2010-03-22",
    "start_date": "2010-03-29",
    "done_date": "2012-01-04",
    "sdone_date": "2012-01-04",
    "busin_name": "㈜도화엔지니어링",
    "ceo_name": "이윤한",
    "busin_addr": "서울특별시 강남구 대치동 942-1",
    "busin_phon": "",
    "direct_pos": "지방공업주사보",
    "direct_nam": "김승구",
    "reason": "1. 다인면 구제역관련 가축매몰 지역과 병행 설계",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "64",
    "cons_code": "GS0268",
    "cons_name": "2014년 다인면 지방상수도 공급사업 (3차분) 설계서 (토목, 기계)",
    "cons_locat": "다인면, 안계면 일원",
    "cons_volum": "1. 토목공사 -신다인배수지: V=1,000m³(신설) -배수관로: D300~80mm, L=1.79km =기존관로 시설개량 1식 2. 기계공사 1식",
    "amount_pre": "1,042,000,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "66",
    "cons_code": "GS0270",
    "cons_name": "2014년 다인면 지방상수도 공급사업 (3차분 1회 변경) 설계변경",
    "cons_locat": "다인면 달제리 475-2번지 일원",
    "cons_volum": "1. 신다인배수지(V=1000톤), L=1.79㎞(배수관 L=0.43㎞ D300, L=2.24㎞ D80)",
    "amount_pre": "1,042,000,000",
    "amount_var": "39,800,000",
    "amount_cha": "",
    "amount_aft": "1,081,800,000",
    "cont_date": "",
    "start_date": "2014-03-10",
    "done_date": "2014-12-14",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "1. 신다인배수지 시공방법개선 및 현장여건을 고려한 공사량 조정 2. 배수관로 시공여건에 따른 노선 및 부대공사 조정 3. 사토운반 및 골재원선정에 따른 운반거리 변경 4. 공사량 변경에 따른 관급자재 및 폐기물수량 변경",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "67",
    "cons_code": "GS0271",
    "cons_name": "2014년 다인면 지방상수도 공급사업 (3차분 2회 변경) 설계변경",
    "cons_locat": "다인면 달제리 475-2번지 일원",
    "cons_volum": "1. 배수시설: 신다인배수지(V=1,000톤) 2. 배수관로: L=2.67㎞ 3. 기존관로 시설개량 1식",
    "amount_pre": "1,081,800,000",
    "amount_var": "",
    "amount_cha": "49,400,000",
    "amount_aft": "1,032,400,000",
    "cont_date": "2014-03-07",
    "start_date": "2014-03-10",
    "done_date": "2014-12-14",
    "sdone_date": "",
    "busin_name": "㈜세영종합건설",
    "ceo_name": "정민호",
    "busin_addr": "안동시 옥동 765-8",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "1. 공사추진 내용에 따른 공사량정산 및 대형공사장 기동감찰 조치사항 반영",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "68",
    "cons_code": "GS0274",
    "cons_name": "2016년 다인면 지방상수도 공급사업 (5차분) 설계서 (1) (01월)",
    "cons_locat": "다인면 달제리 475-2번지 일원",
    "cons_volum": "1. 정수시설 -안계정수장: 부대공사 1식 2. 배수시설 1)신다인배수지: 부대공사 1식 2)안계배수지: 부대공사 1식 3. 송배수및급수관로 1)배수관로:D250~D80mm, L=16.4km 2)급수관로:D63~D20mm,L=1.86km",
    "amount_pre": "3,500,000,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "2016-01-00",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "59",
    "cons_code": "GS0265",
    "cons_name": "2012년 구제역 관련 다인지구 지방상수도 공급사업 실정보고서류 (도화 (다인) 2012-088호 첨부물) (3월)",
    "cons_locat": "다인면 가원리 1381번지 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "274",
    "cons_code": "GS0388",
    "cons_name": "2012년 구제역 관련 다인지구 지방상수도 공급사업 공사관계철 (3)",
    "cons_locat": "다인면 달제리 475-2번지 일원",
    "cons_volum": "1. 배수관로 D80~300㎜, L=33.8㎞ 2. 급수관로 D20~60㎜, L=27.5㎞",
    "amount_pre": "8,164,000,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "2011-04-26",
    "done_date": "2012-03-30",
    "sdone_date": "",
    "busin_name": "㈜삼화건설",
    "ceo_name": "전영수",
    "busin_addr": "경산시 정평동 246-32",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "275",
    "cons_code": "GS0389",
    "cons_name": "2012년 구제역 관련 다인지구 지방상수도 공급사업 실정보고 관계철",
    "cons_locat": "다인면 달제리 475-2번지 일원",
    "cons_volum": "1. 배수관로 D80~300㎜, L=33.2㎞ 2. 급수관로 D20~60㎜, L=30.5㎞",
    "amount_pre": "5,006,290,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "㈜삼화건설",
    "ceo_name": "전영수",
    "busin_addr": "경산시 정평동 246-32",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "1. 가압장 용량 변경에 따른 가압펌프 및 배관규격 조정 2. 가압장 위치 변경에 따른 토목부대공 수량 조정",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "273",
    "cons_code": "GS0387",
    "cons_name": "2012년 구제역 관련 다인지구 지방상수도 공급사업 공사관계철 (2)",
    "cons_locat": "다인면 달제리 475-2번지 일원",
    "cons_volum": "1. 배수관로 D80~300㎜, L=33.2㎞ 2. 급수관로 D20~60㎜, L=30.5㎞ 3. 가압장 1개소",
    "amount_pre": "8,367,000,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "2011-04-26",
    "done_date": "2012-03-31",
    "sdone_date": "",
    "busin_name": "㈜삼화건설",
    "ceo_name": "전영수",
    "busin_addr": "경산시 정평동 246-32",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "272",
    "cons_code": "GS0386",
    "cons_name": "2012년 구제역 관련 다인지구 지방상수도 공급사업 공사관계철 (1)",
    "cons_locat": "다인면 달제리 475-2번지 일원",
    "cons_volum": "1. 배수가압장 2. 배·급수관로",
    "amount_pre": "4,388,568,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "2011-04-20",
    "start_date": "2011-04-26",
    "done_date": "2011-12-21",
    "sdone_date": "",
    "busin_name": "㈜삼화건설",
    "ceo_name": "전영수",
    "busin_addr": "경산시 정평동 246-32",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "335",
    "cons_code": "GS0475",
    "cons_name": "2012년 구제역 관련 다인지구 지방상수도 공급사업 변경설계도 (2회 변경) (03월)",
    "cons_locat": "다인면 달제리 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "435",
    "cons_code": "GS0811",
    "cons_name": "2017년 비안면 지방상수도 공급사업 가압펌프장 설치공사",
    "cons_locat": "비안면 산제리 일원",
    "cons_volum": "1. 펌프설치 1식",
    "amount_pre": "72,240,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "72,240,000",
    "cont_date": "2017-06-13",
    "start_date": "2017-06-14",
    "done_date": "2017-07-12",
    "sdone_date": "2017-07-12",
    "busin_name": "㈜오원산업",
    "ceo_name": "오정희",
    "busin_addr": "의성읍 용연1길 30-5",
    "busin_phon": "",
    "direct_pos": "지방시설주사보",
    "direct_nam": "김민수",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": "MULTIPOLYGON (((351628.30991421745 318821.63138119463, 351622.73812080605 318837.13928520377, 351640.9827150246 318843.69433672976, 351646.55450843635 318828.186432722, 351628.30991421745 318821.63138119463)))"
  },
  {
    "gid": "571",
    "cons_code": "GS1019",
    "cons_name": "2015년 비안면 지방상수도 공급사업 설계서 (02월)",
    "cons_locat": "비안면 일원",
    "cons_volum": "1. 관로공: D16 L=4600m, D25 L=4015m, D40 L=6563m, D50 L=2475m, D75 L=9897m, D100 L=4444m, D150 L=2539m",
    "amount_pre": "3,855,370,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "3,855,370,000",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "574",
    "cons_code": "GS1022",
    "cons_name": "2015년 비안면 지방상수도 공급사업 (1차분) 변경 설계예산서 (12월)",
    "cons_locat": "비안면 일원",
    "cons_volum": "1. 관로공D16 L-2560.0m, D25 L=1970.0m, D40 L=27099.0m, D50 L=781.0m 구조물공:가압변실0개소, 공기변실 4개소, 제수밸브보호통113개소",
    "amount_pre": "1,426,000,000",
    "amount_var": "142,000",
    "amount_cha": "",
    "amount_aft": "1,426,142,000",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": "MULTIPOLYGON (((337960.72332514543 314503.15388002, 338005.0122085479 314483.6505185213, 338029.18825040566 314475.9304379276, 338056.0053724642 314464.1471570226, 338070.42973357195 314454.8017963063, 338157.58538026875 314373.74095007917, 338152.7095398945 314368.66194968903, 338062.7096529786 314452.16071610263, 338049.0979319345 314460.08395671076, 338026.5471702013 314469.22615741275, 338002.5742883595 314477.1493980222, 337956.4569648176 314494.2148393331, 337960.72332514543 314503.15388002)))"
  },
  {
    "gid": "580",
    "cons_code": "GS1028",
    "cons_name": "2015년 비안면 지방상수도 공급사업",
    "cons_locat": "비안면 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "581",
    "cons_code": "GS1029",
    "cons_name": "2015년 비안면 지방상수도 공급사업 설계도면_1",
    "cons_locat": "비안면 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "591",
    "cons_code": "GS1043",
    "cons_name": "2017년 비안면 지방상수도 공급사업 (3차)",
    "cons_locat": "비안면 일원",
    "cons_volum": "1. 급배수관로(D50~16) L=2.2㎞, 절삭포장 A=1,7398㎡",
    "amount_pre": "334,963,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "334,963,000",
    "cont_date": "2017-01-24",
    "start_date": "2017-01-24",
    "done_date": "2018-04-06",
    "sdone_date": "2017-08-25",
    "busin_name": "㈜청토산업",
    "ceo_name": "조점식",
    "busin_addr": "김천시 직지천 우안길 59",
    "busin_phon": "",
    "direct_pos": "지방시설주사보",
    "direct_nam": "김민수",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "371",
    "cons_code": "GS0512",
    "cons_name": "2018년 구천면 지방상수도 공급사업 (소호, 장국, 청산2) 전기공사",
    "cons_locat": "구천면 소호리 일원",
    "cons_volum": "1. 토공: 터파기 및 되메우기 1식 2. 전기설치공: 전력케이블신설, 전선관 배관 및 접지공사 1식 3. 주요자재: 계량기함, 배선용차단기, 전선관 및 접지자재 1식",
    "amount_pre": "6,480,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "6,480,000",
    "cont_date": "2016-11-11",
    "start_date": "2016-11-12",
    "done_date": "2016-12-10",
    "sdone_date": "2016-12-09",
    "busin_name": "㈜대륙전기",
    "ceo_name": "김근회",
    "busin_addr": "의성읍 후죽 1길 11",
    "busin_phon": "",
    "direct_pos": "지방시설주사보",
    "direct_nam": "김민수",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "742",
    "cons_code": "GS1271",
    "cons_name": "2015년 구천면 지방상수도 공급사업",
    "cons_locat": "구천면 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "755",
    "cons_code": "GS1284",
    "cons_name": "2015년 구천면 지방상수도 공급사업 설계 변경서 (총괄분 1회) (12월)",
    "cons_locat": "구천면 일원",
    "cons_volum": "1. D16 L=3,416.0m, D25 L=3,560.0m, D40 L=0.0m, D50 L=5,610.0m, D75 L=6,434.0m, D100 L=7,815.0m, 가압변실 4개소, 공기변실 10개소, 제수밸브 보호통 214개소",
    "amount_pre": "3,573,814,680",
    "amount_var": "223,475,320",
    "amount_cha": "",
    "amount_aft": "3,797,290,000",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "지방시설서기",
    "direct_nam": "김기경",
    "reason": "1. 관로공 D16, D25 D40 D50 D75 D100 길이 연장에 따른 변동",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "756",
    "cons_code": "GS1285",
    "cons_name": "2015년 구천면 지방상수도 공급사업 설계서 (02월)",
    "cons_locat": "구천면 일원",
    "cons_volum": "1. 급배수관로(D16 ~ 100mm) L=26.61km, 가압장 3개소",
    "amount_pre": "3,092,784,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "3,092,784,000",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "758",
    "cons_code": "GS1287",
    "cons_name": "2015년 구천면 지방상수도 공급사업 설계 변경서 (1차분 1회) (12월)",
    "cons_locat": "구천면 일원",
    "cons_volum": "1. 관로공 D16 L=1,876m D25 L=856m D50 L=1,872m D75 L=3,012m D100 L=2,250m 가압변실 1개소, 공기변실 2개소, 제수밸브 보호통 80개소",
    "amount_pre": "985,551,000",
    "amount_var": "8,449,000",
    "amount_cha": "",
    "amount_aft": "994,000,000",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "761",
    "cons_code": "GS1291",
    "cons_name": "2015년 구천면 지방상수도 공급사업 실시설계용역",
    "cons_locat": "구천면 일원",
    "cons_volum": "1. 실시설계 1식 2. 조사측량 1식(L=1㎞)",
    "amount_pre": "19,400,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "19,400,000",
    "cont_date": "2014-12-29",
    "start_date": "2014-12-31",
    "done_date": "2015-02-18",
    "sdone_date": "2015-02-16",
    "busin_name": "㈜청구이엔씨",
    "ceo_name": "이인영",
    "busin_addr": "김천시 부거리길 8",
    "busin_phon": "",
    "direct_pos": "지방공업주사보",
    "direct_nam": "김승구",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "30",
    "cons_code": "GS0177",
    "cons_name": "2021년 신평면 지방상수도 공급사업 설계서",
    "cons_locat": "신평면 검곡리 252-2번지 일원",
    "cons_volum": "1. 관로 L=33.2㎞, 배수지 1개소, 가압장 4개소",
    "amount_pre": "8,500,000,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "6",
    "cons_code": "GS0174",
    "cons_name": "2021년 신평면 지방상수도 공급사업 (1차분 제 1회) 설계변경서",
    "cons_locat": "신평면 교안리, 청운리, 검곡리 일원",
    "cons_volum": "1. 상수관로(D16~150㎜), L=2.666m",
    "amount_pre": "645,920,000",
    "amount_var": "63,796,000",
    "amount_cha": "",
    "amount_aft": "709,716,000",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "㈜중앙수도설비공사",
    "ceo_name": "강영림",
    "busin_addr": "영주시 풍기읍 기주로 106-1",
    "busin_phon": "",
    "direct_pos": "지방시설주사보",
    "direct_nam": "정무영",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "7",
    "cons_code": "GS0210",
    "cons_name": "2023년 신평면 지방상수도 공급사업 (3차)",
    "cons_locat": "신평면 청운리 739-4번지 일원",
    "cons_volum": "1. 상수관로 (D16~150㎜), L=10,316m",
    "amount_pre": "5,635,737,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "2023-01-19",
    "start_date": "2023-01-20",
    "done_date": "2024-01-19",
    "sdone_date": "",
    "busin_name": "㈜중앙수도설비공사",
    "ceo_name": "강영림",
    "busin_addr": "영주시 풍기읍 기주로 106-1",
    "busin_phon": "",
    "direct_pos": "지방시설주사",
    "direct_nam": "권기득",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "31",
    "cons_code": "GS0172",
    "cons_name": "2021년 신평면 지방상수도 공급사업",
    "cons_locat": "신평면 교안리, 청운리, 검곡리 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "32",
    "cons_code": "GS0175",
    "cons_name": "2021년 신평면 지방상수도 공급사업 (총괄분) 설계서",
    "cons_locat": "신평면 교안리, 청운리, 검곡리 일원",
    "cons_volum": "1. 상수관로(D16~150㎜), L=33,208.5m",
    "amount_pre": "7,362,162,060",
    "amount_var": "207,826,940",
    "amount_cha": "",
    "amount_aft": "7,569,989,000",
    "cont_date": "2021-04-22",
    "start_date": "2021-05-03",
    "done_date": "2024-05-01",
    "sdone_date": "",
    "busin_name": "㈜중앙수도설비공사",
    "ceo_name": "강영림",
    "busin_addr": "영주시 풍기읍 기주로 106-1",
    "busin_phon": "",
    "direct_pos": "지방시설주사보",
    "direct_nam": "정무영",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "33",
    "cons_code": "GS0176",
    "cons_name": "2021년 신평면 지방상수도 공급사업 (총괄분) 제 1회 설계변경",
    "cons_locat": "신평면 교안리, 청운리, 검곡리 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "1046",
    "cons_code": "GS1652",
    "cons_name": "2011년 구제역 관련 안사면 쌍호지구 지방상수도 공급사업 설계도 (1) (12월)",
    "cons_locat": "안계면 및 안사면 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "1047",
    "cons_code": "GS1653",
    "cons_name": "2011년 구제역 관련 안사면 쌍호지구 지방상수도 공급사업 설계도 (2) (12월)",
    "cons_locat": "안계면 및 안사면 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "1048",
    "cons_code": "GS1654",
    "cons_name": "2011년 구제역 관련 안사면 쌍호지구 지방상수도 공급사업 설계서 (12월)",
    "cons_locat": "안계면 및 안사면 일원",
    "cons_volum": "1. L=29.3㎞ D=20~150㎜, 가압장 1개소, 가정급수공사 262가구",
    "amount_pre": "4,615,760,000",
    "amount_var": "",
    "amount_cha": "140,830,000",
    "amount_aft": "4,474,930,000",
    "cont_date": "2011-12-29",
    "start_date": "2012-01-05",
    "done_date": "2012-11-20",
    "sdone_date": "2012-11-20",
    "busin_name": "㈜대웅종합건설",
    "ceo_name": "서종락",
    "busin_addr": "포항시 남구 이동 237",
    "busin_phon": "",
    "direct_pos": "지방공업주사보",
    "direct_nam": "김승구",
    "reason": "1. 급수구역 확대 2. 현장여건 및 공사추진내용에 따른 공사량 정산변경",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "1050",
    "cons_code": "GS1659",
    "cons_name": "2012년 구제역 관련 안사면 쌍호지구 지방상수도 공급사업 준공도면 (11월)",
    "cons_locat": "안계면 및 안사면 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "1051",
    "cons_code": "GS1660",
    "cons_name": "2012년 구제역 관련 안사면 쌍호지구 지방상수도 공급사업 준공사진대지 (11월)",
    "cons_locat": "안계면 및 안사면 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "1054",
    "cons_code": "GS1663",
    "cons_name": "2012년 구제역 관련 안사면 쌍호지구 지방상수도 공급사업 공사 기성부분 내역서(1회)",
    "cons_locat": "안계면 및 안사면 일원",
    "cons_volum": "1. 송수관로 D=100mm L=5,651, 배수관로 D= 150 ~ 80mm L=16,245, 급수관로 D=63 ~ 20mm L=5,950",
    "amount_pre": "1,277,650,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "1,277,650,000",
    "cont_date": "2011-12-29",
    "start_date": "2012-01-05",
    "done_date": "2012-11-20",
    "sdone_date": "",
    "busin_name": "㈜대웅종합건설",
    "ceo_name": "서종락",
    "busin_addr": "포항시 남구 이동 237",
    "busin_phon": "",
    "direct_pos": "지방공업주사보",
    "direct_nam": "김승구",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "150",
    "cons_code": "GS0383",
    "cons_name": "2012년 구제역 관련 다인면 가원지구 지방상수도 공급사업 공사관계철",
    "cons_locat": "다인면 가원리 일원",
    "cons_volum": "1. 배수관로 D80㎜, L=6.3㎞ 2. 급수관로 D63~20㎜, L=17.5㎞",
    "amount_pre": "1,718,260,000",
    "amount_var": "12,140,000",
    "amount_cha": "",
    "amount_aft": "1,730,400,000",
    "cont_date": "2012-01-06",
    "start_date": "2012-01-09",
    "done_date": "2012-07-06",
    "sdone_date": "2012-07-06",
    "busin_name": "㈜효성건설, ㈜대경건설",
    "ceo_name": "김인경, 김호연",
    "busin_addr": "부산광역시 부산진구 복지로 21번길 29, 문경시 모전동 402호",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "1. 현장여건 및 공사추진내용에 따른 공사량 정산변경 2. 일부 누락된 가구 추가시공",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "151",
    "cons_code": "GS0390",
    "cons_name": "2012년 구제역 관련 다인면 가원지구 지방상수도 공급사업 실정보고",
    "cons_locat": "다인면 가원리 일원",
    "cons_volum": "1. 급·배수관로(D20~D100㎜), L=18.7㎞ 2. 가정급수 422가구",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "1. 터파기 반영 2. 사토운반거리 및 수량변경 3. 가정급수시설 현지여건 반영",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "332",
    "cons_code": "GS0470",
    "cons_name": "2011년 구제역 관련 다인면 가원지구 지방상수도 공급사업 관계철",
    "cons_locat": "다인면 가원리 일원",
    "cons_volum": "1. 급·배수관로 D=20~100m/m, L=18.7㎞, 가정급수 422가구",
    "amount_pre": "1,227,156,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "1,227,156,000",
    "cont_date": "2012-01-03",
    "start_date": "2012-01-09",
    "done_date": "2012-07-06",
    "sdone_date": "",
    "busin_name": "㈜대경건설, 효성건설",
    "ceo_name": "김호연, 김인경",
    "busin_addr": "문경시 매봉2길, 부산광역시 부산진구 복지로21번길 29",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "333",
    "cons_code": "GS0471",
    "cons_name": "2011년 구제역 관련 다인면 가원지구 지방상수도 공급사업 설계도",
    "cons_locat": "다인면 가원리 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "321",
    "cons_code": "GS0459",
    "cons_name": "2011년 구제역 관련 다인면 가원지구 지방상수도 공급사업 설계도 (토목)_2 (12월)",
    "cons_locat": "다인면 가원리 일원",
    "cons_volum": "",
    "amount_pre": "",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  },
  {
    "gid": "322",
    "cons_code": "GS0460",
    "cons_name": "2011년 구제역 관련 다인면 가원지구 지방상수도 공급사업 폐기물처리용역 설계예산서 (12월)",
    "cons_locat": "다인면 가원리 일원",
    "cons_volum": "1. 폐아스콘: 980ton 2. 폐콘크리트: 4,885ton",
    "amount_pre": "123,600,000",
    "amount_var": "",
    "amount_cha": "",
    "amount_aft": "123,600,000",
    "cont_date": "",
    "start_date": "",
    "done_date": "",
    "sdone_date": "",
    "busin_name": "",
    "ceo_name": "",
    "busin_addr": "",
    "busin_phon": "",
    "direct_pos": "",
    "direct_nam": "",
    "reason": "",
    "descript": "상수",
    "geomWkt5181": null
  }
] as const

function mapRaw(row: (typeof RAW)[number]): WtlConsWork {
  const id = 'w-' + row.gid
  return {
    id,
    consCode: row.cons_code,
    name: row.cons_name,
    location: row.cons_locat,
    volume: row.cons_volum,
    amountPre: row.amount_pre,
    amountVar: row.amount_var,
    amountCha: row.amount_cha,
    amountAft: row.amount_aft,
    contDate: row.cont_date,
    startDate: row.start_date,
    doneDate: row.done_date,
    sdoneDate: row.sdone_date,
    company: row.busin_name,
    ceo: row.ceo_name,
    companyAddr: row.busin_addr,
    companyPhone: row.busin_phon,
    directorPos: row.direct_pos,
    directorName: row.direct_nam,
    reason: row.reason,
    descript: row.descript,
    geomWkt5181: row.geomWkt5181 ?? null,
    attachments: mockAttachments(id, row.cons_name),
  }
}

/** 공사명에서 «…사업»까지를 사업명으로 추출 */
export function extractProjectName(consName: string): string | null {
  const i = consName.indexOf('사업')
  if (i < 0) return null
  return consName.slice(0, i + 2).replace(/^\d{4}년\s*/, '').trim()
}

export function loadWtlConsProjects(): WtlConsProject[] {
  const works = RAW.map(mapRaw)
  const byName = new Map<string, WtlConsWork[]>()
  for (const w of works) {
    const name = extractProjectName(w.name)
    if (!name) continue
    const list = byName.get(name) ?? []
    list.push(w)
    byName.set(name, list)
  }
  return [...byName.entries()]
    .map(([name, list]) => {
      const totalPre = list.reduce((s, w) => s + parseAmount(w.amountPre), 0)
      const totalAft = list.reduce((s, w) => s + parseAmount(w.amountAft || w.amountPre), 0)
      const changes = list.filter((w) => Boolean(w.amountCha || w.amountVar))
      const starts = list.map((w) => w.startDate).filter(Boolean).sort()
      const ends = list.map((w) => w.doneDate || w.sdoneDate).filter(Boolean).sort()
      const locs = [...new Set(list.map((w) => w.location).filter(Boolean))]
      const location = locs[0] ?? ''
      return {
        id: 'proj-' + name,
        name,
        periodLabel: periodOf(list),
        totalAmountLabel: formatAmount(totalAft),
        totalAmount: totalAft,
        workCount: list.length,
        changeCount: changes.length,
        location,
        supplyBlock: guessSupplyBlock(name, locs.join(' ')),
        amountPreLabel: formatAmount(totalPre),
        amountAftLabel: formatAmount(totalAft),
        startDate: starts[0] ?? '',
        doneDate: ends[ends.length - 1] ?? '',
        descript: list.find((w) => w.descript)?.descript ?? '',
        works: list,
      }
    })
    .sort((a, b) => b.workCount - a.workCount || a.name.localeCompare(b.name, 'ko'))
}

export function workHasChange(work: WtlConsWork): boolean {
  return Boolean(work.amountCha?.trim() || work.amountVar?.trim())
}

/** 공사목록 날짜: 준공일(없으면 실준공일)만 */
export function workPeriodLabel(work: WtlConsWork): string {
  return shortYearDate(work.doneDate || work.sdoneDate || '')
}

/** 공사목록 표시명: 사업명과 동일한 구간을 제거 */
export function workListDisplayName(consName: string, projectName: string): string {
  const name = String(consName ?? '').trim()
  const proj = String(projectName ?? '').trim()
  if (!name || !proj) return name || '—'
  const stripped = name.replaceAll(proj, '').replace(/\s{2,}/g, ' ').replace(/\s+([()（）])/g, '$1').trim()
  return stripped || name
}

export function workAmountLabel(work: WtlConsWork): string {
  const n = parseAmount(work.amountAft || work.amountPre)
  return n > 0 ? formatAmount(n) : '—'
}
