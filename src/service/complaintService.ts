/**
 * 민원(comp) / 민원 처리내역(compd) API
 */
import { db } from '@/database/db';
import { comp, compd } from '@/database/schema';
import { eq, desc, asc, sql, inArray } from 'drizzle-orm';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export type CompRow = typeof comp.$inferSelect;
export type CompdRow = typeof compd.$inferSelect;

/** 목록 조회 (페이징, 각 행에 latestState 포함) */
export async function list(params: {
  limit?: number;
  offset?: number;
  compKey?: number;
} = {}) {
  let limit = typeof params?.limit === 'number' && params.limit > 0 ? params.limit : DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  const offset = typeof params?.offset === 'number' && params.offset >= 0 ? params.offset : 0;

  const where = params?.compKey != null ? eq(comp.compKey, params.compKey) : undefined;
  const rows = await db
    .select()
    .from(comp)
    .where(where)
    .orderBy(desc(comp.compKey))
    .limit(limit)
    .offset(offset);

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(comp)
    .where(where);
  const total = countResult[0]?.count ?? 0;

  if (rows.length === 0) return { rows: [], total };
  const compKeys = rows.map((r) => r.compKey);
  const allCompd = await db
    .select({ compKey: compd.compKey, compdState: compd.compdState, compdKey: compd.compdKey })
    .from(compd)
    .where(inArray(compd.compKey, compKeys))
    .orderBy(desc(compd.compdKey));
  const latestByKey = new Map<number, string | null>();
  for (const r of allCompd) {
    if (!latestByKey.has(r.compKey)) latestByKey.set(r.compKey, r.compdState);
  }
  const rowsWithState = rows.map((r) => ({ ...r, latestState: latestByKey.get(r.compKey) ?? null }));

  return { rows: rowsWithState, total };
}

/** 단건 조회 + 처리내역(compd) 목록 */
export async function get(params: { compKey: number }) {
  const key = Number(params?.compKey);
  if (!Number.isInteger(key) || key < 1) return null;

  const [row] = await db.select().from(comp).where(eq(comp.compKey, key)).limit(1);
  if (!row) return null;

  const compdList = await db
    .select()
    .from(compd)
    .where(eq(compd.compKey, key))
    .orderBy(asc(compd.compdKey));

  return { ...row, compdList };
}

