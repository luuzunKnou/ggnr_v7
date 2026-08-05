/**
 * 통합 데이터 로그 (data_log / data_detail_log)
 * — 시스템·SHP·Excel 행 변경 기록·조회
 */
import { db } from '@/database/db';
import { dl } from '@/database/schema/data_log';
import { dd } from '@/database/schema/data_detail_log';
import { and, desc, eq, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { areGeomsEquivalentForHistory } from '@/lib/geomCompare';

export type DataLogSource = '시스템' | 'SHP 업로드' | 'Excel 업로드';
export type DataLogType = '추가' | '수정' | '삭제' | '되돌리기' | '조회' | '저장';

export type DataLogDetailInput = {
  item: string;
  before?: string | null;
  after?: string | null;
  colName?: string;
};

const DEFINE_TABLES_PATH = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'tables.json');

type DefineLayerMeta = { group: string | null; tableKorName: string | null };

let defineMetaCache: Map<string, DefineLayerMeta> | null = null;

function loadDefineLayerMetaMap(): Map<string, DefineLayerMeta> {
  if (defineMetaCache) return defineMetaCache;
  const map = new Map<string, DefineLayerMeta>();
  try {
    if (!fs.existsSync(DEFINE_TABLES_PATH)) {
      defineMetaCache = map;
      return map;
    }
    const parsed = JSON.parse(fs.readFileSync(DEFINE_TABLES_PATH, 'utf-8'));
    if (Array.isArray(parsed)) {
      for (const row of parsed as Array<Record<string, unknown>>) {
        const name = String(row.define_table_name ?? '').trim().toLowerCase();
        if (!name) continue;
        const group = String(row.define_table_group ?? '').trim() || null;
        const tableKorName = String(row.define_table_kor_name ?? '').trim() || null;
        map.set(name, { group, tableKorName });
      }
    }
  } catch {
    /* ignore */
  }
  defineMetaCache = map;
  return map;
}

/** tables.json 기준 그룹·한글명 (없으면 null) */
export function lookupDefineLayerMeta(tableName: string): DefineLayerMeta {
  const key = String(tableName ?? '').trim().toLowerCase();
  if (!key) return { group: null, tableKorName: null };
  return loadDefineLayerMetaMap().get(key) ?? { group: null, tableKorName: null };
}

function resolveGroupAndKorName(params: {
  tableName: string;
  group?: string | null;
  tableKorName?: string | null;
}): { group: string | null; tableKorName: string | null } {
  let group = String(params.group ?? '').trim() || null;
  let tableKorName = String(params.tableKorName ?? '').trim() || null;
  if (!group || !tableKorName) {
    const meta = lookupDefineLayerMeta(params.tableName);
    if (!group) group = meta.group;
    if (!tableKorName) tableKorName = meta.tableKorName;
  }
  return { group, tableKorName };
}

/** 상세·비교에서 제외 (내부 메타만) */
const SKIP_ATTR_KEYS = new Set([
  '__rollback_geom',
  '__geom_meta',
  '__match_ogc_fid',
  '__match_sync_ogc_fid',
]);

const GEOM_ATTR_KEYS = new Set(['geom', 'geometry', 'the_geom', 'shape']);

function isGeomAttrKey(key: string): boolean {
  return GEOM_ATTR_KEYS.has(key.toLowerCase());
}

/** sync_log hash 메타({type,hash,_meta}) — 좌표 없는 요약 */
function isGeomMetaOnly(g: unknown): boolean {
  if (g == null || typeof g !== 'object' || Array.isArray(g)) return false;
  const o = g as Record<string, unknown>;
  if ('coordinates' in o || 'geometries' in o) return false;
  return typeof o.hash === 'string' || o._meta === true;
}

/** 타입만 있고 좌표 배열이 비어 있는 자리표시 GeoJSON */
function isGeomTypeOnlyPlaceholder(g: unknown): boolean {
  if (g == null || typeof g !== 'object' || Array.isArray(g)) return false;
  const o = g as Record<string, unknown>;
  if (typeof o.type !== 'string' || !o.type.trim()) return false;
  if (!('coordinates' in o)) return false;
  const c = o.coordinates;
  return Array.isArray(c) && c.length === 0;
}

function formatGeomDetailValue(g: unknown): string | null {
  if (g == null) return null;
  if (isGeomTypeOnlyPlaceholder(g)) {
    const t = String((g as Record<string, unknown>).type).trim();
    if (!t || t === 'Geometry') return '도형 없음';
    return `${t} (좌표 없음)`;
  }
  return strVal(g, { full: true });
}

function strVal(v: unknown, opts?: { full?: boolean }): string | null {
  if (v == null) return null;
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  const s = String(v);
  if (opts?.full) return s;
  return s.length > 8000 ? `${s.slice(0, 8000)}…` : s;
}

function pickRawGeomField(raw: Record<string, unknown> | null | undefined): unknown {
  if (!raw) return null;
  for (const k of Object.keys(raw)) {
    if (isGeomAttrKey(k)) return raw[k];
  }
  return raw.__rollback_geom ?? null;
}

