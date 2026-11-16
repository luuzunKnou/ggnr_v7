/**
 * 도면 표시 — 메타는 DB(drawing_display), DXF 본문은 GGNR_DATA_DIR/file_data/drawing_display/{dd_key}.dxf
 * 사용자별: 본인이 올린 도면만 목록·수정·삭제·조회 가능
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import { getSessionUsrId } from '@/lib/auth/guard';
import { decodeDxfBytes } from '@/lib/dxfTextEncoding';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';
import { resolveGgnrDataDir } from '@/lib/turbopackFsPath';
import { db } from '@/database/db';
import { drawingDisplay } from '@/database/schema/drawing_display';

type Params = Record<string, unknown>;

export type DrawingDisplayStoredItem = {
  /** dd_key 문자열 (클라이언트·API 식별자) */
  id: string;
  fileName: string;
  storedName: string;
  usrId: string;
  crs: string;
  manualCrs: boolean;
  visible: boolean;
  createdAt: string;
};

function rootDir(): string {
  return path.join(resolveGgnrDataDir(), GGNR_DATA_PATHS.drawingDisplay);
}

function assertSafeKey(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('도면 식별자가 올바르지 않습니다.');
  }
  return n;
}

function fileAbs(storedName: string): string {
  const base = path.resolve(rootDir());
  const abs = path.resolve(base, storedName);
  const rel = path.relative(base, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('파일 경로가 올바르지 않습니다.');
  }
  return abs;
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(rootDir(), { recursive: true });
}

async function requireUsrId(): Promise<string> {
  const usrId = await getSessionUsrId();
  if (!usrId) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 });
  return usrId;
}

function rowToItem(row: typeof drawingDisplay.$inferSelect): DrawingDisplayStoredItem {
  return {
    id: String(row.ddKey),
    fileName: row.ddFileName,
    storedName: row.ddStoredName,
    usrId: row.ddUsrId,
    crs: row.ddCrs || '5186',
    manualCrs: Boolean(row.ddManualCrs),
    visible: row.ddVisible !== false,
    createdAt: row.ddCreateDate || new Date().toISOString(),
  };
}

export async function listItems(_params: Params = {}): Promise<{ items: DrawingDisplayStoredItem[] }> {
  const usrId = await requireUsrId();
  const rows = await db
    .select()
    .from(drawingDisplay)
    .where(eq(drawingDisplay.ddUsrId, usrId))
    .orderBy(asc(drawingDisplay.ddCreateDate));
  return { items: rows.map(rowToItem) };
}

/** 업로드 라우트용 — DXF 본문 저장 후 DB 메타 추가 */
export async function saveUploadedDxf(params: {
  fileName: string;
  dxfText: string;
  crs?: string;
}): Promise<DrawingDisplayStoredItem> {
  const usrId = await requireUsrId();
  const fileName = String(params.fileName ?? '').trim() || 'drawing.dxf';
  const dxfText = String(params.dxfText ?? '');
  if (!dxfText) throw new Error('도면 본문이 비어 있습니다.');

  await ensureDirs();
  const createdAt = new Date().toISOString();

  const inserted = await db
    .insert(drawingDisplay)
    .values({
      ddFileName: fileName,
      ddStoredName: '', // 키 확정 후 갱신
      ddUsrId: usrId,
      ddCrs: params.crs || '5186',
      ddManualCrs: false,
      ddVisible: true,
      ddCreateDate: createdAt,
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new Error('도면 메타를 저장하지 못했습니다.');

  const storedName = `${row.ddKey}.dxf`;
  try {
    await fs.writeFile(fileAbs(storedName), dxfText, 'utf8');
    const updated = await db
      .update(drawingDisplay)
      .set({ ddStoredName: storedName })
      .where(eq(drawingDisplay.ddKey, row.ddKey))
      .returning();
    return rowToItem(updated[0] ?? { ...row, ddStoredName: storedName });
  } catch (e) {
    await db.delete(drawingDisplay).where(eq(drawingDisplay.ddKey, row.ddKey));
    try {
      await fs.unlink(fileAbs(storedName));
    } catch {
      /* ignore */
    }
    throw e;
  }
}

export async function updateItem(params: Params = {}): Promise<{ item: DrawingDisplayStoredItem }> {
  const usrId = await requireUsrId();
  const key = assertSafeKey(params.id);

  const patch: Partial<typeof drawingDisplay.$inferInsert> = {};
  if (params.crs != null) patch.ddCrs = String(params.crs);
  if (params.manualCrs != null) patch.ddManualCrs = Boolean(params.manualCrs);
  if (params.visible != null) patch.ddVisible = Boolean(params.visible);

  if (Object.keys(patch).length > 0) {
    await db
      .update(drawingDisplay)
      .set(patch)
      .where(and(eq(drawingDisplay.ddKey, key), eq(drawingDisplay.ddUsrId, usrId)));
  }

  const rows = await db
    .select()
    .from(drawingDisplay)
    .where(and(eq(drawingDisplay.ddKey, key), eq(drawingDisplay.ddUsrId, usrId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error('도면을 찾을 수 없습니다.');
  return { item: rowToItem(row) };
}

export async function deleteItem(params: Params = {}): Promise<{ ok: true }> {
  const usrId = await requireUsrId();
  const key = assertSafeKey(params.id);

  const rows = await db
    .select()
    .from(drawingDisplay)
    .where(and(eq(drawingDisplay.ddKey, key), eq(drawingDisplay.ddUsrId, usrId)))
    .limit(1);
  const hit = rows[0];
  if (!hit) throw new Error('도면을 찾을 수 없습니다.');

  await db
    .delete(drawingDisplay)
    .where(and(eq(drawingDisplay.ddKey, key), eq(drawingDisplay.ddUsrId, usrId)));

  try {
    await fs.unlink(fileAbs(hit.ddStoredName || `${key}.dxf`));
  } catch {
    /* 파일이 없어도 메타는 삭제됨 */
  }
  return { ok: true };
}

/** 본인 도면만 삭제 */
export async function clearAll(_params: Params = {}): Promise<{ ok: true }> {
  const usrId = await requireUsrId();
  const mine = await db.select().from(drawingDisplay).where(eq(drawingDisplay.ddUsrId, usrId));
  await db.delete(drawingDisplay).where(eq(drawingDisplay.ddUsrId, usrId));
  for (const hit of mine) {
    try {
      await fs.unlink(fileAbs(hit.ddStoredName || `${hit.ddKey}.dxf`));
    } catch {
      /* ignore */
    }
  }
  return { ok: true };
}

/** 서버 라우트용 — DXF 본문 (본인 것만) */
export async function readDxfTextById(idRaw: string): Promise<string> {
  const usrId = await requireUsrId();
  const key = assertSafeKey(idRaw);
  const rows = await db
    .select()
    .from(drawingDisplay)
    .where(and(eq(drawingDisplay.ddKey, key), eq(drawingDisplay.ddUsrId, usrId)))
    .limit(1);
  const hit = rows[0];
  if (!hit) throw new Error('도면을 찾을 수 없습니다.');
  const buf = await fs.readFile(fileAbs(hit.ddStoredName || `${key}.dxf`));
  return decodeDxfBytes(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
