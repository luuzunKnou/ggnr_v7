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
  /** 선택 도형 속성 (저장 시 values로 전달) */
  attributeValues: Record<string, string>;
  /** OpenLayers feature uid — null이면 미선택 */
  selectedFeatureId: string | null;
  /** 신규 / 기존 수정 */
  changeKind: PendingChangeKind;
  /** update 시 DB 키 */
  rowKey: PendingRowKey | null;
  /** WMS 숨김·해제용 feature id */
  wmsFeatureId: string | null;
  /** update — 변경분 계산용 원본 속성 */
  originalAttributeValues: Record<string, string>;
}

export type PendingChangeKind = 'insert' | 'update';

export type PendingRowKey = {
  keyField: string;
  keyValue: string;
};

export type PendingChangeStatus = 'pending' | 'saving' | 'saved' | 'error';

export type EditHistoryAction = 'select' | 'create' | 'move' | 'delete';

/** undo/redo 스택 항목 — 도형·속성 스냅샷 */
export type EditHistoryEntry = {
  id: string;
  action: EditHistoryAction;
  kind: PendingChangeKind;
  layer: Pick<
    ShapeEditorLayerItem,
    'id' | 'name' | 'tableName' | 'schema' | 'physicalTableName'
  >;
  wkt5181: string | null;
  attributeValues: Record<string, string>;
  originalAttributeValues: Record<string, string>;
  rowKey: PendingRowKey | null;
  wmsFeatureId: string | null;
  featureId: string | null;
  sessionKey: string;
  label: string;
  createdAt: number;
};

/** DB 일괄저장 대상 */
export type PendingShapeChange = {
  id: string;
  kind: PendingChangeKind;
  layer: Pick<
    ShapeEditorLayerItem,
    'id' | 'name' | 'tableName' | 'schema' | 'physicalTableName'
  >;
  wkt5181: string;
  attributeValues: Record<string, string>;
  originalAttributeValues: Record<string, string>;
  rowKey: PendingRowKey | null;
  wmsFeatureId: string | null;
  label: string;
  status: PendingChangeStatus;
  errorMessage: string | null;
  createdAt: number;
};

export type ShapeEditorAttributeField = {
  field: string;
  label: string;
};

/** 좌측 작업 레이어 목록 한 행 */
export interface ShapeEditorWorkLayer {
  id: string;
  layer: ShapeEditorLayerItem;
  view: boolean;
  edit: boolean;
  snap: boolean;
  /** true — 보기·스냅만 (지적 등 참조 레이어, 편집 불가) */
  readOnly?: boolean;
}
