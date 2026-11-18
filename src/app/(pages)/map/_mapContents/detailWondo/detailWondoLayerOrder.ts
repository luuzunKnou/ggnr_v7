import type OLMap from 'ol/Map'
import type BaseLayer from 'ol/layer/Base'

/** 지적도 아래(없으면 서비스 레이어 아래) 인덱스. 없으면 -1 */
function belowCadastralIndex(map: OLMap): number {
  const arr = map.getLayers().getArray()
  let idx = arr.findIndex((l) => l.get('cadastralLayer') === true)
  if (idx < 0) idx = arr.findIndex((l) => l.get('serviceLayer') === true)
  return idx
}

/**
 * 도곽 점선 — 원도 이미지·지적도보다 아래.
 * 이미지가 있으면 그 앞에 넣어, 레이어가 다시 붙어도 원도 위를 덮지 않게 한다.
 */
export function insertDetailWondoFootprint(map: OLMap, layer: BaseLayer) {
  const collection = map.getLayers()
  const arr = collection.getArray()
  let idx = arr.findIndex((l) => l.get('detailWondoImageLayer') === true)
  if (idx < 0) idx = belowCadastralIndex(map)
  if (idx >= 0) collection.insertAt(idx, layer)
  else collection.push(layer)
}

/** 원도 이미지 — 지적도 아래. 도곽보다 위에 오도록 지적도 바로 앞에 넣는다 */
export function insertDetailWondoImage(map: OLMap, layer: BaseLayer) {
  const idx = belowCadastralIndex(map)
  if (idx >= 0) map.getLayers().insertAt(idx, layer)
  else map.getLayers().push(layer)
}
