/** 클라이언트용 다운로드 권한 상수·엄격도 비교 (서버 스키마와 동일 값) */

export type LayerDownloadAuthValue = 'auto' | 'admin' | 'team' | 'none'

export const DOWNLOAD_AUTH_OPTIONS: { label: string; value: LayerDownloadAuthValue }[] = [
  { label: '자동승인', value: 'auto' },
  { label: '관리자', value: 'admin' },
  { label: '팀장', value: 'team' },
  { label: '없음', value: 'none' },
]

export function normalizeLayerDownloadAuth(raw: unknown): LayerDownloadAuthValue {
  const v = String(raw ?? '').trim().toLowerCase()
  if (v === 'admin' || v === 'team' || v === 'none' || v === 'auto') return v
  return 'auto'
}

export function pickStrictestDownloadAuth(
  values: LayerDownloadAuthValue[]
): LayerDownloadAuthValue {
  let best: LayerDownloadAuthValue = 'none'
  let score = -1
  const rank: Record<LayerDownloadAuthValue, number> = {
    none: 0,
    auto: 1,
    team: 2,
    admin: 3,
  }
  for (const raw of values) {
    const n = normalizeLayerDownloadAuth(raw)
    if (rank[n] > score) {
      score = rank[n]
      best = n
    }
  }
  return best
}
