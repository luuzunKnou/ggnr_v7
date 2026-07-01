import type { ShapeEditorLayerItem, ShapeEditorWorkLayer } from '../types';

/** GeoServer 지적(jijuk) — 스냅·보기 전용 참조 레이어 */
export const JIJUK_REFERENCE_LAYER: ShapeEditorLayerItem = {
  id: 'jijuk',
  name: '지적도',
  tableName: 'jijuk',
  schema: 'layer',
  physicalTableName: 'jijuk',
  rowFilterSql: null,
  shpType: 'POLYGON',
};

export const DEFAULT_JIJUK_WORK_LAYER: ShapeEditorWorkLayer = {
  id: 'jijuk',
  layer: JIJUK_REFERENCE_LAYER,
  view: true,
  edit: false,
  snap: false,
  readOnly: true,
};

export function isReadOnlyWorkLayer(w: Pick<ShapeEditorWorkLayer, 'readOnly'>): boolean {
  return w.readOnly === true;
}
