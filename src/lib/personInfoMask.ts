/** V6 maskAllByLength — 길이만큼 * (최소 3자) */
export function maskPersonFieldByLength(value: unknown): string {
  if (value == null) return '***';
  const str = String(value).trim();
  if (!str || str === '-') return str || '-';
  return '*'.repeat(Math.max(str.length, 3));
}

/** 행망 장애 로그용 — 응답 본문 PII XML 태그 값 마스킹 */
const KRAS_FAULT_PII_TAGS = ['OWNER_NM', 'DREGNO', 'OWNER_ADDR', 'OWNER_REGNO'] as const;

export function redactKrasFaultBody(body: string): string {
  if (!body) return body;
  let out = body;
  for (const tag of KRAS_FAULT_PII_TAGS) {
    const re = new RegExp(`(<${tag}\\b[^>]*>)([\\s\\S]*?)(</${tag}>)`, 'gi');
    out = out.replace(re, (_m, open: string, inner: string, close: string) => {
      const raw = String(inner).trim();
      if (!raw) return `${open}${inner}${close}`;
      return `${open}${maskPersonFieldByLength(raw)}${close}`;
    });
  }
  return out;
}
