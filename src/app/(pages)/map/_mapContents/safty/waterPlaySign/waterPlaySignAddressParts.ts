/** 주소 전체 문자열 → addr(전체), sido(첫 토큰), sgg(두 번째 토큰) */
export function parseSidoSggFromAddress(fullAddress: string): {
  addr: string;
  sido: string;
  sgg: string;
} {
  const addr = String(fullAddress ?? '').trim();
  if (!addr) return { addr: '', sido: '', sgg: '' };
  const parts = addr.split(/\s+/).filter(Boolean);
  return {
    addr,
    sido: parts[0] ?? '',
    sgg: parts[1] ?? '',
  };
}
