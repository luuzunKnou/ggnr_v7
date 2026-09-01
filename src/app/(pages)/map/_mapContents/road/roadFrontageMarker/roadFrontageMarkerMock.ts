/**
 * 접도구역 표주 관리대장 — UI 타입·빈 값.
 */
export {
  formatMarkerInstallLocation,
  jimokFromJijukJibun,
  normalizeMarkerInstallLocation,
  splitInstallLocationAndJimok,
} from './roadFrontageMarkerAddress';

export const ROAD_FRONTAGE_MARKER_ROAD_TYPES = ['지방도', '국도', '군도'] as const;
export type RoadFrontageMarkerRoadType = (typeof ROAD_FRONTAGE_MARKER_ROAD_TYPES)[number];

export type RoadFrontageMarkerItem = {
  id: string;
  serialNo: number | null;
  stationDistance: string;
  installLocation: string;
  landCategory: string;
  ownerName: string;
  ownerAddress: string;
  sign: string;
  remark: string;
  /** 지도 표시 좌표(EPSG:4326) */
  lon?: number | null;
  lat?: number | null;
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

export function createEmptyRoadFrontageMarkerItem(): RoadFrontageMarkerItem {
  return {
    id: createRoadFrontageMarkerId('marker'),
    serialNo: null,
    stationDistance: '',
    installLocation: '',
    landCategory: '',
    ownerName: '',
    ownerAddress: '',
    sign: '',
    remark: '',
    lon: null,
    lat: null,
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

/** EPSG:4326 → EPSG:3857 (지도 표시용) */
export function lonLatTo3857(lon: number, lat: number): [number, number] {
  const x = (lon * 20037508.34) / 180;
  let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return [x, y];
}
