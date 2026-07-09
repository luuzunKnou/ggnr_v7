/**
 * 버전관리·소스 업로드 공통 이력
 */
import { pool } from '@/database/db';
import { db } from '@/database/db';
import { mvh } from '@/database/schema/mng_version_history';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';

export type VersionHistoryType = 'source_upload' | 'install_zip' | 'apply_latest';

export type VersionHistoryFilter =
  | VersionHistoryType
  | 'version_all'
  | 'source_upload_only';

export type VersionHistoryRow = {
  mvhKey: number;
  mvhHistoryType: string;
  mvhStatus: string;
  mvhMessage: string | null;
  mvhIp: string | null;
  mvhClientHost: string | null;
  mvhCreateDate: Date | string | null;
};

let tableEnsured = false;

async function ensureVersionHistoryTable(): Promise<void> {
  if (tableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "mng_version_history" (
      "mvh_key" serial PRIMARY KEY NOT NULL,
      "mvh_history_type" varchar(40) NOT NULL,
      "mvh_status" varchar(20) NOT NULL,
      "mvh_message" text,
      "mvh_ip" varchar(64),
      "mvh_client_host" varchar(500),
      "mvh_create_date" timestamp
    );
  `);
  tableEnsured = true;
}

function historyTypeLabel(type: string): string {
  switch (type) {
    case 'source_upload':
      return '소스코드 업로드';
    case 'install_zip':
      return '설치파일 다운로드';
    case 'apply_latest':
      return '최신 소스 적용';
    default:
      return type;
  }
}

export { historyTypeLabel };

export async function recordVersionHistory(params: {
  historyType: VersionHistoryType;
  status: 'success' | 'fail';
  message?: string;
  ip?: string;
  clientHost?: string;
}): Promise<{ ok: boolean; mvhKey?: number; error?: string }> {
  try {
    await ensureVersionHistoryTable();
    const rows = await db
      .insert(mvh)
      .values({
        mvhHistoryType: params.historyType,
        mvhStatus: params.status,
        mvhMessage: params.message ?? null,
        mvhIp: params.ip ?? null,
        mvhClientHost: params.clientHost ?? null,
        mvhCreateDate: new Date(),
      })
      .returning({ mvhKey: mvh.mvhKey });
    return { ok: true, mvhKey: rows[0]?.mvhKey };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

function parseYmdRange(dateYmd: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  const start = new Date(`${dateYmd}T00:00:00.000+09:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export async function listVersionHistory(params: {
  filter: VersionHistoryFilter;
  dateYmd?: string;
  limit?: number;
}): Promise<{ success: boolean; data: VersionHistoryRow[]; error?: string }> {
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  try {
    await ensureVersionHistoryTable();
    const conditions = [];

    if (params.filter === 'source_upload_only') {
      conditions.push(eq(mvh.mvhHistoryType, 'source_upload'));
    } else if (params.filter === 'version_all') {
      conditions.push(
        sql`${mvh.mvhHistoryType} IN ('install_zip', 'apply_latest')`
      );
    } else {
      conditions.push(eq(mvh.mvhHistoryType, params.filter));
    }

    if (params.dateYmd) {
      const range = parseYmdRange(params.dateYmd);
      if (range) {
        conditions.push(gte(mvh.mvhCreateDate, range.start));
        conditions.push(lt(mvh.mvhCreateDate, range.end));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db
      .select()
      .from(mvh)
      .where(whereClause)
      .orderBy(desc(mvh.mvhKey))
      .limit(limit);

    return {
      success: true,
      data: rows.map((r) => ({
        mvhKey: r.mvhKey,
        mvhHistoryType: r.mvhHistoryType,
        mvhStatus: r.mvhStatus,
        mvhMessage: r.mvhMessage,
        mvhIp: r.mvhIp,
        mvhClientHost: r.mvhClientHost,
        mvhCreateDate: r.mvhCreateDate,
      })),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, data: [], error: msg };
  }
}
