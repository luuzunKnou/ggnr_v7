/** 공통 점용대장 — 점용 종료일 기준 진행중/종료 */

export const OCCUPATION_PERIOD_STATE_IN_PROGRESS = '진행중';
export const OCCUPATION_PERIOD_STATE_ENDED = '종료';

export const OCCUPATION_PERIOD_STATE_OPTIONS = [
  { value: OCCUPATION_PERIOD_STATE_IN_PROGRESS, label: OCCUPATION_PERIOD_STATE_IN_PROGRESS },
  { value: OCCUPATION_PERIOD_STATE_ENDED, label: OCCUPATION_PERIOD_STATE_ENDED },
] as const;

export type OccupationPeriodState =
  | typeof OCCUPATION_PERIOD_STATE_IN_PROGRESS
  | typeof OCCUPATION_PERIOD_STATE_ENDED;

function todayYmdLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 점용 종료일이 오늘보다 이전이면 종료, 그 외(미입력·당일 포함)는 진행중 */
export function deriveOccupationPeriodState(
  endDateYmd: string | null | undefined
): OccupationPeriodState {
  const end = String(endDateYmd ?? '')
    .trim()
    .slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return OCCUPATION_PERIOD_STATE_IN_PROGRESS;
  return end < todayYmdLocal()
    ? OCCUPATION_PERIOD_STATE_ENDED
    : OCCUPATION_PERIOD_STATE_IN_PROGRESS;
}
