import type Map from 'ol/Map'
import type BaseLayer from 'ol/layer/Base'

/** 스타일 크기 식의 버튼 값. 1이면 축척을 무시하고 18, 0이면 축척 단계 */
export const IGNORE_SCALE_ENV_KEY = 'ignore_scale'

/**
 * 공간분석 등 — 검색바 축척 버튼과 무관하게 항상 ignore_scale=1.
 * 레이어에 `layer.set(FORCE_IGNORE_SCALE_LAYER_KEY, true)` 로 표시.
 */
export const FORCE_IGNORE_SCALE_LAYER_KEY = 'forceIgnoreScaleEnv'

function isLayerSizeEnvKey(key: string): boolean {
  if (key === 'Default Styler_size') return true
  if (key.endsWith('_label_size')) return false
  return key.endsWith('_size')
}

/** ignore_scale만 0/1로 바꾸고 나머지 ENV(크기 등)는 유지 */
export function setIgnoreScaleFlag(current: string | undefined, ignoreScale: boolean): string {
  const parts = String(current ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false
      const key = part.split(':')[0]?.trim() ?? ''
      return key !== IGNORE_SCALE_ENV_KEY && key !== 'icon_scale'
    })
  parts.push(`${IGNORE_SCALE_ENV_KEY}:${ignoreScale ? '1' : '0'}`)
  return parts.join(';')
}

/** 레이어별 크기 값은 빼고, 버튼 여부만 0/1로 남긴다. */
export function mergeIgnoreScaleEnv(current: string | undefined, ignoreScale: boolean): string {
  const parts = String(current ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false
      const key = part.split(':')[0]?.trim() ?? ''
      if (key === IGNORE_SCALE_ENV_KEY || key === 'icon_scale') return false
      return !isLayerSizeEnvKey(key)
    })
  parts.push(`${IGNORE_SCALE_ENV_KEY}:${ignoreScale ? '1' : '0'}`)
  return parts.join(';')
}

type WmsSource = {
  getParams?: () => Record<string, unknown>
  updateParams?: (params: Record<string, unknown>) => void
}

function visitLayer(layer: BaseLayer, ignoreScale: boolean): void {
  const group = layer as BaseLayer & {
    getLayers?: () => { forEach: (cb: (child: BaseLayer) => void) => void }
  }
  if (typeof group.getLayers === 'function') {
    group.getLayers().forEach((child) => visitLayer(child, ignoreScale))
  }
  const source = (layer as BaseLayer & { getSource?: () => WmsSource | null }).getSource?.()
  if (!source?.getParams || !source.updateParams) return
  const params = source.getParams()
  if (!params || !('LAYERS' in params)) return
  const current = typeof params.ENV === 'string' ? params.ENV : undefined
  const forceAlways = layer.get(FORCE_IGNORE_SCALE_LAYER_KEY) === true
  // 공간분석: 크기 ENV 유지 + 항상 ignore_scale=1. 일반: 검색바 토글(크기 키 제거)
  const next = forceAlways
    ? setIgnoreScaleFlag(current, true)
    : mergeIgnoreScaleEnv(current, ignoreScale)
  source.updateParams({ ENV: next, _dc: String(Date.now()) })
}

/** 지도 WMS 요청에 축척 무시 여부(1/0)를 넣고 그림을 다시 받는다. */
export function applyIconScaleWmsEnv(map: Map, ignoreScale: boolean): void {
  map.getLayers().forEach((layer) => visitLayer(layer, ignoreScale))
}
