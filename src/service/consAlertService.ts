/**
 * 상·하수도 공사대장 알림설정.
 * 설정은 공사당 하나이고, 공사대장 메뉴가 있는 시스템에 로그인한 사용자가 같이 본다.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/database/db';
import { consAlertSetting } from '@/database/schema/cons_alert_setting';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  consAlertHits,
  consAlertWhenLabel,
  DEFAULT_CONS_ALERT,
  todayYmd,
  type ConsAlertSettings,
} from '@/lib/consAlertSchedule';
import { getSystemList } from '@/service/configService';
import { listConsDatesByCodes } from '@/service/consDataAsService';
import { ensureConsAlertSettingTable } from '@/service/ensureLayerAppTables';

type LedgerKind = 'wtl' | 'swl';

const WTL_MENUS = ['wtlConstructionLedger', 'waterworksLedger'] as const;
const SWL_MENUS = ['sewerConstructionLedger'] as const;

export type DueConsAlert = {
  id: string;
  notifKey: string;
  name: string;
  listKey: string;
  targetId: string;
  serEng: string;
  kind: LedgerKind;
  daysUntil: number;
};

let ensurePromise: Promise<void> | null = null;

async function ensureTable() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const result = await ensureConsAlertSettingTable();
    if (result.errors.length) {
      throw new Error(result.errors.join('; '));
    }
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

function clampDays(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(9999, n));
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeSettings(raw: Partial<ConsAlertSettings> | null | undefined): ConsAlertSettings {
  const src = raw ?? {};
  return {
    cycleYears: clampDays(src.cycleYears, DEFAULT_CONS_ALERT.cycleYears),
    doneBeforeDays: clampDays(src.doneBeforeDays, DEFAULT_CONS_ALERT.doneBeforeDays),
    doneBeforeOn: flag(src.doneBeforeOn, DEFAULT_CONS_ALERT.doneBeforeOn),
    doneAfterDays: clampDays(src.doneAfterDays, DEFAULT_CONS_ALERT.doneAfterDays),
    doneAfterOn: flag(src.doneAfterOn, DEFAULT_CONS_ALERT.doneAfterOn),
    startBeforeDays: clampDays(src.startBeforeDays, DEFAULT_CONS_ALERT.startBeforeDays),
    startBeforeOn: flag(src.startBeforeOn, DEFAULT_CONS_ALERT.startBeforeOn),
    startAfterDays: clampDays(src.startAfterDays, DEFAULT_CONS_ALERT.startAfterDays),
    startAfterOn: flag(src.startAfterOn, DEFAULT_CONS_ALERT.startAfterOn),
  };
}

function toSettings(row: typeof consAlertSetting.$inferSelect): ConsAlertSettings {
  return {
    cycleYears: row.cycleYears,
    doneBeforeDays: row.doneBeforeDays,
    doneBeforeOn: row.doneBeforeOn,
    doneAfterDays: row.doneAfterDays,
    doneAfterOn: row.doneAfterOn,
    startBeforeDays: row.startBeforeDays,
    startBeforeOn: row.startBeforeOn,
    startAfterDays: row.startAfterDays,
    startAfterOn: row.startAfterOn,
  };
}

async function resolveKind(kindRaw: unknown, consCode: string): Promise<LedgerKind | null> {
  const kind = String(kindRaw ?? '').trim();
  if (kind === 'wtl' || kind === 'swl') return kind;
  const wtl = await listConsDatesByCodes({ kind: 'wtl', consCodes: [consCode] });
  if (wtl.rows.some((row) => row.consCode === consCode)) return 'wtl';
  const swl = await listConsDatesByCodes({ kind: 'swl', consCodes: [consCode] });
  if (swl.rows.some((row) => row.consCode === consCode)) return 'swl';
  return null;
}

function menuSerEngs(kind: LedgerKind): string[] {
  const candidates = kind === 'swl' ? SWL_MENUS : WTL_MENUS;
  const found: string[] = [];
  for (const eng of candidates) {
    const has = getSystemList().systems.some((system) =>
      (system.serviceList ?? []).some((item) => String(item).trim() === eng)
    );
    if (has) found.push(eng);
  }
  return found.length ? found : [candidates[0]];
}

export async function getSettings(params?: { kind?: string; consCode?: string; workId?: string }) {
  const usrId = await getSessionUsrId();
  if (!usrId) return { settings: null, error: '로그인이 필요합니다.' };
  const consCode = String(params?.consCode ?? params?.workId ?? '').trim();
  if (!consCode) return { settings: null, error: '공사코드가 필요합니다.' };
  await ensureTable();
  const kind = await resolveKind(params?.kind, consCode);
  if (!kind) return { settings: null };
  const rows = await db
    .select()
    .from(consAlertSetting)
    .where(and(eq(consAlertSetting.kind, kind), eq(consAlertSetting.consCode, consCode)))
    .limit(1);
  const row = rows[0];
  return { settings: row ? toSettings(row) : null, kind };
}

export async function saveSettings(params?: {
  kind?: string;
  consCode?: string;
  workId?: string;
  settings?: Partial<ConsAlertSettings>;
}) {
  const usrId = await getSessionUsrId();
  if (!usrId) return { ok: false, error: '로그인이 필요합니다.' };
  const consCode = String(params?.consCode ?? params?.workId ?? '').trim();
  if (!consCode) return { ok: false, error: '공사코드가 필요합니다.' };
  await ensureTable();
  const kind = await resolveKind(params?.kind, consCode);
  if (!kind) return { ok: false, error: '공사대장을 찾지 못했습니다.' };
  const settings = normalizeSettings(params?.settings);
  await db
    .insert(consAlertSetting)
    .values({
      kind,
      consCode,
      ...settings,
      updatedBy: usrId,
    })
    .onConflictDoUpdate({
      target: [consAlertSetting.kind, consAlertSetting.consCode],
      set: {
        ...settings,
        updatedBy: usrId,
        updatedAt: sql`now()`,
      },
    });
  return { ok: true, kind };
}

/** 알림일이 오늘 전후 withinDays 안인 공사 알림 */
export async function listDueConsAlerts(withinDays: number): Promise<DueConsAlert[]> {
  await ensureTable();
  const rows = await db.select().from(consAlertSetting);
  if (!rows.length) return [];
  const byKind: Record<LedgerKind, string[]> = { wtl: [], swl: [] };
  for (const row of rows) {
    if (row.kind === 'wtl' || row.kind === 'swl') byKind[row.kind].push(row.consCode);
  }
  const [wtl, swl] = await Promise.all([
    listConsDatesByCodes({ kind: 'wtl', consCodes: byKind.wtl }),
    listConsDatesByCodes({ kind: 'swl', consCodes: byKind.swl }),
  ]);
  const dates = new Map<string, { name: string; startDate: string; doneDate: string }>();
  for (const row of wtl.rows) {
    dates.set(`wtl:${row.consCode}`, {
      name: row.consName || row.consCode,
      startDate: row.startDate,
      doneDate: row.doneDate || row.sdoneDate,
    });
  }
  for (const row of swl.rows) {
    dates.set(`swl:${row.consCode}`, {
      name: row.consName || row.consCode,
      startDate: row.startDate,
      doneDate: row.doneDate || row.sdoneDate,
    });
  }
  const today = todayYmd();
  const out: DueConsAlert[] = [];
  for (const row of rows) {
    if (row.kind !== 'wtl' && row.kind !== 'swl') continue;
    const source = dates.get(`${row.kind}:${row.consCode}`);
    if (!source) continue;
    const hits = consAlertHits(toSettings(row), source.startDate, source.doneDate, today, withinDays);
    for (const hit of hits) {
      const notifKey = `cons-alert:${row.kind}:${row.consCode}:${hit.suffix}`;
      for (const serEng of menuSerEngs(row.kind)) {
        out.push({
          id: `${notifKey}:${serEng}`,
          notifKey,
          name: source.name,
          listKey: `${hit.label} · ${consAlertWhenLabel(hit.daysUntil)}`,
          targetId: row.consCode,
          serEng,
          kind: row.kind,
          daysUntil: hit.daysUntil,
        });
      }
    }
  }
  return out;
}
