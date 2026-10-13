/** 최초 로그인 비밀번호 변경 안내 — 닫기·현재 비밀번호 사용 후 재표시 방지 (localStorage) */
const STORAGE_KEY = 'ggnr_forced_pwd_change_dismissed';

type DismissMap = Record<string, true>;

function readMap(): DismissMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as DismissMap)
      : {};
  } catch {
    return {};
  }
}

function writeMap(map: DismissMap) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function isForcedPasswordChangeDismissed(usrId: string): boolean {
  const id = usrId.trim();
  if (!id) return false;
  return readMap()[id] === true;
}

export function dismissForcedPasswordChange(usrId: string) {
  const id = usrId.trim();
  if (!id) return;
  const map = readMap();
  map[id] = true;
  writeMap(map);
}
