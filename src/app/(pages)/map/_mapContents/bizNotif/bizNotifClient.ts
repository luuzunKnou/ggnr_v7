'use client';

import { call } from '@/lib/api';
import {
  getProtoNotifs,
  PROTO_NOTIF_CHANGED_EVENT,
  setProtoNotifs,
  type ProtoNotifItem,
} from './bizNotifStore';

export const BIZ_NOTIF_WITHIN_DAYS = 15;

export type BizNotifCachedItem = ProtoNotifItem & {
  notifKey: string;
  systemScope: string;
  serEng?: string;
};

/** 로그인 후 전체 후보(시스템 필터 전) */
let allCached: BizNotifCachedItem[] = [];
let activeSystem: string | null = null;
let activeServiceList: string[] | null = null;

function toProto(item: BizNotifCachedItem): ProtoNotifItem {
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    name: item.name,
    listKey: item.listKey,
    read: item.read,
    important: item.important,
    target: item.target,
    targetId: item.targetId,
    notifKey: item.notifKey,
    systemScope: item.systemScope,
    serEng: item.serEng,
  };
}

/** 현재 시스템 알림 — 부서업무(serviceList)에 해당 기능이 있을 때만 */
function notifMatchesActiveSystem(item: BizNotifCachedItem): boolean {
  if (!activeSystem) return true;
  const eng = String(item.serEng ?? '').trim();
  // 메뉴 목록이 있으면 그게 유일한 기준 (도로행정에 도로점용 없으면 안 뜸)
  if (activeServiceList != null) {
    if (eng) return activeServiceList.some((s) => String(s).trim() === eng);
    // serEng 없는 구형 항목만 systemScope 로 폴백
    return String(item.systemScope ?? '').toLowerCase() === activeSystem.toLowerCase();
  }
  return String(item.systemScope ?? '').toLowerCase() === activeSystem.toLowerCase();
}

function publishFiltered() {
  if (!activeSystem) {
    setProtoNotifs(allCached.map(toProto));
    return;
  }
  setProtoNotifs(allCached.filter(notifMatchesActiveSystem).map(toProto));
}

/** 시스템 필터만 적용 (이미 받은 전체 목록 기준) */
export function applyBizNotifSystemFilter(
  system: string | null | undefined,
  serviceList?: readonly string[] | null
) {
  activeSystem = String(system ?? '').trim() || null;
  activeServiceList = Array.isArray(serviceList)
    ? serviceList.map((s) => String(s ?? '').trim()).filter(Boolean)
    : null;
  publishFiltered();
}

export function getBizNotifActiveSystem(): string | null {
  return activeSystem;
}

export function getBizNotifAllCached(): BizNotifCachedItem[] {
  return allCached;
}

/** 전체 후보를 서버에서 받아 캐시하고, 현재 시스템 필터로 화면에 반영 */
export async function refreshBizNotifs(opts?: {
  system?: string | null;
  serviceList?: readonly string[] | null;
}): Promise<BizNotifCachedItem[]> {
  if (opts && 'system' in opts) {
    activeSystem = String(opts.system ?? '').trim() || null;
  }
  if (opts && 'serviceList' in opts) {
    activeServiceList = Array.isArray(opts.serviceList)
      ? opts.serviceList.map((s) => String(s ?? '').trim()).filter(Boolean)
      : null;
  }

  try {
    const res = await call('', 'POST', {
      service: 'bizNotifService',
      action: 'listMyBizNotifications',
      params: { withinDays: BIZ_NOTIF_WITHIN_DAYS },
    });
    const payload = (res?.data ?? res) as {
      items?: BizNotifCachedItem[];
      error?: string;
    };
    allCached = Array.isArray(payload?.items)
      ? payload.items.map((i) => ({
          ...i,
          notifKey: i.notifKey || i.id,
          systemScope: i.systemScope || 'river',
          serEng: String(i.serEng ?? '').trim() || undefined,
          important: true as const,
        }))
      : [];
    publishFiltered();
    return allCached;
  } catch {
    allCached = [];
    publishFiltered();
    return [];
  }
}

export async function markBizNotifRead(item: ProtoNotifItem) {
  const notifKey = String(item.notifKey || item.id).trim();
  if (!notifKey) return;
  allCached = allCached.map((n) =>
    n.notifKey === notifKey ? { ...n, read: true } : n
  );
  publishFiltered();
  await call('', 'POST', {
    service: 'bizNotifService',
    action: 'markBizNotifRead',
    params: { notifKey },
  }).catch(() => undefined);
}

export async function dismissBizNotif(item: ProtoNotifItem) {
  const notifKey = String(item.notifKey || item.id).trim();
  if (!notifKey) return;
  allCached = allCached.filter((n) => n.notifKey !== notifKey);
  publishFiltered();
  await call('', 'POST', {
    service: 'bizNotifService',
    action: 'dismissBizNotif',
    params: { notifKey },
  }).catch(() => undefined);
}

export async function dismissAllBizNotifs() {
  const system = activeSystem;
  const toDrop = new Set(
    (system ? allCached.filter(notifMatchesActiveSystem) : allCached).map(
      (n) => n.notifKey
    )
  );
  allCached = allCached.filter((n) => !toDrop.has(n.notifKey));
  publishFiltered();
  await call('', 'POST', {
    service: 'bizNotifService',
    action: 'dismissAllBizNotifs',
    params: { system: system || undefined },
  }).catch(() => undefined);
}

export { PROTO_NOTIF_CHANGED_EVENT, getProtoNotifs };
