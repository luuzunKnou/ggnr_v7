/** 상수행정 프로토타입 메뉴·예시 화면. 저장/조회 API 없음. */

export type WtlTone = 'ok' | 'warn' | 'bad' | 'info' | 'muted'

export type WtlKind = 'map' | 'search' | 'table' | 'board' | 'stat' | 'doc' | 'step' | 'file'

export type WtlScreen = {
  id: string
  kind: WtlKind
  blurb: string
  legend?: string[]
  filters?: string[]
  columns: string[]
  rows: string[][]
  fields?: string[]
  kpis?: { label: string; value: string; hint: string }[]
  steps?: { title: string; desc: string; state: 'done' | 'now' | 'wait' }[]
  tabs?: { id: string; label: string; fields: string[] }[]
}

export type WtlNav = {
  id: string
  label: string
  screenId?: string
  tab?: string
  children?: WtlNav[]
}

export type WtlSection = {
  id: string
  serEng: string
  label: string
  nav: WtlNav[]
}

const TONE_WORDS = new Set([
  '정상',
  '양호',
  '가동',
  '완료',
  '납부',
  '적합',
  '준공',
  '주의',
  '노후',
  '처리중',
  '접수',
  '미납',
  '대상',
  '점검',
  '진행',
  '단수',
  '정지',
  '오류',
  '부적합',
  '누수',
  '긴급',
])

export function toneOf(text: string): WtlTone | null {
  if (TONE_WORDS.has(text) === false) return null
  if (['정상', '양호', '가동', '완료', '납부', '적합', '준공'].includes(text)) return 'ok'
  if (['주의', '노후', '처리중', '접수', '미납', '대상', '점검', '진행'].includes(text)) return 'warn'
  if (['단수', '정지', '오류', '부적합', '누수', '긴급'].includes(text)) return 'bad'
  return 'info'
}

