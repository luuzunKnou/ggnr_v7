import type OlMap from 'ol/Map';
import type BaseLayer from 'ol/layer/Base';
import ImageLayer from 'ol/layer/Image';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import type ImageSource from 'ol/source/Image';
import type TileSource from 'ol/source/Tile';
import type VectorSource from 'ol/source/Vector';

export const MAP_SPLIT_MIRROR_TWIN = 'mapSplitMirrorTwin';
export const MAP_SPLIT_MIRROR_OF = 'mapSplitMirrorOf';
export const MAP_SPLIT_NO_MIRROR = 'mapSplitNoMirror';

/** key → 우측 짝 레이어 */
export type DynamicMirrorRegistry = Map<string, BaseLayer>;

function propString(layer: BaseLayer, key: string): string | undefined {
  const v = layer.get(key);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** factory·동적 공통 안정 키. name 우선, 없으면 id. */
export function layerMirrorKey(layer: BaseLayer): string | null {
  if (shouldSkipMirror(layer)) return null;
  const name = propString(layer, 'name');
  if (name && name !== 'background') return `name:${name}`;
  const id = propString(layer, 'id');
  if (id) return `id:${id}`;
  return null;
}

/**
 * 미러 대상 제외.
 * API 레이어별 예외가 아니라 일시 UI·시스템 플래그만.
 */
export function shouldSkipMirror(layer: BaseLayer): boolean {
  if (layer.get(MAP_SPLIT_MIRROR_TWIN)) return true;
  if (layer.get(MAP_SPLIT_NO_MIRROR)) return true;
  if (layer.get('serviceLayer')) return true;
  if (layer.get('listHighlightLayer')) return true;
  if (layer.get('listSelectionLayer')) return true;
  if (layer.get('layerRowGeomEditLayer')) return true;
  const name = propString(layer, 'name');
  if (name === 'background') return true;
  if (name?.startsWith('MapPrint')) return true;
  return false;
}

function createVectorTwin(primary: VectorLayer<VectorSource>, key: string): VectorLayer<VectorSource> {
  return new VectorLayer({
    source: primary.getSource() ?? undefined,
    style: (feature, resolution) => {
      const fn = primary.getStyleFunction();
      return fn ? fn(feature, resolution) : undefined;
    },
    zIndex: primary.getZIndex(),
    opacity: primary.getOpacity(),
    visible: primary.getVisible(),
    properties: {
      [MAP_SPLIT_MIRROR_TWIN]: true,
      [MAP_SPLIT_MIRROR_OF]: key,
      name: primary.get('name'),
      id: primary.get('id'),
    },
  });
}

function createTileTwin(primary: TileLayer<TileSource>, key: string): TileLayer<TileSource> {
  return new TileLayer({
    source: primary.getSource() ?? undefined,
    zIndex: primary.getZIndex(),
    opacity: primary.getOpacity(),
    visible: primary.getVisible(),
    extent: primary.getExtent() ?? undefined,
    properties: {
      [MAP_SPLIT_MIRROR_TWIN]: true,
      [MAP_SPLIT_MIRROR_OF]: key,
      name: primary.get('name'),
      id: primary.get('id'),
    },
  });
}

function createImageTwin(primary: ImageLayer<ImageSource>, key: string): ImageLayer<ImageSource> {
  return new ImageLayer({
    source: primary.getSource() ?? undefined,
    zIndex: primary.getZIndex(),
    opacity: primary.getOpacity(),
    visible: primary.getVisible(),
    extent: primary.getExtent() ?? undefined,
    properties: {
      [MAP_SPLIT_MIRROR_TWIN]: true,
      [MAP_SPLIT_MIRROR_OF]: key,
      name: primary.get('name'),
      id: primary.get('id'),
    },
  });
}

function createTwin(primary: BaseLayer, key: string): BaseLayer | null {
  if (primary instanceof VectorLayer) {
    return createVectorTwin(primary as VectorLayer<VectorSource>, key);
  }
  if (primary instanceof TileLayer) {
    return createTileTwin(primary as TileLayer<TileSource>, key);
  }
  if (primary instanceof ImageLayer) {
    return createImageTwin(primary as ImageLayer<ImageSource>, key);
  }
  return null;
}

function syncTwinVisual(from: BaseLayer, to: BaseLayer): void {
  to.setVisible(from.getVisible());
  to.setOpacity(from.getOpacity());
  const z = from.getZIndex();
  if (z != null) to.setZIndex(z);
}

/**
 * 좌측에만 있는(우측 factory에 없는) 레이어를 우측에 짝으로 맞춤.
 * registry에 짝을 보관하고, 좌측에서 사라지면 제거한다.
 */
export function syncDynamicLayerMirrors(
  primary: OlMap,
  secondary: OlMap,
  registry: DynamicMirrorRegistry
): void {
  const nativeSecondaryKeys = new Set<string>();
  for (const layer of secondary.getLayers().getArray()) {
    if (layer.get(MAP_SPLIT_MIRROR_TWIN)) continue;
    const name = propString(layer, 'name');
    if (name && name !== 'background') nativeSecondaryKeys.add(`name:${name}`);
    const id = propString(layer, 'id');
    if (id) nativeSecondaryKeys.add(`id:${id}`);
  }

  const seen = new Set<string>();

  for (const pLayer of primary.getLayers().getArray()) {
    const key = layerMirrorKey(pLayer);
    if (!key) continue;
    seen.add(key);

    // 우측 factory 등에 이미 있으면 짝 불필요(기존 name 동기 경로)
    if (nativeSecondaryKeys.has(key)) {
      const stale = registry.get(key);
      if (stale) {
        secondary.removeLayer(stale);
        registry.delete(key);
      }
      continue;
    }

    let twin = registry.get(key);
    const stillOnMap = twin != null && secondary.getLayers().getArray().includes(twin);
    if (!twin || !stillOnMap) {
      twin = createTwin(pLayer, key) ?? undefined;
      if (!twin) {
        registry.delete(key);
        continue;
      }
      secondary.addLayer(twin);
      registry.set(key, twin);
    }
    syncTwinVisual(pLayer, twin);
  }

  for (const [key, twin] of [...registry.entries()]) {
    if (seen.has(key)) continue;
    secondary.removeLayer(twin);
    registry.delete(key);
  }
}

export function clearDynamicLayerMirrors(
  secondary: OlMap | null,
  registry: DynamicMirrorRegistry
): void {
  if (secondary) {
    for (const twin of registry.values()) {
      secondary.removeLayer(twin);
    }
  }
  registry.clear();
}
