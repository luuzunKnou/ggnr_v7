/**
 * GGNR_DATA_DIR 루트 폴더 상대 경로 (슬래시 구분).
 * service_data / upload_data 없이 루트에 직접 둔 구조 기준.
 */
export const GGNR_DATA_PATHS = {
  meta: '.meta',
  fileData: 'file_data',
  excelData: 'excel_data',
  shpData: 'shp_data',
  integrations: 'integrations',
  sourceUpload: 'source_upload',
  /** 정사영상 GeoTIFF 원본 (업로드·변환 입력) */
  tilesTif: 'tiles_tif',
  /** 정사영상 XYZ JPEG 타일 (변환 산출) */
  tilesJpg: 'tiles_jpg',
  /** LAS 원본 */
  dtilesLas: '3dtiles_las',
  /** 포인트클라우드 PNTS */
  dtilesPnts: '3dtiles_pnts',
  /** OBJ→B3DM 메시 타일 */
  dtilesB3dm: '3dtiles_b3dm',
  /** OBJ 원본 */
  dtilesObj: '3dtiles_obj',
  /** 3D 지도용 GeoTIFF (2D 패널 GeoTIFF 레이어) */
  dtilesTiff: '3dtiles_tiff',
} as const;

/** ensureBaseStructure 가 생성하는 루트 폴더 */
export const GGNR_BASE_STRUCTURE = [
  GGNR_DATA_PATHS.fileData,
  GGNR_DATA_PATHS.shpData,
  GGNR_DATA_PATHS.excelData,
  GGNR_DATA_PATHS.tilesTif,
  GGNR_DATA_PATHS.tilesJpg,
  GGNR_DATA_PATHS.dtilesLas,
  GGNR_DATA_PATHS.dtilesPnts,
  GGNR_DATA_PATHS.dtilesB3dm,
  GGNR_DATA_PATHS.dtilesObj,
  GGNR_DATA_PATHS.dtilesTiff,
  GGNR_DATA_PATHS.meta,
] as const;
