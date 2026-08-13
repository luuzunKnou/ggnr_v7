/** 점용 허가번호 — «년도-번호» (예: 2026-01). 연도별 01부터. */

const PERMIT_NO_RE = /^(\d{4})-(\d+)$/;

export function yearFromStartDateYmd(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  if (!Number.isFinite(y) || y < 1900 || y > 2100) return null;
  return y;
}

export function formatOccupationPermitNo(year: number, seq: number): string {
  const n = Math.max(1, Math.floor(seq));
  const padded = n < 100 ? String(n).padStart(2, "0") : String(n);
  return `${year}-${padded}`;
}

export function parseOccupationPermitNoSeq(
  code: string,
  year: number
): number | null {
  const m = String(code ?? "")
    .trim()
    .match(PERMIT_NO_RE);
  if (!m) return null;
  if (Number(m[1]) !== year) return null;
  const seq = Number(m[2]);
  return Number.isFinite(seq) && seq > 0 ? seq : null;
}

/** 자동채번 형식 여부 (사용자가 임의 문자열을 넣었는지 구분) */
export function isOccupationPermitNoFormat(code: string): boolean {
  return PERMIT_NO_RE.test(String(code ?? "").trim());
}

/** 시작일 없을 때 허가번호 연도 — Asia/Seoul 기준 현재 연도 */
export function currentPermitYear(now: Date = new Date()): number {
  const y = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
    }).format(now)
  );
  return Number.isFinite(y) ? y : now.getFullYear();
}
