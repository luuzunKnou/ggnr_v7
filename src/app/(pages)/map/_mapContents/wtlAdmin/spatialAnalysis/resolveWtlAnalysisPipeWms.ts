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

/** 지하시설물 가용 테이블 조회 후 단수·누수 배경 WMS params */
export async function fetchWtlAnalysisPipeWmsParams(
  opts: BuildOpts = {}
): Promise<WtlAnalysisPipeWmsParams> {
  const fallback = buildWtlAnalysisPipeWmsParams([], opts)
  try {
    const res = await call('', 'POST', {
      service: 'thematicMapService',
      action: 'listAvailableUndergroundFacilityLayerNames',
      params: {},
    })
    const body = (res?.data ?? res) as { success?: boolean; tableNames?: string[] }
    const names = Array.isArray(body?.tableNames) ? body.tableNames : []
    return buildWtlAnalysisPipeWmsParams(names, opts)
  } catch {
    return fallback
  }
}
