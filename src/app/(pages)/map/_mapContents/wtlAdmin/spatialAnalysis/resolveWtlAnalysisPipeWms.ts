import { call } from '@/lib/api'

/** 관로 분할 키 — 부모 wtl_pipe_lm 과 겹치지 않게 분할만 쓴다(관망·위상과 동일) */
export const WTL_PIPE_SPLIT_LAYERS = [
  'wtl_pipe_lm_etc',
  'wtl_pipe_lm_saa004',
  'wtl_pipe_lm_saa003',
] as const

export type WtlAnalysisPipeWmsParams = {
  LAYERS: string
  STYLES: string
  ENV: string
  /** 분할 관로 등 라벨 제거 SLD — 있으면 STYLES 대신 사용 */
  SLD_BODY?: string
}

type BuildOpts = {
  pipeWidth?: number
  splyWidth?: number
}

/**
 * 분할 레이어가 있으면 분할+급수관, 없으면 부모 관로+급수관.
 * 분할 스타일은 라벨 룰이 없고, 부모·급수관은 *_nolabel 을 쓴다.
 */
export function buildWtlAnalysisPipeWmsParams(
  availableNames: Iterable<string>,
  opts: BuildOpts = {}
): WtlAnalysisPipeWmsParams {
  const pipeW = opts.pipeWidth ?? 3
  const splyW = opts.splyWidth ?? 2.5
  const avail = new Set(
    [...availableNames].map((n) => String(n ?? '').trim().toLowerCase()).filter(Boolean)
  )

  const splits = WTL_PIPE_SPLIT_LAYERS.filter((n) => avail.has(n.toLowerCase()))
  const pipes = splits.length > 0 ? [...splits] : (['wtl_pipe_lm'] as const)

  const layers = [...pipes, 'wtl_sply_ls']
  const styles = [
    ...pipes.map((p) => (p === 'wtl_pipe_lm' ? 'wtl_pipe_lm_nolabel' : p)),
    'wtl_sply_ls_nolabel',
  ]
  const envParts = [
    ...pipes.map((p) =>
      p === 'wtl_pipe_lm'
        ? `wtl_pipe_lm_stroke_width:${pipeW}`
        : `${p}_stroke_width:${pipeW}`
    ),
    `wtl_sply_ls_stroke_width:${splyW}`,
  ]

  return {
    LAYERS: layers.join(','),
    STYLES: styles.join(','),
    ENV: envParts.join(';'),
  }
}

/** 지하시설물 가용 테이블 조회 후 단수·누수 배경 WMS params (분할 관로는 라벨 제거 SLD) */
export async function fetchWtlAnalysisPipeWmsParams(
  opts: BuildOpts = {}
): Promise<WtlAnalysisPipeWmsParams> {
  const fallback = buildWtlAnalysisPipeWmsParams([], opts)
  let base = fallback
  try {
    const res = await call('', 'POST', {
      service: 'thematicMapService',
      action: 'listAvailableUndergroundFacilityLayerNames',
      params: {},
    })
    const body = (res?.data ?? res) as { success?: boolean; tableNames?: string[] }
    const names = Array.isArray(body?.tableNames) ? body.tableNames : []
    base = buildWtlAnalysisPipeWmsParams(names, opts)
  } catch {
    base = fallback
  }

  const layers = base.LAYERS.split(',').map((s) => s.trim()).filter(Boolean)
  const usesSplit = layers.some((l) =>
    (WTL_PIPE_SPLIT_LAYERS as readonly string[]).includes(l)
  )
  if (!usesSplit) return base

  try {
    const res = await call('', 'POST', {
      service: 'wtlTopologyService',
      action: 'loadWtlSpatialPipeNolabelSldBody',
      params: { tables: layers },
    })
    const body = (res?.data ?? res) as { sldBody?: string | null }
    const sldBody = typeof body?.sldBody === 'string' && body.sldBody.trim() ? body.sldBody : null
    if (!sldBody) return base
    return {
      LAYERS: base.LAYERS,
      STYLES: '',
      ENV: base.ENV,
      SLD_BODY: sldBody,
    }
  } catch {
    return base
  }
}
