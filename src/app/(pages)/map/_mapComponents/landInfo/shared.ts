export const COORDINATE_SYSTEM_OPTIONS: { label: string; shortLabel: string; code: string }[] = [
  { label: '서부원점 50만, GRS80 [EPSG:5180]', shortLabel: '서부 50만(5180)', code: 'EPSG:5180' },
  { label: '중부원점 50만, GRS80 [EPSG:5181]', shortLabel: '중부 50만(5181)', code: 'EPSG:5181' },
  { label: '제주원점 55만, GRS80 [EPSG:5182]', shortLabel: '제주 55만(5182)', code: 'EPSG:5182' },
  { label: '동부원점 50만, GRS80 [EPSG:5183]', shortLabel: '동부 50만(5183)', code: 'EPSG:5183' },
  { label: '울릉원점 50만, GRS80 [EPSG:5184]', shortLabel: '울릉 50만(5184)', code: 'EPSG:5184' },
  { label: '서부원점 60만, GRS80 [EPSG:5185]', shortLabel: '서부 60만(5185)', code: 'EPSG:5185' },
  { label: '중부원점 60만, GRS80 [EPSG:5186]', shortLabel: '중부 60만(5186)', code: 'EPSG:5186' },
  { label: '동부원점 60만, GRS80 [EPSG:5187]', shortLabel: '동부 60만(5187)', code: 'EPSG:5187' },
  { label: '울릉원점 60만, GRS80 [EPSG:5188]', shortLabel: '울릉 60만(5188)', code: 'EPSG:5188' },
  { label: '위경도, WGS84 [EPSG:4326]', shortLabel: '위경도(4326)', code: 'EPSG:4326' },
];

export interface AddressInfoPanelProps {
  coordinate: [number, number];
  viewProjection: string;
  jibun: string | null;
  road: string | null;
  pnu?: string | null;
  buildingName?: string | null;
  loading?: boolean;
}
