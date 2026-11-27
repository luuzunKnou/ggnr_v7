/** 보고서 조회 목업 데이터 */

export type ReportStatCard = {
  key: string
  title: string
  value: string
  sub?: string
  accent: string
}

export type ReportBarPoint = { label: string; value: number }
export type ReportLinePoint = { label: string; value: number }
export type ReportPieSlice = { label: string; value: number; color: string }

export type ReportTableCol = { key: string; label: string; align?: 'left' | 'right' | 'center' }
export type ReportTableRow = Record<string, string | number>

export type AbatementReportMock = {
  cards: ReportStatCard[]
  monthlyRuns: ReportBarPoint[]
  stationRows: ReportTableRow[]
  stationCols: ReportTableCol[]
}

export type AlertReportMock = {
  cards: ReportStatCard[]
  monthlyTrend: ReportLinePoint[]
  gradePie: ReportPieSlice[]
  stationRows: ReportTableRow[]
  stationCols: ReportTableCol[]
}

export type ComplaintReportMock = {
  cards: ReportStatCard[]
  monthlyReceipts: ReportBarPoint[]
  typePie: ReportPieSlice[]
  listRows: ReportTableRow[]
  listCols: ReportTableCol[]
}

export type ActionReportMock = {
  cards: ReportStatCard[]
  /** 월별 조치·조사 건수 */
  monthlyActions: ReportBarPoint[]
  listRows: ReportTableRow[]
  listCols: ReportTableCol[]
}

export function buildAbatementReportMock(): AbatementReportMock {
  return {
    cards: [
      { key: 'runs', title: '총 가동횟수', value: '1,284', sub: '회', accent: '#3b82f6' },
      { key: 'avgMin', title: '평균 가동시간', value: '42', sub: '분', accent: '#22c55e' },
      { key: 'totalMin', title: '총 가동시간', value: '896', sub: '시간', accent: '#8b5cf6' },
      { key: 'facilities', title: '가동 저감시설', value: '18', sub: '개소', accent: '#f97316' },
    ],
    monthlyRuns: [
      { label: '1월', value: 92 },
      { label: '2월', value: 88 },
      { label: '3월', value: 105 },
      { label: '4월', value: 112 },
      { label: '5월', value: 128 },
      { label: '6월', value: 141 },
      { label: '7월', value: 156 },
      { label: '8월', value: 148 },
      { label: '9월', value: 119 },
      { label: '10월', value: 101 },
      { label: '11월', value: 94 },
    ],
    stationCols: [
      { key: 'station', label: '지점' },
      { key: 'emd', label: '읍면동' },
      { key: 'runs', label: '가동횟수', align: 'right' },
      { key: 'avgMin', label: '평균(분)', align: 'right' },
      { key: 'totalMin', label: '총시간', align: 'right' },
      { key: 'lastAt', label: '최근 가동' },
    ],
    stationRows: [
      { station: 'A-01 중앙맨홀', emd: '중앙동', runs: 86, avgMin: 38, totalMin: '54h', lastAt: '11-23 09:12' },
      { station: 'A-07 시장앞', emd: '동부동', runs: 72, avgMin: 45, totalMin: '54h', lastAt: '11-23 08:41' },
      { station: 'B-03 하수처리장', emd: '서부동', runs: 64, avgMin: 51, totalMin: '54h', lastAt: '11-22 22:05' },
      { station: 'B-12 공단입구', emd: '남부동', runs: 58, avgMin: 33, totalMin: '32h', lastAt: '11-23 07:55' },
      { station: 'C-02 북부펌프', emd: '북부동', runs: 49, avgMin: 40, totalMin: '33h', lastAt: '11-21 18:20' },
    ],
  }
}

export function buildAlertReportMock(): AlertReportMock {
  return {
    cards: [
      { key: 'count', title: '경보 발생', value: '326', sub: '건', accent: '#ef4444' },
      { key: 'avgPpm', title: '평균 농도', value: '4.8', sub: 'ppm', accent: '#f97316' },
      { key: 'top', title: '최다 발생 지점', value: 'A-07', sub: '시장앞', accent: '#eab308' },
      { key: 'recover', title: '평균 복귀시간', value: '28', sub: '분', accent: '#3b82f6' },
    ],
    monthlyTrend: [
      { label: '1월', value: 22 },
      { label: '2월', value: 19 },
      { label: '3월', value: 27 },
      { label: '4월', value: 31 },
      { label: '5월', value: 36 },
      { label: '6월', value: 42 },
      { label: '7월', value: 48 },
      { label: '8월', value: 44 },
      { label: '9월', value: 29 },
      { label: '10월', value: 24 },
      { label: '11월', value: 21 },
    ],
    gradePie: [
      { label: '주의(3)', value: 148, color: '#eab308' },
      { label: '경고(4)', value: 112, color: '#f97316' },
      { label: '심각(5)', value: 66, color: '#ef4444' },
    ],
    stationCols: [
      { key: 'station', label: '지점' },
      { key: 'count', label: '발생', align: 'right' },
      { key: 'avgPpm', label: '평균ppm', align: 'right' },
      { key: 'maxPpm', label: '최고ppm', align: 'right' },
      { key: 'avgRecover', label: '평균복귀', align: 'right' },
      { key: 'lastAt', label: '최근 발생' },
    ],
    stationRows: [
      { station: 'A-07 시장앞', count: 48, avgPpm: 5.6, maxPpm: 9.2, avgRecover: '32분', lastAt: '11-23 10:05' },
      { station: 'A-01 중앙맨홀', count: 41, avgPpm: 4.9, maxPpm: 8.1, avgRecover: '26분', lastAt: '11-23 08:22' },
      { station: 'B-03 하수처리장', count: 37, avgPpm: 5.1, maxPpm: 7.8, avgRecover: '35분', lastAt: '11-22 21:40' },
      { station: 'C-02 북부펌프', count: 29, avgPpm: 4.2, maxPpm: 6.5, avgRecover: '22분', lastAt: '11-22 14:11' },
      { station: 'B-12 공단입구', count: 24, avgPpm: 3.9, maxPpm: 6.1, avgRecover: '19분', lastAt: '11-21 16:48' },
    ],
  }
}

