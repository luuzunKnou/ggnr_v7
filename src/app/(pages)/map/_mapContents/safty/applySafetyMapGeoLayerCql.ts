import type { Map } from 'ol';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';

/** 목록 조회 결과 id와 WMS 표시를 맞출 때 사용. 빈 목록이면 아무 피처도 안 그림. */
export function buildSafetyLayerIdInCql(ids: Iterable<number>): string {
  const uniq: number[] = [];
  const seen = new Set<number>();
  for (const raw of ids) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    uniq.push(id);
  }
  if (uniq.length === 0) return 'id = -1';
  return `id IN (${uniq.join(',')})`;
}

/**
 * 안전데이터 GeoServer ImageWMS에 CQL_FILTER 반영·해제.
 * OpenLayers `updateParams`는 병합만 하므로, 해제 시 getParams()에서 키를 직접 삭제한다.
 */
export function applySafetyMapGeoLayerCql(
  map: Map | null | undefined,
  tableName: string,
  cql: string | null
): void {
  if (!map || !tableName) return;
  const stamp = String(Date.now());
  map.getLayers().getArray().forEach((l) => {
    if (!l.get('safetyMapGeoLayer')) return;
    if (l.get('layerTableName') !== tableName) return;
    const source = (l as ImageLayer<ImageWMS>).getSource();
    if (!source) return;
    const params = source.getParams() as Record<string, unknown>;
    if (cql) {
      // 설정은 updateParams로 명시 반영 (검색·구분 등 속성 CQL 누락 방지)
      if (typeof source.updateParams === 'function') {
        source.updateParams({ CQL_FILTER: cql, _dc: stamp });
      } else {
        params.CQL_FILTER = cql;
        source.changed();
      }
    } else {
      delete params.CQL_FILTER;
      if (typeof source.updateParams === 'function') {
        source.updateParams({ _dc: stamp });
      } else {
        source.changed();
      }
    }
    l.changed();
  });
  map.render();
}

