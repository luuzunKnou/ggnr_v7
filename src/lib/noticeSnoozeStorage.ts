/** 공지 팝업 «1주일간 보지 않기» — localStorage (공지 키별 만료 시각) */
const STORAGE_KEY = 'ggnr_notice_snooze';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

type SnoozeMap = Record<string, number>;

function readRawMap(): SnoozeMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as SnoozeMap)
      : {};
  } catch {
    return {};
  }
}

function writeMap(map: SnoozeMap) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

/** 만료된 항목 제거 후 반환 */
export function readNoticeSnoozeMap(): SnoozeMap {
  const now = Date.now();
  const raw = readRawMap();
  const next: SnoozeMap = {};
  for (const [key, until] of Object.entries(raw)) {
    if (typeof until === 'number' && until > now) next[key] = until;
  }
  if (Object.keys(next).length !== Object.keys(raw).length) writeMap(next);
  return next;
}

export function isNoticeSnoozed(noticeKey: number): boolean {
  const until = readNoticeSnoozeMap()[String(noticeKey)];
  return typeof until === 'number' && until > Date.now();
}

export function filterVisibleNotices<T extends { noticeKey: number }>(rows: T[]): T[] {
  const map = readNoticeSnoozeMap();
  const now = Date.now();
  return rows.filter((r) => {
    const until = map[String(r.noticeKey)];
    return !(typeof until === 'number' && until > now);
  });
}

/** 표시 중인 공지를 1주일간 숨김 */
export function snoozeNoticesForOneWeek(noticeKeys: number[]) {
  const map = readNoticeSnoozeMap();
  const until = Date.now() + SNOOZE_MS;
  for (const key of noticeKeys) {
    if (Number.isInteger(key) && key > 0) map[String(key)] = until;
  }
  writeMap(map);
}
