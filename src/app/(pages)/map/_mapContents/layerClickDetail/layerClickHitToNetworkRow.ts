import { getRowValueByField } from '../../_mapComponents/standard/defineLayerRowUtils'
import type { WtlNetworkRow } from '../wtlAdmin/networkMap/wtlNetworkTypes'
import type { LayerClickHit } from './useLayerClickDetail'

/** 첨부·연관·이력 탭 재사용을 위해 클릭 hit → 관망 행 형태로 변환 */
export function layerClickHitToNetworkRow(hit: LayerClickHit): WtlNetworkRow {
  const fieldsTable = String(hit.fieldsTable || hit.tableName || '')
    .trim()
    .toLowerCase()
  const tableName = String(hit.tableName || fieldsTable)
    .trim()
    .toLowerCase()
  const ogcRaw = getRowValueByField(hit.data, 'ogc_fid')
  const ogc =
    ogcRaw != null && Number.isFinite(Number(ogcRaw)) ? Number(ogcRaw) : null
  const id =
    ogc != null
      ? `${tableName || fieldsTable}:${ogc}`
      : String(hit.key ?? '').trim() || `${tableName}:0`

  return {
    id,
    layerKey: fieldsTable || tableName,
    geomKind: 'point',
    name: String(hit.titleValue ?? '').trim(),
    diameter: '',
    material: '',
    length: '',
    year: '',
    status: '',
    hjd: '',
    attrs: [],
    record: hit.data,
    fieldsTable: fieldsTable || tableName || null,
  }
}
