/** 관망조회 예시. 저장소 없음. 좌표는 경위도. */

export const WTL_NET_KINDS = ['pipe', 'valve', 'gate', 'hydrant', 'zone'] as const

export type WtlNetKind = (typeof WTL_NET_KINDS)[number]

export type WtlNetItem = {
  id: string
  kind: WtlNetKind
  /** 목록 «번호». 급수구역은 구역 이름 */
  name: string
  diameter: string
  status: string
  material: string
  length: string
  year: string
  area: string
  households: string
  inletValve: string
  nightFlow: string
  supplyZone: string
  supplyBranch: string
  supplyBlock: string
  eupmyeon: string
  ri: string
  line?: [number, number][]
  point?: [number, number]
  ring?: [number, number][]
}

export const WTL_NET_KIND_LABEL: Record<WtlNetKind, string> = {
  pipe: '관로',
  valve: '밸브',
  gate: '제수변',
  hydrant: '소화전',
  zone: '급수구역',
}

export const WTL_NET_ITEMS: WtlNetItem[] = [
  {
    id: 'zone-yy1',
    kind: 'zone',
    name: '영양1',
    diameter: '—',
    status: '주의',
    material: '—',
    length: '—',
    year: '—',
    area: '1.8 ㎢',
    households: '1,240',
    inletValve: 'V-101',
    nightFlow: '42 ㎥/h',
    supplyZone: '영양',
    supplyBranch: '영양1분구',
    supplyBlock: '영양1블록',
    eupmyeon: '영양읍',
    ri: '서부리',
    ring: [
      [128.714, 36.56],
      [128.732, 36.56],
      [128.734, 36.573],
      [128.713, 36.572],
    ],
  },
  {
    id: 'pipe-1042',
    kind: 'pipe',
    name: 'P-1042',
    diameter: '150',
    status: '노후',
    material: 'DCIP',
    length: '128 m',
    year: '1998',
    area: '—',
    households: '—',
    inletValve: '—',
    nightFlow: '—',
    supplyZone: '영양',
    supplyBranch: '영양1분구',
    supplyBlock: '영양1블록',
    eupmyeon: '영양읍',
    ri: '서부리',
    line: [
      [128.716, 36.563],
      [128.723, 36.566],
      [128.73, 36.569],
    ],
  },
  {
    id: 'valve-228',
    kind: 'valve',
    name: 'V-228',
    diameter: '150',
    status: '정상',
    material: '주철',
    length: '—',
    year: '2004',
    area: '—',
    households: '—',
    inletValve: '—',
    nightFlow: '—',
    supplyZone: '영양',
    supplyBranch: '영양1분구',
    supplyBlock: '영양1블록',
    eupmyeon: '영양읍',
    ri: '서부리',
    point: [128.723, 36.566],
  },
  {
    id: 'gate-17',
    kind: 'gate',
    name: 'GV-17',
    diameter: '100',
    status: '정상',
    material: '스테인리스',
    length: '—',
    year: '2016',
    area: '—',
    households: '—',
    inletValve: '—',
    nightFlow: '—',
    supplyZone: '영양',
    supplyBranch: '영양1분구',
    supplyBlock: '영양1블록',
    eupmyeon: '영양읍',
    ri: '서부리',
    point: [128.727, 36.5675],
  },
  {
    id: 'hydrant-09',
    kind: 'hydrant',
    name: 'H-09',
    diameter: '65',
    status: '점검',
    material: '주철',
    length: '—',
    year: '2011',
    area: '—',
    households: '—',
    inletValve: '—',
    nightFlow: '—',
    supplyZone: '영양',
    supplyBranch: '영양2분구',
    supplyBlock: '서부블록',
    eupmyeon: '영양읍',
    ri: '동부리',
    point: [128.719, 36.5642],
  },
  {
    id: 'zone-ip2',
    kind: 'zone',
    name: '입암2',
    diameter: '—',
    status: '정상',
    material: '—',
    length: '—',
    year: '—',
    area: '3.1 ㎢',
    households: '860',
    inletValve: 'V-240',
    nightFlow: '18 ㎥/h',
    supplyZone: '입암',
    supplyBranch: '입암1분구',
    supplyBlock: '입암2블록',
    eupmyeon: '입암면',
    ri: '흥구리',
    ring: [
      [128.748, 36.56],
      [128.766, 36.561],
      [128.764, 36.574],
      [128.746, 36.573],
    ],
  },
]

export function wtlNetDetailTitle(item: WtlNetItem): string {
  if (item.kind === 'zone') return `${item.name}블록`
  return `${WTL_NET_KIND_LABEL[item.kind]} ${item.name}`
}

export function wtlNetDetailRows(item: WtlNetItem): { label: string; value: string }[] {
  if (item.kind === 'zone') {
    return [
      { label: '구역명', value: `${item.name}블록` },
      { label: '구분', value: '급수구역' },
      { label: '면적', value: item.area },
      { label: '세대', value: item.households },
      { label: '유입밸브', value: item.inletValve },
      { label: '야간최소유량', value: item.nightFlow },
      { label: '상태', value: item.status },
    ]
  }
  const rows = [
    { label: '관리번호', value: item.name },
    { label: '구분', value: WTL_NET_KIND_LABEL[item.kind] },
    { label: '구경', value: `${item.diameter} mm` },
    { label: '재질', value: item.material },
  ]
  if (item.kind === 'pipe') rows.push({ label: '연장', value: item.length })
  rows.push({ label: '매설연도', value: item.year }, { label: '상태', value: item.status })
  return rows
}
