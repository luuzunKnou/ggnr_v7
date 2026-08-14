/**
 * 데이터 이력관리 — data_log / data_detail_log 통합 조회·속성 되돌리기
 */
import { db } from '@/database/db';
import { eq, sql } from 'drizzle-orm';
import { usr } from '@/database/schema/usr';
import { auth } from '@/auth';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  formatAttrDisplayName,
  loadDefineFieldKorMap,
  loadColumnCommentMap,
} from '@/lib/dataLogFieldLabels';
import { formatTimestampWallClock } from '@/lib/formatTimestampWallClock';
import { recordDataLog, stripGeomMetaDetailString } from './dataLogService';

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
  /** data_detail_log 키 — 속성 되돌리기 대상 */
  ddKey?: number;
  /** DB 컬럼 영문명 */
  colName?: string;
  /** 속성 단위 되돌리기 가능 여부 */
  canRevert?: boolean;
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
  /** 회차 묶음 키 (excel:… / shp:dh:…) */
  batchKey?: string | null;
  /** 상세에 되돌릴 속성이 1개 이상 있으면 true (행 속성 전체 되돌리기) */
  canRevertAll?: boolean;
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
  const userId = raw.trim();
  // 예전에 id만 저장된 슈퍼계정 표시 보정
  if (userId === 'su') return { userId, userName: '슈퍼관리자' };
  return { userId, userName: '' };
}

function formatDateTime(v: string | Date | null | undefined): string {
  return formatTimestampWallClock(v);
}

function looksLikeGeomMetaStored(raw: string | null | undefined): boolean {
  return stripGeomMetaDetailString(raw) === '' && String(raw ?? '').trim().startsWith('{');
}

/** 배치키·행키로 전용 도형 테이블에서 GeoJSON 문자열 조회 (테이블+키 폴백 포함) */
async function fetchHistoryGeomJson(params: {
  batchKey: string | null | undefined;
  keyValue: string;
  side: 'old' | 'new';
  tableName?: string | null;
  sourceHint?: string | null;
}): Promise<string | null> {
  const kv = String(params.keyValue ?? '').trim();
  if (!kv) return null;
  const safeKv = escapeSqlLiteral(kv);
  const side = params.side === 'new' ? 'new' : 'old';
  const batch = String(params.batchKey ?? '').trim();

  const run = async (q: string): Promise<string | null> => {
    try {
      const res = await db.execute(sql.raw(q));
      const gj = (res.rows as Array<{ gj?: string | null }>)[0]?.gj;
      return gj != null && String(gj).trim() ? String(gj) : null;
    } catch {
      return null;
    }
  };

  if (batch) {
    const excelM = batch.match(/^excel:(\d+)$/i);
    if (excelM) {
      const ehKey = Number(excelM[1]);
      if (Number.isFinite(ehKey) && ehKey > 0) {
        const hit = await run(
          `SELECT ST_AsGeoJSON(g.eslg_geom) AS gj
           FROM excel_sync_log esl
           JOIN excel_sync_log_geom g
             ON g.eslg_esl_key = esl.esl_key AND g.eslg_side = '${side}'
           WHERE esl.esl_eh_key = ${Math.trunc(ehKey)}
             AND esl.esl_key_value = '${safeKv}'
           LIMIT 1`
        );
        if (hit) return hit;
      }
    }
    const shpM = batch.match(/^shp:dh:(\d+)$/i);
    if (shpM) {
      const dhKey = Number(shpM[1]);
      if (Number.isFinite(dhKey) && dhKey > 0) {
        const hit = await run(
          `SELECT ST_AsGeoJSON(g.slg_geom) AS gj
           FROM sync_log sl
           JOIN sync_log_geom g
             ON g.slg_sl_key = sl.sl_key AND g.slg_side = '${side}'
           WHERE sl.sl_dh_key = ${Math.trunc(dhKey)}
             AND sl.sl_key_value = '${safeKv}'
           LIMIT 1`
        );
        if (hit) return hit;
      }
    }
  }

  // batchKey 없음·미스 → 테이블명+키값으로 최근 이력 도형 탐색
  const bare = String(params.tableName ?? '')
    .trim()
    .split('.')
    .pop()
    ?.trim() ?? '';
  if (!bare || !isSafeSqlIdent(bare)) return null;
  const safeTable = escapeSqlLiteral(bare.toLowerCase());
  const hint = String(params.sourceHint ?? '').trim();
  const preferExcel = /excel/i.test(hint);
  const preferShp = /shp/i.test(hint);

  const excelQ = `SELECT ST_AsGeoJSON(g.eslg_geom) AS gj
    FROM excel_sync_log esl
    JOIN excel_sync_log_geom g
      ON g.eslg_esl_key = esl.esl_key AND g.eslg_side = '${side}'
    WHERE lower(esl.esl_table_name) = '${safeTable}'
      AND esl.esl_key_value = '${safeKv}'
      AND g.eslg_geom IS NOT NULL
    ORDER BY esl.esl_key DESC
    LIMIT 1`;
  const shpQ = `SELECT ST_AsGeoJSON(g.slg_geom) AS gj
    FROM sync_log sl
    JOIN sync_log_geom g
      ON g.slg_sl_key = sl.sl_key AND g.slg_side = '${side}'
    WHERE lower(sl.sl_table_name) = '${safeTable}'
      AND sl.sl_key_value = '${safeKv}'
      AND g.slg_geom IS NOT NULL
    ORDER BY sl.sl_key DESC
    LIMIT 1`;

  if (preferExcel) {
    return (await run(excelQ)) ?? (await run(shpQ));
  }
  if (preferShp) {
    return (await run(shpQ)) ?? (await run(excelQ));
  }
  return (await run(shpQ)) ?? (await run(excelQ));
}

