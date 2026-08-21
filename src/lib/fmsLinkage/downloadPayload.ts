import iconv from 'iconv-lite';
import type { FmsLinkageConfig } from '@/lib/fmsLinkage/config';

/** fmsKey 경로로 2차 GET — MS949/EUC-KR 등 */
export async function downloadFmsPayload(
  config: FmsLinkageConfig,
  fmsKey: string
): Promise<string> {
  const key = String(fmsKey ?? '').trim();
  if (!key) throw new Error('FMS 다운로드 경로(fmsKey) 가 없습니다.');

  const url = key.startsWith('http')
    ? key
    : `${config.baseUrl}${key.replace(/^\//, '')}`;

  const res = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`FMS 2차 다운로드 HTTP ${res.status}: ${url}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return iconv.decode(buf, config.downloadCharset);
}