export const WTL_SCREENS: Record<string, WtlScreen> = {
  'net-view': {
    id: 'net-view',
    kind: 'map',
    blurb: '오른쪽 지도의 관로·밸브·제수변·소화전과, 지금 보이는 범위의 목록·상세를 함께 봅니다.',
    legend: ['관로', '밸브', '제수변', '소화전'],
    columns: ['구분', '관리번호', '구경', '재질', '매설', '상태'],
    rows: [
      ['관로', 'P-1042', '150mm', 'DCIP', '1998', '노후'],
      ['밸브', 'V-228', '150mm', '주철', '2004', '정상'],
      ['제수변', 'GV-17', '100mm', '스테인리스', '2016', '정상'],
      ['소화전', 'H-09', '65mm', '주철', '2011', '점검'],
    ],
    fields: ['관리번호', '시설구분', '구경', '재질', '매설연도', '연장', '위치', '상태', '비고'],
    tabs: [
      { id: 'map', label: '지도', fields: ['표시 시설', '범례', '선택 객체'] },
      { id: 'list', label: '목록', fields: ['화면 범위', '정렬', '선택'] },
      { id: 'detail', label: '상세', fields: ['관리번호', '구경', '재질', '매설연도', '상태', '비고'] },
    ],
  },
  'net-search': {
    id: 'net-search',
    kind: 'search',
    blurb: '관종·관경·매설연도·재질·위치로 전체 시설을 찾고, 결과를 누르면 지도가 그 위치로 이동합니다.',
    filters: ['관종', '관경', '매설연도', '재질', '읍면동'],
    columns: ['관리번호', '구분', '관경', '재질', '매설', '위치'],
    rows: [
      ['P-0881', '송수관', '300mm', 'DCIP', '1994', '영양읍 서부리'],
      ['P-1104', '배수관', '100mm', 'PE', '2012', '입암면 흥구리'],
      ['V-041', '밸브', '200mm', '주철', '2001', '청기면 당리'],
    ],
    fields: ['관리번호', '구분', '관경', '재질', '매설연도', '위치'],
  },
  'net-block': {
    id: 'net-block',
    kind: 'map',
    blurb: '급수구역(블록) 경계와 수용 세대, 유입 유량을 지도와 목록으로 봅니다.',
    legend: ['블록경계', '유입점'],
    columns: ['블록', '면적', '세대', '야간최소유량', '상태'],
    rows: [
      ['영양 1블록', '1.8㎢', '1,240', '42㎥/h', '주의'],
      ['입암 2블록', '3.1㎢', '860', '18㎥/h', '정상'],
    ],
    fields: ['블록명', '경계', '세대수', '유입밸브', '야간최소유량', '비고'],
  },
  'net-fitting': {
    id: 'net-fitting',
    kind: 'table',
    blurb: '밸브·소화전·공기변·감압변·유량계를 구분해 조회하고 등록·수정합니다.',
    filters: ['밸브', '소화전', '공기변', '감압변', '유량계'],
    columns: ['구분', '관리번호', '구경', '위치', '상태'],
    rows: [
      ['밸브', 'V-228', '150mm', '서부리 군청길', '정상'],
      ['소화전', 'H-09', '65mm', '서부리 시장길', '점검'],
      ['감압변', 'PRV-03', '100mm', '흥구리', '정상'],
      ['유량계', 'FM-12', '150mm', '1블록 유입', '정상'],
    ],
    fields: ['구분', '관리번호', '구경', '설치일', '위치', '상태', '점검주기'],
  },
  'net-meter': {
    id: 'net-meter',
    kind: 'table',
    blurb: '수도미터(계량기) 구경·검침·교체 이력을 보고 등록·수정합니다.',
    columns: ['기물번호', '구경', '수용가', '설치', '상태'],
    rows: [
      ['M-77821', '15mm', '서부리 12', '2019-04', '정상'],
      ['M-66102', '20mm', '시장상가', '2014-11', '노후'],
    ],
    fields: ['기물번호', '구경', '수용가', '설치일', '최근검침', '교체예정', '상태'],
  },
  'net-aging': {
    id: 'net-aging',
    kind: 'board',
    blurb: '매설연도·재질·파손 이력으로 노후도를 나누고 교체 대상을 고릅니다.',
    kpis: [
      { label: '관로 연장', value: '86.4km', hint: '배수·송수' },
      { label: '노후(30년+)', value: '21.6km', hint: '25%' },
      { label: '교체 대상', value: '6.2km', hint: '우선 3구간' },
    ],
    columns: ['구간', '재질', '매설', '연장', '평가', '선정'],
    rows: [
      ['서부리 간선', 'CIP', '1989', '1.4km', '노후', '대상'],
      ['당리 지선', 'DCIP', '2006', '0.8km', '주의', '관찰'],
      ['흥구리 확장', 'PE', '2018', '2.1km', '양호', '제외'],
    ],
    fields: ['구간', '평가등급', '교체우선', '추정공사비', '비고'],
  },
  'net-leak': {
    id: 'net-leak',
    kind: 'table',
    blurb: '누수·파손 이력을 조회하고 새 건을 등록합니다.',
    columns: ['일시', '위치', '유형', '관경', '조치', '상태'],
    rows: [
      ['2026-03-02', '서부리', '누수', '100mm', '밴드보수', '완료'],
      ['2026-08-19', '당리', '파손', '150mm', '관교체', '처리중'],
    ],
    fields: ['발생일시', '위치', '유형', '관번호', '조치내용', '복구일시', '상태'],
  },
  'net-section': {
    id: 'net-section',
    kind: 'file',
    blurb: '관로 종·횡단 도면을 고르면 단면 미리보기와 지장물 높이를 봅니다.',
    columns: ['도면', '구간', '작성', '축척'],
    rows: [
      ['횡단-서부-04', '군청길', '2024-11', '1:100'],
      ['종단-입암-02', '흥구리', '2023-06', '1:500'],
    ],
    fields: ['도면명', '구간', '지반고', '관저고', '토피', '지장물'],
  },
  'net-outage': {
    id: 'net-outage',
    kind: 'step',
    blurb: '누수 지점을 기준으로 닫을 밸브와 단수 세대, 영향을 받는 블록을 따라갑니다.',
    steps: [
      { title: '지점 지정', desc: '서부리 누수지점 선택', state: 'done' },
      { title: '차단 밸브', desc: 'V-228, V-231 폐쇄', state: 'now' },
      { title: '단수 범위', desc: '1블록 일부 186세대', state: 'wait' },
      { title: '공지 대상', desc: '수용가 목록 확인', state: 'wait' },
    ],
    columns: ['밸브', '동작', '영향 블록', '세대'],
    rows: [
      ['V-228', '폐쇄', '영양 1블록', '186'],
      ['V-231', '폐쇄', '영양 1블록', '186'],
    ],
    fields: ['분석지점', '폐쇄밸브', '단수세대', '예상복구'],
  },
  'net-flow': {
    id: 'net-flow',
    kind: 'step',
    blurb: '정수장을 기점으로 물길이 어느 관로·블록으로 가는지 따라갑니다.',
    steps: [
      { title: '정수장', desc: '영양 정수장 유출', state: 'done' },
      { title: '송수', desc: 'P-0881 300mm', state: 'now' },
      { title: '배수지', desc: '중앙 배수지 유입', state: 'wait' },
      { title: '배수블록', desc: '1·2블록 분배', state: 'wait' },
    ],
    columns: ['순서', '시설', '유량', '방향'],
    rows: [
      ['1', '영양 정수장', '2,400㎥/일', '유출'],
      ['2', '송수관 P-0881', '2,400㎥/일', '하류'],
      ['3', '중앙 배수지', '1,800㎥', '유입'],
    ],
    fields: ['기점', '추적방향', '경유시설', '도달블록'],
  },
  'net-topo': {
    id: 'net-topo',
    kind: 'table',
    blurb: '관 연결이 끊기거나 밸브가 고립된 곳을 위상 오류로 보여 줍니다.',
    columns: ['구분', '대상', '내용', '위치', '판정'],
    rows: [
      ['단절', 'P-2210', '끝점이 시설과 안 붙음', '입암면', '오류'],
      ['고립', 'V-088', '연결된 관로 없음', '청기면', '오류'],
      ['중복', 'P-1042', '같은 구간 선형 겹침', '서부리', '주의'],
    ],
    fields: ['오류유형', '대상번호', '설명', '위치', '수정제안'],
  },
  'net-protect': {
    id: 'net-protect',
    kind: 'map',
    blurb: '취수·정수 보호구역 경계와 행위제한을 지도에서 봅니다.',
    legend: ['보호구역', '취수원'],
    columns: ['구역', '등급', '면적', '제한', '상태'],
    rows: [
      ['취수원 상류', '1등급', '0.4㎢', '건축제한', '정상'],
      ['정수장 주변', '2등급', '0.2㎢', '농약주의', '주의'],
    ],
    fields: ['구역명', '등급', '경계', '제한행위', '관리부서'],
  },
  'net-cad': {
    id: 'net-cad',
    kind: 'file',
    blurb: '구간별 CAD 도면을 고르고 미리봅니다.',
    columns: ['도면명', '구간', '형식', '갱신'],
    rows: [
      ['영양_배수지_평면도', '중앙배수지', 'DWG', '2025-02'],
      ['서부리_관로평면도', '군청길', 'DWG', '2024-09'],
    ],
    fields: ['도면명', '구간', '형식', '레이어', '등록자'],
  },
  'fac-list': {
    id: 'fac-list',
    kind: 'map',
    blurb: '정수장·배수지·가압장·취수장 위치와 목록입니다. 행을 누르면 지도가 이동합니다.',
    legend: ['정수장', '배수지', '가압장', '취수장'],
    filters: ['전체', '정수장', '배수지', '가압장', '취수장'],
    columns: ['시설명', '종류', '용량', '준공', '상태'],
    rows: [
      ['영양 정수장', '정수장', '3,000㎥/일', '2008', '가동'],
      ['중앙 배수지', '배수지', '1,800㎥', '2012', '가동'],
      ['입암 가압장', '가압장', '0.2㎥/분', '2015', '정지'],
      ['장수 취수장', '취수장', '4,200㎥/일', '1999', '가동'],
    ],
    fields: ['시설명', '종류', '주소', '용량', '준공', '가동상태'],
  },
  'fac-detail': {
    id: 'fac-detail',
    kind: 'table',
    blurb: '시설 제원과 그 안의 설비, 설비별 점검 이력을 한 시설에서 오갑니다.',
    tabs: [
      { id: 'base', label: '기본정보', fields: ['시설명', '종류', '용량', '준공연도', '주소', '관리자'] },
      { id: 'equip', label: '설비 목록', fields: ['펌프', '흡수정', '염소투입기', '수질계측기'] },
      { id: 'equip-detail', label: '설비 상세', fields: ['설비명', '제원', '가동상태', '최근점검', '다음점검'] },
    ],
    columns: ['설비', '수량', '가동', '최근점검'],
    rows: [
      ['취수펌프 1호', '1대', '가동', '2026-08-01'],
      ['염소투입기', '1대', '가동', '2026-08-12'],
      ['탁도계', '1대', '점검', '2026-07-20'],
    ],
    fields: ['시설명', '종류', '용량', '준공연도', '주소', '관리자'],
  },
  'fac-board': {
    id: 'fac-board',
    kind: 'board',
    blurb: '시설별 가동과 용량 대비 현재 수위를 한눈에 봅니다.',
    kpis: [
      { label: '가동 시설', value: '3 / 4', hint: '가압장 정지' },
      { label: '배수지 수위', value: '72%', hint: '중앙 배수지' },
      { label: '금일 생산', value: '2,150㎥', hint: '정수장' },
    ],
    columns: ['시설', '용량', '현재', '비율', '상태'],
    rows: [
      ['영양 정수장', '3,000㎥/일', '2,150', '72%', '가동'],
      ['중앙 배수지', '1,800㎥', '1,300', '72%', '가동'],
      ['입암 가압장', '0.2㎥/분', '0', '0%', '정지'],
    ],
    fields: ['시설', '가동', '용량대비', '특이사항'],
  },
  'con-ledger': {
    id: 'con-ledger',
    kind: 'table',
    blurb: '신설·개량·이설·보수 공사대장을 조회하고 등록합니다.',
    filters: ['전체', '신설', '개량', '이설', '보수'],
    columns: ['공사명', '구분', '착공', '준공예정', '상태'],
    rows: [
      ['서부리 관로개량', '개량', '2026-04-01', '2026-11-30', '진행'],
      ['당리 누수보수', '보수', '2026-08-20', '2026-08-27', '준공'],
      ['흥구리 확장', '신설', '2025-09-01', '2026-06-30', '진행'],
    ],
    fields: ['공사명', '구분', '위치', '착공일', '준공예정', '시공사', '공사비', '상태'],
  },
  'con-map': {
    id: 'con-map',
    kind: 'map',
    blurb: '공사 구간을 지도에 선으로 잡고 시점·종점·연장 을 적습니다.',
    legend: ['공사구간', '시점', '종점'],
    columns: ['공사', '시점', '종점', '연장', '상태'],
    rows: [
      ['서부리 관로개량', '군청삼거리', '서부교', '420m', '진행'],
      ['흥구리 확장', '면사무소', '마을회관', '260m', '진행'],
    ],
    fields: ['공사명', '시점', '종점', '연장', '관경', '구간메모'],
  },
  'con-complete': {
    id: 'con-complete',
    kind: 'step',
    blurb: '준공도서, 준공일, 인수인계를 순서대로 확인합니다.',
    steps: [
      { title: '준공검사', desc: '검사일 2026-08-25', state: 'done' },
      { title: '준공도서', desc: '도면·내역 4건', state: 'now' },
      { title: '인수인계', desc: '시설팀 인수 대기', state: 'wait' },
    ],
    columns: ['항목', '내용', '일자', '상태'],
    rows: [
      ['준공일', '당리 누수보수', '2026-08-26', '완료'],
      ['인수인계', '서부리 관로개량', '-', '진행'],
    ],
    fields: ['공사명', '준공일', '검사자', '인수부서', '인계일'],
  },
  'con-files': {
    id: 'con-files',
    kind: 'file',
    blurb: '공사별 도면과 첨부파일을 올리고 받습니다.',
    columns: ['파일', '종류', '공사', '등록일'],
    rows: [
      ['준공도면.dwg', '도면', '당리 누수보수', '2026-08-26'],
      ['내역서.pdf', '문서', '당리 누수보수', '2026-08-26'],
      ['현장사진.zip', '사진', '서부리 관로개량', '2026-07-14'],
    ],
    fields: ['파일명', '종류', '공사명', '등록자', '비고'],
  },
  'con-apply': {
    id: 'con-apply',
    kind: 'step',
    blurb: '준공된 관로·밸브를 관망도에 반영하는 단계입니다.',
    steps: [
      { title: '준공 확정', desc: '당리 누수보수', state: 'done' },
      { title: '반영 대상', desc: '관로 28m, 밸브 1', state: 'now' },
      { title: '관망 갱신', desc: '기존 P-441 교체', state: 'wait' },
    ],
    columns: ['대상', '변경', '기존', '반영'],
    rows: [
      ['관로 28m', '신설 대체', 'P-441', '대기'],
      ['밸브 1', '교체', 'V-19', '대기'],
    ],
    fields: ['공사명', '반영대상', '기존관리번호', '반영일'],
  },
  'con-stat': {
    id: 'con-stat',
    kind: 'stat',
    blurb: '구분·연도별 공사 건수와 금액입니다.',
    kpis: [
      { label: '올해 공사', value: '14건', hint: '진행 6 · 준공 8' },
      { label: '공사비', value: '18.4억', hint: '개량이 가장 큼' },
      { label: '평균 공기', value: '92일', hint: '보수 제외' },
    ],
    columns: ['구분', '건수', '연장', '금액'],
    rows: [
      ['신설', '3', '1.2km', '6.1억'],
      ['개량', '5', '2.4km', '9.8억'],
      ['보수', '6', '0.4km', '2.5억'],
    ],
    fields: ['연도', '구분', '건수', '금액'],
  },
  'sup-apply': {
    id: 'sup-apply',
    kind: 'table',
    blurb: '신규·증설·개조·철거 급수 신청을 접수합니다.',
    filters: ['신규', '증설', '개조', '철거'],
    columns: ['접수번호', '구분', '신청인', '위치', '상태'],
    rows: [
      ['2026-014', '신규', '김○○', '서부리 48', '접수'],
      ['2026-011', '증설', '○○상점', '시장길 3', '처리중'],
    ],
    fields: ['접수번호', '구분', '신청인', '연락처', '주소', '희망구경', '접수일', '상태'],
  },
  'sup-survey': {
    id: 'sup-survey',
    kind: 'table',
    blurb: '현장조사와 인입 설계(관경·연장·분기점)를 적습니다.',
    columns: ['접수', '조사일', '분기점', '연장', '상태'],
    rows: [
      ['2026-014', '2026-09-12', 'P-1042', '18m', '진행'],
      ['2026-009', '2026-08-02', 'P-880', '7m', '완료'],
    ],
    fields: ['접수번호', '조사일', '기존관', '인입관경', '연장', '설계메모'],
  },
  'sup-fee': {
    id: 'sup-fee',
    kind: 'table',
    blurb: '공사비를 산출하고 납부 여부를 표시합니다.',
    columns: ['접수', '산정액', '납부액', '납부기한', '상태'],
    rows: [
      ['2026-014', '1,240,000', '0', '2026-09-30', '미납'],
      ['2026-009', '680,000', '680,000', '2026-08-15', '납부'],
    ],
    fields: ['접수번호', '자재비', '시공비', '원인자부담', '납부기한', '납부일'],
  },
  'sup-work': {
    id: 'sup-work',
    kind: 'step',
    blurb: '시공 일정과 감독 확인을 단계로 봅니다.',
    steps: [
      { title: '착공', desc: '2026-09-18 예정', state: 'wait' },
      { title: '배관', desc: '인입 18m', state: 'wait' },
      { title: '감독확인', desc: '수압시험', state: 'wait' },
    ],
    columns: ['접수', '시공사', '착공', '감독', '상태'],
    rows: [['2026-011', '○○설비', '2026-09-01', '시설팀', '처리중']],
    fields: ['접수번호', '시공사', '착공일', '감독자', '수압시험', '특이사항'],
  },
  'sup-open': {
    id: 'sup-open',
    kind: 'step',
    blurb: '준공검사 뒤 급수를 개시하고 계량기를 연결합니다.',
    steps: [
      { title: '준공검사', desc: '누수·수압 확인', state: 'now' },
      { title: '계량기', desc: '기물번호 부여', state: 'wait' },
      { title: '급수개시', desc: '개시일 통보', state: 'wait' },
    ],
    columns: ['접수', '검사', '계량기', '개시일', '상태'],
    rows: [['2026-009', '적합', 'M-78012', '2026-08-20', '완료']],
    fields: ['접수번호', '검사결과', '계량기기물', '급수개시일', '통보일'],
  },
  'sup-ledger': {
    id: 'sup-ledger',
    kind: 'table',
    blurb: '끝난 급수공사를 대장으로 모아 봅니다.',
    columns: ['대장번호', '구분', '주소', '구경', '개시일'],
    rows: [
      ['급-2026-009', '신규', '서부리 21', '15mm', '2026-08-20'],
      ['급-2025-102', '개조', '입암면 흥구리', '20mm', '2025-11-03'],
    ],
    fields: ['대장번호', '구분', '주소', '구경', '공사비', '개시일'],
  },
  'sup-customer': {
    id: 'sup-customer',
    kind: 'search',
    blurb: '수용가와 계량기를 함께 찾아 급수 현황을 봅니다.',
    filters: ['수용가', '계량기', '구경', '읍면동'],
    columns: ['수용가', '주소', '구경', '기물번호', '상태'],
    rows: [
      ['김○○', '서부리 12', '15mm', 'M-77821', '정상'],
      ['○○상점', '시장길 3', '20mm', 'M-66102', '노후'],
    ],
    fields: ['수용가', '주소', '용도', '구경', '기물번호', '최근지침'],
  },
  'civ-case': {
    id: 'civ-case',
    kind: 'table',
    blurb: '누수·단수·수질·수압 민원을 접수하고 처리 상태를 바꿉니다.',
    filters: ['누수', '단수', '수질', '수압'],
    columns: ['접수', '유형', '위치', '접수일', '상태'],
    rows: [
      ['민-221', '누수', '서부리', '2026-09-20', '처리중'],
      ['민-198', '수압', '당리', '2026-09-02', '완료'],
      ['민-190', '수질', '흥구리', '2026-08-28', '완료'],
    ],
    fields: ['접수번호', '유형', '신고자', '위치', '내용', '담당', '상태'],
  },
  'civ-map': {
    id: 'civ-map',
    kind: 'map',
    blurb: '민원 위치를 지도에 점으로 보고 주변 관로와 함께 확인합니다.',
    legend: ['누수', '단수', '수질', '수압'],
    columns: ['접수', '유형', '위치', '상태'],
    rows: [
      ['민-221', '누수', '서부리 군청길', '처리중'],
      ['민-198', '수압', '청기면 당리', '완료'],
    ],
    fields: ['접수번호', '유형', '좌표위치', '인근관로', '상태'],
  },
  'civ-result': {
    id: 'civ-result',
    kind: 'table',
    blurb: '처리 내용과 완료 일시를 남깁니다.',
    columns: ['접수', '조치', '완료일', '결과', '상태'],
    rows: [
      ['민-198', '감압변 조정', '2026-09-04', '수압 회복', '완료'],
      ['민-190', '탁도 재검사', '2026-08-30', '기준 이내', '완료'],
    ],
    fields: ['접수번호', '조치내용', '완료일', '결과통보일', '민원인확인'],
  },
  'civ-stat': {
    id: 'civ-stat',
    kind: 'stat',
    blurb: '유형·월별 민원 건수입니다.',
    kpis: [
      { label: '올해', value: '46건', hint: '누수가 가장 많음' },
      { label: '처리중', value: '3건', hint: '평균 4.2일' },
      { label: '평균 처리', value: '3.1일', hint: '완료 건' },
    ],
    columns: ['유형', '건수', '비율', '평균일'],
    rows: [
      ['누수', '21', '46%', '2.4'],
      ['수압', '12', '26%', '3.8'],
      ['수질', '8', '17%', '4.1'],
      ['단수', '5', '11%', '1.2'],
    ],
    fields: ['기간', '유형', '건수'],
  },
  'job-outage': {
    id: 'job-outage',
    kind: 'table',
    blurb: '단수·복구 작업과 공지할 수용가를 관리합니다.',
    columns: ['작업', '구간', '단수시작', '복구예정', '공지', '상태'],
    rows: [
      ['밸브교체', '서부리', '09-29 09:00', '09-29 13:00', '186세대', '단수'],
      ['이음보수', '당리', '09-18 10:00', '09-18 12:00', '40세대', '완료'],
    ],
    fields: ['작업명', '구간', '단수시작', '복구예정', '폐쇄밸브', '공지세대', '담당'],
  },
  'job-detect': {
    id: 'job-detect',
    kind: 'table',
    blurb: '누수탐사 구간과 결과를 기록합니다.',
    columns: ['일자', '구간', '방법', '결과', '상태'],
    rows: [
      ['2026-09-15', '1블록 야간', '음청', '의심 2지점', '진행'],
      ['2026-07-02', '입암 간선', '상관식', '특이 없음', '완료'],
    ],
    fields: ['탐사일', '구간', '방법', '발견지점', '후속조치'],
  },
  'job-valve': {
    id: 'job-valve',
    kind: 'table',
    blurb: '밸브 개폐 이력입니다.',
    columns: ['일시', '밸브', '동작', '사유', '조작자'],
    rows: [
      ['2026-09-29 08:40', 'V-228', '폐쇄', '단수작업', '시설팀'],
      ['2026-08-19 16:10', 'V-231', '개방', '복구', '시설팀'],
    ],
    fields: ['일시', '밸브번호', '동작', '사유', '조작자'],
  },
  'job-quality': {
    id: 'job-quality',
    kind: 'table',
    blurb: '수질검사 지점과 결과입니다.',
    columns: ['채수일', '지점', '잔염소', '탁도', '판정'],
    rows: [
      ['2026-09-22', '정수장 출구', '0.52', '0.08', '적합'],
      ['2026-09-22', '배수지', '0.41', '0.11', '적합'],
      ['2026-09-08', '말단 당리', '0.18', '0.24', '주의'],
    ],
    fields: ['채수일', '지점', '잔염소', '탁도', '판정', '조치'],
  },
  'stat-asset': {
    id: 'stat-asset',
    kind: 'stat',
    blurb: '관로·밸브·시설 수량 현황입니다.',
    kpis: [
      { label: '관로', value: '86.4km', hint: 'DCIP 61%' },
      { label: '밸브', value: '412개', hint: '점검대상 18' },
      { label: '소화전', value: '96개', hint: '정상 90' },
    ],
    columns: ['구분', '수량', '양호', '주의'],
    rows: [
      ['관로', '86.4km', '64.8', '21.6'],
      ['밸브', '412', '394', '18'],
      ['정수시설', '4개소', '3', '1'],
    ],
    fields: ['기준일', '구분', '수량'],
  },
  'stat-con': {
    id: 'stat-con',
    kind: 'stat',
    blurb: '공사 실적을 연도·구분으로 봅니다. 공사대장 통계와 같은 형식입니다.',
    kpis: [
      { label: '5년 건수', value: '61건', hint: '개량 비중 증가' },
      { label: '올해 금액', value: '18.4억', hint: '전년 대비 +12%' },
    ],
    columns: ['연도', '건수', '금액'],
    rows: [
      ['2024', '11', '14.2억'],
      ['2025', '12', '16.4억'],
      ['2026', '14', '18.4억'],
    ],
    fields: ['연도', '구분', '금액'],
  },
  'stat-supply': {
    id: 'stat-supply',
    kind: 'stat',
    blurb: '급수공사 실적입니다.',
    kpis: [
      { label: '올해 접수', value: '28건', hint: '신규 19' },
      { label: '개시', value: '21건', hint: '진행 7' },
      { label: '납부율', value: '86%', hint: '미납 4건' },
    ],
    columns: ['구분', '접수', '개시', '금액'],
    rows: [
      ['신규', '19', '14', '1.6억'],
      ['증설', '5', '4', '0.4억'],
      ['철거', '4', '3', '-'],
    ],
    fields: ['기간', '구분', '건수', '금액'],
  },
  'stat-issue': {
    id: 'stat-issue',
    kind: 'stat',
    blurb: '누수와 민원을 같은 화면에 모아 봅니다.',
    kpis: [
      { label: '누수', value: '17건', hint: '올해' },
      { label: '민원', value: '46건', hint: '올해' },
      { label: '미조치', value: '4건', hint: '누수 1 · 민원 3' },
    ],
    columns: ['월', '누수', '민원'],
    rows: [
      ['7월', '2', '6'],
      ['8월', '3', '8'],
      ['9월', '1', '4'],
    ],
    fields: ['기간', '누수건', '민원건'],
  },
  'stat-nrw': {
    id: 'stat-nrw',
    kind: 'board',
    blurb: '생산량과 유수수량으로 유수율을 봅니다.',
    kpis: [
      { label: '유수율', value: '78.4%', hint: '전월 77.1%' },
      { label: '생산량', value: '62,400㎥', hint: '9월' },
      { label: '유수수량', value: '48,920㎥', hint: '검침' },
    ],
    columns: ['블록', '생산', '유수', '유수율'],
    rows: [
      ['영양 1블록', '28,100', '20,400', '72.6%'],
      ['입암 2블록', '14,200', '12,100', '85.2%'],
    ],
    fields: ['기간', '블록', '생산량', '유수수량', '유수율'],
  },
  'stat-print': {
    id: 'stat-print',
    kind: 'doc',
    blurb: '고른 통계를 보고서 형식으로 모아 인쇄합니다.',
    columns: ['보고서', '기간', '포함'],
    rows: [
      ['월간 시설현황', '2026-09', '관로·밸브·시설'],
      ['분기 유수율', '2026 3분기', '블록별 유수율'],
      ['민원 처리현황', '2026-09', '유형별 건수'],
    ],
    fields: ['보고서명', '기간', '부수', '수신'],
  },
  'man-manual': {
    id: 'man-manual',
    kind: 'doc',
    blurb: '상수 업무 절차 문서입니다.',
    columns: ['문서', '개정', '부서'],
    rows: [
      ['단수 작업 절차', '2026-03', '시설팀'],
      ['급수공사 접수 절차', '2025-11', '급수팀'],
      ['수질 이상 대응', '2024-08', '정수팀'],
    ],
    fields: ['문서명', '개정일', '담당부서', '요약'],
  },
  'man-guide': {
    id: 'man-guide',
    kind: 'doc',
    blurb: '이 화면을 어떻게 쓰는지 안내합니다.',
    columns: ['안내', '대상'],
    rows: [
      ['관망도에서 시설 고르기', '관망조회'],
      ['공사 구간 그리기', '공사대장'],
      ['민원 위치를 지도에서 보기', '민원관리'],
    ],
    fields: ['안내제목', '화면', '순서'],
  },
  'man-files': {
    id: 'man-files',
    kind: 'file',
    blurb: '업무에 쓰는 참고 자료입니다.',
    columns: ['자료', '형식', '등록'],
    rows: [
      ['관망도 표준 레이어', 'PDF', '2026-01'],
      ['급수공사 원인자부담 기준', 'HWP', '2025-12'],
      ['밸브 조작 점검표', 'XLSX', '2025-06'],
    ],
    fields: ['자료명', '형식', '등록일', '설명'],
  },
}

