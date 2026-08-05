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
  /** childTableName 외 삭제 시 함께 지울 자식 테이블 (예: usage_data_as_mgj) */
  additionalChildTableNames?: string[];
  /** 자식 테이블의 부모 FK 컬럼 (기본 parent_id) */
  childParentField?: string;
  /** 자식 테이블 주소 컬럼 (기본 parcel_address, 없으면 usage_loc) */
  childAddressField?: string;
  /** 신규 등록 시 PK(텍스트 키) 직접 입력 허용 */
  keyFieldEditableOnCreate?: boolean;
  /** 신규 등록 시 PK를 서버에서 자동 채번 (defineLayer 읽기전용 키) */
  autoGenerateKeyOnCreate?: boolean;
  /** show_detail=false 필드도 더보기로 표시·저장 */
  includeHiddenDetail?: boolean;
  /**
   * 화면 고정 한글 필드명 (defineLayer 한글명 무시).
   * key는 컬럼명(대소문자 무시). 있으면 해당 맵만 사용.
   */
  fieldLabels?: Record<string, string>;
};

export type LayerRowDetailAttr = {
  field: string;
  label: string;
  value: string;
  /** false면 기본 숨김(더보기로 표시). 미지정은 기본 표시 */
  showDetail?: boolean;
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
  /** WMS 레이어 개별 on/off — ogc_fid 등 */
  wmsRowKey?: { keyField: string; keyValue: string };
};