async function resolveDetailGeomDisplay(params: {
  stored: string | null | undefined;
  batchKey: string | null | undefined;
  keyValue: string;
  side: 'old' | 'new';
  tableName?: string | null;
  sourceHint?: string | null;
}): Promise<string> {
  const stripped = stripGeomMetaDetailString(params.stored);
  if (stripped) return stripped;
  if (!looksLikeGeomMetaStored(params.stored)) return String(params.stored ?? '');
  const fromTable = await fetchHistoryGeomJson({
    batchKey: params.batchKey,
    keyValue: params.keyValue,
    side: params.side,
    tableName: params.tableName,
    sourceHint: params.sourceHint,
  });
  return fromTable ?? '';
}

function canDetailFor(workType: DataHistoryWorkType): boolean {
  return workType === '추가' || workType === '수정' || workType === '되돌리기';
}

const LAYER_SEARCH_SCHEMAS = ['layer', 'public_layer', 'public'] as const;

/** 회차 스냅샷 요약 등 — 실제 테이블 컬럼이 아닌 상세는 속성 되돌리기 제외 */
const NON_TABLE_REVERT_COLS = new Set(['batch_snapshot']);

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** 식별자: 영문·숫자·언더스코어만 (스키마 탐색·SQL 조립용) */
function isSafeSqlIdent(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function escapeSqlLiteral(v: string): string {
  return v.replace(/'/g, "''");
}

function isGeomColName(col: string): boolean {
  const c = col.toLowerCase();
  return c === 'geom' || c === 'geometry' || c === 'the_geom' || c === 'shape';
}

/** dd_col_name 없을 때 dd_item에서 영문 컬럼명 추정 */
function resolveColName(
  ddColName: string | null | undefined,
  ddItem: string | null | undefined
): string {
  const fromCol = String(ddColName ?? '').trim();
  if (fromCol && isSafeSqlIdent(fromCol)) return fromCol;
  const item = String(ddItem ?? '').trim();
  if (!item) return fromCol;
  // "eng(한글)" / "eng" / "한글(eng)" 등에서 식별자 후보 추출
  const parenEng = item.match(/\(([A-Za-z_][A-Za-z0-9_]*)\)\s*$/);
  if (parenEng && isSafeSqlIdent(parenEng[1])) return parenEng[1];
  const leading = item.replace(/\([^)]*\)\s*$/, '').trim();
  if (leading && isSafeSqlIdent(leading)) return leading;
  const anyIdent = item.match(/[A-Za-z_][A-Za-z0-9_]*/);
  if (anyIdent && isSafeSqlIdent(anyIdent[0])) return anyIdent[0];
  return fromCol;
}

/** 빈 도형·자리표시 → NULL로 되돌림 */
function isGeomClearPlaceholder(raw: string | null | undefined): boolean {
  if (raw == null) return true;
  const s = String(raw).trim();
  if (!s) return true;
  return s === '도형 없음' || /\(좌표 없음\)\s*$/.test(s);
}

/** 메타 해시·_meta만 — 좌표 테이블 폴백 필요 */
function isGeomMetaOnlyStored(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const s = String(raw).trim();
  if (!s.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(s) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    if ('coordinates' in parsed || 'geometries' in parsed) return false;
    return typeof parsed.hash === 'string' || parsed._meta === true;
  } catch {
    return false;
  }
}

/**
 * SHP/Excel 이력 도형 테이블에서 geometry 서브쿼리.
 * batchKey 우선, 없으면 테이블명+키값.
 */
function buildHistoryGeomSubquery(params: {
  batchKey: string | null | undefined;
  keyValue: string;
  side: 'old' | 'new';
  tableName?: string | null;
  sourceHint?: string | null;
}): string | null {
  const kv = String(params.keyValue ?? '').trim();
  if (!kv) return null;
  const safeKv = escapeSqlLiteral(kv);
  const side = params.side === 'new' ? 'new' : 'old';
  const batch = String(params.batchKey ?? '').trim();

  const excelM = batch.match(/^excel:(\d+)$/i);
  if (excelM) {
    const ehKey = Number(excelM[1]);
    if (Number.isFinite(ehKey) && ehKey > 0) {
      return `(SELECT g.eslg_geom
        FROM excel_sync_log esl
        JOIN excel_sync_log_geom g
          ON g.eslg_esl_key = esl.esl_key AND g.eslg_side = '${side}'
        WHERE esl.esl_eh_key = ${Math.trunc(ehKey)}
          AND esl.esl_key_value = '${safeKv}'
        LIMIT 1)`;
    }
  }

  const shpM = batch.match(/^shp:dh:(\d+)$/i);
  if (shpM) {
    const dhKey = Number(shpM[1]);
    if (Number.isFinite(dhKey) && dhKey > 0) {
      return `(SELECT g.slg_geom
        FROM sync_log sl
        JOIN sync_log_geom g
          ON g.slg_sl_key = sl.sl_key AND g.slg_side = '${side}'
        WHERE sl.sl_dh_key = ${Math.trunc(dhKey)}
          AND sl.sl_key_value = '${safeKv}'
        LIMIT 1)`;
    }
  }

  const bare = String(params.tableName ?? '')
    .trim()
    .split('.')
    .pop()
    ?.trim() ?? '';
  if (!bare || !isSafeSqlIdent(bare)) return null;
  const safeTable = escapeSqlLiteral(bare.toLowerCase());
  const hint = String(params.sourceHint ?? '').trim();
  const preferExcel = /excel/i.test(hint);

  if (preferExcel) {
    return `(SELECT g.eslg_geom
      FROM excel_sync_log esl
      JOIN excel_sync_log_geom g
        ON g.eslg_esl_key = esl.esl_key AND g.eslg_side = '${side}'
      WHERE lower(esl.esl_table_name) = '${safeTable}'
        AND esl.esl_key_value = '${safeKv}'
        AND g.eslg_geom IS NOT NULL
      ORDER BY esl.esl_key DESC
      LIMIT 1)`;
  }

  return `(SELECT g.slg_geom
    FROM sync_log sl
    JOIN sync_log_geom g
      ON g.slg_sl_key = sl.sl_key AND g.slg_side = '${side}'
    WHERE lower(sl.sl_table_name) = '${safeTable}'
      AND sl.sl_key_value = '${safeKv}'
      AND g.slg_geom IS NOT NULL
    ORDER BY sl.sl_key DESC
    LIMIT 1)`;
}

async function hasHistoryGeomInTable(params: {
  batchKey: string | null | undefined;
  keyValue: string;
  side: 'old' | 'new';
  tableName?: string | null;
  sourceHint?: string | null;
}): Promise<boolean> {
  const gj = await fetchHistoryGeomJson(params);
  return gj != null && String(gj).trim().length > 0;
}

async function canRevertAttr(params: {
  colName: string | null | undefined;
  tableName: string | null | undefined;
  keyField: string | null | undefined;
  keyValue: string | null | undefined;
  before: string | null | undefined;
  batchKey?: string | null;
  sourceHint?: string | null;
}): Promise<boolean> {
  const col = String(params.colName ?? '').trim();
  const table = String(params.tableName ?? '').trim();
  const keyField = String(params.keyField ?? '').trim();
  const keyValue = String(params.keyValue ?? '').trim();
  if (!col || !table || !keyField || !keyValue) return false;
  if (!isSafeSqlIdent(col)) return false;
  if (!isGeomColName(col)) return true;

  if (isGeomClearPlaceholder(params.before)) return true;
  if (!isGeomMetaOnlyStored(params.before)) return true;
  return hasHistoryGeomInTable({
    batchKey: params.batchKey,
    keyValue,
    side: 'old',
    tableName: table,
    sourceHint: params.sourceHint,
  });
}

/** 세션·usr → `usrId(usrName)` (이름 없으면 세션 name / su 폴백) */
async function resolveOperatorLabel(): Promise<string | null> {
  const session = await auth();
  const usrId = session?.user?.id?.trim() || (await getSessionUsrId());
  if (!usrId) return null;
  const sessionName = String(session?.user?.name ?? '').trim();
  try {
    const [row] = await db
      .select({ usrName: usr.usrName })
      .from(usr)
      .where(eq(usr.usrId, usrId))
      .limit(1);
    const dbName = String(row?.usrName ?? '').trim();
    const name =
      dbName || sessionName || (usrId === 'su' ? '슈퍼관리자' : '');
    return name ? `${usrId}(${name})` : usrId;
  } catch {
    const name = sessionName || (usrId === 'su' ? '슈퍼관리자' : '');
    return name ? `${usrId}(${name})` : usrId;
  }
}

async function resolveTargetTableFq(tableName: string): Promise<string | null> {
  const bare = tableName.includes('.')
    ? tableName.split('.').pop()!.trim()
    : tableName.trim();
  if (!bare || !isSafeSqlIdent(bare)) return null;

  if (tableName.includes('.')) {
    const [schema, name] = tableName.split('.', 2).map((s) => s.trim());
    if (schema && name && isSafeSqlIdent(schema) && isSafeSqlIdent(name)) {
      return `${quoteIdent(schema)}.${quoteIdent(name)}`;
    }
  }

  const schemasIn = LAYER_SEARCH_SCHEMAS.map((s) => `'${s}'`).join(',');
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT table_schema, table_name
         FROM information_schema.tables
         WHERE table_schema IN (${schemasIn})
           AND lower(table_name) = lower('${escapeSqlLiteral(bare)}')
         ORDER BY CASE table_schema
           WHEN 'layer' THEN 1
           WHEN 'public_layer' THEN 2
           ELSE 3
         END
         LIMIT 1`
      )
    );
    const row = (res.rows as Array<{ table_schema?: string; table_name?: string }>)[0];
    if (row?.table_schema && row?.table_name) {
      return `${quoteIdent(row.table_schema)}.${quoteIdent(row.table_name)}`;
    }
  } catch {
    /* fall through */
  }
  return quoteIdent(bare);
}

function buildKeyWhereClause(keyField: string, keyValue: string): string | null {
  const fields = keyField.split(',').map((s) => s.trim()).filter(Boolean);
  if (fields.length === 0) return null;
  if (!fields.every(isSafeSqlIdent)) return null;

  if (fields.length === 1) {
    // 숫자·문자 키 모두 매칭 (ogc_fid integer 등)
    return `${quoteIdent(fields[0])}::text = '${escapeSqlLiteral(keyValue)}'`;
  }
  const values = keyValue.split(',', fields.length);
  const parts: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const val = (i < values.length ? values[i] : '').trim();
    parts.push(`${quoteIdent(fields[i])}::text = '${escapeSqlLiteral(val)}'`);
  }
  return parts.join(' AND ');
}

/** 추가 이력 상세(변경 후 값)로 행 찾기 — ogc_fid 이력 불일치 시 폴백 */
function buildAddedRowAttrWhereClause(
  details: Array<{
    dd_item: string | null;
    dd_after: string | null;
    dd_col_name: string | null;
  }>,
): string | null {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const r of details) {
    const colName = resolveColName(r.dd_col_name, r.dd_item);
    if (!colName || !isSafeSqlIdent(colName)) continue;
    const lower = colName.toLowerCase();
    if (
      seen.has(lower)
      || NON_TABLE_REVERT_COLS.has(lower)
      || isGeomColName(colName)
      || lower === 'ogc_fid'
    ) {
      continue;
    }
    const after = r.dd_after;
    if (after == null || String(after).trim() === '') continue;
    seen.add(lower);
    parts.push(`${quoteIdent(colName)}::text = '${escapeSqlLiteral(String(after))}'`);
  }
  if (parts.length === 0) return null;
  return parts.join(' AND ');
}

async function deleteRowsReturningCount(fq: string, whereClause: string): Promise<number> {
  const res = await db.execute(sql.raw(`DELETE FROM ${fq} WHERE ${whereClause} RETURNING 1`));
  return ((res.rows as unknown[]) ?? []).length;
}

/** 속성 매칭 폴백 — 동일 속성 행이 여러 개여도 1건만 삭제 */
async function deleteOneRowByAttrWhere(fq: string, whereClause: string): Promise<number> {
  const res = await db.execute(sql.raw(
    `DELETE FROM ${fq} t
     WHERE t.ctid = (
       SELECT ctid FROM ${fq} WHERE ${whereClause} LIMIT 1
     )
     RETURNING 1`
  ));
  return ((res.rows as unknown[]) ?? []).length;
}

/**
 * 추가 행 삭제: 키로 먼저 시도하고, 0건이면(특히 ogc_fid serial 불일치) 속성 매칭으로 폴백.
 */
async function deleteAddedHistoryRow(params: {
  fq: string;
  keyField: string;
  keyValue: string;
  details: Array<{
    dd_item: string | null;
    dd_after: string | null;
    dd_col_name: string | null;
  }>;
}): Promise<number> {
  const whereKey = buildKeyWhereClause(params.keyField, params.keyValue);
  if (whereKey) {
    const n = await deleteRowsReturningCount(params.fq, whereKey);
    if (n > 0) return n;
  }
  const whereAttr = buildAddedRowAttrWhereClause(params.details);
  if (!whereAttr) return 0;
  return deleteOneRowByAttrWhere(params.fq, whereAttr);
}

function buildSetExpression(
  colName: string,
  before: string | null,
  opts?: {
    batchKey?: string | null;
    keyValue?: string;
    tableName?: string | null;
    sourceHint?: string | null;
  }
): string | { error: string } {
  const qCol = quoteIdent(colName);
  if (!isGeomColName(colName)) {
    if (before == null || String(before).trim() === '') return `${qCol} = NULL`;
    return `${qCol} = '${escapeSqlLiteral(before)}'`;
  }

  if (isGeomClearPlaceholder(before)) {
    return `${qCol} = NULL`;
  }

  // 메타만 → 이력 도형 테이블(old) 서브쿼리
  if (isGeomMetaOnlyStored(before)) {
    const sub = buildHistoryGeomSubquery({
      batchKey: opts?.batchKey,
      keyValue: String(opts?.keyValue ?? ''),
      side: 'old',
      tableName: opts?.tableName,
      sourceHint: opts?.sourceHint,
    });
    if (!sub) {
      return {
        error:
          '도형 메타만 있고 SHP/Excel 이력 도형을 찾을 수 없습니다. (batchKey·테이블·키값 확인)',
      };
    }
    return `${qCol} = ${sub}`;
  }

  const s = String(before).trim();
  if (s.toUpperCase().startsWith('SRID=')) {
    return `${qCol} = ST_GeomFromEWKT('${escapeSqlLiteral(s)}')`;
  }
  if (s.startsWith('{')) {
    try {
      const parsed = JSON.parse(s) as Record<string, unknown>;
      if (!parsed || typeof parsed.type !== 'string') {
        return { error: '도형 GeoJSON 형식이 올바르지 않습니다.' };
      }
      let srid = 5181;
      const crs = parsed.crs;
      if (crs && typeof crs === 'object' && !Array.isArray(crs)) {
        const name = (crs as { properties?: { name?: unknown } }).properties?.name;
        if (typeof name === 'string') {
          const m = name.match(/EPSG::?(\d+)/i) ?? name.match(/(\d{3,5})\s*$/);
          if (m) srid = Number(m[1]) || 5181;
        }
      }
      const { crs: _crs, ...withoutCrs } = parsed;
      const json = JSON.stringify(withoutCrs);
      return `${qCol} = ST_SetSRID(ST_GeomFromGeoJSON('${escapeSqlLiteral(json)}'), ${srid})`;
    } catch {
      return { error: '도형 GeoJSON 파싱에 실패했습니다.' };
    }
  }
  // WKT
  return `${qCol} = ST_GeomFromText('${escapeSqlLiteral(s)}', 5181)`;
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
  if (s === '레이어 관리(개발자모드)') {
    return { source: '지도', category: '레이어 관리(개발자모드)' };
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

  const svc = (row.dl_service_name ?? '').trim();
  const contents = (row.dl_contents ?? '').trim();
  const src = String(row.dl_source ?? '').trim();
  const isLayerListDownload =
    svc === '레이어 관리(개발자모드)' ||
    src === '레이어 관리(개발자모드)' ||
    contents === 'SHP 다운로드' ||
    contents === 'CSV 다운로드';

  return {
    id: `dl-${row.dl_key}`,
    source,
    sourceKey: Number(row.dl_key),
    date: formatDateTime(row.dl_date),
    userId: parsed.userId,
    userName: parsed.userName,
    category: isLayerListDownload
      ? '레이어 관리(개발자모드)'
      : svc || category,
    groupName: (row.dl_group ?? '').trim(),
    layerName,
    keyField: row.dl_key_field ?? '',
    keyValue: row.dl_key_value ?? '',
    workType,
    canDetail: canDetailFor(workType),
    batchKey: String(row.dl_batch_key ?? '').trim() || null,
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
  if (s === '레이어 관리(개발자모드)') {
    return sql`AND (
      COALESCE(dl.dl_service_name, '') = ${s}
      OR COALESCE(dl.dl_source, '') = ${s}
      OR COALESCE(dl.dl_contents, '') IN ('SHP 다운로드', 'CSV 다운로드')
    )`;
  }
  // 개별 서비스(구분)명 — 목록에 보이는 category(=dl_service_name)와 동일
  return sql`AND COALESCE(dl.dl_service_name, '') = ${s}`;
}

const PINNED_CATEGORY_LABELS = new Set([
  'SHP 업로드',
  'Excel 업로드',
  'SHP',
  'Excel',
  '레이어 관리(개발자모드)',
]);

/** 구분 드롭다운용 — 상단 고정(SHP·Excel·레이어 관리) 제외, 이력에 존재하는 서비스명 */
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
          'SHP 업로드', 'Excel 업로드', 'SHP', 'Excel', '레이어 관리(개발자모드)'
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
          dl.dl_source,
          dl.dl_batch_key
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
        SELECT dd_key, dd_item, dd_before, dd_after, dd_col_name, dd_key_value
        FROM public.data_detail_log
        WHERE dd_dl_key = ${Math.trunc(dlKey)}
        ORDER BY dd_key
      `),
      loadColumnCommentMap(tableName),
    ]);
    const korMap = loadDefineFieldKorMap(tableName);

    const rawDetails = (detRes.rows as Array<{
      dd_key: number;
      dd_item: string | null;
      dd_before: string | null;
      dd_after: string | null;
      dd_col_name: string | null;
      dd_key_value: string | null;
    }>) ?? [];

    const details: DataHistoryDetailAttr[] = [];
    const sourceHint = String(head.dl_source ?? '').trim() || item.category;
    for (const r of rawDetails) {
      const stored = String(r.dd_item ?? '').trim();
      const resolvedCol = resolveColName(r.dd_col_name, r.dd_item);
      const eng =
        resolvedCol ||
        stored.replace(/\([^)]*\)\s*$/, '').trim() ||
        '(항목)';
      const name = formatAttrDisplayName(eng, korMap, commentMap);
      const isGeom =
        eng.toLowerCase() === 'geom'
        || eng.toLowerCase() === 'geometry'
        || looksLikeGeomMetaStored(r.dd_before)
        || looksLikeGeomMetaStored(r.dd_after);

      const detailKeyValue = String(r.dd_key_value ?? '').trim() || keyValue;
      const colName = resolvedCol || undefined;
      const ddKey = Number(r.dd_key);
      const skipSynthetic =
        !!resolvedCol && NON_TABLE_REVERT_COLS.has(resolvedCol.toLowerCase());

      if (item.workType === '추가') {
        let value = r.dd_after ?? '';
        if (isGeom) {
          value = await resolveDetailGeomDisplay({
            stored: r.dd_after,
            batchKey,
            keyValue,
            side: 'new',
            tableName,
            sourceHint,
          });
        } else {
          value = stripGeomMetaDetailString(value) || value;
        }
        details.push({
          name,
          value,
          ddKey: Number.isFinite(ddKey) ? ddKey : undefined,
          colName,
          canRevert:
            !skipSynthetic &&
            (await canRevertAttr({
              colName,
              tableName,
              keyField: item.keyField,
              keyValue: detailKeyValue,
              before: r.dd_before,
              batchKey,
              sourceHint,
            })),
        });
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
          tableName,
          sourceHint,
        });
        after = await resolveDetailGeomDisplay({
          stored: r.dd_after,
          batchKey,
          keyValue,
          side: 'new',
          tableName,
          sourceHint,
        });
      }
      details.push({
        name,
        before,
        after,
        ddKey: Number.isFinite(ddKey) ? ddKey : undefined,
        colName,
        canRevert:
          !skipSynthetic &&
          (await canRevertAttr({
            colName,
            tableName,
            keyField: item.keyField,
            keyValue: detailKeyValue,
            before: r.dd_before,
            batchKey,
            sourceHint,
          })),
      });
    }

    const canRevertAll = details.some((d) => !!(d.canRevert && d.ddKey));

    return {
      success: true,
      data: { ...item, batchKey, canRevertAll, details },
    };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 속성(필드) 단위 되돌리기 — 레거시 revertByDdKey 이식.
 * data_detail_log 1건의 변경 전 값으로 대상 테이블 컬럼을 UPDATE하고,
 * 작업분류 «되돌리기» data_log/data_detail_log를 남긴다.
 */
