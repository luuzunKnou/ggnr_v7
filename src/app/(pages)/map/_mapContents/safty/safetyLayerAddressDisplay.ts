import type { PublicLayerAddressPrefixes } from '@/lib/publicLayerSgg';

function stripLeadingToken(text: string, token: string): string {
  const t = token.trim();
  if (!t || !text.startsWith(t)) return text;
  return text.slice(t.length).replace(/^\s+/, '').trim();
}

/** 목록·상세 주소 표시 — 시도·시군구 접두 제거 */
export function formatSafetyLayerAddressDisplay(
  raw: unknown,
  prefixes: PublicLayerAddressPrefixes = { sidoName: '', sggName: '' }
): string {
  const original = String(raw ?? '').trim();
  if (!original || original === '-') return '—';

  const sidoName = String(prefixes.sidoName ?? '').trim();
  const sggName = String(prefixes.sggName ?? '').trim();

  // [시도] [시군구] [기타]
  if (sidoName && sggName && original.startsWith(sidoName)) {
    const afterSido = stripLeadingToken(original, sidoName);
    if (afterSido.startsWith(sggName)) {
      const afterSgg = stripLeadingToken(afterSido, sggName);
      if (afterSgg) return afterSgg;
    }
  }

  // [시군구] [기타]
  if (sggName && original.startsWith(sggName)) {
    const afterSgg = stripLeadingToken(original, sggName);
    if (afterSgg) return afterSgg;
  }

  return original;
}
