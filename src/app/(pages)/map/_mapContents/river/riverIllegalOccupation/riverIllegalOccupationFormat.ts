/** 관리카드 날짜 표기 — 2026-03-13 → 26.3.13. (원본 카드와 같은 모양) */
export function formatRiverIllegalCardDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return String(iso ?? "").trim();
  return `${m[1]!.slice(2)}.${Number(m[2])}.${Number(m[3])}.`;
}

/** 조치현황 시설 종류 머리칸 — «비닐하우스»«형질변경»«(가설)건축물» 두 줄, «평상등»«데크등»은 한 줄 */
export function splitRiverIllegalKindLabel(label: string): string[] {
  const s = label.trim();
  // «평상 등» «데크 등» — 띄어쓰기 유지·줄바꿈 없이
  if (/\s등$/.test(s)) return [s];
  if (s.endsWith("등") && s.length <= 4) return [s];
  // «(가설)건축물» → (가설) / 건축물
  const paren = /^(\([^)]+\))(.+)$/.exec(s);
  if (paren?.[1] && paren[2]) return [paren[1], paren[2]];
  if (s.includes(" ")) return s.split(/\s+/);
  if (s.length >= 4) return [s.slice(0, 2), s.slice(2)];
  return [s];
}

/** `#빨간글씨#` 구간 — 짝이 맞는 #…# 만 빨강, 짝 없는 # 은 그대로 */
export type RiverIllegalMarkupPart = { text: string; red: boolean };

export function parseRiverIllegalRedMarkup(raw: string | null | undefined): RiverIllegalMarkupPart[] {
  const s = String(raw ?? "");
  if (!s) return [];
  const parts: RiverIllegalMarkupPart[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "#") {
      const close = s.indexOf("#", i + 1);
      if (close > i) {
        parts.push({ text: s.slice(i + 1, close), red: true });
        i = close + 1;
        continue;
      }
    }
    let j = i + 1;
    while (j < s.length && s[j] !== "#") j += 1;
    // 다음이 닫는 # 쌍이면 여기까지가 일반 글씨, 아니면 끝까지
    if (s[j] === "#" && s.indexOf("#", j + 1) > j) {
      parts.push({ text: s.slice(i, j), red: false });
      i = j;
      continue;
    }
    parts.push({ text: s.slice(i), red: false });
    break;
  }
  return parts.filter((p) => p.text.length > 0 || p.red);
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 인쇄·PDF HTML — #…# 구간을 빨간 span 으로 */
export function riverIllegalRedMarkupToHtml(raw: string | null | undefined): string {
  return parseRiverIllegalRedMarkup(raw)
    .map((p) => (p.red ? `<span class="rio-red">${escHtml(p.text)}</span>` : escHtml(p.text)))
    .join("");
}

/** 조치현황 적발 — 숫자만 */
export function sanitizeRiverIllegalStatusDigits(raw: string): string {
  return String(raw ?? "").replace(/[^0-9]/g, "");
}

/** 조치현황 조치·미조치 — 숫자와 # (`#1#` 빨간 표시·DB 저장) */
export function sanitizeRiverIllegalStatusInput(raw: string): string {
  return String(raw ?? "").replace(/[^0-9#]/g, "");
}
