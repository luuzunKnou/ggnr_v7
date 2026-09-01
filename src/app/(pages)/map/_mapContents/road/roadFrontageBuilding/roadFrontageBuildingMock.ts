/**
 * 접도구역 건축물 관리대장 — 화면 타입·빈 값.
 * 대장 필드명은 수급 DBF와 동일(camelCase).
 */
import { DEFAULT_CENTER_LAT, DEFAULT_CENTER_LON } from '../../../_mapComponents/config/mapDefaults';

export const ROAD_FRONTAGE_BUILDING_ROAD_TYPES = ['지방도', '국도', '군도'] as const;
export type RoadFrontageBuildingRoadType = (typeof ROAD_FRONTAGE_BUILDING_ROAD_TYPES)[number];

/** 불량 건축물 표시 — 복수 선택 */
export const ROAD_FRONTAGE_BUILDING_BAD_MARKS = ['A', 'B', 'C', 'D'] as const;

/** 건축물내용 위치 — 하나만 선택 */
export const ROAD_FRONTAGE_BUILDING_LOCATION_KINDS = ['도로예정지', '접도구역'] as const;
export type RoadFrontageBuildingLocationKind =
  (typeof ROAD_FRONTAGE_BUILDING_LOCATION_KINDS)[number];

export function detailLocationKind(
  d: Pick<RoadFrontageBuildingDetailItem, 'locAdrR' | 'locAdrC'>
): RoadFrontageBuildingLocationKind | '' {
  if (String(d.locAdrR ?? '').trim().toUpperCase() === 'Y') return '도로예정지';
  if (String(d.locAdrC ?? '').trim().toUpperCase() === 'Y') return '접도구역';
  return '';
}

export function detailLocationFieldValue(
  d: Pick<RoadFrontageBuildingDetailItem, 'locAdrR' | 'locAdrC'>,
  kind: RoadFrontageBuildingLocationKind
): string {
  return kind === '도로예정지' ? String(d.locAdrR ?? '').trim() : String(d.locAdrC ?? '').trim();
}

/** 화면·인쇄 — Y는 ○, 그 외 수급 원문(△, Y (137), 도로구역 내 등)은 그대로 */
export function detailLocationCellDisplay(raw: string): string {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  if (v.toUpperCase() === 'Y') return '○';
  return v;
}

export function flagsFromLocationKind(
  kind: RoadFrontageBuildingLocationKind | ''
): Pick<RoadFrontageBuildingDetailItem, 'locAdrR' | 'locAdrC'> {
  return {
    locAdrR: kind === '도로예정지' ? 'Y' : '',
    locAdrC: kind === '접도구역' ? 'Y' : '',
  };
}

export type RoadFrontageBuildingDetailItem = {
  id: string;
  /** 동 구분 */
  dongNo: string;
  /** 설치연월일 */
  instYmd: string;
  structure: string;
  usageType: string;
  /** 건축물(공작물) 면적 */
  areaSqm: string;
  /** 도로예정지 — 신규·수정 시 Y, 수급 원문 문자열도 보관 */
  locAdrR: string;
  /** 접도구역 — 신규·수정 시 Y, 수급 원문 문자열도 보관 */
  locAdrC: string;
  badMarks: string[];
};

export type RoadFrontageBuildingConfirmItem = {
  id: string;
  checkYmd: string;
  checkNam: string;
  appNam: string;
};

export type RoadFrontageBuildingFormAttachId = 'locationMap' | 'layoutPlan' | 'before' | 'after';

export const ROAD_FRONTAGE_BUILDING_FORM_ATTACH_TABS: {
  id: RoadFrontageBuildingFormAttachId;
  label: string;
  title: string;
}[] = [
  { id: 'locationMap', label: '위치도', title: '위치도' },
  { id: 'layoutPlan', label: '배치도', title: '건축물(공작물) 배치도' },
  { id: 'before', label: '종전', title: '종전' },
  { id: 'after', label: '변경', title: '변경' },
];

export function emptyRoadFrontageBuildingFormAttaches(): Record<
  RoadFrontageBuildingFormAttachId,
  string[]
> {
  return { locationMap: [], layoutPlan: [], before: [], after: [] };
}

export function emptyRoadFrontageBuildingFormAttachShotDates(): {
  before: string;
  after: string;
} {
  return { before: '', after: '' };
}

export const ROAD_FRONTAGE_BUILDING_DEFAULT_WRITER_DEPT = '안전재난건설과';

