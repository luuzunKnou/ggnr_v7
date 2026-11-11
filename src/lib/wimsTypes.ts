/** 필지 안 급수전(수용가·계량기) */
export type WimsMeter = {
  homNum: string;
  homNam: string;
  homAdr: string;
  metNum: string;
  /** EPSG:3857 GeoJSON geometry */
  geom: string | null;
};

export type WimsPair = {
  customerNo: string;
  meterNo: string;
};

/** 검침 이력 한 행 */
export type WimsHistoryRow = {
  nabgiDate: string;
  ymCustNo: string;
  meterYm: string;
  meterMonth: string;
  meterDay: string;
  customerNo: string;
  meterNo: string;
  dongcode: string;
  admDong: string;
  suname: string;
  lostnoAddr: string;
  roadAddr: string;
  useQty: string;
  supcode: string;
  induty: string;
  sgucode: string;
  diam: string;
  blockName: string;
  areaCd: string;
  jocode: string;
  delYn: string;
  gojikind: string;
  freeQty: string;
};

/** 수용가·계량기 기간 통계 */
export type WimsStatRow = {
  customerNo: string;
  meterNo: string;
  induty: string;
  suname: string;
  roadAddr: string;
  avgUseQty: number | null;
  avgFreeQty: number | null;
  delYn: string;
};

export type WimsListQuery = {
  pairs?: WimsPair[];
  customerNo?: string;
  meterNo?: string;
  gojikind?: string;
  jocode?: string;
  searchKeyword?: string;
  searchKeys?: string[];
  page?: number;
  pageSize?: number;
};

export type WimsStatQuery = {
  pairs?: WimsPair[];
  customerNo?: string;
  meterNo?: string;
  startYmd?: string;
  endYmd?: string;
};

export type WimsParcelResult = {
  meters: WimsMeter[];
  statList: WimsStatRow[];
  dataList: WimsHistoryRow[];
  totalCount: number;
};

export const WIMS_PAGE_SIZE = 8;

export const WIMS_GOJIKIND: Record<string, string> = {
  '11': '정기',
  '44': '수시',
};

export const WIMS_JOCODE: Record<string, string> = {
  '1000': '정상조정',
  '3001': '정수처분',
  '3100': '급수중지',
  '9000': '미조정',
  '9999': '폐전',
};

/** 통합검색 대상 (레거시 검침 컬럼) */
export const WIMS_SEARCH_KEYS = [
  'gojikind',
  'meterDay',
  'nabgiDate',
  'customerNo',
  'meterNo',
  'suname',
  'areaCd',
  'admDong',
  'lostnoAddr',
  'roadAddr',
  'useQty',
  'freeQty',
  'induty',
  'diam',
  'delYn',
] as const;
