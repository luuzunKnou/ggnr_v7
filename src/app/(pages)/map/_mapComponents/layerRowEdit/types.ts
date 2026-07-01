/** 신규 등록 모드용 상세 id */
export const LAYER_ROW_NEW_ID = "__new__";

/** defineLayer 기반 레이어 행 수정 — 화면별 preset */
export type LayerRowEditPreset = {
  /** define_table_name (예: public_land) */
  tableName: string;
  schema?: string;
  /** 목록·상세에서 쓰는 PK 컬럼 (기본 id) */
  keyField?: string;
  /** 상세/수정에서 제외할 컬럼 */
  excludeFields?: string[];
  /** DATE 입력으로 처리할 컬럼 (define type 외 보조) */
  dateFields?: string[];
  /** 삭제 시 함께 지울 자식 테이블 (예: public_land_jijuk) */
  childTableName?: string;
  /** 자식 테이블의 부모 FK 컬럼 (기본 parent_id) */
  childParentField?: string;
};

export type LayerRowDetailAttr = {
  field: string;
  label: string;
  value: string;
};

export type LayerRowParcelItem = {
  address: string;
  /** PNU 19자리(또는 18자리) — jijuk 매칭용 */
  pnu?: string;
  extent3857: [number, number, number, number] | null;
  /** GeoJSON geometry (EPSG:3857) — 지도 미리보기용 */
  geometry3857?: Record<string, unknown> | null;
  /** VWorld 좌표 — jijuk 조회 보조 */
  point4326?: { x: number; y: number };
  /** false면 지도 파란 미리보기 생략 (필지목록 불러오기 등) */
  showMapGeom?: boolean;
};
