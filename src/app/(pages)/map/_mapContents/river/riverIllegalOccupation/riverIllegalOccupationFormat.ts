/** 관리카드 날짜 표기 — 2026-03-13 → 26.3.13. (원본 카드와 같은 모양) */
export function formatRiverIllegalCardDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return String(iso ?? "").trim();
  return `${m[1]!.slice(2)}.${Number(m[2])}.${Number(m[3])}.`;
}

/** 조치현황 시설 종류 머리칸 — 좁은 칸에서 «비닐/하우스»처럼 두 줄로 (띄어쓰기 있으면 그 자리) */
export function splitRiverIllegalKindLabel(label: string): string[] {
  const s = label.trim();
  if (s.includes(" ")) return s.split(/\s+/);
  if (s.length >= 4) return [s.slice(0, 2), s.slice(2)];
  return [s];
}