export async function revertDataHistoryField(params: {
  ddKey?: number;
}): Promise<{
  success: boolean;
  code?: 'not_found' | 'not_revertable' | 'target_deleted' | 'update_failed';
  dlKey?: number;
  error?: string;
}> {
  const ddKey = Number(params.ddKey);
  if (!Number.isFinite(ddKey) || ddKey <= 0) {
    return { success: false, code: 'not_found', error: 'ddKey가 필요합니다.' };
  }

  try {
    const detRes = await db.execute(sql`
      SELECT
        dd.dd_key,
        dd.dd_dl_key,
        dd.dd_item,
        dd.dd_before,
        dd.dd_after,
        dd.dd_col_name,
        dd.dd_key_value,
        dl.dl_key,
        dl.dl_contents,
        dl.dl_type,
        dl.dl_service_key,
        dl.dl_service_name,
        dl.dl_key_field,
        dl.dl_key_value AS dl_key_value,
        dl.dl_table_name,
        dl.dl_table_kor_name,
        dl.dl_group,
        dl.dl_source,
        dl.dl_batch_key
      FROM public.data_detail_log dd
      JOIN public.data_log dl ON dl.dl_key = dd.dd_dl_key
      WHERE dd.dd_key = ${Math.trunc(ddKey)}
      LIMIT 1
    `);

    const row = (detRes.rows as Array<{
      dd_key: number;
      dd_dl_key: number;
      dd_item: string | null;
      dd_before: string | null;
      dd_after: string | null;
      dd_col_name: string | null;
      dd_key_value: string | null;
      dl_key: number;
      dl_contents: string | null;
      dl_type: string | null;
      dl_service_key: number | null;
      dl_service_name: string | null;
      dl_key_field: string | null;
      dl_key_value: string | null;
      dl_table_name: string | null;
      dl_table_kor_name: string | null;
      dl_group: string | null;
      dl_source: string | null;
      dl_batch_key: string | null;
    }>)?.[0];

    if (!row) {
      return { success: false, code: 'not_found', error: '상세 이력을 찾을 수 없습니다.' };
    }

    const colName = resolveColName(row.dd_col_name, row.dd_item);
    const tableName = String(row.dl_table_name ?? '').trim();
    const keyField = String(row.dl_key_field ?? '').trim();
    const keyValue =
      String(row.dd_key_value ?? '').trim() || String(row.dl_key_value ?? '').trim();
    const sourceHint = String(row.dl_source ?? '').trim();

    if (!colName || NON_TABLE_REVERT_COLS.has(colName.toLowerCase())) {
      return {
        success: false,
        code: 'not_revertable',
        error: '이력 데이터에 테이블·컬럼 정보가 없거나 되돌릴 수 없는 값입니다.',
      };
    }

    if (
      !(await canRevertAttr({
        colName,
        tableName,
        keyField,
        keyValue,
        before: row.dd_before,
        batchKey: row.dl_batch_key,
        sourceHint,
      }))
    ) {
      return {
        success: false,
        code: 'not_revertable',
        error: '이력 데이터에 테이블·컬럼 정보가 없거나 되돌릴 수 없는 값입니다.',
      };
    }

    const fq = await resolveTargetTableFq(tableName);
    if (!fq) {
      return {
        success: false,
        code: 'not_revertable',
        error: '대상 테이블을 확인할 수 없습니다.',
      };
    }

    const whereClause = buildKeyWhereClause(keyField, keyValue);
    if (!whereClause) {
      return {
        success: false,
        code: 'not_revertable',
        error: '키 필드 정보가 올바르지 않습니다.',
      };
    }

    const workType = String(row.dl_type ?? '').trim();
    const operator = await resolveOperatorLabel();
    const { source } = mapSource(row.dl_source);
    const logSource =
      source === 'Excel'
        ? ('Excel 업로드' as const)
        : source === 'SHP'
          ? ('SHP 업로드' as const)
          : ('시스템' as const);

    // 추가 이력 되돌리기 = 해당 행 삭제 (변경 전 NULL로 UPDATE하면 PK/NOT NULL 실패)
    if (workType === '추가') {
      const allDetRes = await db.execute(sql`
        SELECT dd_item, dd_after, dd_col_name
        FROM public.data_detail_log
        WHERE dd_dl_key = ${Math.trunc(Number(row.dd_dl_key))}
        ORDER BY dd_key
      `);
      const allDetails = (allDetRes.rows as Array<{
        dd_item: string | null;
        dd_after: string | null;
        dd_col_name: string | null;
      }>) ?? [];

      const affected = await deleteAddedHistoryRow({
        fq,
        keyField,
        keyValue,
        details: allDetails.length > 0 ? allDetails : [{
          dd_item: row.dd_item,
          dd_after: row.dd_after,
          dd_col_name: row.dd_col_name,
        }],
      });
      if (affected === 0) {
        return {
          success: false,
          code: 'target_deleted',
          error: '대상 행이 없거나 이미 삭제되었습니다.',
        };
      }

      const logged = await recordDataLog({
        source: logSource,
        type: '되돌리기',
        user: operator,
        serviceKey: row.dl_service_key,
        serviceName: row.dl_service_name,
        tableName,
        tableKorName: row.dl_table_kor_name,
        group: row.dl_group,
        keyField,
        keyValue,
        contents: row.dl_contents,
        batchKey: row.dl_batch_key,
        details: [
          {
            item: String(row.dd_item ?? colName),
            before: row.dd_after,
            after: null,
            colName,
          },
        ],
      });

      if (!logged.success) {
        return {
          success: false,
          code: 'update_failed',
          error: logged.error || '되돌리기는 적용됐으나 이력 기록에 실패했습니다.',
        };
      }
      return { success: true, dlKey: logged.dlKey };
    }

    // 메타 도형 → 이력 테이블(old) GeoJSON으로 SET (batch·테이블+키 폴백 동일 경로)
    let setExpr: string | { error: string };
    if (isGeomColName(colName) && isGeomMetaOnlyStored(row.dd_before)) {
      const gj = await fetchHistoryGeomJson({
        batchKey: row.dl_batch_key,
        keyValue,
        side: 'old',
        tableName,
        sourceHint,
      });
      if (!gj) {
        return {
          success: false,
          code: 'not_revertable',
          error: '이력 도형(old)을 sync_log_geom / excel_sync_log_geom에서 찾을 수 없습니다.',
        };
      }
      const qCol = quoteIdent(colName);
      setExpr = `${qCol} = ST_SetSRID(ST_GeomFromGeoJSON('${escapeSqlLiteral(gj)}'), 5181)`;
    } else {
      setExpr = buildSetExpression(colName, row.dd_before, {
        batchKey: row.dl_batch_key,
        keyValue,
        tableName,
        sourceHint,
      });
    }
    if (typeof setExpr === 'object') {
      return { success: false, code: 'not_revertable', error: setExpr.error };
    }

    const updateSql = `UPDATE ${fq} SET ${setExpr} WHERE ${whereClause}`;
    const upd = await db.execute(sql.raw(updateSql));
    const affected = Number((upd as { rowCount?: number }).rowCount ?? 0);
    if (affected === 0) {
      return {
        success: false,
        code: 'target_deleted',
        error: '대상 행이 없거나 이미 삭제되었습니다.',
      };
    }

    const logged = await recordDataLog({
      source: logSource,
      type: '되돌리기',
      user: operator,
      serviceKey: row.dl_service_key,
      serviceName: row.dl_service_name,
      tableName,
      tableKorName: row.dl_table_kor_name,
      group: row.dl_group,
      keyField,
      keyValue,
      contents: row.dl_contents,
      batchKey: row.dl_batch_key,
      details: [
        {
          item: String(row.dd_item ?? colName),
          before: row.dd_after,
          after: row.dd_before,
          colName,
        },
      ],
    });

    if (!logged.success) {
      return {
        success: false,
        code: 'update_failed',
        error: logged.error || '되돌리기는 적용됐으나 이력 기록에 실패했습니다.',
      };
    }

    return { success: true, dlKey: logged.dlKey };
  } catch (e: unknown) {
    return {
      success: false,
      code: 'update_failed',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 이력 1건(상세창 대상 행)의 되돌릴 수 있는 속성을 한꺼번에 변경 전 값으로 복원.
 * 속성별 되돌리기와 동일 규칙·이력 기록(상세는 속성별 전·후).
 */
export async function revertDataHistoryRow(params: {
  id?: string;
  sourceKey?: number;
}): Promise<{
  success: boolean;
  code?: 'not_found' | 'not_revertable' | 'target_deleted' | 'update_failed';
  dlKey?: number;
  revertedCount?: number;
  error?: string;
}> {
  let dlKey = params.sourceKey;
  const id = params.id?.trim();
  if (id) {
    const m = id.match(/^dl-(\d+)$/i);
    if (m) dlKey = Number(m[1]);
  }
  if (!dlKey || !Number.isFinite(dlKey) || dlKey <= 0) {
    return { success: false, code: 'not_found', error: 'id(dl-{키}) 또는 sourceKey가 필요합니다.' };
  }

  try {
    const headRes = await db.execute(sql`
      SELECT
        dl.dl_key,
        dl.dl_contents,
        dl.dl_type,
        dl.dl_service_key,
        dl.dl_service_name,
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
    const head = (headRes.rows as Array<{
      dl_key: number;
      dl_contents: string | null;
      dl_type: string | null;
      dl_service_key: number | null;
      dl_service_name: string | null;
      dl_key_field: string | null;
      dl_key_value: string | null;
      dl_table_name: string | null;
      dl_table_kor_name: string | null;
      dl_group: string | null;
      dl_source: string | null;
      dl_batch_key: string | null;
    }>)?.[0];

    if (!head) {
      return { success: false, code: 'not_found', error: '이력을 찾을 수 없습니다.' };
    }

    const tableName = String(head.dl_table_name ?? '').trim();
    const keyField = String(head.dl_key_field ?? '').trim();
    const dlKeyValue = String(head.dl_key_value ?? '').trim();
    const sourceHint = String(head.dl_source ?? '').trim();
    const batchKey = head.dl_batch_key;

    const detRes = await db.execute(sql`
      SELECT dd_key, dd_item, dd_before, dd_after, dd_col_name, dd_key_value
      FROM public.data_detail_log
      WHERE dd_dl_key = ${Math.trunc(dlKey)}
      ORDER BY dd_key
    `);
    const rawDetails = (detRes.rows as Array<{
      dd_key: number;
      dd_item: string | null;
      dd_before: string | null;
      dd_after: string | null;
      dd_col_name: string | null;
      dd_key_value: string | null;
    }>) ?? [];

    if (rawDetails.length === 0) {
      return {
        success: false,
        code: 'not_revertable',
        error: '되돌릴 속성이 없습니다.',
      };
    }

    const fq = await resolveTargetTableFq(tableName);
    if (!fq) {
      return {
        success: false,
        code: 'not_revertable',
        error: '대상 테이블을 확인할 수 없습니다.',
      };
    }

    const operator = await resolveOperatorLabel();
    const { source } = mapSource(head.dl_source);
    const logSource =
      source === 'Excel'
        ? ('Excel 업로드' as const)
        : source === 'SHP'
          ? ('SHP 업로드' as const)
          : ('시스템' as const);

    const workType = String(head.dl_type ?? '').trim();

    // 추가 이력 전체 되돌리기 = 해당 행 삭제 (속성 NULL UPDATE 금지)
    if (workType === '추가') {
      const keyValue =
        String(rawDetails[0]?.dd_key_value ?? '').trim() || dlKeyValue;

      const affected = await deleteAddedHistoryRow({
        fq,
        keyField,
        keyValue,
        details: rawDetails,
      });
      if (affected === 0) {
        return {
          success: false,
          code: 'target_deleted',
          error: '대상 행이 없거나 이미 삭제되었습니다.',
        };
      }

      const details = rawDetails
        .map((r) => {
          const colName = resolveColName(r.dd_col_name, r.dd_item);
          if (!colName || NON_TABLE_REVERT_COLS.has(colName.toLowerCase())) return null;
          return {
            item: String(r.dd_item ?? colName),
            before: r.dd_after,
            after: null as string | null,
            colName,
          };
        })
        .filter((d): d is NonNullable<typeof d> => d != null);

      const logged = await recordDataLog({
        source: logSource,
        type: '되돌리기',
        user: operator,
        serviceKey: head.dl_service_key,
        serviceName: head.dl_service_name,
        tableName,
        tableKorName: head.dl_table_kor_name,
        group: head.dl_group,
        keyField,
        keyValue,
        contents: head.dl_contents,
        batchKey,
        details,
      });

      if (!logged.success) {
        return {
          success: false,
          code: 'update_failed',
          error: logged.error || '되돌리기는 적용됐으나 이력 기록에 실패했습니다.',
        };
      }

      return {
        success: true,
        dlKey: logged.dlKey,
        revertedCount: details.length,
      };
    }

    type Prepared = {
      colName: string;
      setExpr: string;
      item: string;
      before: string | null;
      after: string | null;
      keyValue: string;
    };
    const prepared: Prepared[] = [];
    const seenCols = new Set<string>();

    for (const r of rawDetails) {
      const colName = resolveColName(r.dd_col_name, r.dd_item);
      if (!colName || NON_TABLE_REVERT_COLS.has(colName.toLowerCase())) continue;
      const colKey = colName.toLowerCase();
      if (seenCols.has(colKey)) continue;

      const keyValue =
        String(r.dd_key_value ?? '').trim() || dlKeyValue;
      if (
        !(await canRevertAttr({
          colName,
          tableName,
          keyField,
          keyValue,
          before: r.dd_before,
          batchKey,
          sourceHint,
        }))
      ) {
        continue;
      }

      let setExpr: string | { error: string };
      if (isGeomColName(colName) && isGeomMetaOnlyStored(r.dd_before)) {
        const gj = await fetchHistoryGeomJson({
          batchKey,
          keyValue,
          side: 'old',
          tableName,
          sourceHint,
        });
        if (!gj) continue;
        setExpr = `${quoteIdent(colName)} = ST_SetSRID(ST_GeomFromGeoJSON('${escapeSqlLiteral(gj)}'), 5181)`;
      } else {
        setExpr = buildSetExpression(colName, r.dd_before, {
          batchKey,
          keyValue,
          tableName,
          sourceHint,
        });
      }
      if (typeof setExpr === 'object') continue;

      seenCols.add(colKey);
      prepared.push({
        colName,
        setExpr,
        item: String(r.dd_item ?? colName),
        before: r.dd_after,
        after: r.dd_before,
        keyValue,
      });
    }

    if (prepared.length === 0) {
      return {
        success: false,
        code: 'not_revertable',
        error: '되돌릴 수 있는 속성이 없습니다.',
      };
    }

    // 상세마다 키가 다르면(이상 케이스) 행별로 UPDATE
    const byKey = new Map<string, Prepared[]>();
    for (const p of prepared) {
      const list = byKey.get(p.keyValue) ?? [];
      list.push(p);
      byKey.set(p.keyValue, list);
    }

    for (const [keyValue, cols] of byKey) {
      const whereClause = buildKeyWhereClause(keyField, keyValue);
      if (!whereClause) {
        return {
          success: false,
          code: 'not_revertable',
          error: '키 필드 정보가 올바르지 않습니다.',
        };
      }
      const updateSql = `UPDATE ${fq} SET ${cols.map((c) => c.setExpr).join(', ')} WHERE ${whereClause}`;
      const upd = await db.execute(sql.raw(updateSql));
      const affected = Number((upd as { rowCount?: number }).rowCount ?? 0);
      if (affected === 0) {
        return {
          success: false,
          code: 'target_deleted',
          error: '대상 행이 없거나 이미 삭제되었습니다.',
        };
      }
    }

    // 로그 키는 대표(첫) 키 — 상세 dd_key_value에 행별 키를 남기려면 확장 필요. 단일 행이 일반적.
    const logKeyValue = prepared[0]?.keyValue || dlKeyValue;

    const logged = await recordDataLog({
      source: logSource,
      type: '되돌리기',
      user: operator,
      serviceKey: head.dl_service_key,
      serviceName: head.dl_service_name,
      tableName,
      tableKorName: head.dl_table_kor_name,
      group: head.dl_group,
      keyField,
      keyValue: logKeyValue,
      contents: head.dl_contents,
      batchKey,
      details: prepared.map((p) => ({
        item: p.item,
        before: p.before,
        after: p.after,
        colName: p.colName,
      })),
    });

    if (!logged.success) {
      return {
        success: false,
        code: 'update_failed',
        error: logged.error || '되돌리기는 적용됐으나 이력 기록에 실패했습니다.',
      };
    }

    return {
      success: true,
      dlKey: logged.dlKey,
      revertedCount: prepared.length,
    };
  } catch (e: unknown) {
    return {
      success: false,
      code: 'update_failed',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
