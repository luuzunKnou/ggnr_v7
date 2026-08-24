/**
 * 접도구역 표주 관리대장 — UI 목업 데이터.
 * 노선(1)에 표주 점(N)이 달린다.
 * 저장소·서버 연동 없음. 새로고침하면 초기 샘플로 돌아간다.
 */
/** 영양군 일월면 부근 — 서식 샘플 위치 */
const YEONGYANG_LON = 129.175;
const YEONGYANG_LAT = 36.748;

export const ROAD_FRONTAGE_MARKER_ROAD_TYPES = ['지방도', '국도', '군도'] as const;
export type RoadFrontageMarkerRoadType = (typeof ROAD_FRONTAGE_MARKER_ROAD_TYPES)[number];

export type RoadFrontageMarkerItem = {
  id: string;
  serialNo: number | null;
  /** 지점거리 */
  stationDistance: string;
  county: string;
  myeon: string;
  ri: string;
  landCategory: string;
  lotNo: string;
  ownerName: string;
  ownerAddress: string;
  sign: string;
  remark: string;
  /** 목업 지도 표시 좌표(EPSG:4326) */
  mockLonLat: { lon: number; lat: number };
};

export type RoadFrontageMarkerLedger = {
  id: string;
  roadType: string;
  routeName: string;
  markers: RoadFrontageMarkerItem[];
};

export const ROAD_FRONTAGE_MARKER_NEW_ID = '__new_road_frontage_marker__';

export function isNewRoadFrontageMarkerId(id: string | null | undefined): boolean {
  return String(id ?? '') === ROAD_FRONTAGE_MARKER_NEW_ID;
}

let idSeq = 0;
export function createRoadFrontageMarkerId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

export function lonLatTo3857(lon: number, lat: number): [number, number] {
  const x = (lon * 20037508.34) / 180;
  const y =
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180);
  return [x, y];
}

export function formatMarkerInstallLocation(item: Pick<
  RoadFrontageMarkerItem,
  'county' | 'myeon' | 'ri' | 'landCategory' | 'lotNo'
>): string {
  return [item.county, item.myeon, item.ri, item.landCategory, item.lotNo]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
}

function mockLonLat(index: number): { lon: number; lat: number } {
  const angle = (index * 41) % 360;
  const radius = 0.008 + (index % 5) * 0.003;
  const rad = (angle * Math.PI) / 180;
  return {
    lon: Number((YEONGYANG_LON + Math.cos(rad) * radius).toFixed(6)),
    lat: Number((YEONGYANG_LAT + Math.sin(rad) * radius).toFixed(6)),
  };
}

/** 표주 점들을 감싸는 범위 — 목록 행 클릭 시 지도 이동 */
export function markersExtent3857(
  markers: Pick<RoadFrontageMarkerItem, 'mockLonLat'>[]
): [number, number, number, number] | null {
  if (markers.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of markers) {
    const [x, y] = lonLatTo3857(m.mockLonLat.lon, m.mockLonLat.lat);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const pad = markers.length === 1 ? 80 : 40;
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}

export function pointExtent3857(
  lonLat: { lon: number; lat: number }
): [number, number, number, number] {
  const [cx, cy] = lonLatTo3857(lonLat.lon, lonLat.lat);
  const half = 50;
  return [cx - half, cy - half, cx + half, cy + half];
}

export function createEmptyRoadFrontageMarkerItem(
  serialNo: number | null = null
): RoadFrontageMarkerItem {
  return {
    id: createRoadFrontageMarkerId('marker'),
    serialNo,
    stationDistance: '',
    county: '',
    myeon: '',
    ri: '',
    landCategory: '',
    lotNo: '',
    ownerName: '',
    ownerAddress: '',
    sign: '',
    remark: '',
    mockLonLat: mockLonLat(idSeq + 20),
  };
}

export function createEmptyRoadFrontageMarkerLedger(): RoadFrontageMarkerLedger {
  return {
    id: createRoadFrontageMarkerId('ledger'),
    roadType: '',
    routeName: '',
    markers: [],
  };
}

function makeMarker(
  data: Omit<RoadFrontageMarkerItem, 'id'>
): RoadFrontageMarkerItem {
  return { id: createRoadFrontageMarkerId('marker'), ...data };
}

export function createInitialRoadFrontageMarkerLedgers(): RoadFrontageMarkerLedger[] {
  return [
    {
      id: createRoadFrontageMarkerId('ledger'),
      roadType: '국도',
      routeName: '국도 31호선',
      markers: [
        makeMarker({
          serialNo: 1,
          stationDistance: '217',
          county: '영양',
          myeon: '일월',
          ri: '곡강리',
          landCategory: '대',
          lotNo: '162-2',
          ownerName: '금용래',
          ownerAddress: '경상북도 영양군 일월면 곡강리 162-2',
          sign: '',
          remark: '상행',
          mockLonLat: mockLonLat(1),
        }),
        makeMarker({
          serialNo: 2,
          stationDistance: '218',
          county: '영양',
          myeon: '일월',
          ri: '도계리',
          landCategory: '전',
          lotNo: '72',
          ownerName: '국(농림부)',
          ownerAddress: '경상북도 영양군 일월면 도계리 72',
          sign: '',
          remark: '상행',
          mockLonLat: mockLonLat(2),
        }),
        makeMarker({
          serialNo: 3,
          stationDistance: '218',
          county: '영양',
          myeon: '일월',
          ri: '섬촌리',
          landCategory: '도로',
          lotNo: '388',
          ownerName: '국(농림부)',
          ownerAddress: '경상북도 영양군 일월면 섬촌리 388',
          sign: '',
          remark: '',
          mockLonLat: mockLonLat(3),
        }),
        makeMarker({
          serialNo: 4,
          stationDistance: '219',
          county: '영양',
          myeon: '일월',
          ri: '섬촌리',
          landCategory: '답',
          lotNo: '201',
          ownerName: '박OO',
          ownerAddress: '경상북도 영양군 일월면 섬촌리 15',
          sign: '',
          remark: '하행',
          mockLonLat: mockLonLat(4),
        }),
      ],
    },
    {
      id: createRoadFrontageMarkerId('ledger'),
      roadType: '지방도',
      routeName: '지방도 911호선',
      markers: [
        makeMarker({
          serialNo: 1,
          stationDistance: '12',
          county: '영양',
          myeon: '청기',
          ri: '정족리',
          landCategory: '대',
          lotNo: '752-3',
          ownerName: '정삼용',
          ownerAddress: '경상북도 영양군 청기면 정족리 544',
          sign: '',
          remark: '상행',
          mockLonLat: mockLonLat(8),
        }),
        makeMarker({
          serialNo: 2,
          stationDistance: '13',
          county: '영양',
          myeon: '청기',
          ri: '정족리',
          landCategory: '전',
          lotNo: '760',
          ownerName: '김OO',
          ownerAddress: '경상북도 영양군 청기면 정족리 760',
          sign: '',
          remark: '',
          mockLonLat: mockLonLat(9),
        }),
      ],
    },
    {
      id: createRoadFrontageMarkerId('ledger'),
      roadType: '군도',
      routeName: '군도 7호선',
      markers: [
        makeMarker({
          serialNo: 1,
          stationDistance: '3',
          county: '영양',
          myeon: '입암',
          ri: '산해리',
          landCategory: '대',
          lotNo: '21',
          ownerName: '한국농어촌공사',
          ownerAddress: '경상북도 영양군 입암면 산해리 1',
          sign: '',
          remark: '',
          mockLonLat: mockLonLat(14),
        }),
      ],
    },
  ];
}
