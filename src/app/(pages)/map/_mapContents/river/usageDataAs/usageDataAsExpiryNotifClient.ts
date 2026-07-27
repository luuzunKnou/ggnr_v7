'use client';

import { call } from '@/lib/api';
import {
  getProtoNotifs,
  PROTO_NOTIF_CHANGED_EVENT,
  setProtoNotifs,
  type ProtoNotifItem,
} from '../../prototypes/dummyData';

const DISMISSED_STORAGE_BASE = 'ggnr-usage-expiry-notif-dismissed';
const READ_STORAGE_BASE = 'ggnr-usage-expiry-notif-read';
export const USAGE_EXPIRY_NOTIF_WITHIN_DAYS = 15;

/** localStorage 키 — 로그인 계정별 분리 */
let activeUsrId = '';

export function setUsageDataAsNotifUsrId(usrId: string | null | undefined) {
  activeUsrId = String(usrId ?? '').trim();
}

function requireUsrId(): string | null {
  return activeUsrId || null;
}

function storageKey(base: string): string | null {
  const usrId = requireUsrId();
  if (!usrId) return null;
  return `${base}:${usrId}`;
}

type ExpiryNotifRow = {
  rowKey: string;
  name: string;
  endDate: string;
  daysRemaining: number;
};

function loadIdSet(key: string | null): Set<string> {
  if (!key || typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((v) => String(v ?? '').trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function saveIdSet(key: string | null, ids: Set<string>) {
  if (!key || typeof window === 'undefined') return;
  if (ids.size === 0) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify([...ids]));
}

function formatDaysRemainingLabel(daysRemaining: number): string {
  if (daysRemaining <= 0) return '오늘 종료';
  return `D-${daysRemaining}`;
}

export function expiryRowToNotifItem(
  row: ExpiryNotifRow,
  read: boolean
): ProtoNotifItem {
  return {
    id: `usage-expiry:${row.rowKey}`,
    category: '만료임박',
    title: '점용 종료 임박',
    name: `하천점용 ${row.rowKey} ${row.name}`,
    listKey: `${row.endDate} · ${formatDaysRemainingLabel(row.daysRemaining)}`,
    read,
    important: true,
    target: 'ledger',
    targetId: row.rowKey,
  };
}

function mergeExpiryRows(rows: ExpiryNotifRow[]): ProtoNotifItem[] {
  const dismissed = loadIdSet(storageKey(DISMISSED_STORAGE_BASE));
  const read = loadIdSet(storageKey(READ_STORAGE_BASE));
  return rows
    .filter((row) => !dismissed.has(row.rowKey))
    .map((row) => expiryRowToNotifItem(row, read.has(row.rowKey)));
}

export async function refreshUsageDataAsExpiryNotifs(): Promise<ProtoNotifItem[]> {
  if (!requireUsrId()) {
    setProtoNotifs([]);
    return [];
  }

  try {
    const res = await call('', 'POST', {
      service: 'usageDataAsService',
      action: 'getUsageDataAsExpiryNotifications',
      params: { withinDays: USAGE_EXPIRY_NOTIF_WITHIN_DAYS },
    });
    const payload = (res?.data ?? res) as {
      success?: boolean;
      items?: ExpiryNotifRow[];
      error?: string;
    };
    const rows = Array.isArray(payload?.items) ? payload.items : [];
    const items = mergeExpiryRows(rows);
    setProtoNotifs(items);
    return items;
  } catch {
    setProtoNotifs([]);
    return [];
  }
}

export function markUsageDataAsExpiryNotifRead(rowKey: string) {
  const row = String(rowKey ?? '').trim();
  if (!row) return;
  const readKey = storageKey(READ_STORAGE_BASE);
  if (!readKey) return;
  const read = loadIdSet(readKey);
  read.add(row);
  saveIdSet(readKey, read);
  setProtoNotifs(
    getProtoNotifs().map((item) =>
      item.targetId === row ? { ...item, read: true } : item
    )
  );
}

export function dismissUsageDataAsExpiryNotif(rowKey: string) {
  const row = String(rowKey ?? '').trim();
  if (!row) return;
  const dismissedKey = storageKey(DISMISSED_STORAGE_BASE);
  if (!dismissedKey) return;
  const dismissed = loadIdSet(dismissedKey);
  dismissed.add(row);
  saveIdSet(dismissedKey, dismissed);
  setProtoNotifs(getProtoNotifs().filter((item) => item.targetId !== row));
}

export function dismissAllUsageDataAsExpiryNotifs() {
  const dismissedKey = storageKey(DISMISSED_STORAGE_BASE);
  if (!dismissedKey) return;
  const dismissed = loadIdSet(dismissedKey);
  for (const item of getProtoNotifs()) {
    dismissed.add(item.targetId);
  }
  saveIdSet(dismissedKey, dismissed);
  setProtoNotifs([]);
}

export { PROTO_NOTIF_CHANGED_EVENT };
