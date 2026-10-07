export const USER_DATA_UPLOAD_OPENED_KEY = 'userDataUpload';

export const USER_DATA_UPLOAD_PANEL_DEFAULT_WIDTH = 440;
export const USER_DATA_UPLOAD_PANEL_MIN_WIDTH = 360;
export const USER_DATA_UPLOAD_PANEL_MAX_WIDTH = 900;

export const SHP_PART_EXTS = ['shp', 'shx', 'dbf', 'prj', 'cpg'] as const;
export type ShpPartExt = (typeof SHP_PART_EXTS)[number];
export const SHP_REQUIRED_EXTS: ShpPartExt[] = ['shp', 'shx', 'dbf'];
export const SHP_PART_LABELS: Record<ShpPartExt, string> = {
  shp: '도형',
  shx: '색인',
  dbf: '속성',
  prj: '좌표계',
  cpg: '인코딩',
};

export const EXCEL_EXTS = ['xlsx', 'xls', 'csv'] as const;

/** 브라우저에서 통째로 읽는 상한 — 넘으면 미리보기 대신 서버 처리 안내 */
export const USER_DATA_UPLOAD_MAX_BYTES = 300 * 1024 * 1024;

export const PREVIEW_ROW_LIMIT = 20;
export const PREVIEW_MAP_FEATURE_LIMIT = 100;

export type UploadCrsCode =
  | '4326'
  | '3857'
  | '5174'
  | '5176'
  | '5179'
  | '5180'
  | '5181'
  | '5182'
  | '5183'
  | '5184'
  | '5185'
  | '5186'
  | '5187'
  | '5188';

export const UPLOAD_CRS_OPTIONS: Array<{ code: UploadCrsCode; label: string }> = [
  { code: '4326', label: '위경도 (WGS84)' },
  { code: '3857', label: '웹 메르카토르' },
  { code: '5174', label: '중부원점 (구 베셀)' },
  { code: '5176', label: '동부원점 (구 베셀)' },
  { code: '5179', label: '통합좌표계 (UTM-K)' },
  { code: '5180', label: '서부원점' },
  { code: '5181', label: '중부원점' },
  { code: '5182', label: '제주원점' },
  { code: '5183', label: '동부원점' },
  { code: '5184', label: '동해(울릉)원점' },
  { code: '5185', label: '서부원점 2010' },
  { code: '5186', label: '중부원점 2010' },
  { code: '5187', label: '동부원점 2010' },
  { code: '5188', label: '동해(울릉)원점 2010' },
];

export function getUploadCrsLabel(code: UploadCrsCode | ''): string {
  if (!code) return '—';
  const hit = UPLOAD_CRS_OPTIONS.find((o) => o.code === code);
  return hit ? `${hit.label} · EPSG:${code}` : `EPSG:${code}`;
}

/** TextDecoder 라벨 — euc-kr 은 브라우저에서 cp949 확장까지 처리 */
export type UploadEncoding = 'euc-kr' | 'utf-8';

export const UPLOAD_ENCODING_OPTIONS: Array<{ value: UploadEncoding; label: string }> = [
  { value: 'euc-kr', label: '국내 표준 (CP949·EUC-KR)' },
  { value: 'utf-8', label: '유니코드 (UTF-8)' },
];

export type UploadVisibility = 'private' | 'dept' | 'public';

export const UPLOAD_VISIBILITY_OPTIONS: Array<{ value: UploadVisibility; label: string }> = [
  { value: 'private', label: '나만' },
  { value: 'dept', label: '부서' },
  { value: 'public', label: '전체' },
];

export type ExcelLocationMode = 'coords' | 'address' | 'wkt';

export const EXCEL_LOCATION_OPTIONS: Array<{ value: ExcelLocationMode; label: string }> = [
  { value: 'coords', label: '좌표' },
  { value: 'address', label: '주소' },
  { value: 'wkt', label: '도형문자(WKT)' },
];
