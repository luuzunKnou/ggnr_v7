/** layer 스키마 테이블 (DB) */
export type LayerSchemaTable = { schema: string; table: string };

export interface ShapeEditorLayerItem {
  id: string;
  name: string;
  /** WMS·defineLayer 키 */
  tableName: string;
  schema: string;
  physicalTableName: string;
  rowFilterSql: string | null;
  shpType: string;
}

export interface ShapeEditorLayerGroup {
  id: string;
  name: string;
  layers: ShapeEditorLayerItem[];
}

export type ShapeEditorToolMode = 'select' | 'draw';

/** 신규 추가 vs 기존 피처 수정 */
export type ShapeEditorEditMode = 'new' | 'edit';

export interface ShapeEditorDraftState {
  hasGeometry: boolean;
  wkt5181: string | null;
  saving: boolean;
  saveMessage: string | null;
}
