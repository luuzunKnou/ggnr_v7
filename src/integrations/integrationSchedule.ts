import type { SafetydataRefreshSchedule } from '@/integrations/safetydata.config';

export function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

/** 현재 시각이 캘린더 스케줄의 실행 분이면 슬롯 키 반환, 아니면 null */
export function calendarSlotKey(
  s: Exclude<SafetydataRefreshSchedule, { mode: 'interval' }>,
  now: Date
): string | null {
  const y = now.getFullYear();
  const mo = now.getMonth() + 1;
  const day = now.getDate();
  const h = now.getHours();
  const mi = now.getMinutes();
  const wd = now.getDay();

  if (s.mode === 'daily') {
    if (h !== s.hour || mi !== s.minute) return null;
    return `daily|${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  if (s.mode === 'weekly') {
    if (wd !== s.weekday || h !== s.hour || mi !== s.minute) return null;
    return `weekly|${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  if (s.mode === 'monthly') {
    const dim = daysInMonth(y, now.getMonth());
    const dom = Math.min(s.dayOfMonth, dim);
    if (day !== dom || h !== s.hour || mi !== s.minute) return null;
    return `monthly|${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

/**
 * interval 갱신: 시계에 맞춘 격자.
 * - `minutes`가 60의 약수(1,2,3,4,5,6,10,12,15,20,30,60…)이면 매시 정각·05·10분 등 해당 분에만 실행.
 * - 그 외(7, 11, 90…)는 자정(00:00)부터 `minutes` 간격으로 맞춤.
 */
export function intervalSlotKey(
  s: { mode: 'interval'; minutes: number },
  now: Date
): string | null {
  const n = Math.floor(s.minutes);
  if (n <= 0 || n > 24 * 60) return null;

  const y = now.getFullYear();
  const mo = now.getMonth() + 1;
  const day = now.getDate();
  const h = now.getHours();
  const mi = now.getMinutes();
  const pad = (x: number) => String(x).padStart(2, '0');
  const datePart = `${y}-${pad(mo)}-${pad(day)}`;
  const total = h * 60 + mi;

  if (60 % n === 0) {
    if (mi % n !== 0) return null;
    return `interval|${datePart}|${pad(h)}:${pad(mi)}`;
  }

  if (total % n !== 0) return null;
  return `interval|${datePart}|t${total}`;
}