export const WTL_SECTIONS: WtlSection[] = [
  {
    id: 'net',
    serEng: 'wtlNetworkMap',
    label: '관망조회',
    nav: [
      {
        id: 'net-view',
        label: '관망도 보기',
        screenId: 'net-view',
        children: [
          { id: 'net-view-map', label: '지도 뷰', screenId: 'net-view', tab: 'map' },
          { id: 'net-view-list', label: '목록 뷰', screenId: 'net-view', tab: 'list' },
          { id: 'net-view-detail', label: '상세 패널', screenId: 'net-view', tab: 'detail' },
        ],
      },
      { id: 'net-search', label: '시설물 검색', screenId: 'net-search' },
      { id: 'net-block', label: '블록(급수구역) 조회', screenId: 'net-block' },
      { id: 'net-fitting', label: '부속시설 상세', screenId: 'net-fitting' },
      { id: 'net-meter', label: '수도미터(계량기) 상세', screenId: 'net-meter' },
      { id: 'net-aging', label: '노후관 현황', screenId: 'net-aging' },
      { id: 'net-leak', label: '누수·파손 현황', screenId: 'net-leak' },
      { id: 'net-section', label: '단면도 조회', screenId: 'net-section' },
      { id: 'net-outage', label: '공간분석(단수/누수)', screenId: 'net-outage' },
      { id: 'net-flow', label: '관망 흐름분석', screenId: 'net-flow' },
      { id: 'net-topo', label: '데이터 위상검증', screenId: 'net-topo' },
      { id: 'net-protect', label: '보호구역 조회', screenId: 'net-protect' },
      { id: 'net-cad', label: 'CAD 도면조회', screenId: 'net-cad' },
    ],
  },
  {
    id: 'fac',
    serEng: 'wtlFacility',
    label: '시설조회',
    nav: [
      { id: 'fac-list', label: '시설 목록/위치조회', screenId: 'fac-list' },
      {
        id: 'fac-detail',
        label: '시설 상세',
        screenId: 'fac-detail',
        children: [
          { id: 'fac-detail-base', label: '시설 기본정보', screenId: 'fac-detail', tab: 'base' },
          { id: 'fac-detail-equip', label: '설비 목록', screenId: 'fac-detail', tab: 'equip' },
          { id: 'fac-detail-one', label: '설비 상세', screenId: 'fac-detail', tab: 'equip-detail' },
        ],
      },
      { id: 'fac-board', label: '시설 현황판', screenId: 'fac-board' },
    ],
  },
  {
    id: 'con',
    serEng: 'wtlConstructionLedger',
    label: '공사대장',
    nav: [
      { id: 'con-ledger', label: '공사대장 등록/조회', screenId: 'con-ledger' },
      { id: 'con-map', label: '공사 위치·구간 등록', screenId: 'con-map' },
      { id: 'con-complete', label: '준공 관리', screenId: 'con-complete' },
      { id: 'con-files', label: '도면·첨부파일 관리', screenId: 'con-files' },
      { id: 'con-apply', label: '시설물 반영', screenId: 'con-apply' },
      { id: 'con-stat', label: '공사 현황/통계', screenId: 'con-stat' },
    ],
  },
  {
    id: 'sup',
    serEng: 'wtlWaterSupply',
    label: '급수공사',
    nav: [
      { id: 'sup-apply', label: '급수 신청 접수', screenId: 'sup-apply' },
      { id: 'sup-survey', label: '현장조사/설계', screenId: 'sup-survey' },
      { id: 'sup-fee', label: '공사비 산정·납부 관리', screenId: 'sup-fee' },
      { id: 'sup-work', label: '시공/감독 관리', screenId: 'sup-work' },
      { id: 'sup-open', label: '준공검사·급수개시', screenId: 'sup-open' },
      { id: 'sup-ledger', label: '급수공사 대장', screenId: 'sup-ledger' },
      { id: 'sup-customer', label: '급수 현황 조회', screenId: 'sup-customer' },
    ],
  },
  {
    id: 'civ',
    serEng: 'wtlComplaint',
    label: '민원관리',
    nav: [
      { id: 'civ-case', label: '민원 접수/처리', screenId: 'civ-case' },
      { id: 'civ-map', label: '민원 위치 조회', screenId: 'civ-map' },
      { id: 'civ-result', label: '처리결과 관리', screenId: 'civ-result' },
      { id: 'civ-stat', label: '민원 통계', screenId: 'civ-stat' },
    ],
  },
  {
    id: 'job',
    serEng: 'wtlField',
    label: '작업/현장관리',
    nav: [
      { id: 'job-outage', label: '단수·복구 작업 관리', screenId: 'job-outage' },
      { id: 'job-detect', label: '누수탐사 관리', screenId: 'job-detect' },
      { id: 'job-valve', label: '밸브 조작 이력', screenId: 'job-valve' },
      { id: 'job-quality', label: '수질검사 이력', screenId: 'job-quality' },
    ],
  },
  {
    id: 'stat',
    serEng: 'wtlStats',
    label: '통계/보고서',
    nav: [
      { id: 'stat-asset', label: '시설물 현황 통계', screenId: 'stat-asset' },
      { id: 'stat-con', label: '공사 실적 통계', screenId: 'stat-con' },
      { id: 'stat-supply', label: '급수공사 실적 통계', screenId: 'stat-supply' },
      { id: 'stat-issue', label: '누수/민원 통계', screenId: 'stat-issue' },
      { id: 'stat-nrw', label: '유수율 관리', screenId: 'stat-nrw' },
      { id: 'stat-print', label: '보고서 출력', screenId: 'stat-print' },
    ],
  },
  {
    id: 'man',
    serEng: 'wtlHandbook',
    label: '업무편람',
    nav: [
      { id: 'man-manual', label: '업무 매뉴얼 조회', screenId: 'man-manual' },
      { id: 'man-guide', label: '시스템 사용 가이드', screenId: 'man-guide' },
      { id: 'man-files', label: '자료실', screenId: 'man-files' },
    ],
  },
]

export function sectionBySerEng(serEng: string): WtlSection | null {
  return WTL_SECTIONS.find((s) => s.serEng === serEng) ?? null
}

export function firstScreenId(section: WtlSection): string {
  const walk = (nodes: WtlNav[]): string | null => {
    for (const n of nodes) {
      if (n.screenId && !n.tab) return n.screenId
      if (n.children) {
        const child = walk(n.children)
        if (child) return child
      }
    }
    return null
  }
  return walk(section.nav) ?? section.nav[0]?.screenId ?? 'net-view'
}

export function findNavLabel(section: WtlSection, screenId: string): string {
  const walk = (nodes: WtlNav[]): string | null => {
    for (const n of nodes) {
      if (n.screenId === screenId && !n.tab) return n.label
      if (n.children) {
        const child = walk(n.children)
        if (child) return child
      }
    }
    return null
  }
  return walk(section.nav) ?? screenId
}
