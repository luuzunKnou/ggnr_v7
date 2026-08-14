/**
 * Layer History Service
 * - layer_history / layer_detail_history CRUD
 */
import { db } from '@/database/db';
import { lh } from '@/database/schema/layer_history';
import { dh } from '@/database/schema/layer_detail_history';
import { archiveShpForLayerHistory, removeShpHistoryArchive } from '@/lib/shpHistoryArchive';
import { sql } from 'drizzle-orm';
import { desc, eq } from 'drizzle-orm';

/** 작업일 — KST 기준 YYYY-MM-DD (UTC toISOString().slice(0,10)는 KST 오전에 전날로 기록됨) */
function todayWorkDateString(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

export type LayerHistoryRow = {
  lhKey: number;
  lhContents: string | null;
  lhSuccessCount: number | null;
  lhFailCount: number | null;
  lhCreateUser: string | null;
  lhCreateDate: string | null;
};

export type LayerDetailRow = {
  dhKey: number;
  dhLhKey: number | null;
  dhGroup: string | null;
  dhName: string | null;
  dhKorName: string | null;
  dhType: string | null;
  dhOldData: number | null;
  dhNewData: number | null;
  dhAppendCount: number | null;
  dhConflictCount: number | null;
  dhRemoveCount: number | null;
  dhContents: string | null;
  dhResult: string | null;
  dhShpPath: string | null;
};

/** 레이어 목록 «수정 이력» 모달용 — SHP·Excel·시스템 UI 통합 행 */
export type LayerTableHistoryUnifiedRow = {
  id: string;
  /** 표시용 일시 (ISO 또는 YYYY-MM-DD) */
  date: string | null;
  /** 정렬용 epoch ms */
  sortAt: number;
  /** SHP | Excel | 서비스명 | 시스템 UI */
  sourceLabel: string;
  countOld: number | null;
  countNew: number | null;
  /** 건수 열 요약(없으면 UI에서 —) */
  countSummary: string | null;
  contents: string | null;
  result: string | null;
};

export type LayerDetailHistoryByTableRow = LayerDetailRow & {
  lhCreateDate: string | null;
  lhContents: string | null;
  /** 통합 모달용 (있으면 UI가 이 필드를 우선) */
  sourceLabel?: string;
  countSummary?: string | null;
  id?: string;
  sortAt?: number;
};

function formatCountKo(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number(n).toLocaleString('ko-KR');
}

function toSortAt(raw: unknown): number {
  if (raw == null) return 0;
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  const s = String(raw).trim();
  if (!s) return 0;
  // YYYY-MM-DD only → 당일 끝으로 (시간 없는 SHP 이력과 timestamp 비교 시 당일 배치가 뒤로 가지 않게)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(`${s}T23:59:59+09:00`);
    return Number.isFinite(t) ? t : 0;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function toDateString(raw: unknown): string | null {
  if (raw == null) return null;
  if (raw instanceof Date) return raw.toISOString();
  const s = String(raw).trim();
  return s || null;
}

function resolveUiSourceLabel(params: {
  dlSource?: string | null;
  dlServiceName?: string | null;
}): string {
  const src = String(params.dlSource ?? '').trim();
  if (src === 'SHP 업로드' || src === 'SHP') return 'SHP';
  if (src === 'Excel 업로드' || src === 'Excel') return 'Excel';
  if (src === '시스템') return '시스템 UI';
  const svc = String(params.dlServiceName ?? '').trim();
  if (
    svc &&
    svc !== '시스템' &&
    svc !== 'SHP 업로드' &&
    svc !== 'Excel 업로드' &&
    svc !== '레이어 관리(개발자모드)'
  ) {
    return svc;
  }
  return '시스템 UI';
}

function buildShpContents(dhType: string | null, dhContents: string | null, lhContents: string | null): string {
  const type = String(dhType ?? '').trim();
  const detail = String(dhContents ?? lhContents ?? '').trim();
  if (type && detail && type !== detail) return `${type} — ${detail}`;
  return type || detail || '—';
}

/**
 * 테이블별 수정 이력 — SHP(layer_detail_history) · Excel(excel_upload_history) ·
 * 시스템 UI(data_log, 업로드 미러·다운로드 제외)를 합쳐 최신순.
 */
export async function getLayerDetailHistoryByTable(params: {
  tableName: string;
  limit?: number;
}): Promise<{ success: boolean; data: LayerTableHistoryUnifiedRow[]; error?: string }> {
  const tableName = params?.tableName?.trim();
  if (!tableName) return { success: false, data: [], error: 'tableName이 필요합니다.' };
  const limit = Math.min(200, Math.max(1, params?.limit ?? 50));
  const perSource = Math.min(200, Math.max(limit, 50));

  try {
    const unified: LayerTableHistoryUnifiedRow[] = [];

    // 1) SHP 업로드 배치
    try {
      const shpRes = await db.execute(sql`
        SELECT
          dh.dh_key AS "dhKey",
          dh.dh_type AS "dhType",
          dh.dh_old_data AS "dhOldData",
          dh.dh_new_data AS "dhNewData",
          dh.dh_contents AS "dhContents",
          dh.dh_result AS "dhResult",
          lh.lh_create_date AS "lhCreateDate",
          lh.lh_contents AS "lhContents"
        FROM layer_detail_history dh
        JOIN layer_history lh ON dh.dh_lh_key = lh.lh_key
        WHERE LOWER(dh.dh_name) = LOWER(${tableName})
        ORDER BY lh.lh_key DESC, dh.dh_key DESC
        LIMIT ${perSource}
      `);
      for (const r of (shpRes.rows as Array<{
        dhKey: number;
        dhType: string | null;
        dhOldData: number | null;
        dhNewData: number | null;
        dhContents: string | null;
        dhResult: string | null;
        lhCreateDate: string | null;
        lhContents: string | null;
      }>) ?? []) {
        const oldN = r.dhOldData != null ? Number(r.dhOldData) : null;
        const newN = r.dhNewData != null ? Number(r.dhNewData) : null;
        unified.push({
          id: `shp-${r.dhKey}`,
          date: toDateString(r.lhCreateDate),
          sortAt: toSortAt(r.lhCreateDate),
          sourceLabel: 'SHP',
          countOld: Number.isFinite(oldN as number) ? oldN : null,
          countNew: Number.isFinite(newN as number) ? newN : null,
          countSummary:
            oldN != null || newN != null
              ? `${formatCountKo(oldN)} → ${formatCountKo(newN)}`
              : null,
          contents: buildShpContents(r.dhType, r.dhContents, r.lhContents),
          result: r.dhResult,
        });
      }
    } catch {
      /* SHP 이력 테이블 없거나 조회 실패 시 나머지 출처만 */
    }

    // 2) Excel 업로드 배치
    try {
      const excelRes = await db.execute(sql`
        SELECT
          eh.eh_key AS "ehKey",
          eh.eh_old_row_count AS "ehOldRowCount",
          eh.eh_row_count AS "ehRowCount",
          eh.eh_contents AS "ehContents",
          eh.eh_result AS "ehResult",
          eh.eh_create_date AS "ehCreateDate"
        FROM excel_upload_history eh
        WHERE LOWER(eh.eh_table_name) = LOWER(${tableName})
        ORDER BY eh.eh_key DESC
        LIMIT ${perSource}
      `);
      for (const r of (excelRes.rows as Array<{
        ehKey: number;
        ehOldRowCount: number | null;
        ehRowCount: number | null;
        ehContents: string | null;
        ehResult: string | null;
        ehCreateDate: string | Date | null;
      }>) ?? []) {
        const oldN = r.ehOldRowCount != null ? Number(r.ehOldRowCount) : null;
        const newN = r.ehRowCount != null ? Number(r.ehRowCount) : null;
        const contents = String(r.ehContents ?? '').trim() || 'Excel 업로드';
        unified.push({
          id: `excel-${r.ehKey}`,
          date: toDateString(r.ehCreateDate),
          sortAt: toSortAt(r.ehCreateDate),
          sourceLabel: 'Excel',
          countOld: Number.isFinite(oldN as number) ? oldN : null,
          countNew: Number.isFinite(newN as number) ? newN : null,
          countSummary:
            oldN != null || newN != null
              ? `${formatCountKo(oldN)} → ${formatCountKo(newN)}`
              : null,
          contents,
          result: r.ehResult,
        });
      }
    } catch {
      /* Excel 이력 없으면 스킵 */
    }

    // 3) 시스템 UI·기타 (업로드 미러·다운로드·되돌리기·조회·저장 제외)
    try {
      const sysRes = await db.execute(sql`
        SELECT
          dl.dl_key AS "dlKey",
          dl.dl_date AS "dlDate",
          dl.dl_source AS "dlSource",
          dl.dl_service_name AS "dlServiceName",
          dl.dl_type AS "dlType",
          dl.dl_contents AS "dlContents"
        FROM data_log dl
        WHERE LOWER(dl.dl_table_name) = LOWER(${tableName})
          AND COALESCE(dl.dl_source, '') NOT IN ('SHP 업로드', 'Excel 업로드', '레이어 관리(개발자모드)')
          AND COALESCE(dl.dl_type, '') IN ('추가', '수정', '삭제')
          AND (dl.dl_batch_key IS NULL OR btrim(dl.dl_batch_key) = '')
        ORDER BY dl.dl_date DESC NULLS LAST, dl.dl_key DESC
        LIMIT ${perSource}
      `);
      for (const r of (sysRes.rows as Array<{
        dlKey: number;
        dlDate: string | Date | null;
        dlSource: string | null;
        dlServiceName: string | null;
        dlType: string | null;
        dlContents: string | null;
      }>) ?? []) {
        const type = String(r.dlType ?? '').trim();
        const detail = String(r.dlContents ?? '').trim();
        const contents =
          type && detail && !detail.startsWith(type) ? `${type} — ${detail}` : type || detail || '—';
        unified.push({
          id: `dl-${r.dlKey}`,
          date: toDateString(r.dlDate),
          sortAt: toSortAt(r.dlDate),
          sourceLabel: resolveUiSourceLabel({
            dlSource: r.dlSource,
            dlServiceName: r.dlServiceName,
          }),
          countOld: null,
          countNew: null,
          countSummary: null,
          contents,
          result: '성공',
        });
      }
    } catch {
      /* data_log 미적용 환경 */
    }

    unified.sort((a, b) => b.sortAt - a.sortAt || b.id.localeCompare(a.id));
    return { success: true, data: unified.slice(0, limit) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, data: [], error: msg };
  }
}

/**
 * 테이블별 최신 통합 이력일 (목록 갱신일용).
 * SHP · Excel · 시스템 UI(data_log) 중 가장 최근.
 */
export async function getLatestHistoryDatesByTables(params?: {
  tableNames?: string[];
}): Promise<{ success: boolean; dates: Record<string, string>; error?: string }> {
  const names = (params?.tableNames ?? [])
    .map((n) => String(n ?? '').trim())
    .filter(Boolean);
  const dates: Record<string, string> = {};

  const pickLatest = (table: string, raw: unknown) => {
    const key = table.toLowerCase();
    const next = toDateString(raw);
    if (!next) return;
    const prev = dates[key];
    if (!prev || toSortAt(next) >= toSortAt(prev)) {
      dates[key] = next;
    }
  };

  try {
    const nameFilter =
      names.length > 0
        ? sql`AND LOWER(dh.dh_name) IN (${sql.join(
            names.map((n) => sql`${n.toLowerCase()}`),
            sql`, `
          )})`
        : sql``;
    try {
      const shpRes = await db.execute(sql`
        SELECT LOWER(dh.dh_name) AS "tableName", MAX(lh.lh_create_date) AS "lastDate"
        FROM layer_detail_history dh
        JOIN layer_history lh ON dh.dh_lh_key = lh.lh_key
        WHERE dh.dh_result IN ('성공', '대기')
        ${nameFilter}
        GROUP BY LOWER(dh.dh_name)
      `);
      for (const r of (shpRes.rows as Array<{ tableName: string; lastDate: string | null }>) ?? []) {
        if (r.tableName) pickLatest(r.tableName, r.lastDate);
      }
    } catch {
      /* ignore */
    }

    const excelNameFilter =
      names.length > 0
        ? sql`AND LOWER(eh.eh_table_name) IN (${sql.join(
            names.map((n) => sql`${n.toLowerCase()}`),
            sql`, `
          )})`
        : sql``;
    try {
      const excelRes = await db.execute(sql`
        SELECT LOWER(eh.eh_table_name) AS "tableName", MAX(eh.eh_create_date) AS "lastDate"
        FROM excel_upload_history eh
        WHERE (eh.eh_result IN ('성공', '대기') OR eh.eh_result IS NULL)
        ${excelNameFilter}
        GROUP BY LOWER(eh.eh_table_name)
      `);
      for (const r of (excelRes.rows as Array<{ tableName: string; lastDate: string | Date | null }>) ?? []) {
        if (r.tableName) pickLatest(r.tableName, r.lastDate);
      }
    } catch {
      /* ignore */
    }

    const dlNameFilter =
      names.length > 0
        ? sql`AND LOWER(dl.dl_table_name) IN (${sql.join(
            names.map((n) => sql`${n.toLowerCase()}`),
            sql`, `
          )})`
        : sql``;
    try {
      const dlRes = await db.execute(sql`
        SELECT LOWER(dl.dl_table_name) AS "tableName", MAX(dl.dl_date) AS "lastDate"
        FROM data_log dl
        WHERE COALESCE(dl.dl_source, '') NOT IN ('SHP 업로드', 'Excel 업로드', '레이어 관리(개발자모드)')
          AND COALESCE(dl.dl_type, '') IN ('추가', '수정', '삭제')
          AND (dl.dl_batch_key IS NULL OR btrim(dl.dl_batch_key) = '')
        ${dlNameFilter}
        GROUP BY LOWER(dl.dl_table_name)
      `);
      for (const r of (dlRes.rows as Array<{ tableName: string; lastDate: string | Date | null }>) ?? []) {
        if (r.tableName) pickLatest(r.tableName, r.lastDate);
      }
    } catch {
      /* ignore */
    }

    return { success: true, dates };
  } catch (e: unknown) {
    return {
      success: false,
      dates,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 이력 목록 조회 (페이징) */
export async function getLayerHistoryList(params?: {
  page?: number;
  limit?: number;
}): Promise<{ success: boolean; data: LayerHistoryRow[]; total: number; error?: string }> {
  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.min(100, Math.max(1, params?.limit ?? 20));
  const offset = (page - 1) * limit;
  try {
    const [rows, countRes] = await Promise.all([
      db.select().from(lh).orderBy(desc(lh.lhKey)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(lh),
    ]);
    const total = countRes[0]?.count ?? 0;
    return {
      success: true,
      data: rows.map((r) => ({
        lhKey: r.lhKey,
        lhContents: r.lhContents,
        lhSuccessCount: r.lhSuccessCount,
        lhFailCount: r.lhFailCount,
        lhCreateUser: r.lhCreateUser,
        lhCreateDate: r.lhCreateDate,
      })),
      total,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, data: [], total: 0, error: msg };
  }
}

/** 이력 상세 목록 조회 */
export async function getLayerDetailHistory(params: {
  lhKey: number;
}): Promise<{ success: boolean; data: LayerDetailRow[]; error?: string }> {
  const lhKey = params?.lhKey;
  if (!lhKey) return { success: false, data: [], error: 'lhKey가 필요합니다.' };
  try {
    const rows = await db.select().from(dh).where(eq(dh.dhLhKey, lhKey)).orderBy(dh.dhKey);
    return {
      success: true,
      data: rows.map((r) => ({
        dhKey: r.dhKey,
        dhLhKey: r.dhLhKey,
        dhGroup: r.dhGroup,
        dhName: r.dhName,
        dhKorName: r.dhKorName,
        dhType: r.dhType,
        dhOldData: r.dhOldData,
        dhNewData: r.dhNewData,
        dhAppendCount: r.dhAppendCount,
        dhConflictCount: r.dhConflictCount,
        dhRemoveCount: r.dhRemoveCount,
        dhContents: r.dhContents,
        dhResult: r.dhResult,
        dhShpPath: r.dhShpPath,
      })),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, data: [], error: msg };
  }
}

/** 이력 1건 생성 → lhKey 반환 */
export async function createLayerHistory(params: {
  contents: string;
  successCount: number;
  failCount: number;
  /** 작업자 — `usrId(usrName)` 또는 표시 문자열 */
  createUser?: string | number | null;
}): Promise<{ success: boolean; lhKey?: number; error?: string }> {
  try {
    const createUser =
      params.createUser == null || params.createUser === ''
        ? null
        : String(params.createUser).trim() || null;
    const rows = await db.insert(lh).values({
      lhContents: params.contents,
      lhSuccessCount: params.successCount,
      lhFailCount: params.failCount,
      lhCreateUser: createUser,
      lhCreateDate: todayWorkDateString(),
    }).returning({ lhKey: lh.lhKey });
    return { success: true, lhKey: rows[0]?.lhKey };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/** 상세 이력 결과 업데이트 (대기→성공, 롤백 등. eager-create된 placeholder row 마무리에도 사용) */
export async function updateDetailResult(params: {
  dhKey: number;
  result: string;
  contents?: string;
  newData?: number;
  type?: string;
  group?: string;
  korName?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!params?.dhKey) return { success: false, error: 'dhKey가 필요합니다.' };
  try {
    const updates: Record<string, unknown> = { dhResult: params.result };
    if (params.contents !== undefined) updates.dhContents = params.contents;
    if (params.newData !== undefined) updates.dhNewData = params.newData;
    if (params.type !== undefined) updates.dhType = params.type;
    if (params.group !== undefined) updates.dhGroup = params.group;
    if (params.korName !== undefined) updates.dhKorName = params.korName;
    await db.update(dh).set(updates).where(eq(dh.dhKey, params.dhKey));
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 상세 이력 이전/현재/추가/변경/삭제 건수 갱신 (과거 기록 백필 + 처리 완료 시 최종 반영 용도로 공용 사용) */
export async function updateDetailCounts(params: {
  dhKey: number;
  oldData?: number;
  newData?: number;
  appendCount?: number;
  conflictCount?: number;
  removeCount?: number;
}): Promise<{ success: boolean; error?: string }> {
  if (!params?.dhKey) return { success: false, error: 'dhKey가 필요합니다.' };
  try {
    const updates: Record<string, unknown> = {};
    if (params.oldData !== undefined) updates.dhOldData = params.oldData;
    if (params.newData !== undefined) updates.dhNewData = params.newData;
    if (params.appendCount !== undefined) updates.dhAppendCount = params.appendCount;
    if (params.conflictCount !== undefined) updates.dhConflictCount = params.conflictCount;
    if (params.removeCount !== undefined) updates.dhRemoveCount = params.removeCount;
    if (Object.keys(updates).length === 0) return { success: true };
    await db.update(dh).set(updates).where(eq(dh.dhKey, params.dhKey));
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 배치 이력(lh) 결과 업데이트 (eager-create된 placeholder row를 처리 완료 후 마무리할 때 사용) */
export async function updateLayerHistory(params: {
  lhKey: number;
  contents?: string;
  successCount?: number;
  failCount?: number;
}): Promise<{ success: boolean; error?: string }> {
  if (!params?.lhKey) return { success: false, error: 'lhKey가 필요합니다.' };
  try {
    const updates: Record<string, unknown> = {};
    if (params.contents !== undefined) updates.lhContents = params.contents;
    if (params.successCount !== undefined) updates.lhSuccessCount = params.successCount;
    if (params.failCount !== undefined) updates.lhFailCount = params.failCount;
    if (Object.keys(updates).length === 0) return { success: true };
    await db.update(lh).set(updates).where(eq(lh.lhKey, params.lhKey));
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 상세 이력 1건 즉시 생성 (placeholder) → dhKey 반환. 처리 시작 전 실제 dhKey를 확보해 sync_log와 연결하기 위한 용도.
 * shpPath가 있으면 GGNR_DATA_DIR/shp_history/{dhKey}/ 로 복사 후 그 경로를 저장한다. */
export async function createLayerDetailHistoryDraft(params: {
  lhKey: number;
  group?: string;
  name: string;
  korName?: string;
  type: string;
  shpPath?: string;
}): Promise<{ success: boolean; dhKey?: number; error?: string }> {
  if (!params?.lhKey || !params?.name) return { success: false, error: 'lhKey와 name이 필요합니다.' };
  try {
    const sourcePath = params.shpPath?.trim() || null;
    const rows = await db.insert(dh).values({
      dhLhKey: params.lhKey,
      dhGroup: params.group ?? null,
      dhName: params.name,
      dhKorName: params.korName ?? null,
      dhType: params.type,
      dhResult: '진행중',
      dhShpPath: sourcePath,
    }).returning({ dhKey: dh.dhKey });
    const dhKey = rows[0]?.dhKey;
    if (dhKey != null && sourcePath) {
      const archived = await archiveShpForLayerHistory({ dhKey, sourceRelativePath: sourcePath });
      if (archived && archived !== sourcePath) {
        await db.update(dh).set({ dhShpPath: archived }).where(eq(dh.dhKey, dhKey));
      }
    }
    return { success: true, dhKey };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 상세 이력 여러 건 일괄 INSERT. shpPath가 있으면 건별 shp_history 스냅샷 경로로 저장. */
export async function createLayerDetailHistoryBatch(params: {
  lhKey: number;
  details: Array<{
    group?: string;
    name: string;
    korName?: string;
    type: string;
    oldData?: number;
    newData?: number;
    appendCount?: number;
    conflictCount?: number;
    removeCount?: number;
    contents?: string;
    result: string;
    shpPath?: string;
  }>;
}): Promise<{ success: boolean; error?: string }> {
  if (!params.details?.length) return { success: true };
  try {
    const values = params.details.map((d) => ({
      dhLhKey: params.lhKey,
      dhGroup: d.group ?? null,
      dhName: d.name,
      dhKorName: d.korName ?? null,
      dhType: d.type,
      dhOldData: d.oldData ?? null,
      dhNewData: d.newData ?? null,
      dhAppendCount: d.appendCount ?? null,
      dhConflictCount: d.conflictCount ?? null,
      dhRemoveCount: d.removeCount ?? null,
      dhContents: d.contents ?? null,
      dhResult: d.result,
      dhShpPath: d.shpPath?.trim() || null,
    }));
    const inserted = await db.insert(dh).values(values).returning({
      dhKey: dh.dhKey,
      dhShpPath: dh.dhShpPath,
    });
    for (const row of inserted) {
      const sourcePath = row.dhShpPath?.trim();
      if (!sourcePath || row.dhKey == null) continue;
      const archived = await archiveShpForLayerHistory({
        dhKey: row.dhKey,
        sourceRelativePath: sourcePath,
      });
      if (archived && archived !== sourcePath) {
        await db.update(dh).set({ dhShpPath: archived }).where(eq(dh.dhKey, row.dhKey));
      }
    }
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * 위저드 작업 취소(닫기).
 * - 이번 lh에 묶인 반영 건을 먼저 롤백한 뒤, 관련 sync_log·상세·배치 이력 삭제
 * - 업로드 shp_data SHP는 유지. shp_history/{dhKey} 스냅샷만 삭제
 */
export async function abortIncompleteLayerHistory(params: {
  lhKey: number;
}): Promise<{ success: boolean; error?: string; code?: 'not_found' | 'rollback_failed'; rolledBackCount?: number }> {
  const lhKey = Math.floor(Number(params?.lhKey));
  if (!Number.isFinite(lhKey) || lhKey <= 0) {
    return { success: false, error: 'lhKey가 필요합니다.' };
  }
  try {
    const lhRows = await db.select({ lhKey: lh.lhKey }).from(lh).where(eq(lh.lhKey, lhKey)).limit(1);
    // 이미 없거나 다른 경로에서 정리된 경우 — 닫기 허용
    if (lhRows.length === 0) {
      return { success: true, code: 'not_found' };
    }

    const detailRows = await db
      .select({ dhKey: dh.dhKey, dhName: dh.dhName })
      .from(dh)
      .where(eq(dh.dhLhKey, lhKey));

    const dhKeys = detailRows.map((r) => r.dhKey).filter((k) => Number.isFinite(k) && k > 0);
    let rolledBackCount = 0;

    if (dhKeys.length > 0) {
      const appliedRes = await db.execute(sql`
        SELECT sl_key AS "slKey"
        FROM sync_log
        WHERE sl_dh_key IN (${sql.join(dhKeys.map((k) => sql`${k}`), sql`, `)})
          AND sl_operation IS NOT NULL
          AND sl_rolled_back = false
        ORDER BY sl_key DESC
      `);
      const slKeys = (appliedRes.rows as Array<{ slKey: number }>)
        .map((r) => Math.floor(Number(r.slKey)))
        .filter((k) => Number.isFinite(k) && k > 0);

      if (slKeys.length > 0) {
        const { rollbackSyncRows } = await import('./shpUploadService');
        const rb = await rollbackSyncRows({ slKeys });
        if (!rb.success) {
          return {
            success: false,
            error: rb.error ?? '반영 데이터 롤백에 실패했습니다. 이력을 삭제하지 않았습니다.',
            code: 'rollback_failed',
            rolledBackCount: rb.rolledBackCount ?? 0,
          };
        }
        rolledBackCount = rb.rolledBackCount ?? 0;
      }

      // 상세 키에 묶인 로그 삭제 — FK(sl_dh_key → dh). 롤백·유지 건 포함
      await db.execute(sql`
        DELETE FROM sync_log
        WHERE sl_dh_key IN (${sql.join(dhKeys.map((k) => sql`${k}`), sql`, `)})
      `);
    }

    const tableNames = [
      ...new Set(
        detailRows
          .map((r) => String(r.dhName ?? '').trim())
          .filter((n) => n.length > 0)
      ),
    ];
    // 비교 직후 미결은 sl_dh_key가 NULL인 경우가 많음 → 이번 작업 테이블 범위의 미결만 삭제
    if (tableNames.length > 0) {
      await db.execute(sql`
        DELETE FROM sync_log
        WHERE sl_operation IS NULL
          AND LOWER(sl_table_name) IN (${sql.join(
            tableNames.map((n) => sql`${n.toLowerCase()}`),
            sql`, `
          )})
      `);
      try {
        const { dropShpSyncTempTablesForNames } = await import('./shpUploadService');
        await dropShpSyncTempTablesForNames({ tableNames });
      } catch {
        /* best-effort */
      }
    }

    await db.delete(dh).where(eq(dh.dhLhKey, lhKey));
    await db.delete(lh).where(eq(lh.lhKey, lhKey));
    for (const k of dhKeys) {
      await removeShpHistoryArchive(k);
    }
    return { success: true, rolledBackCount };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
