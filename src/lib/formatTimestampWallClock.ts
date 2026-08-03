/**
 * DB timestamp(without time zone) 표시.
 * - 이미 포맷된 벽시계 문자열(to_char 등)은 TZ 재해석 없이 그대로 표시
 * - Date / UTC ISO 는 Asia/Seoul 벽시계로 표시
 *   (node-pg가 naive timestamp를 UTC Date로 주는 경우가 많음)
 */
export function formatTimestampWallClock(v: string | Date | null | undefined): string {
  if (v == null || v === '') return '';
  if (typeof v === 'string') {
    const s = v.trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
    // 오프셋 없는 문자열은 서버에서 이미 서울 벽시계로 만든 값으로 본다
    if (m && !/Z$|[+-]\d{2}:?\d{2}$/.test(s)) {
      return `${m[1]} ${m[2]}`;
    }
    if (/Z$|[+-]\d{2}:?\d{2}$/.test(s) || m) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        return formatSeoul(d);
      }
    }
    return s.replace('T', ' ').slice(0, 19);
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return formatSeoul(v);
  }
  return String(v);
}

function formatSeoul(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}
