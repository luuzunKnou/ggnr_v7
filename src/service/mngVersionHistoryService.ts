/**
 * 버전관리·소스 업로드 공통 이력
 */
import { pool } from '@/database/db';
import { db } from '@/database/db';
import { mvh } from '@/database/schema/mng_version_history';
import { coerceHistoryOptions, normalizeHistoryMemo, normalizeHistoryOptions } from '@/lib/versionHistoryMessage';
import { and, desc, eq, gte, ilike, lt, or, sql } from 'drizzle-orm';

export type VersionHistoryType = 'source_upload' | 'install_zip' | 'apply_latest';

export type VersionHistoryFilter =
  | VersionHistoryType
  | 'version_all'
  | 'source_upload_only'
  | 'source_all';

export type VersionHistoryRow = {
  mvhKey: number;
  mvhHistoryType: string;
  mvhStatus: string;
  mvhMessage: string | null;
  mvhOption: string[] | null;
  mvhMemo: string | null;
  mvhIp: string | null;
  mvhClientHost: string | null;
  mvhCreateDate: Date | string | null;
};

let tableEnsured = false;

/**
 * 테이블이 없을 때만 생성. 기존 테이블 ALTER는 하지 않음 (DB는 운영자가 적용).
 * DROP 후 재실행 시 이 CREATE로 새 컬럼 포함 재생성.
 */
async function ensureVersionHistoryTable(): Promise<void> {
  if (tableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "mng_version_history" (
      "mvh_key" serial PRIMARY KEY NOT NULL,
      "mvh_history_type" varchar(40) NOT NULL,
      "mvh_status" varchar(20) NOT NULL,
      "mvh_message" text,
      "mvh_option" jsonb,
      "mvh_memo" text,
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
  option?: string[] | null;
  memo?: string | null;
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
        mvhMessage: params.message?.trim() ? params.message.trim() : null,
        mvhOption: normalizeHistoryOptions(params.option ?? null),
        mvhMemo: normalizeHistoryMemo(params.memo ?? null),
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
  /** 통합검색 키워드 (날짜·기능구분·성공실패·IP·선택·메모·본문) */
  q?: string;
  limit?: number;
}): Promise<{ success: boolean; data: VersionHistoryRow[]; error?: string }> {
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  try {
    await ensureVersionHistoryTable();
    const conditions = [];

    if (params.filter === 'source_upload_only') {
      conditions.push(eq(mvh.mvhHistoryType, 'source_upload'));
    } else if (params.filter === 'source_all') {
      conditions.push(sql`${mvh.mvhHistoryType} IN ('source_upload', 'install_zip')`);
    } else if (params.filter === 'version_all') {
      conditions.push(eq(mvh.mvhHistoryType, 'apply_latest'));
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

    const q = params.q?.trim();
    if (q) {
      const pattern = `%${q}%`;
      conditions.push(
        or(
          ilike(mvh.mvhMessage, pattern),
          ilike(mvh.mvhMemo, pattern),
          ilike(mvh.mvhIp, pattern),
          ilike(mvh.mvhClientHost, pattern),
          ilike(mvh.mvhStatus, pattern),
          ilike(mvh.mvhHistoryType, pattern),
          sql`CAST(${mvh.mvhOption} AS text) ILIKE ${pattern}`,
          sql`(CASE WHEN ${mvh.mvhStatus} = 'success' THEN '성공' ELSE '실패' END) ILIKE ${pattern}`,
          sql`(CASE
            WHEN ${mvh.mvhHistoryType} = 'source_upload' THEN '소스코드 업로드'
            WHEN ${mvh.mvhHistoryType} = 'install_zip' THEN '설치파일 다운로드'
            WHEN ${mvh.mvhHistoryType} = 'apply_latest' THEN '최신 소스 적용'
            ELSE ${mvh.mvhHistoryType}
          END) ILIKE ${pattern}`,
          sql`to_char(${mvh.mvhCreateDate} AT TIME ZONE 'Asia/Seoul', 'YYYY.MM.DD HH24:MI:SS') ILIKE ${pattern}`,
          sql`to_char(${mvh.mvhCreateDate} AT TIME ZONE 'Asia/Seoul', 'YYYY.MM.DD') ILIKE ${pattern}`,
          sql`to_char(${mvh.mvhCreateDate} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') ILIKE ${pattern}`
        )!
      );
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
        mvhOption: coerceHistoryOptions(r.mvhOption),
        mvhMemo: r.mvhMemo,
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
