import type OlMap from 'ol/Map';
import type BaseLayer from 'ol/layer/Base';
import type Layer from 'ol/layer/Layer';
import type Source from 'ol/source/Source';
import {
  syncDynamicLayerMirrors,
  type DynamicMirrorRegistry,
  MAP_SPLIT_MIRROR_TWIN,
} from './mirrorPrimaryDynamicLayers';

type ParamsSource = Source & {
  getParams?: () => Record<string, unknown>;
  updateParams?: (params: Record<string, unknown>) => void;
};

function propString(layer: BaseLayer, key: string): string | undefined {
  const v = layer.get(key);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** define_table_name 우선, 없으면 한글 name (레거시·비-define 레이어) */
function layerMatchKey(layer: BaseLayer): string | undefined {
  const table = propString(layer, 'layerTableName');
  if (table) return `table:${table}`;
  const name = propString(layer, 'name');
  if (name && name !== 'background') return `name:${name}`;
  return undefined;
}

function copySourceParams(from: BaseLayer, to: BaseLayer): void {
  const pAsLayer = from as Layer<Source>;
  const sAsLayer = to as Layer<Source>;
  const pSource = pAsLayer.getSource?.() as ParamsSource | null;
  const sSource = sAsLayer.getSource?.() as ParamsSource | null;
  if (
    pSource &&
    sSource &&
    typeof pSource.getParams === 'function' &&
    typeof sSource.updateParams === 'function'
  ) {
    sSource.updateParams({ ...pSource.getParams() });
  }
}

function copyVisibility(from: BaseLayer, to: BaseLayer): void {
  to.setVisible(from.getVisible());
  to.setOpacity(from.getOpacity());
}

/**
 * 주 맵의 비-배경 레이어 visible·opacity·WMS params를 보조 맵에 맞춤.
 * factory 공통 레이어 + 좌측 전용 동적 레이어(미러) 모두 처리.
 * 매칭 키: layerTableName(define_table_name) → name.
 */
export function syncSecondaryLayersFromPrimary(
  primary: OlMap,
  secondary: OlMap,
  mirrorRegistry?: DynamicMirrorRegistry
): void {
  const secondaryByKey = new globalThis.Map<string, BaseLayer>();
  let secondaryService: BaseLayer | undefined;
  let secondaryUfService: BaseLayer | undefined;
  for (const layer of secondary.getLayers().getArray()) {
    if (layer.get(MAP_SPLIT_MIRROR_TWIN)) continue;
    if (layer.get('serviceLayer')) {
      secondaryService = layer;
      continue;
    }
    if (layer.get('undergroundFacilityServiceLayer')) {
      secondaryUfService = layer;
      continue;
    }
    const key = layerMatchKey(layer);
    if (!key) continue;
    secondaryByKey.set(key, layer);
  }

  for (const pLayer of primary.getLayers().getArray()) {
    if (pLayer.get('serviceLayer')) {
      if (secondaryService) {
        copyVisibility(pLayer, secondaryService);
        copySourceParams(pLayer, secondaryService);
      }
      continue;
    }
    if (pLayer.get('undergroundFacilityServiceLayer')) {
      if (secondaryUfService) {
        copyVisibility(pLayer, secondaryUfService);
        copySourceParams(pLayer, secondaryUfService);
      }
      continue;
    }
    const key = layerMatchKey(pLayer);
    if (!key) continue;
    const sLayer = secondaryByKey.get(key);
    if (!sLayer) continue;
    copyVisibility(pLayer, sLayer);
    copySourceParams(pLayer, sLayer);
  }

  if (mirrorRegistry) {
    syncDynamicLayerMirrors(primary, secondary, mirrorRegistry);
  }
}
