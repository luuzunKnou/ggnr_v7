/** 점용대장·점사용료·알림 프로토타입용 더미 데이터 (영양군 기준) */

import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin'
import WKT from 'ol/format/WKT'
import Polygon from 'ol/geom/Polygon'

export type ProtoLedgerType = 'road' | 'river' | 'publicLand'

/** 프로토 메모리 저장용 필지 geom (주소·도형 조회·지도 이동) */
export type ProtoParcelDetail = {
  address: string
  pnu?: string
  extent3857?: [number, number, number, number] | null
  geometry3857?: Record<string, unknown> | null
  showMapGeom?: boolean
}

export type ProtoLedgerRow = {
  id: string
  type: ProtoLedgerType
  manageCode: string
  name: string
  permitNo: string
  permitDate: string
  place: string
  purpose: string
  area: string
  startDate: string
  endDate: string
  /** 도로 */
  roadType?: string
  routeNo?: string
  /** 하천 */
  riverType?: string
  riverCode?: string
  riverName?: string
  riverGrade?: string
  /** 국공유지 */
  landCategory?: string
  publicKind?: string
  parcels: string[]
  /** 도형·저장 후 필지 클릭 이동용 (메모리) */
  parcelDetails?: ProtoParcelDetail[]
  properties: string[]
  mapped: boolean
  /** 프로토 지도 이동용(EPSG:3857) */
  extent3857?: [number, number, number, number]
  /** 프로토 메모리 저장 도형(EPSG:5181 WKT) */
  geomWkt5181?: string | null
}

export type ProtoFeeRow = {
  id: string
  status: '미납' | '수납'
  chargeNo: string
  chargeKey: string
  installment: string
  year: string
  acctType: string
  orgCode: string
  orgName: string
  deptName: string
  deptCode: string
  subjectName: string
  subjectCode: string
  chargeStatus: string
  chargeDate: string
  firstDueDate: string
  /** 목록·이력 표시용 YY-MM-DD */
  dueDate: string
  /** 속성·연계용 YYYY-MM-DD */
  dueDateFull: string
  payer: string
  payerType: string
  payerNo: string
  address: string
  phone: string
  mobile: string
  /** 점용 정보 (세외수입·부서업무 연계) */
  usageName: string
  usagePlace: string
  parcelNo: string
  useStartDate: string
  useEndDate: string
  area: string
  baseFee: string
  vat: string
  /** 목록 합계·부과금액 */
  amount: string
  objectPlace: string
  objectAddress: string
  ePaymentNo: string
  manageCode5: string
  manageCode6: string
  ledgerId: string | null
  /** 관리번호3 */
  officialLandPrice?: string
  /** 관리번호4 */
  usagePurpose?: string
  chargeType?: string
  initialChargeAmount?: string
  paymentType?: string
  seizureType?: string
  reductionType?: string
  lossType?: string
  payerStatus?: string
  payerEmail?: string
  installmentType?: string
  installmentInterest?: string
  arrearsReasonCode?: string
  arrearsReason?: string
  postDueAmount?: string
  postDueDate?: string
  surcharge?: string
  vbankBank1?: string
  vbankNo1?: string
  vbankBank2?: string
  vbankNo2?: string
  vbankBank3?: string
  vbankNo3?: string
}

export type ProtoNotifItem = {
  id: string
  category: '만료임박' | '미납임박'
  title: string
  name: string
  /** 목록 우측 키 열 표시 (없으면 name 파싱) */
  listKey?: string
  read: boolean
  important: boolean
  target: 'ledger' | 'fee'
  targetId: string
}

/** 프로토 내 정보 — 사용자 더미 */
export const PROTO_USER = {
  name: '홍길동',
  email: 'proto@example.com',
  phone: '010-1234-5678',
  dept: '도로과',
} as const

export type ProtoPhotoRequestItem = {
  id: string
  requestDate: string
  status: '대기' | '승인' | '반려'
  title: string
  assignee: string
}

export const PROTO_PHOTO_REQUESTS: ProtoPhotoRequestItem[] = [
  {
    id: 'PR1',
    requestDate: '2025-12-05',
    status: '대기',
    title: '공원 조성 현황',
    assignee: '주무관 오세린',
  },
  {
    id: 'PR2',
    requestDate: '2025-12-05',
    status: '승인',
    title: '철도 연결구간',
    assignee: '주무관 오세린',
  },
  {
    id: 'PR3',
    requestDate: '2025-11-29',
    status: '반려',
    title: '매립지 경계 확대',
    assignee: '주무관 오세린',
  },
  {
    id: 'PR4',
    requestDate: '2025-11-24',
    status: '대기',
    title: '농지 이용현황',
    assignee: '주무관 오세린',
  },
]

