/**
 * 데이터 이력관리 — data_log / data_detail_log 통합 조회
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import {
  formatAttrDisplayName,
  loadDefineFieldKorMap,
  loadColumnCommentMap,
} from '@/lib/dataLogFieldLabels';
import { formatTimestampWallClock } from '@/lib/formatTimestampWallClock';
import { stripGeomMetaDetailString } from './dataLogService';

export type DataHistoryWorkType =
  | '추가'
  | '수정'
  | '삭제'
  | '되돌리기'
  | '조회'
  | '저장';

export type DataHistorySource = 'SHP' | 'Excel' | '지도';

export type DataHistoryDetailAttr = {
  name: string;
  before?: string;
  after?: string;
  value?: string;
};

export type DataHistoryListItem = {
  id: string;
  source: DataHistorySource;
  sourceKey: number;
  date: string;
  userId: string;
  userName: string;
  category: string;
  groupName: string;
  layerName: string;
  keyField: string;
  keyValue: string;
  workType: DataHistoryWorkType;
  saveType?: string;
  canDetail: boolean;
};

export type DataHistoryDetail = DataHistoryListItem & {
  details: DataHistoryDetailAttr[];
};

type RawDlRow = {
  dl_key: number;
  dl_contents: string | null;
  dl_type: string | null;
  dl_user: string | null;
  dl_service_name: string | null;
  dl_date: string | Date | null;
  dl_key_field: string | null;
  dl_key_value: string | null;
  dl_table_name: string | null;
  dl_table_kor_name: string | null;
  dl_group: string | null;
  dl_source: string | null;
  dl_batch_key?: string | null;
};

function parseLhUser(raw: string | null | undefined): { userId: string; userName: string } {
  if (!raw?.trim()) return { userId: '', userName: '' };
  const m = raw.trim().match(/^([^(]+)\((.*)\)\s*$/);
  if (m) return { userId: m[1].trim(), userName: m[2].trim() };
  return { userId: raw.trim(), userName: '' };
}

function formatDateTime(v: string | Date | null | undefined): string {
  return formatTimestampWallClock(v);
}

function looksLikeGeomMetaStored(raw: string | null | undefined): boolean {
  return stripGeomMetaDetailString(raw) === '' && String(raw ?? '').trim().startsWith('{');
}

/** 배치키·행키로 전용 도형 테이블에서 GeoJSON 문자열 조회 */
async function fetchHistoryGeomJson(params: {
  batchKey: string | null | undefined;
  keyValue: string;
  side: 'old' | 'new';
}): Promise<string | null> {
  const batch = String(params.batchKey ?? '').trim();
  const kv = String(params.keyValue ?? '').trim();
  if (!batch || !kv) return null;
  const safeKv = kv.replace(/'/g, "''");
  try {
    const excelM = batch.match(/^excel:(\d+)$/i);
    if (excelM) {
      const ehKey = Number(excelM[1]);
      if (!Number.isFinite(ehKey) || ehKey <= 0) return null;
      const res = await db.execute(sql.raw(
        `SELECT ST_AsGeoJSON(g.eslg_geom) AS gj
         FROM excel_sync_log esl
         JOIN excel_sync_log_geom g
           ON g.eslg_esl_key = esl.esl_key AND g.eslg_side = '${params.side}'
         WHERE esl.esl_eh_key = ${Math.trunc(ehKey)}
           AND esl.esl_key_value = '${safeKv}'
         LIMIT 1`
      ));
      const gj = (res.rows as Array<{ gj?: string | null }>)[0]?.gj;
      return gj != null && String(gj).trim() ? String(gj) : null;
    }
    const shpM = batch.match(/^shp:dh:(\d+)$/i);
    if (shpM) {
      const dhKey = Number(shpM[1]);
      if (!Number.isFinite(dhKey) || dhKey <= 0) return null;
      const res = await db.execute(sql.raw(
        `SELECT ST_AsGeoJSON(g.slg_geom) AS gj
         FROM sync_log sl
         JOIN sync_log_geom g
           ON g.slg_sl_key = sl.sl_key AND g.slg_side = '${params.side}'
         WHERE sl.sl_dh_key = ${Math.trunc(dhKey)}
           AND sl.sl_key_value = '${safeKv}'
         LIMIT 1`
      ));
      const gj = (res.rows as Array<{ gj?: string | null }>)[0]?.gj;
      return gj != null && String(gj).trim() ? String(gj) : null;
    }
  } catch {
    return null;
  }
  return null;
}

async function resolveDetailGeomDisplay(params: {
  stored: string | null | undefined;
  batchKey: string | null | undefined;
  keyValue: string;
  side: 'old' | 'new';
}): Promise<string> {
  const stripped = stripGeomMetaDetailString(params.stored);
  if (stripped) return stripped;
  if (!looksLikeGeomMetaStored(params.stored)) return String(params.stored ?? '');
  const fromTable = await fetchHistoryGeomJson({
    batchKey: params.batchKey,
    keyValue: params.keyValue,
    side: params.side,
  });
  return fromTable ?? '';
}

function canDetailFor(workType: DataHistoryWorkType): boolean {
  return workType === '추가' || workType === '수정' || workType === '되돌리기';
}

function ymdToDateBound(ymd: string, endOfDay: boolean): string | null {
  const s = ymd.replace(/-/g, '').slice(0, 8);
  if (!/^\d{8}$/.test(s)) return null;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return endOfDay ? `${iso} 23:59:59` : `${iso} 00:00:00`;
}

function mapSource(dlSource: string | null | undefined): {
  source: DataHistorySource;
  category: string;
} {
  const s = String(dlSource ?? '').trim();
  if (s === 'Excel 업로드' || s === 'Excel') {
    return { source: 'Excel', category: 'Excel 업로드' };
  }
  if (s === 'SHP 업로드' || s === 'SHP') {
    return { source: 'SHP', category: 'SHP 업로드' };
  }
  return {
    source: '지도',
    category: s || '시스템',
  };
}

function mapWorkType(dlType: string | null | undefined): DataHistoryWorkType | null {
  const t = String(dlType ?? '').trim();
  if (
    t === '추가' ||
    t === '수정' ||
    t === '삭제' ||
    t === '되돌리기' ||
    t === '조회' ||
    t === '저장'
  ) {
    return t;
  }
  return null;
}

function toListItem(row: RawDlRow): DataHistoryListItem | null {
  const workType = mapWorkType(row.dl_type);
  if (!workType) return null;

  const { source, category } = mapSource(row.dl_source);
  const parsed = parseLhUser(row.dl_user);
  const layerName =
    (row.dl_table_kor_name ?? '').trim() ||
    (row.dl_table_name ?? '').trim() ||
    '';

  return {
    id: `dl-${row.dl_key}`,
    source,
    sourceKey: Number(row.dl_key),
    date: formatDateTime(row.dl_date),
    userId: parsed.userId,
    userName: parsed.userName,
    category: (row.dl_service_name ?? '').trim() || category,
    groupName: (row.dl_group ?? '').trim(),
    layerName,
    keyField: row.dl_key_field ?? '',
    keyValue: row.dl_key_value ?? '',
    workType,
    canDetail: canDetailFor(workType),
  };
}

function workTypeSqlFilter(workType?: string): ReturnType<typeof sql> | null {
  if (!workType || workType === '전체') return null;
  const allowed = ['추가', '수정', '삭제', '되돌리기', '조회', '저장'];
  if (!allowed.includes(workType)) return null;
  return sql`AND dl.dl_type = ${workType}`;
}

/** 구분 필터 — 전체 | SHP 업로드 | Excel 업로드 | (서비스명 정확 일치) */
function categorySqlFilter(category?: string): ReturnType<typeof sql> | null {
  const s = String(category ?? '').trim();
  if (!s || s === '전체') return null;
  if (s === 'SHP' || s === 'SHP 업로드') {
    return sql`AND (dl.dl_source IN ('SHP 업로드', 'SHP'))`;
  }
  if (s === 'Excel' || s === 'Excel 업로드') {
    return sql`AND (dl.dl_source IN ('Excel 업로드', 'Excel'))`;
  }
  // 개별 서비스(구분)명 — 목록에 보이는 category(=dl_service_name)와 동일
  return sql`AND COALESCE(dl.dl_service_name, '') = ${s}`;
}

const PINNED_CATEGORY_LABELS = new Set([
  'SHP 업로드',
  'Excel 업로드',
  'SHP',
  'Excel',
]);

/** 구분 드롭다운용 — SHP/Excel 제외, 이력에 존재하는 서비스명 */
export async function getDataHistoryCategoryOptions(): Promise<{
  success: boolean;
  data: string[];
  error?: string;
}> {
  try {
    const res = await db.execute(sql`
      SELECT DISTINCT btrim(dl.dl_service_name) AS name
      FROM public.data_log dl
      WHERE dl.dl_service_name IS NOT NULL
        AND btrim(dl.dl_service_name) <> ''
        AND btrim(dl.dl_service_name) NOT IN (
          'SHP 업로드', 'Excel 업로드', 'SHP', 'Excel'
        )
      ORDER BY name
    `);
    const names = ((res.rows as Array<{ name?: string }>) ?? [])
      .map((r) => String(r.name ?? '').trim())
      .filter((n) => n && !PINNED_CATEGORY_LABELS.has(n));
    return { success: true, data: names };
  } catch (e: unknown) {
    return {
      success: false,
      data: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 통합 목록 — public.data_log */
export async function getDataHistoryList(params?: {
  startDate?: string;
  endDate?: string;
  workType?: string;
  /** 전체 | SHP 업로드 | Excel 업로드 | 서비스명 */
  source?: string;
  /** source 와 동일 (구분 필터) */
  category?: string;
  keyword?: string;
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  data: DataHistoryListItem[];
  total: number;
  error?: string;
}> {
  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.min(100, Math.max(1, params?.limit ?? 20));
  const offset = (page - 1) * limit;
  const keyword = (params?.keyword ?? '').trim();
  const startBound = params?.startDate ? ymdToDateBound(params.startDate, false) : null;
  const endBound = params?.endDate ? ymdToDateBound(params.endDate, true) : null;
  const wtFilter = workTypeSqlFilter(params?.workType);
  const catFilter = categorySqlFilter(params?.category ?? params?.source);

  try {
    const filters = sql`
      WHERE 1 = 1
      ${startBound ? sql`AND dl.dl_date >= ${startBound}::timestamp` : sql``}
      ${endBound ? sql`AND dl.dl_date <= ${endBound}::timestamp` : sql``}
      ${wtFilter ?? sql``}
      ${catFilter ?? sql``}
      ${
        keyword
          ? sql`AND (
              COALESCE(dl.dl_user, '') ILIKE ${'%' + keyword + '%'}
              OR COALESCE(dl.dl_service_name, '') ILIKE ${'%' + keyword + '%'}
              OR COALESCE(dl.dl_group, '') ILIKE ${'%' + keyword + '%'}
              OR COALESCE(dl.dl_table_name, '') ILIKE ${'%' + keyword + '%'}
              OR COALESCE(dl.dl_table_kor_name, '') ILIKE ${'%' + keyword + '%'}
              OR COALESCE(dl.dl_source, '') ILIKE ${'%' + keyword + '%'}
              OR COALESCE(dl.dl_key_field, '') ILIKE ${'%' + keyword + '%'}
              OR COALESCE(dl.dl_key_value, '') ILIKE ${'%' + keyword + '%'}
              OR COALESCE(dl.dl_contents, '') ILIKE ${'%' + keyword + '%'}
            )`
          : sql``
      }
    `;

    const [countRes, listRes] = await Promise.all([
      db.execute(sql`
        SELECT count(*)::int AS cnt
        FROM public.data_log dl
        ${filters}
      `),
      db.execute(sql`
        SELECT
          dl.dl_key,
          dl.dl_contents,
          dl.dl_type,
          dl.dl_user,
          dl.dl_service_name,
          to_char(
            dl.dl_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul',
            'YYYY-MM-DD HH24:MI:SS'
          ) AS dl_date,
          dl.dl_key_field,
          dl.dl_key_value,
          dl.dl_table_name,
          dl.dl_table_kor_name,
          dl.dl_group,
          dl.dl_source
        FROM public.data_log dl
        ${filters}
        ORDER BY dl.dl_date DESC NULLS LAST, dl.dl_key DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
    ]);

    const total = Number((countRes.rows?.[0] as { cnt?: number } | undefined)?.cnt ?? 0);
    const data = ((listRes.rows as RawDlRow[]) ?? [])
      .map(toListItem)
      .filter((x): x is DataHistoryListItem => !!x);

    return { success: true, data, total };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, data: [], total: 0, error: msg };
  }
}

/** 상세 — data_log + data_detail_log */
export async function getDataHistoryDetail(params: {
  id?: string;
  source?: DataHistorySource;
  sourceKey?: number;
}): Promise<{ success: boolean; data?: DataHistoryDetail; error?: string }> {
  let dlKey = params.sourceKey;
  const id = params.id?.trim();
  if (id) {
    const m = id.match(/^dl-(\d+)$/i);
    if (m) dlKey = Number(m[1]);
  }
  if (!dlKey || !Number.isFinite(dlKey)) {
    return { success: false, error: 'id(dl-{키}) 또는 sourceKey가 필요합니다.' };
  }

  try {
    const headRes = await db.execute(sql`
      SELECT
        dl.dl_key,
        dl.dl_contents,
        dl.dl_type,
        dl.dl_user,
        dl.dl_service_name,
        to_char(
          dl.dl_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul',
          'YYYY-MM-DD HH24:MI:SS'
        ) AS dl_date,
        dl.dl_key_field,
        dl.dl_key_value,
        dl.dl_table_name,
        dl.dl_table_kor_name,
        dl.dl_group,
        dl.dl_source,
        dl.dl_batch_key
      FROM public.data_log dl
      WHERE dl.dl_key = ${Math.trunc(dlKey)}
      LIMIT 1
    `);
    const head = (headRes.rows as RawDlRow[])?.[0];
    if (!head) return { success: false, error: '이력을 찾을 수 없습니다.' };

    const item = toListItem(head);
    if (!item) return { success: false, error: '지원하지 않는 작업분류입니다.' };
    if (!item.canDetail) {
      return { success: false, error: '상세가 없는 작업분류입니다.' };
    }

    const tableName = String(head.dl_table_name ?? '').trim();
    const batchKey = String(head.dl_batch_key ?? '').trim() || null;
    const keyValue = String(head.dl_key_value ?? '').trim();
    const [detRes, commentMap] = await Promise.all([
      db.execute(sql`
        SELECT dd_item, dd_before, dd_after, dd_col_name
        FROM public.data_detail_log
        WHERE dd_dl_key = ${Math.trunc(dlKey)}
        ORDER BY dd_key
      `),
      loadColumnCommentMap(tableName),
    ]);
    const korMap = loadDefineFieldKorMap(tableName);

    const rawDetails = (detRes.rows as Array<{
      dd_item: string | null;
      dd_before: string | null;
      dd_after: string | null;
      dd_col_name: string | null;
    }>) ?? [];

    const details: DataHistoryDetailAttr[] = [];
    for (const r of rawDetails) {
      const stored = String(r.dd_item ?? '').trim();
      const eng =
        String(r.dd_col_name ?? '').trim() ||
        stored.replace(/\([^)]*\)\s*$/, '').trim() ||
        '(항목)';
      const name = formatAttrDisplayName(eng, korMap, commentMap);
      const isGeom =
        eng.toLowerCase() === 'geom'
        || eng.toLowerCase() === 'geometry'
        || looksLikeGeomMetaStored(r.dd_before)
        || looksLikeGeomMetaStored(r.dd_after);

      if (item.workType === '추가') {
        let value = r.dd_after ?? '';
        if (isGeom) {
          value = await resolveDetailGeomDisplay({
            stored: r.dd_after,
            batchKey,
            keyValue,
            side: 'new',
          });
        } else {
          value = stripGeomMetaDetailString(value) || value;
        }
        details.push({ name, value });
        continue;
      }

      let before = r.dd_before ?? '';
      let after = r.dd_after ?? '';
      if (isGeom) {
        before = await resolveDetailGeomDisplay({
          stored: r.dd_before,
          batchKey,
          keyValue,
          side: 'old',
        });
        after = await resolveDetailGeomDisplay({
          stored: r.dd_after,
          batchKey,
          keyValue,
          side: 'new',
        });
      }
      details.push({ name, before, after });
    }

    return { success: true, data: { ...item, details } };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
