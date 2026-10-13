/**
 * 정책지도 바로가기 — zip 업로드·목록·삭제·정적 루트
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { db, pool } from '@/database/db';
import { policyMap } from '@/database/schema/policy_map';
import { getSessionUsrId } from '@/lib/auth/guard';
import { isSuperUser } from '@/lib/auth/superUser';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';
import { resolveGgnrDataDir } from '@/lib/turbopackFsPath';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_ZIP_BYTES = 80 * 1024 * 1024;

function throwHttp(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

async function requireUsr(): Promise<string> {
  const usrId = await getSessionUsrId();
  if (!usrId) throwHttp(401, '로그인이 필요합니다.');
  return usrId;
}

function nowIso(): string {
  return new Date().toISOString();
}

function formatDateLabel(iso: string | null | undefined): string {
  if (!iso) return '-';
  return iso.slice(0, 10).replace(/-/g, '.');
}

let ensured = false;

/** 테이블 없으면 생성 (push 없이 기동 가능) */
export async function ensurePolicyMapTable(): Promise<void> {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS policy_map (
      pm_key serial PRIMARY KEY NOT NULL,
      pm_title varchar NOT NULL,
      pm_entry varchar NOT NULL DEFAULT 'index.html',
      pm_is_del boolean NOT NULL DEFAULT false,
      pm_create_date timestamp,
      pm_create_user varchar,
      pm_update_date timestamp,
      pm_update_user varchar
    )
  `);
  ensured = true;
}

function policyMapRootRel(pmKey: number): string {
  return path.posix.join(GGNR_DATA_PATHS.policyMap, String(pmKey));
}

export function policyMapSiteAbsDir(pmKey: number): string {
  return path.join(resolveGgnrDataDir(), policyMapRootRel(pmKey), 'site');
}

function sanitizeZipEntryName(name: string): string | null {
  const n = String(name ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!n || n.endsWith('/')) return null;
  if (n.includes('..') || n.startsWith('/') || /^[a-zA-Z]:/.test(n)) return null;
  return n;
}

async function writeExtractedZip(zipBytes: Uint8Array, destDir: string): Promise<void> {
  const files = unzipSync(zipBytes);
  let written = 0;
  await fs.mkdir(destDir, { recursive: true });
  for (const [rawName, data] of Object.entries(files)) {
    const name = sanitizeZipEntryName(rawName);
    if (!name || !data) continue;
    const abs = path.join(destDir, ...name.split('/'));
    const resolved = path.resolve(abs);
    const root = path.resolve(destDir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) continue;
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, Buffer.from(data));
    written += 1;
  }
  if (!written) throwHttp(400, '압축 안에 파일이 없습니다.');
}

async function findEntryHtml(siteDir: string): Promise<string> {
  const tryRel = async (rel: string) => {
    try {
      await fs.access(path.join(siteDir, rel));
      return rel.replace(/\\/g, '/');
    } catch {
      return null;
    }
  };

  const direct = await tryRel('index.html');
  if (direct) return direct;
  const directHtm = await tryRel('index.htm');
  if (directHtm) return directHtm;

  const entries = await fs.readdir(siteDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 1) {
    const nested = await tryRel(path.join(dirs[0]!.name, 'index.html'));
    if (nested) return nested;
  }
  for (const e of entries) {
    if (e.isFile() && /\.html?$/i.test(e.name)) return e.name;
  }
  for (const d of dirs) {
    const nested = await tryRel(path.join(d.name, 'index.html'));
    if (nested) return nested;
  }
  throwHttp(400, 'index.html(또는 HTML)을 찾지 못했습니다. HTML 파일을 포함해 주세요.');
}

/** 여러 파일의 공통 최상위 폴더명 제거 (폴더 업로드 시) */
export function stripCommonRootPrefix(paths: string[]): string[] {
  if (paths.length <= 1) return paths.map((p) => p.replace(/^\/+/, ''));
  const norm = paths.map((p) => p.replace(/\\/g, '/').replace(/^\/+/, ''));
  const firstSegs = norm.map((p) => p.split('/')[0] ?? '');
  const root = firstSegs[0]!;
  if (!root || firstSegs.some((s) => s !== root)) return norm;
  const allHaveSlash = norm.every((p) => p.includes('/'));
  if (!allHaveSlash) return norm;
  return norm.map((p) => p.slice(root.length + 1));
}

async function writeUploadFiles(
  files: Array<{ relativePath: string; bytes: Uint8Array }>,
  destDir: string
): Promise<void> {
  if (!files.length) throwHttp(400, '파일이 없습니다.');
  const paths = stripCommonRootPrefix(files.map((f) => f.relativePath));
  await fs.mkdir(destDir, { recursive: true });
  let written = 0;
  const root = path.resolve(destDir);
  for (let i = 0; i < files.length; i++) {
    const rel = sanitizeZipEntryName(paths[i] ?? files[i]!.relativePath);
    if (!rel) continue;
    const data = files[i]!.bytes;
    if (data == null) continue;
    const abs = path.join(destDir, ...rel.split('/'));
    const resolved = path.resolve(abs);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) continue;
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, Buffer.from(data));
    written += 1;
  }
  if (!written) throwHttp(400, '저장할 파일이 없습니다.');
}

export type PolicyMapListItem = {
  pmKey: number;
  pmTitle: string;
  pmEntry: string;
  pmCreateUser: string | null;
  pmCreateDate: string | null;
  dateLabel: string;
  openPath: string;
};

function toListItem(row: {
  pmKey: number;
  pmTitle: string;
  pmEntry: string;
  pmCreateUser: string | null;
  pmCreateDate: string | null;
}): PolicyMapListItem {
  const entry = (row.pmEntry || 'index.html').replace(/^\/+/, '');
  return {
    pmKey: row.pmKey,
    pmTitle: row.pmTitle,
    pmEntry: entry,
    pmCreateUser: row.pmCreateUser,
    pmCreateDate: row.pmCreateDate,
    dateLabel: formatDateLabel(row.pmCreateDate),
    openPath: `/api/policy-map/site/${row.pmKey}/${entry}`,
  };
}

/** 목록 */
export async function list(params: { limit?: number; offset?: number; keyword?: string } = {}) {
  await ensurePolicyMapTable();
  await requireUsr();
  let limit = typeof params?.limit === 'number' && params.limit > 0 ? params.limit : DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  const offset = typeof params?.offset === 'number' && params.offset >= 0 ? params.offset : 0;
  const keyword = String(params?.keyword ?? '').trim();

  const conditions = [eq(policyMap.pmIsDel, false)];
  if (keyword) conditions.push(ilike(policyMap.pmTitle, `%${keyword}%`));
  const where = and(...conditions);

  const rows = await db
    .select()
    .from(policyMap)
    .where(where)
    .orderBy(desc(policyMap.pmCreateDate), desc(policyMap.pmKey))
    .limit(limit)
    .offset(offset);

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(policyMap)
    .where(where);

  return { rows: rows.map(toListItem), total: countResult[0]?.count ?? 0 };
}

async function insertAndPopulate(
  title: string,
  usrId: string,
  populate: (siteDir: string) => Promise<void>
): Promise<PolicyMapListItem> {
  const now = nowIso();
  const [row] = await db
    .insert(policyMap)
    .values({
      pmTitle: title,
      pmEntry: 'index.html',
      pmIsDel: false,
      pmCreateDate: now,
      pmCreateUser: usrId,
      pmUpdateDate: now,
      pmUpdateUser: usrId,
    })
    .returning();
  if (!row) throwHttp(500, '등록에 실패했습니다.');

  const siteDir = policyMapSiteAbsDir(row.pmKey);
  try {
    await populate(siteDir);
    const entry = await findEntryHtml(siteDir);
    if (entry !== row.pmEntry) {
      await db
        .update(policyMap)
        .set({ pmEntry: entry, pmUpdateDate: nowIso(), pmUpdateUser: usrId })
        .where(eq(policyMap.pmKey, row.pmKey));
      row.pmEntry = entry;
    }
  } catch (e) {
    await db.delete(policyMap).where(eq(policyMap.pmKey, row.pmKey));
    await fs
      .rm(path.join(resolveGgnrDataDir(), policyMapRootRel(row.pmKey)), {
        recursive: true,
        force: true,
      })
      .catch(() => undefined);
    throw e;
  }

  return toListItem(row);
}

/** zip 바이트로 등록 */
export async function createFromZip(params: {
  title: string;
  zipBytes: Uint8Array;
}): Promise<PolicyMapListItem> {
  await ensurePolicyMapTable();
  const usrId = await requireUsr();
  const title = String(params.title ?? '').trim();
  if (!title) throwHttp(400, '제목을 입력하세요.');
  if (!params.zipBytes?.length) throwHttp(400, '압축 파일이 없습니다.');
  if (params.zipBytes.length > MAX_ZIP_BYTES) {
    throwHttp(400, '파일 용량이 너무 큽니다. (최대 80MB)');
  }
  return insertAndPopulate(title, usrId, (siteDir) => writeExtractedZip(params.zipBytes, siteDir));
}

/** HTML·리소스 파일들(폴더/다중선택)로 등록 */
export async function createFromFiles(params: {
  title: string;
  files: Array<{ relativePath: string; bytes: Uint8Array }>;
}): Promise<PolicyMapListItem> {
  await ensurePolicyMapTable();
  const usrId = await requireUsr();
  const title = String(params.title ?? '').trim();
  if (!title) throwHttp(400, '제목을 입력하세요.');
  if (!params.files?.length) throwHttp(400, '파일이 없습니다.');
  let total = 0;
  for (const f of params.files) total += f.bytes?.length ?? 0;
  if (total > MAX_ZIP_BYTES) throwHttp(400, '파일 용량이 너무 큽니다. (최대 80MB)');

  // 단일 HTML만 올린 경우 진입명을 index.html로 맞춤
  let files = params.files;
  if (files.length === 1) {
    const only = files[0]!;
    const base = path.posix.basename(only.relativePath.replace(/\\/g, '/'));
    if (/\.html?$/i.test(base) && !/^index\.html?$/i.test(base)) {
      files = [{ relativePath: 'index.html', bytes: only.bytes }];
    }
  }

  return insertAndPopulate(title, usrId, (siteDir) => writeUploadFiles(files, siteDir));
}

/** 삭제 (등록자 또는 슈퍼계정) */
export async function remove(params: { pmKey: number }): Promise<{ ok: true }> {
  await ensurePolicyMapTable();
  const usrId = await requireUsr();
  const key = Number(params?.pmKey);
  if (!Number.isInteger(key) || key < 1) throwHttp(400, '키가 올바르지 않습니다.');

  const [row] = await db.select().from(policyMap).where(eq(policyMap.pmKey, key)).limit(1);
  if (!row || row.pmIsDel) throwHttp(404, '항목을 찾을 수 없습니다.');
  if (row.pmCreateUser !== usrId && !isSuperUser(usrId)) {
    throwHttp(403, '본인이 올린 항목만 삭제할 수 있습니다.');
  }

  await db
    .update(policyMap)
    .set({
      pmIsDel: true,
      pmUpdateDate: nowIso(),
      pmUpdateUser: usrId,
    })
    .where(eq(policyMap.pmKey, key));

  return { ok: true };
}

/** 열람용 메타 (로그인) */
export async function getForServe(pmKey: number): Promise<{ pmKey: number; pmEntry: string } | null> {
  await ensurePolicyMapTable();
  await requireUsr();
  const key = Number(pmKey);
  if (!Number.isInteger(key) || key < 1) return null;
  const [row] = await db
    .select({
      pmKey: policyMap.pmKey,
      pmEntry: policyMap.pmEntry,
      pmIsDel: policyMap.pmIsDel,
    })
    .from(policyMap)
    .where(eq(policyMap.pmKey, key))
    .limit(1);
  if (!row || row.pmIsDel) return null;
  return { pmKey: row.pmKey, pmEntry: row.pmEntry || 'index.html' };
}
