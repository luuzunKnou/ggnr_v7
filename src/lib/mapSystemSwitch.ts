import { getOpenedKeyForSerEng, normalizeOpenedToken } from '@/lib/mapServiceOpened';
import { scrubOccupationLedgerFromMapSearchParams } from '@/lib/occupationLedgerBinding';
import { scrubUseFeeFromMapSearchParams } from '@/lib/useFeeBinding';

/** 시스템 전환 시 닫을 보조 opened 토큰 (서비스 메뉴 아님) */
const AUXILIARY_OPENED_TOKENS = new Set(['layerSetting']);

/** systemList.serviceList → 허용 opened 토큰 집합 */
export function collectAllowedOpenedKeys(serviceList: string[]): Set<string> {
  const allowed = new Set<string>();
  for (const raw of serviceList) {
    const eng = String(raw ?? '').trim();
    if (!eng) continue;
    allowed.add(getOpenedKeyForSerEng(eng));
    allowed.add(eng);
  }
  return allowed;
}

/** opened 토큰이 대상 시스템 serviceList 에 포함된 기능인지 */
export function isOpenedTokenAllowedForServiceList(
  token: string,
  serviceList: string[]
): boolean {
  const normalized = normalizeOpenedToken(String(token ?? '').trim());
  if (!normalized) return false;
  if (AUXILIARY_OPENED_TOKENS.has(normalized)) return false;
  if (normalized === 'listView') {
    return collectAllowedOpenedKeys(serviceList).has('standardList');
  }
  return collectAllowedOpenedKeys(serviceList).has(normalized);
}

function applyOpenedAndLedgerScrub(
  params: URLSearchParams,
  targetSystemKey: string,
  nextOpened: string[],
  serviceList: string[]
): void {
  if (nextOpened.length > 0) params.set('opened', nextOpened.join(','));
  else params.delete('opened');

  scrubOccupationLedgerFromMapSearchParams(params, targetSystemKey, serviceList);
  scrubUseFeeFromMapSearchParams(params, targetSystemKey, serviceList);

  const openedAfter = (params.get('opened') ?? '').split(',').filter(Boolean);
  const hasListView = openedAfter.some((t) => normalizeOpenedToken(t) === 'listView');
  // listView가 없을 때만 dataTable·dataKey 정리. (있으면 유지 — 잘못 지우면 패널이 열렸다 바로 닫힘)
  if (!hasListView) {
    params.delete('dataTable');
    params.delete('dataKey');
  }
}

/**
 * 현재 시스템 serviceList 에 없는 opened 만 제거.
 * layerSetting 등 보조 토큰은 유지.
 */
export function scrubOpenedNotAllowedForSystem(
  params: URLSearchParams,
  targetSystemKey: string,
  targetServiceList: string[]
): void {
  const opened = (params.get('opened') ?? '').split(',').filter(Boolean);
  const nextOpened = opened.filter((token) => {
    const normalized = normalizeOpenedToken(String(token ?? '').trim());
    if (AUXILIARY_OPENED_TOKENS.has(normalized)) return true;
    return isOpenedTokenAllowedForServiceList(token, targetServiceList);
  });
  applyOpenedAndLedgerScrub(params, targetSystemKey, nextOpened, targetServiceList);
}

/**
 * 시스템 전환 시 URL opened·상세 쿼리 정리.
 * 대상 시스템에도 있는 기능( serviceList )이면 패널 유지, 없으면 제거.
 * layerSetting 등 보조 토큰도 닫는다.
 */
export function scrubMapSearchParamsOnSystemSwitch(
  params: URLSearchParams,
  targetSystemKey: string,
  targetServiceList: string[]
): void {
  const opened = (params.get('opened') ?? '').split(',').filter(Boolean);
  const nextOpened = opened.filter((token) =>
    isOpenedTokenAllowedForServiceList(token, targetServiceList)
  );
  applyOpenedAndLedgerScrub(params, targetSystemKey, nextOpened, targetServiceList);
}
