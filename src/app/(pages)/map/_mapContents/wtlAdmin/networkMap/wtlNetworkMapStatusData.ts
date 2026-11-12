/** 관망조회 현황판 예시. 저장소 없음. */

export const WTL_PIPE_LENGTH_BY_DIAMETER: { label: string; meters: number }[] = [
  { label: '50㎜', meters: 1800 },
  { label: '65㎜', meters: 4200 },
  { label: '80㎜', meters: 2600 },
  { label: '100㎜', meters: 8600 },
  { label: '150㎜', meters: 12400 },
  { label: '200㎜', meters: 3100 },
  { label: '250㎜', meters: 5400 },
  { label: '300㎜', meters: 7200 },
  { label: '400㎜', meters: 2100 },
  { label: '500㎜', meters: 900 },
]

export const WTL_PIPE_LENGTH_BY_MATERIAL: { label: string; meters: number }[] = [
  { label: 'DCIP', meters: 15200 },
  { label: '주철', meters: 8400 },
  { label: '스테인리스', meters: 4700 },
  { label: 'PE', meters: 6300 },
  { label: 'PVC', meters: 3900 },
  { label: '강관', meters: 2800 },
  { label: '흡관', meters: 1600 },
  { label: '아연도강관', meters: 1100 },
  { label: '폴리에틸렌', meters: 2400 },
  { label: '기타', meters: 700 },
]

export const WTL_PIPE_LENGTH_BY_YEAR: { label: string; meters: number }[] = [
  { label: '1985', meters: 2200 },
  { label: '1990', meters: 3400 },
  { label: '1995', meters: 4100 },
  { label: '1998', meters: 5100 },
  { label: '2002', meters: 4600 },
  { label: '2004', meters: 9200 },
  { label: '2008', meters: 6800 },
  { label: '2011', meters: 7800 },
  { label: '2016', meters: 6200 },
  { label: '2020', meters: 3700 },
]

export const WTL_FACILITY_COUNTS: { label: string; count: number }[] = [
  { label: '소방시설', count: 48 },
  { label: '유량계', count: 12 },
  { label: '급수전계량기', count: 1860 },
  { label: '변류시설', count: 36 },
  { label: '배수지', count: 4 },
  { label: '수압계', count: 9 },
  { label: '가압펌프장', count: 3 },
  { label: '상수맨홀', count: 214 },
  { label: '수원지', count: 2 },
  { label: '취수장', count: 1 },
]
