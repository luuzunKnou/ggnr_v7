/**
 * Excel Upload History Service
 * - excel_upload_history CRUD
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { db } from '@/database/db';
import { eh } from '@/database/schema/excel_upload_history';
import { sql, desc, eq } from 'drizzle-orm';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
/** 로그 파일 최대 읽기 크기 (2MB) — 그 이상은 잘림 */
const MAX_LOG_BYTES = 2 * 1024 * 1024;

export type ExcelHistoryRow = {
  ehKey: number;
  ehSourcePath: string | null;
  ehTableName: string | null;
  ehTableKorName: string | null;
  ehGroup: string | null;
  ehRowCount: number | null;
  ehResult: string | null;
  ehContents: string | null;
  ehCreateDate: Date | string | null;
  ehCreateUser: number | null;
  ehGeocodingHeaderKor: string | null;
  ehGeocodingHeaderEng: string | null;
  ehGeometryType: string | null;
};

/** Excel 이력 1건 생성 (도형 대상 컬럼 한글/영문·도형타입 저장 → 다음 업로드 시 자동 불러오기용) */
export async function createExcelHistory(params: {
  sourcePath?: string;
  tableName: string;
  tableKorName?: string;
  group?: string;
  rowCount?: number;
  result?: string;
  contents?: string;
  createUser?: number;
  geocodingHeaderKor?: string;
  geocodingHeaderEng?: string;
  geometryType?: string;
}): Promise<{ success: boolean; ehKey?: number; error?: string }> {
  try {
    const rows = await db
      .insert(eh)
      .values({
        ehSourcePath: params.sourcePath ?? null,
        ehTableName: params.tableName,
        ehTableKorName: params.tableKorName ?? null,
        ehGroup: params.group ?? null,
        ehRowCount: params.rowCount ?? null,
        ehResult: params.result ?? null,
        ehContents: params.contents ?? null,
        ehCreateDate: new Date(),
        ehCreateUser: params.createUser ?? null,
        ehGeocodingHeaderKor: params.geocodingHeaderKor ?? null,
        ehGeocodingHeaderEng: params.geocodingHeaderEng ?? null,
        ehGeometryType: params.geometryType ?? null,
      })
      .returning({ ehKey: eh.ehKey });
    return { success: true, ehKey: rows[0]?.ehKey };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/** Excel 이력 목록 조회 (페이징) */
export async function getExcelHistoryList(params?: {
  page?: number;
  limit?: number;
}): Promise<{ success: boolean; data: ExcelHistoryRow[]; total: number; error?: string }> {
  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.min(100, Math.max(1, params?.limit ?? 20));
  const offset = (page - 1) * limit;
  try {
    const [rows, countRes] = await Promise.all([
      db.select().from(eh).orderBy(desc(eh.ehKey)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(eh),
    ]);
    const total = countRes[0]?.count ?? 0;
    return {
      success: true,
      data: rows.map((r) => ({
        ehKey: r.ehKey,
        ehSourcePath: r.ehSourcePath,
        ehTableName: r.ehTableName,
        ehTableKorName: r.ehTableKorName,
        ehGroup: r.ehGroup,
        ehRowCount: r.ehRowCount,
        ehResult: r.ehResult,
        ehContents: r.ehContents,
        ehCreateDate: r.ehCreateDate,
        ehCreateUser: r.ehCreateUser,
        ehGeocodingHeaderKor: r.ehGeocodingHeaderKor ?? null,
        ehGeocodingHeaderEng: r.ehGeocodingHeaderEng ?? null,
        ehGeometryType: r.ehGeometryType ?? null,
      })),
      total,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, data: [], total: 0, error: msg };
  }
}

/** 테이블별 최신 이력 1건 (eh_table_name 기준, eh_create_date 내림). 도형 대상 컬럼·도형타입 포함 → 다음 업로드 시 자동 불러오기용 */
export async function getLatestExcelHistoryByTables(): Promise<{
  success: boolean;
  map: Record<string, {
    sourcePath: string | null;
    createDate: Date | string | null;
    geocodingHeaderKor: string | null;
    geocodingHeaderEng: string | null;
    geometryType: string | null;
  }>;
  error?: string;
}> {
  try {
    const rows = await db
      .select({
        ehTableName: eh.ehTableName,
        ehSourcePath: eh.ehSourcePath,
        ehCreateDate: eh.ehCreateDate,
        ehGeocodingHeaderKor: eh.ehGeocodingHeaderKor,
        ehGeocodingHeaderEng: eh.ehGeocodingHeaderEng,
        ehGeometryType: eh.ehGeometryType,
      })
      .from(eh)
      .orderBy(eh.ehTableName, desc(eh.ehCreateDate));
    const map: Record<string, {
      sourcePath: string | null;
      createDate: Date | string | null;
      geocodingHeaderKor: string | null;
      geocodingHeaderEng: string | null;
      geometryType: string | null;
    }> = {};
    for (const r of rows) {
      const name = r.ehTableName ?? '';
      if (name && !map[name]) {
        map[name] = {
          sourcePath: r.ehSourcePath ?? null,
          createDate: r.ehCreateDate ?? null,
          geocodingHeaderKor: r.ehGeocodingHeaderKor ?? null,
          geocodingHeaderEng: r.ehGeocodingHeaderEng ?? null,
          geometryType: r.ehGeometryType ?? null,
        };
      }
    }
    return { success: true, map };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, map: {}, error: msg };
  }
}

/** 테이블명으로 해당 테이블의 최신 이력 1건 조회 (재업로드 시 도형대상 컬럼·도형타입 등 자동 불러오기용). API 호출 시 params: { tableName } */
export async function getLatestExcelHistoryByTable(params: { tableName?: string }): Promise<{
  success: boolean;
  data: ExcelHistoryRow | null;
  error?: string;
}> {
  const tableName = params?.tableName?.trim();
  if (!tableName) {
    return { success: true, data: null };
  }
  try {
    const rows = await db
      .select()
      .from(eh)
      .where(eq(eh.ehTableName, tableName))
      .orderBy(desc(eh.ehCreateDate))
      .limit(1);
    const r = rows[0];
    if (!r) return { success: true, data: null };
    return {
      success: true,
      data: {
        ehKey: r.ehKey,
        ehSourcePath: r.ehSourcePath,
        ehTableName: r.ehTableName,
        ehTableKorName: r.ehTableKorName,
        ehGroup: r.ehGroup,
        ehRowCount: r.ehRowCount,
        ehResult: r.ehResult,
        ehContents: r.ehContents,
        ehCreateDate: r.ehCreateDate,
        ehCreateUser: r.ehCreateUser,
        ehGeocodingHeaderKor: r.ehGeocodingHeaderKor ?? null,
        ehGeocodingHeaderEng: r.ehGeocodingHeaderEng ?? null,
        ehGeometryType: r.ehGeometryType ?? null,
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, data: null, error: msg };
  }
}

/**
 * 이력의 엑셀 경로와 동일 폴더·동일 basename의 `.log` 내용을 읽는다.
 * writeExcelWizardLog 와 같은 경로 규칙.
 */
export async function getExcelHistoryLog(params: {
  sourcePath?: string;
}): Promise<{
  success: boolean;
  content?: string;
  logPath?: string;
  truncated?: boolean;
  error?: string;
}> {
  const sourcePath = params?.sourcePath?.trim();
  if (!sourcePath) {
    return { success: false, error: '파일 경로가 없습니다.' };
  }

  const relative = sourcePath.replace(/\//g, path.sep).replace(/^[/\\]+/, '');
  const absoluteDir = path.join(GGNR_DATA_DIR, path.dirname(relative));
  const base = path.basename(relative).replace(/\.xlsx?$/i, '');
  const logAbs = path.resolve(absoluteDir, `${base}.log`);
  const dataRoot = path.resolve(GGNR_DATA_DIR);
  const relToRoot = path.relative(dataRoot, logAbs);
  if (!relToRoot || relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    return { success: false, error: '허용되지 않은 경로입니다.' };
  }

  const logRelative = relToRoot.replace(/\\/g, '/');

  try {
    const stat = await fs.stat(logAbs);
    if (!stat.isFile()) {
      return { success: false, logPath: logRelative, error: '로그 파일이 없습니다.' };
    }
    const buf = await fs.readFile(logAbs);
    const truncated = buf.length > MAX_LOG_BYTES;
    const slice = truncated ? buf.subarray(0, MAX_LOG_BYTES) : buf;
    let content = slice.toString('utf-8');
    if (truncated) {
      content += `\n\n… (이하 생략: 파일이 ${MAX_LOG_BYTES}바이트를 초과합니다)`;
    }
    return { success: true, content, logPath: logRelative, truncated };
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { success: false, logPath: logRelative, error: '로그 파일이 없습니다.' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, logPath: logRelative, error: msg };
  }
}