export function buildComplaintReportMock(): ComplaintReportMock {
  return {
    cards: [
      { key: 'recv', title: '접수', value: '87', sub: '건', accent: '#3b82f6' },
      { key: 'done', title: '처리완료', value: '61', sub: '건', accent: '#22c55e' },
      { key: 'ing', title: '처리중', value: '26', sub: '건', accent: '#eab308' },
      { key: 'avgDay', title: '평균 처리일', value: '3.4', sub: '일', accent: '#8b5cf6' },
    ],
    monthlyReceipts: [
      { label: '1월', value: 6 },
      { label: '2월', value: 5 },
      { label: '3월', value: 7 },
      { label: '4월', value: 8 },
      { label: '5월', value: 9 },
      { label: '6월', value: 11 },
      { label: '7월', value: 12 },
      { label: '8월', value: 10 },
      { label: '9월', value: 8 },
      { label: '10월', value: 6 },
      { label: '11월', value: 5 },
    ],
    typePie: [
      { label: '악취 민원', value: 42, color: '#ef4444' },
      { label: '설비 이상', value: 21, color: '#f97316' },
      { label: '소음·기타', value: 14, color: '#eab308' },
      { label: '정보 문의', value: 10, color: '#3b82f6' },
    ],
    listCols: [
      { key: 'no', label: '접수번호' },
      { key: 'recvAt', label: '접수일' },
      { key: 'type', label: '유형' },
      { key: 'place', label: '발생지' },
      { key: 'status', label: '상태' },
      { key: 'days', label: '처리일', align: 'right' },
    ],
    listRows: [
      { no: 'M-1123-01', recvAt: '11-23', type: '악취 민원', place: '중앙동 시장', status: '처리중', days: '—' },
      { no: 'M-1122-04', recvAt: '11-22', type: '설비 이상', place: '서부 처리장', status: '처리완료', days: 2 },
      { no: 'M-1121-02', recvAt: '11-21', type: '악취 민원', place: '동부 맨홀', status: '처리완료', days: 3 },
      { no: 'M-1120-07', recvAt: '11-20', type: '소음·기타', place: '북부펌프', status: '처리중', days: '—' },
      { no: 'M-1119-03', recvAt: '11-19', type: '정보 문의', place: '공단입구', status: '처리완료', days: 1 },
    ],
  }
}

export function buildActionReportMock(): ActionReportMock {
  return {
    cards: [
      { key: 'survey', title: '조사건수', value: '54', sub: '건', accent: '#3b82f6' },
      { key: 'avgPpm', title: '평균 농도', value: '3.7', sub: 'ppm', accent: '#f97316' },
      { key: 'over', title: '기준 초과 지점', value: '9', sub: '개소', accent: '#ef4444' },
      { key: 'reports', title: '보고서', value: '12', sub: '부', accent: '#22c55e' },
    ],
    monthlyActions: [
      { label: '1월', value: 3 },
      { label: '2월', value: 4 },
      { label: '3월', value: 5 },
      { label: '4월', value: 4 },
      { label: '5월', value: 6 },
      { label: '6월', value: 7 },
      { label: '7월', value: 8 },
      { label: '8월', value: 6 },
      { label: '9월', value: 5 },
      { label: '10월', value: 4 },
      { label: '11월', value: 2 },
    ],
    listCols: [
      { key: 'at', label: '조사일' },
      { key: 'station', label: '지점' },
      { key: 'kind', label: '구분' },
      { key: 'ppm', label: '농도', align: 'right' },
      { key: 'over', label: '초과' },
      { key: 'actor', label: '담당' },
      { key: 'note', label: '조치요지' },
    ],
    listRows: [
      {
        at: '11-23',
        station: 'A-07 시장앞',
        kind: '현장 조사',
        ppm: '6.2',
        over: 'Y',
        actor: '김○○',
        note: '저감장치 가동·재측정',
      },
      {
        at: '11-22',
        station: 'B-03 하수처리장',
        kind: '조치',
        ppm: '4.1',
        over: 'N',
        actor: '이○○',
        note: '필터 교체 확인',
      },
      {
        at: '11-21',
        station: 'A-01 중앙맨홀',
        kind: '현장 조사',
        ppm: '5.5',
        over: 'Y',
        actor: '박○○',
        note: '인근 민원 연계 조사',
      },
      {
        at: '11-20',
        station: 'C-02 북부펌프',
        kind: '조치',
        ppm: '2.8',
        over: 'N',
        actor: '최○○',
        note: '통신 복구 후 정상',
      },
      {
        at: '11-19',
        station: 'B-12 공단입구',
        kind: '현장 조사',
        ppm: '7.0',
        over: 'Y',
        actor: '정○○',
        note: '보고서 작성(목업)',
      },
    ],
  }
}
