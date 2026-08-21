/** 민원 접수 (comp) - 목록/상세 */
export interface CompUI {
  compKey: number;
  compDate: string | null;
  compCu: string | null;
  compCt: string | null;
  compCg: string | null;
  compAdr: string | null;
  compName: string | null;
  compTel: string | null;
  compContent: string | null;
  compExtra: Record<string, unknown> | null;
  latestState?: string | null;
  /** 상세 조회 시 지도 이동용 (EPSG:3857, 점이면 xmin=xmax) */
  extent3857?: [number, number, number, number] | null;
  /** 상세 조회 시 선택 하이라이트용 (EPSG:4326 GeoJSON) */
  geomGeoJson4326?: Record<string, unknown> | null;
}

/** 민원 처리내역 (compd) - compdContents: 처리내용, compdExtra에 title 등 */
export interface CompdUI {
  compdKey: number;
  compKey: number;
  compdDate: string | null;
  compdCu: string | null;
  compdCt: string | null;
  compdCg: string | null;
  compdState: string | null;
  compdContents?: string | null;
  compdExtra: Record<string, unknown> | null;
  compdTitle?: string;
  compdContent?: string;
}

/** 첨부파일 (추후 API 연동) */
export interface CompFileUI {
  fileKey: number;
  compKey: number;
  fileName: string;
  fileSize: string;
  fileDate: string;
  fileType: 'image' | 'pdf' | 'document';
}

export type CompdStateType =
  | '접수'
  | '점검'
  | '보수'
  | '이상발생'
  | '준공'
  | '처리중'
  | '완료';