/** WGS84 → EPSG:3857 (프로토 더미 지도 이동용) */
function lonLatTo3857(lon: number, lat: number): [number, number] {
  const x = (lon * 20037508.34) / 180
  const latRad = (lat * Math.PI) / 180
  const y = Math.log(Math.tan(Math.PI / 4 + latRad / 2)) * 6378137
  return [x, y]
}

/** 중심 좌표 기준 프로토 클릭·목록 이동용 extent (반경 m — 레거시·비점용용) */
function protoExtentAroundLonLat(
  lon: number,
  lat: number,
  halfM = 180
): [number, number, number, number] {
  const [cx, cy] = lonLatTo3857(lon, lat)
  return [cx - halfM, cy - halfM, cx + halfM, cy + halfM]
}

function parseAreaM2(area: string): number {
  const n = Number.parseFloat(String(area).replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 20
}

type ProtoOccupancyShape = 'roadStrip' | 'riverStrip' | 'parcelBlock'

/** 점용면적(㎡) 기준 반폭·반장(m) — 3857 단위 ≈ m */
function protoOccupancyHalfSize(
  areaM2: number,
  shape: ProtoOccupancyShape
): { halfW: number; halfH: number } {
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

  if (shape === 'roadStrip') {
    const width = clamp(Math.sqrt(areaM2) * 0.35, 1.2, 4.5)
    const length = areaM2 / width
    return {
      halfW: width / 2,
      halfH: clamp(length / 2, 2.5, 28),
    }
  }
  if (shape === 'riverStrip') {
    const width = clamp(Math.sqrt(areaM2) * 0.4, 2, 5)
    const length = areaM2 / width
    return {
      halfW: width / 2,
      halfH: clamp(length / 2, 2.5, 22),
    }
  }
  const side = Math.sqrt(areaM2)
  const aspect = areaM2 > 120 ? 1.55 : 1.25
  return {
    halfW: clamp((side * aspect) / 2, 3, 18),
    halfH: clamp(side / (aspect * 2), 3, 14),
  }
}

/** 점용면적·형태에 맞는 좁은 도형 + extent (EPSG:5181 WKT) */
function protoLedgerMapFields(
  lon: number,
  lat: number,
  area: string,
  shape: ProtoOccupancyShape,
  bearingDeg = 0
): Pick<ProtoLedgerRow, 'extent3857' | 'geomWkt5181'> {
  const areaM2 = parseAreaM2(area)
  const { halfW, halfH } = protoOccupancyHalfSize(areaM2, shape)
  const [cx, cy] = lonLatTo3857(lon, lat)
  const rad = (bearingDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const localCorners: [number, number][] = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ]

  const jitter = (i: number) => {
    const t = Math.sin(lon * 911 + lat * 577 + i * 17.3) * 0.5 + 0.5
    return (t - 0.5) * Math.min(halfW, halfH) * 0.1
  }

  const ring = localCorners.map(([e, n], i) => {
    const je = e + jitter(i)
    const jn = n + jitter(i + 3)
    return [cx + je * cos - jn * sin, cy + je * sin + jn * cos] as [number, number]
  })
  ring.push(ring[0]!)

  const poly3857 = new Polygon([ring])
  const poly5181 = poly3857.clone()
  poly5181.transform('EPSG:3857', 'EPSG:5181')
  const ext = poly3857.getExtent()
  if (ext.length !== 4 || !ext.every(Number.isFinite)) {
    const fallback = protoExtentAroundLonLat(lon, lat, Math.max(halfW, halfH))
    return {
      extent3857: fallback,
      geomWkt5181: protoGeomWkt5181FromExtent3857(fallback),
    }
  }

  return {
    extent3857: ext as [number, number, number, number],
    geomWkt5181: new WKT().writeGeometry(poly5181),
  }
}

/** 영양군 행정구역별 대표 좌표(WGS84) — build_yy 지도·더미 통일 */
export const PROTO_YY_LONLAT = {
  /** 영양읍 중앙로·군청 인근 */
  eupCenter: { lon: 129.1142, lat: 36.6671 },
  eupJungang120: { lon: 129.1168, lat: 36.6685 },
  eupSan: { lon: 129.1255, lat: 36.6582 },
  eupSuha: { lon: 129.1085, lat: 36.6548 },
  eupSeobu: { lon: 129.1105, lat: 36.6698 },
  ipam: { lon: 129.052, lat: 36.5815 },
  suhaMyeon: { lon: 129.0745, lat: 36.5478 },
  ilwol: { lon: 129.1782, lat: 36.7185 },
  seokbo: { lon: 128.9848, lat: 36.6245 },
} as const

/** 물건지 더미 좌표(영양읍·면 대표점) */
export const PROTO_PROPERTY_LONLAT: ReadonlyArray<{ x: number; y: number }> = [
  { x: PROTO_YY_LONLAT.eupCenter.lon, y: PROTO_YY_LONLAT.eupCenter.lat },
  { x: PROTO_YY_LONLAT.eupJungang120.lon, y: PROTO_YY_LONLAT.eupJungang120.lat },
  { x: PROTO_YY_LONLAT.eupSuha.lon, y: PROTO_YY_LONLAT.eupSuha.lat },
  { x: PROTO_YY_LONLAT.ipam.lon, y: PROTO_YY_LONLAT.ipam.lat },
  { x: PROTO_YY_LONLAT.ilwol.lon, y: PROTO_YY_LONLAT.ilwol.lat },
]

/** 프로토 더미 — 대장 extent를 필지 수만큼 나눠 클릭 이동용 extent 부여 */
export function buildProtoParcelDetails(
  addresses: string[],
  extent3857?: [number, number, number, number]
): ProtoParcelDetail[] | undefined {
  if (!extent3857 || addresses.length === 0) return undefined
  const [minX, minY, maxX, maxY] = extent3857
  if (![minX, minY, maxX, maxY].every((v) => Number.isFinite(v))) return undefined
  if (addresses.length === 1) {
    return [{ address: addresses[0]!, extent3857: [...extent3857] }]
  }
  const sliceW = (maxX - minX) / addresses.length
  return addresses.map((address, i) => {
    const x0 = minX + sliceW * i
    const x1 = i === addresses.length - 1 ? maxX : minX + sliceW * (i + 1)
    return {
      address,
      extent3857: [x0, minY, x1, maxY] as [number, number, number, number],
    }
  })
}

/** extent(EPSG:3857) → 프로토 조회용 도형 WKT(EPSG:5181) */
function protoGeomWkt5181FromExtent3857(
  extent3857: [number, number, number, number]
): string {
  const [minX, minY, maxX, maxY] = extent3857
  const poly = new Polygon([
    [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
      [minX, minY],
    ],
  ])
  poly.transform('EPSG:3857', 'EPSG:5181')
  return new WKT().writeGeometry(poly)
}

const PROTO_LEDGERS_RAW: ProtoLedgerRow[] = [
  {
    id: 'L1',
    type: 'road',
    manageCode: 'RD-2024-001',
    name: '영업용간판설치',
    permitNo: '도로점2024-0156',
    permitDate: '2024-01-15',
    place: '영양군 영양읍 중앙로 45 국도 제31호선 구간',
    purpose: '영업용 간판',
    area: '24.5',
    startDate: '2024-01-15',
    endDate: '2028-01-14',
    roadType: '국도',
    routeNo: '31',
    parcels: ['영양읍 중앙로 45-3', '영양읍 중앙로 45-4'],
    properties: ['김영수상회 간판'],
    mapped: true,
    ...protoLedgerMapFields(
      PROTO_YY_LONLAT.eupCenter.lon,
      PROTO_YY_LONLAT.eupCenter.lat,
      '24.5',
      'roadStrip',
      18
    ),
  },
  {
    id: 'L2',
    type: 'road',
    manageCode: 'RD-2022-028',
    name: '상하수도배관점용',
    permitNo: '도로점2022-0089',
    permitDate: '2022-03-10',
    place: '영양군 입암면 입암로 120~125 구간',
    purpose: '상·하수도관로',
    area: '18.2',
    startDate: '2022-03-15',
    endDate: '2027-03-14',
    roadType: '군도',
    routeNo: '1021',
    parcels: ['입암면 입암리 120-1'],
    properties: ['상수관로 D300', '하수관로 D400'],
    mapped: true,
    ...protoLedgerMapFields(PROTO_YY_LONLAT.ipam.lon, PROTO_YY_LONLAT.ipam.lat, '18.2', 'roadStrip', -8),
  },
  {
    id: 'L3',
    type: 'road',
    manageCode: 'RD-2021-089',
    name: '공사용가설건축물',
    permitNo: '도로점2021-0342',
    permitDate: '2021-06-01',
    place: '영양군 수하면 수하리 도로변(구 군도 15호)',
    purpose: '공사용 가설물',
    area: '86.0',
    startDate: '2021-06-01',
    endDate: '2026-05-31',
    roadType: '군도',
    routeNo: '15',
    parcels: ['수하면 수하리 234'],
    properties: [],
    mapped: false,
    ...protoLedgerMapFields(
      PROTO_YY_LONLAT.suhaMyeon.lon,
      PROTO_YY_LONLAT.suhaMyeon.lat,
      '86.0',
      'roadStrip',
      105
    ),
  },
  {
    id: 'L4',
    type: 'river',
    manageCode: 'RV-2024-003',
    name: '농업용수취수설비',
    permitNo: '하천점2024-0007',
    permitDate: '2024-03-01',
    place: '영양군 영양읍 수하교 인근 남강 좌안',
    purpose: '농업용수 취수',
    area: '12.0',
    startDate: '2024-03-01',
    endDate: '2029-02-28',
    riverType: '국가하천',
    riverCode: '1003010',
    riverName: '남강',
    riverGrade: '1급',
    parcels: ['영양읍 수하리 56-2'],
    properties: ['취수펌프장'],
    mapped: true,
    ...protoLedgerMapFields(
      PROTO_YY_LONLAT.eupSuha.lon,
      PROTO_YY_LONLAT.eupSuha.lat,
      '12.0',
      'riverStrip',
      82
    ),
  },
  {
    id: 'L5',
    type: 'publicLand',
    manageCode: 'PL-2023-012',
    name: '임시주차장점용',
    permitNo: '공유2023-0012',
    permitDate: '2023-05-01',
    place: '영양군 영양읍 산계리 234 공유재산',
    purpose: '임시 주차장',
    area: '320.0',
    startDate: '2023-05-01',
    endDate: '2028-04-30',
    landCategory: '도로',
    publicKind: '공유',
    parcels: ['영양읍 산계리 234'],
    properties: ['주차장 펜스'],
    mapped: true,
    ...protoLedgerMapFields(
      PROTO_YY_LONLAT.eupSan.lon,
      PROTO_YY_LONLAT.eupSan.lat,
      '320.0',
      'parcelBlock',
      12
    ),
  },
  {
    id: 'L6',
    type: 'road',
    manageCode: 'RD-2023-045',
    name: '도로공사가설통행로',
    permitNo: '도로점2023-0211',
    permitDate: '2023-08-20',
    place: '영양군 일월면 일월로 88 도로공사 구간',
    purpose: '공사용 가설통행로',
    area: '145.0',
    startDate: '2023-09-01',
    endDate: '2024-08-31',
    roadType: '군도',
    routeNo: '1025',
    parcels: ['일월면 일월리 88-1', '일월면 일월리 88-2'],
    properties: ['가설통행로 A구간', '안전펜스'],
    mapped: true,
    ...protoLedgerMapFields(
      PROTO_YY_LONLAT.ilwol.lon,
      PROTO_YY_LONLAT.ilwol.lat,
      '145.0',
      'roadStrip',
      38
    ),
  },
  {
    id: 'L7',
    type: 'river',
    manageCode: 'RV-2023-008',
    name: '하천변가설발판',
    permitNo: '하천점2023-0018',
    permitDate: '2023-04-10',
    place: '영양군 석보면 석보천 우안(지방하천)',
    purpose: '하천 정비 공사',
    area: '28.5',
    startDate: '2023-04-15',
    endDate: '2024-10-14',
    riverType: '지방하천',
    riverCode: '4775030',
    riverName: '석보천',
    riverGrade: '2급',
    parcels: ['석보면 석보리 12-3'],
    properties: ['가설발판'],
    mapped: true,
    ...protoLedgerMapFields(
      PROTO_YY_LONLAT.seokbo.lon,
      PROTO_YY_LONLAT.seokbo.lat,
      '28.5',
      'riverStrip',
      68
    ),
  },
  {
    id: 'L8',
    type: 'road',
    manageCode: 'RD-2025-002',
    name: '버스정류장광고물',
    permitNo: '도로점2025-0004',
    permitDate: '2025-02-03',
    place: '영양군 영양읍 중앙로 120 버스정류장',
    purpose: '버스정류장 광고물',
    area: '6.8',
    startDate: '2025-02-03',
    endDate: '2030-02-02',
    roadType: '군도',
    routeNo: '31',
    parcels: ['영양읍 중앙로 120'],
    properties: ['버스쉘터 광고판'],
    mapped: true,
    ...protoLedgerMapFields(
      PROTO_YY_LONLAT.eupJungang120.lon,
      PROTO_YY_LONLAT.eupJungang120.lat,
      '6.8',
      'roadStrip',
      22
    ),
  },
]

export const PROTO_LEDGERS: ProtoLedgerRow[] = PROTO_LEDGERS_RAW.map((row) => ({
  ...row,
  parcelDetails: row.parcelDetails ?? buildProtoParcelDetails(row.parcels, row.extent3857),
}))

export const PROTO_FEES: ProtoFeeRow[] = [
  {
    id: 'F1',
    status: '미납',
    chargeNo: '20260101234',
    chargeKey: '47750-D01-2026-001234',
    installment: '1',
    year: '2026',
    acctType: '일반회계',
    orgCode: '47750',
    orgName: '경상북도 영양군',
    deptName: '도로교통과',
    deptCode: '021',
    subjectName: '점사용료',
    subjectCode: '412001',
    chargeStatus: '부과',
    chargeDate: '2026-03-01',
    firstDueDate: '2026-07-31',
    dueDate: '26-07-31',
    dueDateFull: '2026-07-31',
    payer: '김영수',
    payerType: '개인',
    payerNo: '4775012345678',
    address: '경상북도 영양군 영양읍 중앙로 45-3',
    phone: '054-683-1234',
    mobile: '010-1234-5678',
    usageName: '영업용간판설치',
    usagePlace: '영양군 영양읍 중앙로 45 국도 제31호선 구간',
    parcelNo: '영양읍 중앙로 45-3',
    useStartDate: '2026-01-15',
    useEndDate: '2027-01-14',
    area: '24.5',
    baseFee: '1,123,000',
    vat: '112,300',
    amount: '1,235,300',
    objectPlace: '김영수상회 간판',
    objectAddress: '경상북도 영양군 영양읍 중앙로 45-3',
    ePaymentNo: '4775020260012345678',
    manageCode5: 'RD-2024-001',
    manageCode6: 'RD-2024-001',
    ledgerId: 'L1',
    officialLandPrice: '125,000',
    usagePurpose: '영업용간판',
    chargeType: '정기부과',
    initialChargeAmount: '1,235,300',
    paymentType: '미납',
    seizureType: '해당없음',
    reductionType: '해당없음',
    lossType: '해당없음',
    payerStatus: '정상',
    payerEmail: 'kim@example.com',
    installmentType: '일시납',
    installmentInterest: '0',
    arrearsReasonCode: '—',
    arrearsReason: '—',
    postDueAmount: '1,247,830',
    postDueDate: '2026-08-31',
    surcharge: '12,530',
    vbankBank1: '국민은행',
    vbankNo1: '123-456-789012',
    vbankBank2: '농협은행',
    vbankNo2: '356-1234-5678-90',
    vbankBank3: '우리은행',
    vbankNo3: '1002-345-678901',
  },
  {
    id: 'F2',
    status: '수납',
    chargeNo: '20250101234',
    chargeKey: '47750-D01-2025-001234',
    installment: '1',
    year: '2025',
    acctType: '일반회계',
    orgCode: '47750',
    orgName: '경상북도 영양군',
    deptName: '도로교통과',
    deptCode: '021',
    subjectName: '점사용료',
    subjectCode: '412001',
    chargeStatus: '수납',
    chargeDate: '2025-03-01',
    firstDueDate: '2025-07-31',
    dueDate: '25-07-31',
    dueDateFull: '2025-07-31',
    payer: '김영수',
    payerType: '개인',
    payerNo: '4775012345678',
    address: '경상북도 영양군 영양읍 중앙로 45-3',
    phone: '054-683-1234',
    mobile: '010-1234-5678',
    usageName: '영업용간판설치',
    usagePlace: '영양군 영양읍 중앙로 45 국도 제31호선 구간',
    parcelNo: '영양읍 중앙로 45-3',
    useStartDate: '2025-01-15',
    useEndDate: '2026-01-14',
    area: '24.5',
    baseFee: '1,080,000',
    vat: '108,000',
    amount: '1,188,000',
    objectPlace: '김영수상회 간판',
    objectAddress: '경상북도 영양군 영양읍 중앙로 45-3',
    ePaymentNo: '4775020250012345678',
    manageCode5: 'RD-2024-001',
    manageCode6: 'RD-2024-001',
    ledgerId: 'L1',
  },
  {
    id: 'F3',
    status: '수납',
    chargeNo: '20240101234',
    chargeKey: '47750-D01-2024-001234',
    installment: '1',
    year: '2024',
    acctType: '일반회계',
    orgCode: '47750',
    orgName: '경상북도 영양군',
    deptName: '도로교통과',
    deptCode: '021',
    subjectName: '점사용료',
    subjectCode: '412001',
    chargeStatus: '수납',
    chargeDate: '2024-03-01',
    firstDueDate: '2024-07-31',
    dueDate: '24-07-31',
    dueDateFull: '2024-07-31',
    payer: '김영수',
    payerType: '개인',
    payerNo: '4775012345678',
    address: '경상북도 영양군 영양읍 중앙로 45-3',
    phone: '054-683-1234',
    mobile: '010-1234-5678',
    usageName: '영업용간판설치',
    usagePlace: '영양군 영양읍 중앙로 45 국도 제31호선 구간',
    parcelNo: '영양읍 중앙로 45-3',
    useStartDate: '2024-01-15',
    useEndDate: '2025-01-14',
    area: '24.5',
    baseFee: '1,045,000',
    vat: '104,500',
    amount: '1,149,500',
    objectPlace: '김영수상회 간판',
    objectAddress: '경상북도 영양군 영양읍 중앙로 45-3',
    ePaymentNo: '4775020240012345678',
    manageCode5: 'RD-2024-001',
    manageCode6: 'RD-2024-001',
    ledgerId: 'L1',
  },
  {
    id: 'F4',
    status: '미납',
    chargeNo: '20260102089',
    chargeKey: '47750-D01-2026-002089',
    installment: '1',
    year: '2026',
    acctType: '일반회계',
    orgCode: '47750',
    orgName: '경상북도 영양군',
    deptName: '도로교통과',
    deptCode: '021',
    subjectName: '점사용료',
    subjectCode: '412001',
    chargeStatus: '부과',
    chargeDate: '2026-03-01',
    firstDueDate: '2026-08-15',
    dueDate: '26-08-15',
    dueDateFull: '2026-08-15',
    payer: '영양군수도사업소',
    payerType: '법인',
    payerNo: '4775000123456',
    address: '경상북도 영양군 영양읍 중앙로 1',
    phone: '054-683-2100',
    mobile: '',
    usageName: '상하수도배관점용',
    usagePlace: '영양군 입암면 입암로 120~125 구간',
    parcelNo: '입암면 입암리 120-1',
    useStartDate: '2026-03-15',
    useEndDate: '2027-03-14',
    area: '18.2',
    baseFee: '778,000',
    vat: '77,800',
    amount: '855,800',
    objectPlace: '상수관로 D300',
    objectAddress: '경상북도 영양군 입암면 입암로 120',
    ePaymentNo: '4775020260020890123',
    manageCode5: 'RD-2022-028',
    manageCode6: 'RD-2022-028',
    ledgerId: 'L2',
  },
  {
    id: 'F5',
    status: '수납',
    chargeNo: '20250102089',
    chargeKey: '47750-D01-2025-002089',
    installment: '1',
    year: '2025',
    acctType: '일반회계',
    orgCode: '47750',
    orgName: '경상북도 영양군',
    deptName: '도로교통과',
    deptCode: '021',
    subjectName: '점사용료',
    subjectCode: '412001',
    chargeStatus: '수납',
    chargeDate: '2025-03-01',
    firstDueDate: '2025-07-31',
    dueDate: '25-07-31',
    dueDateFull: '2025-07-31',
    payer: '영양군수도사업소',
    payerType: '법인',
    payerNo: '4775000123456',
    address: '경상북도 영양군 영양읍 중앙로 1',
    phone: '054-683-2100',
    mobile: '',
    usageName: '상하수도배관점용',
    usagePlace: '영양군 입암면 입암로 120~125 구간',
    parcelNo: '입암면 입암리 120-1',
    useStartDate: '2025-03-15',
    useEndDate: '2026-03-14',
    area: '18.2',
    baseFee: '756,000',
    vat: '75,600',
    amount: '831,600',
    objectPlace: '상수관로 D300',
    objectAddress: '경상북도 영양군 입암면 입암로 120',
    ePaymentNo: '4775020250020890123',
    manageCode5: 'RD-2022-028',
    manageCode6: 'RD-2022-028',
    ledgerId: 'L2',
  },
  {
    id: 'F6',
    status: '미납',
    chargeNo: '20260103007',
    chargeKey: '47750-D02-2026-003007',
    installment: '1',
    year: '2026',
    acctType: '일반회계',
    orgCode: '47750',
    orgName: '경상북도 영양군',
    deptName: '환경과',
    deptCode: '022',
    subjectName: '점사용료',
    subjectCode: '412001',
    chargeStatus: '부과',
    chargeDate: '2026-03-01',
    firstDueDate: '2026-07-31',
    dueDate: '26-07-31',
    dueDateFull: '2026-07-31',
    payer: '박철민',
    payerType: '개인',
    payerNo: '4775098765432',
    address: '경상북도 영양군 영양읍 수하리 56',
    phone: '054-683-4567',
    mobile: '010-9876-5432',
    usageName: '농업용수취수설비',
    usagePlace: '영양군 영양읍 수하교 인근 남강 좌안',
    parcelNo: '영양읍 수하리 56-2',
    useStartDate: '2026-03-01',
    useEndDate: '2027-02-28',
    area: '12.0',
    baseFee: '432,000',
    vat: '43,200',
    amount: '475,200',
    objectPlace: '취수펌프장',
    objectAddress: '경상북도 영양군 영양읍 수하리 56-2',
    ePaymentNo: '4775020260030070456',
    manageCode5: 'RV-2024-003',
    manageCode6: 'RV-2024-003',
    ledgerId: 'L4',
  },
  {
    id: 'F7',
    status: '수납',
    chargeNo: '20260104012',
    chargeKey: '47750-D03-2026-004012',
    installment: '1',
    year: '2026',
    acctType: '일반회계',
    orgCode: '47750',
    orgName: '경상북도 영양군',
    deptName: '재무과',
    deptCode: '031',
    subjectName: '점사용료',
    subjectCode: '412001',
    chargeStatus: '수납',
    chargeDate: '2026-01-15',
    firstDueDate: '2026-05-31',
    dueDate: '26-05-31',
    dueDateFull: '2026-05-31',
    payer: '(주)영양주차',
    payerType: '법인',
    payerNo: '4775011122334',
    address: '경상북도 영양군 영양읍 산계리 234',
    phone: '054-683-7788',
    mobile: '010-5555-7788',
    usageName: '임시주차장점용',
    usagePlace: '영양군 영양읍 산계리 234 공유재산',
    parcelNo: '영양읍 산계리 234',
    useStartDate: '2026-05-01',
    useEndDate: '2027-04-30',
    area: '320.0',
    baseFee: '2,880,000',
    vat: '288,000',
    amount: '3,168,000',
    objectPlace: '주차장 펜스',
    objectAddress: '경상북도 영양군 영양읍 산계리 234',
    ePaymentNo: '4775020260040120999',
    manageCode5: 'PL-2023-012',
    manageCode6: 'PL-2023-012',
    ledgerId: 'L5',
  },
  {
    id: 'F8',
    status: '미납',
    chargeNo: '20260105045',
    chargeKey: '47750-D01-2026-005045',
    installment: '1',
    year: '2026',
    acctType: '일반회계',
    orgCode: '47750',
    orgName: '경상북도 영양군',
    deptName: '도로교통과',
    deptCode: '021',
    subjectName: '점사용료',
    subjectCode: '412001',
    chargeStatus: '부과',
    chargeDate: '2026-03-01',
    firstDueDate: '2026-09-30',
    dueDate: '26-09-30',
    dueDateFull: '2026-09-30',
    payer: '대한토목(주)',
    payerType: '법인',
    payerNo: '4775055566677',
    address: '경상북도 영양군 일월면 일월리 10',
    phone: '054-683-9900',
    mobile: '010-3333-9900',
    usageName: '도로공사가설통행로',
    usagePlace: '영양군 일월면 일월로 88 도로공사 구간',
    parcelNo: '일월면 일월리 88-1',
    useStartDate: '2026-01-01',
    useEndDate: '2026-12-31',
    area: '145.0',
    baseFee: '1,450,000',
    vat: '145,000',
    amount: '1,595,000',
    objectPlace: '가설통행로 A구간',
    objectAddress: '경상북도 영양군 일월면 일월로 88',
    ePaymentNo: '4775020260050450888',
    manageCode5: 'RD-2023-045',
    manageCode6: 'RD-2023-045',
    ledgerId: 'L6',
  },
  {
    id: 'F9',
    status: '수납',
    chargeNo: '20250108008',
    chargeKey: '47750-D02-2025-008008',
    installment: '1',
    year: '2025',
    acctType: '일반회계',
    orgCode: '47750',
    orgName: '경상북도 영양군',
    deptName: '환경과',
    deptCode: '022',
    subjectName: '점사용료',
    subjectCode: '412001',
    chargeStatus: '수납',
    chargeDate: '2025-04-15',
    firstDueDate: '2025-08-31',
    dueDate: '25-08-31',
    dueDateFull: '2025-08-31',
    payer: '석보하천정비공사',
    payerType: '법인',
    payerNo: '4775088899900',
    address: '경상북도 영양군 석보면 석보리 5',
    phone: '054-683-3344',
    mobile: '',
    usageName: '하천변가설발판',
    usagePlace: '영양군 석보면 석보천 우안(지방하천)',
    parcelNo: '석보면 석보리 12-3',
    useStartDate: '2025-04-15',
    useEndDate: '2025-10-14',
    area: '28.5',
    baseFee: '570,000',
    vat: '57,000',
    amount: '627,000',
    objectPlace: '가설발판',
    objectAddress: '경상북도 영양군 석보면 석보천 일원',
    ePaymentNo: '4775020250080080333',
    manageCode5: 'RV-2023-008',
    manageCode6: 'RV-2023-008',
    ledgerId: 'L7',
  },
  {
    id: 'F10',
    status: '미납',
    chargeNo: '20260106002',
    chargeKey: '47750-D01-2026-006002',
    installment: '1',
    year: '2026',
    acctType: '일반회계',
    orgCode: '47750',
    orgName: '경상북도 영양군',
    deptName: '도로교통과',
    deptCode: '021',
    subjectName: '점사용료',
    subjectCode: '412001',
    chargeStatus: '부과',
    chargeDate: '2026-03-01',
    firstDueDate: '2026-07-31',
    dueDate: '26-07-31',
    dueDateFull: '2026-07-31',
    payer: '영양광고(주)',
    payerType: '법인',
    payerNo: '4775077788899',
    address: '경상북도 영양군 영양읍 중앙로 118',
    phone: '054-683-6677',
    mobile: '010-7777-6677',
    usageName: '버스정류장광고물',
    usagePlace: '영양군 영양읍 중앙로 120 버스정류장',
    parcelNo: '영양읍 중앙로 120',
    useStartDate: '2026-02-03',
    useEndDate: '2027-02-02',
    area: '6.8',
    baseFee: '340,000',
    vat: '34,000',
    amount: '374,000',
    objectPlace: '버스쉘터 광고판',
    objectAddress: '경상북도 영양군 영양읍 중앙로 120',
    ePaymentNo: '4775020260060020444',
    manageCode5: 'RD-2025-002',
    manageCode6: 'RD-2025-002',
    ledgerId: 'L8',
  },
  {
    id: 'F11',
    status: '수납',
    chargeNo: '20240199887',
    chargeKey: '47750-D01-2024-998877',
    installment: '1',
    year: '2024',
    acctType: '일반회계',
    orgCode: '47750',
    orgName: '경상북도 영양군',
    deptName: '도로교통과',
    deptCode: '021',
    subjectName: '점사용료',
    subjectCode: '412001',
    chargeStatus: '수납',
    chargeDate: '2024-03-01',
    firstDueDate: '2024-07-31',
    dueDate: '24-07-31',
    dueDateFull: '2024-07-31',
    payer: '이정호',
    payerType: '개인',
    payerNo: '4775044455566',
    address: '경상북도 영양군 영양읍 서부로 22',
    phone: '054-683-2211',
    mobile: '010-4444-2211',
    usageName: '(과거)가로시설물',
    usagePlace: '영양군 영양읍 서부로 22',
    parcelNo: '영양읍 서부로 22-1',
    useStartDate: '2024-01-01',
    useEndDate: '2024-12-31',
    area: '15.0',
    baseFee: '620,000',
    vat: '62,000',
    amount: '682,000',
    objectPlace: '(과거 미매핑)',
    objectAddress: '경상북도 영양군 영양읍 서부로 22',
    ePaymentNo: '4775020249988770123',
    manageCode5: '',
    manageCode6: '',
    ledgerId: null,
  },
  {
    id: 'F12',
    status: '수납',
    chargeNo: '20230188776',
    chargeKey: '47750-D01-2023-887766',
    installment: '1',
    year: '2023',
    acctType: '일반회계',
    orgCode: '47750',
    orgName: '경상북도 영양군',
    deptName: '도로교통과',
    deptCode: '021',
    subjectName: '점사용료',
    subjectCode: '412001',
    chargeStatus: '수납',
    chargeDate: '2023-03-01',
    firstDueDate: '2023-07-31',
    dueDate: '23-07-31',
    dueDateFull: '2023-07-31',
    payer: '최민재',
    payerType: '개인',
    payerNo: '4775033344455',
    address: '경상북도 영양군 입암면 입암리 55',
    phone: '054-683-8899',
    mobile: '',
    usageName: '(과거)통신케이블',
    usagePlace: '영양군 입암면 입암로 55',
    parcelNo: '입암면 입암리 55',
    useStartDate: '2023-01-01',
    useEndDate: '2023-12-31',
    area: '9.5',
    baseFee: '380,000',
    vat: '38,000',
    amount: '418,000',
    objectPlace: '(과거 미매핑)',
    objectAddress: '경상북도 영양군 입암면 입암로 55',
    ePaymentNo: '4775020238877660999',
    manageCode5: '',
    manageCode6: '',
    ledgerId: null,
  },
]

export const PROTO_NOTIFS: ProtoNotifItem[] = []

/** 프로토 알림 — 패널·사이드바 공유 (메모리) */
export const PROTO_NOTIF_CHANGED_EVENT = 'ggnr-proto-notifs-changed'

let protoNotifItems: ProtoNotifItem[] = [...PROTO_NOTIFS]

export function getProtoNotifs(): ProtoNotifItem[] {
  return protoNotifItems
}

export function setProtoNotifs(items: ProtoNotifItem[]) {
  if (items === protoNotifItems) return
  protoNotifItems = items
  if (typeof window !== 'undefined') {
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent(PROTO_NOTIF_CHANGED_EVENT))
    })
  }
}