/**
 * 행 JSON에서 상세용 geom 값.
 * 전체 GeoJSON 우선. 타입만 자리표시(coordinates:[])도 유지.
 * hash/_meta 메타만 있으면 __rollback_geom 폴백 후, 없으면 null.
 */
function resolveGeomValue(raw: Record<string, unknown>): unknown {
  let geomKey: string | null = null;
  for (const k of Object.keys(raw)) {
    if (isGeomAttrKey(k)) {
      geomKey = k;
      break;
    }
  }
  const direct = geomKey != null ? raw[geomKey] : undefined;
  if (direct != null && !isGeomMetaOnly(direct)) return direct;
  const rollback = raw.__rollback_geom;
  if (rollback != null && !isGeomMetaOnly(rollback)) return rollback;
  // hash/_meta 자리표시는 이력 상세 값으로 쓰지 않음
  return null;
}

/** 이미 저장된 상세 문자열이 geom 메타 JSON이면 빈 문자열(표시 —) */
export function stripGeomMetaDetailString(raw: string | null | undefined): string {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s.startsWith('{')) return String(raw);
  try {
    const parsed = JSON.parse(s) as unknown;
    if (isGeomMetaOnly(parsed)) return '';
    return String(raw);
  } catch {
    return String(raw);
  }
}

function normalizeRecord(raw: Record<string, unknown> | null | undefined): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (!raw) return out;

  let sawGeom = false;
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k);
    if (!key || SKIP_ATTR_KEYS.has(key.toLowerCase())) continue;
    if (isGeomAttrKey(key)) {
      if (sawGeom) continue;
      sawGeom = true;
      const g = resolveGeomValue(raw);
      out.geom = formatGeomDetailValue(g);
      continue;
    }
    out[key] = strVal(v);
  }

  // geom 키가 없고 __rollback_geom만 있는 경우
  if (!sawGeom && raw.__rollback_geom != null) {
    out.geom = formatGeomDetailValue(raw.__rollback_geom);
  }
  return out;
}

/** old/new JSON에서 필드별 상세 목록 생성 (수정 시 geom은 스냅 해시로 오탐 제거) */
export async function buildDetailsFromOldNew(params: {
  type: DataLogType;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
}): Promise<DataLogDetailInput[]> {
  const oldR = normalizeRecord(params.oldData);
  const newR = normalizeRecord(params.newData);
  const details: DataLogDetailInput[] = [];

  if (params.type === '추가') {
    for (const [col, after] of Object.entries(newR)) {
      if (after == null || after === '') continue;
      details.push({ item: col, before: null, after, colName: col });
    }
    return details;
  }
  if (params.type === '삭제') {
    for (const [col, before] of Object.entries(oldR)) {
      if (before == null || before === '') continue;
      details.push({ item: col, before, after: null, colName: col });
    }
    return details;
  }

  const keys = new Set([...Object.keys(oldR), ...Object.keys(newR)]);
  // 표시용으로 메타가 제거돼도 원본에 geom이 있으면 비교 대상에 포함
  if (pickRawGeomField(params.oldData) != null || pickRawGeomField(params.newData) != null) {
    keys.add('geom');
  }
  for (const col of keys) {
    if (col === 'geom' || isGeomAttrKey(col)) {
      const oldDisp = params.oldData ? resolveGeomValue(params.oldData) : null;
      const newDisp = params.newData ? resolveGeomValue(params.newData) : null;
      const oldRaw = pickRawGeomField(params.oldData);
      const newRaw = pickRawGeomField(params.newData);
      if (await areGeomsEquivalentForHistory(oldDisp ?? oldRaw, newDisp ?? newRaw)) continue;
      const before = formatGeomDetailValue(oldDisp);
      const after = formatGeomDetailValue(newDisp);
      // 좌표·타입 자리표시 모두 없으면 상세 행 생략
      if (before == null && after == null) continue;
      details.push({ item: 'geom', before, after, colName: 'geom' });
      continue;
    }

    const before = oldR[col] ?? null;
    const after = newR[col] ?? null;
    const beforeN = before == null || before === '' ? null : before;
    const afterN = after == null || after === '' ? null : after;
    if (beforeN === afterN) continue;

    details.push({ item: col, before, after, colName: col });
  }
  return details;
}

function mapSyncOpToType(op: string | null | undefined): DataLogType | null {
  const o = String(op ?? '').trim().toLowerCase();
  if (o === 'append') return '추가';
  if (o === 'conflict' || o === 'update') return '수정';
  if (o === 'remove' || o === 'delete') return '삭제';
  if (o === 'kept') return null;
  return null;
}

/**
 * 데이터 로그 1건 + 상세 N건 기록.
 * 상세가 비어 있고 old/new가 있으면 자동 비교한다.
 */
