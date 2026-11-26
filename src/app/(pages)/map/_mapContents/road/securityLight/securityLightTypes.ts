export type SecurityLightSource = 'supply' | 'public';
export type SecurityLightSourceFilter = 'all' | 'supply' | 'public';

export type SecurityLightListItem = {
  key: string;
  source: SecurityLightSource;
  sourceLabel: string;
  id: string;
  location: string;
  manageNo: string;
  lon: number | null;
  lat: number | null;
};

export type SecurityLightSupplyDetail = {
  source: 'supply';
  id: string;
  manageNo: string;
  manageOrg: string;
  bjd: string;
  hjd: string;
  lightKind: string;
  fixtureModel: string;
  lightCapacity: string;
  installYmd: string;
  workNo: string;
  roadSectionNo: string;
  lon: number | null;
  lat: number | null;
};

export type SecurityLightPublicDetail = {
  source: 'public';
  id: string;
  manageNo: string;
  addr: string;
  roadNmAddr: string;
  fcltType: string;
  parcelAddress: string;
  manager: string;
  dataSource: string;
  lon: number | null;
  lat: number | null;
};

export function parseSecurityLightKey(
  key: string | null | undefined
): { source: SecurityLightSource; id: string } | null {
  const s = String(key ?? '').trim();
  const m = /^(supply|public):(.+)$/.exec(s);
  if (!m) return null;
  const source = m[1] as SecurityLightSource;
  const id = String(m[2] ?? '').trim();
  if (!id) return null;
  return { source, id };
}

export function lonLatTo3857(lon: number, lat: number): [number, number] {
  const x = (lon * 20037508.34) / 180;
  let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return [x, y];
}