function emptyToNull(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

/** 민원 접수 생성 (생성 시 상태 '접수' 이력 1건 자동 추가) */
export async function create(params: {
  compDate?: string | null;
  compCu?: string | null;
  compCt?: string | null;
  compCg?: string | null;
  compAdr?: string | null;
  compName?: string | null;
  compTel?: string | null;
  compContent?: string | null;
  compExtra?: Record<string, unknown> | null;
}) {
  try {
    const [inserted] = await db
      .insert(comp)
      .values({
        compDate: emptyToNull(params.compDate),
        compCu: emptyToNull(params.compCu),
        compCt: emptyToNull(params.compCt),
        compCg: emptyToNull(params.compCg),
        compAdr: emptyToNull(params.compAdr),
        compName: emptyToNull(params.compName),
        compTel: emptyToNull(params.compTel),
        compContent: emptyToNull(params.compContent),
        compExtra: params.compExtra ?? null,
      })
      .returning();
    if (!inserted) return null;

    const today = new Date().toISOString().slice(0, 10);
    await db.insert(compd).values({
      compKey: inserted.compKey,
      compdDate: today,
      compdState: '접수',
      compdCu: emptyToNull(params.compCu),
      compdCt: emptyToNull(params.compCt),
      compdCg: emptyToNull(params.compCg),
      compdContents: '민원접수',
      compdExtra: null,
    });

    return inserted;
  } catch (e: unknown) {
    const err = e as { code?: string; detail?: string; message?: string };
    const msg = err.detail || err.message || String(e);
    throw Object.assign(new Error(msg), { code: err.code, detail: err.detail });
  }
}

/** 민원 접수 수정 */
export async function update(params: {
  compKey: number;
  compDate?: string | null;
  compCu?: string | null;
  compCt?: string | null;
  compCg?: string | null;
  compAdr?: string | null;
  compName?: string | null;
  compTel?: string | null;
  compContent?: string | null;
  compExtra?: Record<string, unknown> | null;
}) {
  const key = Number(params.compKey);
  if (!Number.isInteger(key) || key < 1) return null;

  const set: Record<string, unknown> = {};
  if (params.compDate !== undefined) set.compDate = emptyToNull(params.compDate);
  if (params.compCu !== undefined) set.compCu = emptyToNull(params.compCu);
  if (params.compCt !== undefined) set.compCt = emptyToNull(params.compCt);
  if (params.compCg !== undefined) set.compCg = emptyToNull(params.compCg);
  if (params.compAdr !== undefined) set.compAdr = emptyToNull(params.compAdr);
  if (params.compName !== undefined) set.compName = emptyToNull(params.compName);
  if (params.compTel !== undefined) set.compTel = emptyToNull(params.compTel);
  if (params.compContent !== undefined) set.compContent = emptyToNull(params.compContent);
  if (params.compExtra !== undefined) set.compExtra = params.compExtra;
  if (Object.keys(set).length === 0) return (await get({ compKey: key })) ?? null;

  const [updated] = await db
    .update(comp)
    .set(set as Partial<typeof comp.$inferInsert>)
    .where(eq(comp.compKey, key))
    .returning();
  return updated ?? null;
}

/** 민원 처리내역(compd) 추가 */
export async function compdCreate(params: {
  compKey: number;
  compdDate?: string | null;
  compdCu?: string | null;
  compdCt?: string | null;
  compdCg?: string | null;
  compdState?: string | null;
  compdContents?: string | null;
  compdExtra?: Record<string, unknown> | null;
}) {
  const key = Number(params.compKey);
  if (!Number.isInteger(key) || key < 1) return null;

  const [inserted] = await db
    .insert(compd)
    .values({
      compKey: key,
      compdDate: params.compdDate ?? null,
      compdCu: params.compdCu ?? null,
      compdCt: params.compdCt ?? null,
      compdCg: params.compdCg ?? null,
      compdState: params.compdState ?? null,
      compdContents: params.compdContents ?? null,
      compdExtra: params.compdExtra ?? null,
    })
    .returning();
  return inserted ?? null;
}

/** 민원 처리내역(compd) 수정 */
export async function compdUpdate(params: {
  compdKey: number;
  compdDate?: string | null;
  compdCu?: string | null;
  compdCt?: string | null;
  compdCg?: string | null;
  compdState?: string | null;
  compdContents?: string | null;
  compdExtra?: Record<string, unknown> | null;
}) {
  const key = Number(params.compdKey);
  if (!Number.isInteger(key) || key < 1) return null;

  const [updated] = await db
    .update(compd)
    .set({
      compdDate: params.compdDate ?? null,
      compdCu: params.compdCu ?? null,
      compdCt: params.compdCt ?? null,
      compdCg: params.compdCg ?? null,
      compdState: params.compdState ?? null,
      compdContents: params.compdContents ?? null,
      compdExtra: params.compdExtra ?? null,
    })
    .where(eq(compd.compdKey, key))
    .returning();
  return updated ?? null;
}

/** 민원 처리내역(compd) 삭제 */
export async function compdRemove(params: { compdKey: number }) {
  const key = Number(params.compdKey);
  if (!Number.isInteger(key) || key < 1) return { deleted: false };

  await db.delete(compd).where(eq(compd.compdKey, key));
  return { deleted: true };
}

/** 민원 접수 삭제 (compd는 FK cascade로 함께 삭제) */
export async function remove(params: { compKey: number }) {
  const key = Number(params.compKey);
  if (!Number.isInteger(key) || key < 1) return { deleted: false };

  await db.delete(comp).where(eq(comp.compKey, key));
  return { deleted: true };
}
