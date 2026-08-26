/**
 * 업무 알림 — 후보 수집 + 계정별 읽음·지우기(서버)
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/database/db';
import { usrBizNotifState } from '@/database/schema/usr_biz_notif_state';
import { getSessionUsrId } from '@/lib/auth/guard';
import { getUsageDataAsExpiryNotifications } from '@/service/usageDataAsService';
import { getUseFeeUnpaidDueNotifications } from '@/service/useFeeService';
import { getUseFeeBinding } from '@/lib/useFeeBinding';

export type BizNotifItem = {
  id: string;
  notifKey: string;
  category: '만료임박' | '미납임박';
  title: string;
  name: string;
  listKey: string;
  read: boolean;
  important: true;
  target: 'ledger' | 'fee';
  targetId: string;
  /** URL system= 과 맞춤 (예: river) */
  systemScope: string;
};

const WITHIN_DAYS = 15;

function formatDaysRemainingLabel(daysRemaining: number, kind: 'expiry' | 'due'): string {
  if (daysRemaining <= 0) return kind === 'expiry' ? '오늘 종료' : '오늘 납기';
  return `D-${daysRemaining}`;
}

async function loadStateMap(usrId: string, keys: string[]): Promise<Map<string, { read: boolean; dismissed: boolean }>> {
  const map = new Map<string, { read: boolean; dismissed: boolean }>();
  if (keys.length === 0) return map;
  try {
    const rows = await db
      .select()
      .from(usrBizNotifState)
      .where(and(eq(usrBizNotifState.usrId, usrId), inArray(usrBizNotifState.notifKey, keys)));
    for (const r of rows) {
      map.set(String(r.notifKey), {
        read: Boolean(r.isRead),
        dismissed: Boolean(r.isDismissed),
      });
    }
  } catch (e) {
    console.warn(
      '[bizNotif] state load failed (테이블 미적용 가능):',
      e instanceof Error ? e.message : e
    );
  }
  return map;
}

async function upsertState(params: {
  usrId: string;
  notifKey: string;
  isRead?: boolean;
  isDismissed?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const key = String(params.notifKey ?? '').trim();
  if (!key) return { ok: false, error: '알림 키가 필요합니다.' };
  try {
    const existing = await db
      .select()
      .from(usrBizNotifState)
      .where(and(eq(usrBizNotifState.usrId, params.usrId), eq(usrBizNotifState.notifKey, key)))
      .limit(1);
    const prev = existing[0];
    const isRead = params.isRead ?? Boolean(prev?.isRead);
    const isDismissed = params.isDismissed ?? Boolean(prev?.isDismissed);
    if (prev) {
      await db
        .update(usrBizNotifState)
        .set({
          isRead,
          isDismissed,
          updatedAt: sql`now()`,
        })
        .where(eq(usrBizNotifState.id, prev.id));
    } else {
      await db.insert(usrBizNotifState).values({
        usrId: params.usrId,
        notifKey: key,
        isRead,
        isDismissed,
      });
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? `${e.message} (usr_biz_notif_state 테이블 적용 여부를 확인하세요)`
          : String(e),
    };
  }
}

/** 전체 후보 + 서버 상태. system 있으면 해당 시스템만 */
export async function listMyBizNotifications(params?: {
  system?: string;
  withinDays?: number;
}): Promise<{ items: BizNotifItem[]; error?: string }> {
  const usrId = await getSessionUsrId();
  if (!usrId) return { items: [], error: '로그인이 필요합니다.' };

  const withinDays = Math.max(1, Math.min(365, Math.trunc(Number(params?.withinDays ?? WITHIN_DAYS))));
  const system = String(params?.system ?? '')
    .trim()
    .toLowerCase();

  const [expiryRes, feeRes] = await Promise.all([
    getUsageDataAsExpiryNotifications({ withinDays }),
    getUseFeeUnpaidDueNotifications({ withinDays }),
  ]);

  const candidates: Omit<BizNotifItem, 'read'>[] = [];

  for (const row of expiryRes.items ?? []) {
    candidates.push({
      id: `usage-expiry:${row.rowKey}`,
      notifKey: `usage-expiry:${row.rowKey}`,
      category: '만료임박',
      title: '점용 종료 임박',
      name: `하천점용 ${row.rowKey} ${row.name}`,
      listKey: `${row.endDate} · ${formatDaysRemainingLabel(row.daysRemaining, 'expiry')}`,
      important: true,
      target: 'ledger',
      targetId: row.rowKey,
      systemScope: 'river',
    });
  }

  for (const row of feeRes.items ?? []) {
    const feeTitle = getUseFeeBinding({ prefix: row.prefix }).title;
    candidates.push({
      id: `use-fee-due:${row.prefix}:${row.id}`,
      notifKey: `use-fee-due:${row.prefix}:${row.id}`,
      category: '미납임박',
      title: '점사용료 납기 임박',
      name: `${feeTitle} ${row.chargeNo} ${row.payer}`,
      listKey: `${row.dueDate} · ${formatDaysRemainingLabel(row.daysRemaining, 'due')}`,
      important: true,
      target: 'fee',
      targetId: row.id,
      systemScope: row.systemScope,
    });
  }

  const scoped = system
    ? candidates.filter((c) => c.systemScope === system)
    : candidates;

  const stateMap = await loadStateMap(
    usrId,
    scoped.map((c) => c.notifKey)
  );

  const items: BizNotifItem[] = [];
  for (const c of scoped) {
    const st = stateMap.get(c.notifKey);
    if (st?.dismissed) continue;
    items.push({ ...c, read: Boolean(st?.read) });
  }

  items.sort((a, b) => {
    if (a.category !== b.category) return a.category === '만료임박' ? -1 : 1;
    return a.listKey.localeCompare(b.listKey);
  });

  const err = expiryRes.error || feeRes.error;
  return err ? { items, error: err } : { items };
}

export async function markBizNotifRead(params?: {
  notifKey?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const usrId = await getSessionUsrId();
  if (!usrId) return { ok: false, error: '로그인이 필요합니다.' };
  return upsertState({ usrId, notifKey: String(params?.notifKey ?? ''), isRead: true });
}

export async function dismissBizNotif(params?: {
  notifKey?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const usrId = await getSessionUsrId();
  if (!usrId) return { ok: false, error: '로그인이 필요합니다.' };
  return upsertState({
    usrId,
    notifKey: String(params?.notifKey ?? ''),
    isDismissed: true,
    isRead: true,
  });
}

/** 현재 목록(시스템 필터 적용) 기준으로 모두 지우기 */
export async function dismissAllBizNotifs(params?: {
  system?: string;
}): Promise<{ ok: boolean; count?: number; error?: string }> {
  const list = await listMyBizNotifications({ system: params?.system });
  if (list.error && list.items.length === 0) return { ok: false, error: list.error };
  const usrId = await getSessionUsrId();
  if (!usrId) return { ok: false, error: '로그인이 필요합니다.' };

  let count = 0;
  for (const item of list.items) {
    const r = await upsertState({
      usrId,
      notifKey: item.notifKey,
      isDismissed: true,
      isRead: true,
    });
    if (r.ok) count++;
  }
  return { ok: true, count };
}
