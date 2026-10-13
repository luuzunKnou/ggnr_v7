/**
 * 브라우저 → GNMS 직결용 공통 헬퍼.
 * 운영 서버는 /api/source/version/gnms-config 로 URL·Bearer 만 제공.
 */

export type GnmsBrowserConfig = {
  gnmsBaseUrl: string;
  latestUrl: string;
  listUrl?: string;
  downloadUrlFallback: string;
  cancelUrl?: string;
  installLatestUrl?: string;
  installDownloadUrl?: string;
  uploadBaseUrl?: string;
  logsUrl?: string;
  bearer: string;
  restartCommandConfigured?: boolean;
  error?: string;
};

export function gnmsAuthHeaders(bearer: string, extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...(extra ?? {}) };
  if (bearer) h.Authorization = `Bearer ${bearer}`;
  return h;
}

export async function loadGnmsBrowserConfig(signal?: AbortSignal): Promise<GnmsBrowserConfig> {
  const res = await fetch('/api/source/version/gnms-config', { cache: 'no-store', signal });
  const json = (await res.json().catch(() => ({}))) as GnmsBrowserConfig;
  if (!res.ok) throw new Error(json.error ?? 'GNMS 설정 조회 실패');
  if (!json.gnmsBaseUrl) throw new Error('GNMS 설정에 gnmsBaseUrl이 없습니다');
  return json;
}

export function classifyGnmsNetworkError(err: unknown, context: string, url: string): Error {
  if (err instanceof Error && err.name === 'AbortError') return err;
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  const looksCorsOrNetwork =
    err instanceof TypeError ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('load failed') ||
    lower.includes('cors') ||
    lower.includes('access-control');
  if (looksCorsOrNetwork) {
    return new Error(
      `[CORS/네트워크] ${context} 실패 — HTTP 응답 없이 브라우저가 연결을 거부했습니다 (${url}). CORS·주소·방화벽을 확인하세요. 원본: ${raw}`
    );
  }
  return err instanceof Error ? err : new Error(raw);
}