export async function recordDataLog(params: {
  source: DataLogSource;
  type: DataLogType;
  user?: string | null;
  serviceName?: string | null;
  serviceKey?: number | null;
  tableName: string;
  tableKorName?: string | null;
  group?: string | null;
  keyField: string;
  keyValue: string;
  contents?: string | null;
  batchKey?: string | null;
  details?: DataLogDetailInput[];
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
}): Promise<{ success: boolean; dlKey?: number; error?: string }> {
  const tableName = String(params.tableName ?? '').trim();
  const keyField = String(params.keyField ?? '').trim();
  const keyValue = String(params.keyValue ?? '').trim();
  if (!tableName || !keyField || !keyValue) {
    return { success: false, error: 'tableName, keyField, keyValue가 필요합니다.' };
  }

  try {
    let details = params.details;
    if (!details?.length && (params.oldData || params.newData)) {
      details = await buildDetailsFromOldNew({
        type: params.type,
        oldData: params.oldData,
        newData: params.newData,
      });
    }
    details = details ?? [];

    const { group, tableKorName } = resolveGroupAndKorName({
      tableName,
      group: params.group,
      tableKorName: params.tableKorName,
    });

    const contents =
      params.contents?.trim() ||
      `${keyField} | ${keyValue}`;

    const serviceName =
      params.serviceName?.trim() ||
      [group, tableKorName || tableName].filter(Boolean).join('-') ||
      params.source;

    const rows = await db
      .insert(dl)
      .values({
        dlServiceKey: params.serviceKey ?? null,
        dlContents: contents,
        dlType: params.type,
        dlUser: params.user?.trim() || null,
        dlServiceName: serviceName,
        // timestamp without tz: UTC 벽시계로 저장 → 조회 시 Seoul 변환
        dlDate: sql`(timezone('UTC', now()))::timestamp`,
        dlKeyField: keyField,
        dlKeyValue: keyValue,
        dlTableName: tableName,
        dlTableKorName: tableKorName,
        dlGroup: group,
        dlSource: params.source,
        dlBatchKey: params.batchKey ?? null,
      })
      .returning({ dlKey: dl.dlKey });

    const dlKey = rows[0]?.dlKey;
    if (dlKey == null) return { success: false, error: 'data_log 삽입 실패' };

    if (details.length > 0) {
      await db.insert(dd).values(
        details.map((d) => ({
          ddDlKey: dlKey,
          ddItem: d.item,
          ddBefore: d.before ?? null,
          ddAfter: d.after ?? null,
          ddColName: d.colName ?? d.item,
          ddKeyValue: keyValue,
        }))
      );
    }

    return { success: true, dlKey };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * sync_log / excel_sync_log 스타일 행들을 일괄 data_log로 기록.
 * kept 는 건너뛴다.
 */
export async function recordDataLogsFromSyncStyleRows(params: {
  source: DataLogSource;
  user?: string | null;
  tableName: string;
  tableKorName?: string | null;
  group?: string | null;
  serviceName?: string | null;
  batchKey?: string | null;
  rows: Array<{
    keyField: string;
    keyValue: string;
    operation: string | null;
    oldData?: Record<string, unknown> | null;
    newData?: Record<string, unknown> | null;
  }>;
}): Promise<{ success: boolean; recorded: number; error?: string }> {
  let recorded = 0;
  try {
    for (const row of params.rows) {
      const type = mapSyncOpToType(row.operation);
      if (!type) continue;
      const kv = String(row.keyValue ?? '').trim();
      const kf = String(row.keyField ?? '').trim();
      if (!kv || !kf) continue;
      const res = await recordDataLog({
        source: params.source,
        type,
        user: params.user,
        serviceName: params.serviceName,
        tableName: params.tableName,
        tableKorName: params.tableKorName,
        group: params.group,
        keyField: kf,
        keyValue: kv,
        batchKey: params.batchKey,
        oldData: row.oldData,
        newData: row.newData,
      });
      if (res.success) recorded += 1;
    }
    return { success: true, recorded };
  } catch (e: unknown) {
    return { success: false, recorded, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getDataLogList(params?: {
  page?: number;
  limit?: number;
  source?: string;
  tableName?: string;
  keyValue?: string;
}): Promise<{
  success: boolean;
  data?: Array<typeof dl.$inferSelect>;
  total?: number;
  error?: string;
}> {
  const page = Math.max(1, Math.floor(Number(params?.page) || 1));
  const limit = Math.min(200, Math.max(1, Math.floor(Number(params?.limit) || 50)));
  const offset = (page - 1) * limit;
  try {
    const conds = [];
    const src = params?.source?.trim();
    const tbl = params?.tableName?.trim();
    const kv = params?.keyValue?.trim();
    if (src) conds.push(eq(dl.dlSource, src));
    if (tbl) conds.push(eq(dl.dlTableName, tbl));
    if (kv) conds.push(eq(dl.dlKeyValue, kv));
    const where = conds.length ? and(...conds) : undefined;
    const data = await db
      .select()
      .from(dl)
      .where(where)
      .orderBy(desc(dl.dlDate), desc(dl.dlKey))
      .limit(limit)
      .offset(offset);
    const countRes = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(dl)
      .where(where);
    return { success: true, data, total: countRes[0]?.c ?? 0 };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