export function hasProtoUnreadNotifications(): boolean {
  return protoNotifItems.some((n) => !n.read)
}

export function feesForLedger(manageCode: string): ProtoFeeRow[] {
  return PROTO_FEES.filter(
    (f) => f.manageCode5 === manageCode || f.manageCode6 === manageCode
  )
}

/** YYYY-MM-DD → YY-MM-DD (목록·이력 납기 표시) */
export function formatProtoDueDate(full: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(full)
  if (!m) return full
  return `${m[1].slice(2)}-${m[2]}-${m[3]}`
}

/** URL system 키로 목록에 쓸 점용 유형 추정 */
export function resolveProtoLedgerType(systemKey: string): ProtoLedgerType {
  const k = systemKey.toLowerCase()
  if (k.includes('river') || k.includes('하천')) return 'river'
  if (k.includes('public') || k.includes('build') || k.includes('국공')) return 'publicLand'
  return 'road'
}

export function ledgerTypeLabel(type: ProtoLedgerType): string {
  if (type === 'river') return '하천점용'
  if (type === 'publicLand') return '국공유지점용'
  return '도로점용'
}

/** 목록 «점용장소» — 시·군·구(·도) 접두 제거, 전체는 title 속성용 */
export function formatProtoLedgerListPlace(place: string): string {
  return formatAddressStripSidoSigungu(place)
}