export function formatRoadFrontageBuildingWrittenAt(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export type RoadFrontageBuildingLedger = {
  id: string;
  /** 시설식별번호(업무 키) */
  ftrIdn: string;
  roadType: string;
  routeNo: string;
  routeNam: string;
  serialNo: string;
  preYmd: string;
  /** 위치 */
  locAdr: string;
  /** 현 거주자 성명 */
  resiNam: string;
  /** 현 거주자 전화번호 */
  resiNum: string;
  buildOnam: string;
  buildOnum: string;
  buildOadr: string;
  landOnam: string;
  landOnum: string;
  landOadr: string;
  /** 바닥글 부서 */
  writeDept: string;
  /** 바닥글 작성자 */
  writeNam: string;
  /** 바닥글 작성 시각 YYYY-MM-DD HH:mm:ss */
  writeYmd: string;
  /** 지도 표시 좌표(EPSG:4326) */
  mockLonLat: { lon: number; lat: number };
  details: RoadFrontageBuildingDetailItem[];
  confirmHistory: RoadFrontageBuildingConfirmItem[];
  photos: string[];
  /** 관리대장 제2쪽 — 위치도·배치도·종전·변경 */
  formAttaches: Record<RoadFrontageBuildingFormAttachId, string[]>;
  /** 종전·변경 촬영 연월일 */
  formAttachShotDates: { before: string; after: string };
};

export type RoadFrontageBuildingLedgerField = {
  field: keyof Pick<
    RoadFrontageBuildingLedger,
    | 'roadType'
    | 'routeNo'
    | 'serialNo'
    | 'preYmd'
    | 'locAdr'
    | 'resiNam'
    | 'resiNum'
    | 'buildOnam'
    | 'buildOnum'
    | 'buildOadr'
    | 'landOnam'
    | 'landOnum'
    | 'landOadr'
  >;
  label: string;
  /** 상세 속성 표에서 한 줄 전체를 차지 */
  fullWidth?: boolean;
  /** 날짜 입력 */
  date?: boolean;
  /** 도로종류 선택 */
  select?: readonly string[];
  /** 노선번호·노선명을 한 칸에 묶음 */
  routePair?: boolean;
};

export const ROAD_FRONTAGE_BUILDING_LEDGER_FIELDS: RoadFrontageBuildingLedgerField[] = [
  { field: 'roadType', label: '도로의 종류', select: ROAD_FRONTAGE_BUILDING_ROAD_TYPES },
  { field: 'routeNo', label: '노선번호(노선명)', routePair: true },
  { field: 'serialNo', label: '일련번호' },
  { field: 'preYmd', label: '작성연월일', date: true },
  { field: 'locAdr', label: '위치', fullWidth: true },
  { field: 'resiNam', label: '현 거주자' },
  { field: 'resiNum', label: '현 거주자 전화번호' },
  { field: 'buildOnam', label: '건축물 소유자' },
  { field: 'buildOnum', label: '건축물 소유자 전화번호' },
  { field: 'buildOadr', label: '건축물 소유자 주소', fullWidth: true },
  { field: 'landOnam', label: '토지 소유자' },
  { field: 'landOnum', label: '토지 소유자 전화번호' },
  { field: 'landOadr', label: '토지 소유자 주소', fullWidth: true },
];

export function formatRouteNoName(routeNo: string, routeNam: string): string {
  const no = routeNo.trim();
  const name = routeNam.trim();
  if (no && name) return `${no} (${name})`;
  return no || name || '—';
}

export const ROAD_FRONTAGE_BUILDING_NEW_ID = '__new_road_frontage_building__';

export function isNewRoadFrontageBuildingId(id: string | null | undefined): boolean {
  return String(id ?? '') === ROAD_FRONTAGE_BUILDING_NEW_ID;
}

let idSeq = 0;
export function createRoadFrontageBuildingId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

export function lonLatTo3857(lon: number, lat: number): [number, number] {
  const x = (lon * 20037508.34) / 180;
  const y =
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180);
  return [x, y];
}

/** 좌표 주변 작은 범위 — 목록 행 클릭 시 지도 이동에 사용 */
export function ledgerExtent3857(
  ledger: Pick<RoadFrontageBuildingLedger, 'mockLonLat'>
): [number, number, number, number] {
  const [cx, cy] = lonLatTo3857(ledger.mockLonLat.lon, ledger.mockLonLat.lat);
  const half = 60;
  return [cx - half, cy - half, cx + half, cy + half];
}

function mockLonLat(index: number): { lon: number; lat: number } {
  const angle = (index * 53) % 360;
  const radius = 0.012 + (index % 4) * 0.008;
  const rad = (angle * Math.PI) / 180;
  return {
    lon: Number((DEFAULT_CENTER_LON + Math.cos(rad) * radius).toFixed(6)),
    lat: Number((DEFAULT_CENTER_LAT + Math.sin(rad) * radius).toFixed(6)),
  };
}

export function createEmptyRoadFrontageBuildingDetail(): RoadFrontageBuildingDetailItem {
  return {
    id: createRoadFrontageBuildingId('detail'),
    dongNo: '',
    instYmd: '',
    structure: '',
    usageType: '',
    areaSqm: '',
    locAdrR: '',
    locAdrC: '',
    badMarks: [],
  };
}

export function createEmptyRoadFrontageBuildingConfirm(): RoadFrontageBuildingConfirmItem {
  return {
    id: createRoadFrontageBuildingId('confirm'),
    checkYmd: '',
    checkNam: '',
    appNam: '',
  };
}

export function createEmptyRoadFrontageBuildingLedger(): RoadFrontageBuildingLedger {
  return {
    id: createRoadFrontageBuildingId('ledger'),
    ftrIdn: '',
    roadType: '',
    routeNo: '',
    routeNam: '',
    serialNo: '',
    preYmd: '',
    locAdr: '',
    resiNam: '',
    resiNum: '',
    buildOnam: '',
    buildOnum: '',
    buildOadr: '',
    landOnam: '',
    landOnum: '',
    landOadr: '',
    writeDept: ROAD_FRONTAGE_BUILDING_DEFAULT_WRITER_DEPT,
    writeNam: '',
    writeYmd: '',
    mockLonLat: mockLonLat(90),
    details: [],
    confirmHistory: [],
    photos: [],
    formAttaches: emptyRoadFrontageBuildingFormAttaches(),
    formAttachShotDates: emptyRoadFrontageBuildingFormAttachShotDates(),
  };
}
