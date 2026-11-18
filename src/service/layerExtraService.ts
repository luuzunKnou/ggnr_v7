/**
 * 레이어 추가속성(Extra) — 정의 테이블 + 행 jsonb(extra) 조회·저장
 * - 정의: public.layer_extra_def (신규 화면 템플릿·현재 항목)
 * - 원본 이력: public.layer_extra_source (SHP에서 뺀 필드 누적, 재업로드 구조검증)
 * - 행: 대상 테이블 extra jsonb 컬럼 (배열로 건별 순서 저장, 객체는 이전 형식)
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { getSessionUsrId } from '@/lib/auth/guard';
import { isLayerExtraFieldName } from '@/lib/layerExtraField';
import * as fs from 'fs';
import * as path from 'path';

export type LayerExtraDefItem = {
  id?: number;
  fieldName: string;
  dataType: string;
  sortOrder: number;
};

/** SHP→extra 원본 필드 이력 (누적 + 현재 active) */
export type LayerExtraSourceItem = {
  id?: number;
  sourceField: string;
  fieldName: string;
  dataType: string;
  isActive: boolean;
  sortOrder: number;
};

export type LayerExtraFieldValue = {
  fieldName: string;
  dataType: string;
  value: string;
  sortOrder: number;
};

async function requireSession(): Promise<string> {
  const id = (await getSessionUsrId())?.trim() ?? '';
  if (!id) throw new Error('로그인이 필요합니다.');
  return id;
}

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

const DEFINE_FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');

function defineFieldsFilePath(tableName: string): string {
  const safe = String(tableName ?? '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase();
  return path.join(DEFINE_FIELDS_DIR, `table_${safe}.json`);
}

/** extra jsonb 컬럼은 항목 설정에 두지 않는다. 이미 있으면 뺀다. */
function stripLayerExtraDefineField(tableName: string): { ok: boolean; error?: string } {
  const filePath = defineFieldsFilePath(tableName);
  if (!String(tableName ?? '').trim()) return { ok: false, error: 'tableName이 필요합니다.' };
  try {
    if (!fs.existsSync(filePath)) return { ok: true };
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(parsed)) return { ok: true };
    const next = (parsed as Record<string, unknown>[]).filter(
      (f) => !isLayerExtraFieldName(String(f?.define_field_name ?? ''))
    );
    if (next.length === parsed.length) return { ok: true };
    fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function normSchema(schema?: string | null): string {
  const s = String(schema ?? 'layer').trim();
  return s === 'public_layer' ? 'public_layer' : s || 'layer';
}

function normTable(table?: string | null): string {
  return String(table ?? '').trim();
}

async function tableExists(schema: string, table: string): Promise<boolean> {
  const res = await db.execute(
    sql.raw(
      `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = '${esc(schema)}'
         AND table_name = '${esc(table)}'
       LIMIT 1`
    )
  );
  return (res.rows?.length ?? 0) > 0;
}

async function columnExists(schema: string, table: string, column: string): Promise<boolean> {
  const res = await db.execute(
    sql.raw(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = '${esc(schema)}'
         AND table_name = '${esc(table)}'
         AND column_name = '${esc(column)}'
       LIMIT 1`
    )
  );
  return (res.rows?.length ?? 0) > 0;
}

/** 대상 레이어 테이블에 extra(jsonb) 컬럼이 있는지 확인 */
export async function checkLayerExtraColumn(params?: {
  tableName?: string;
  tableSchema?: string;
}): Promise<{ hasColumn: boolean; tableExists: boolean; error?: string }> {
  const tableName = normTable(params?.tableName);
  const tableSchema = normSchema(params?.tableSchema);
  if (!tableName) return { hasColumn: false, tableExists: false, error: 'tableName이 필요합니다.' };

  const tExists = await tableExists(tableSchema, tableName);
  if (!tExists) return { hasColumn: false, tableExists: false };
  const hasCol = await columnExists(tableSchema, tableName, 'extra');
  return { hasColumn: hasCol, tableExists: true };
}

/**
 * 대상 레이어 테이블에 extra jsonb 컬럼 추가
 * DB에 직접 ALTER TABLE 실행 — 사용자가 명시적으로 요청한 경우만
 */
export async function addLayerExtraColumn(params?: {
  tableName?: string;
  tableSchema?: string;
}): Promise<{ success: boolean; error?: string }> {
  const tableName = normTable(params?.tableName);
  const tableSchema = normSchema(params?.tableSchema);
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };
  if (!(await tableExists(tableSchema, tableName))) {
    return { success: false, error: '테이블을 찾을 수 없습니다.' };
  }
  if (await columnExists(tableSchema, tableName, 'extra')) {
    const defRes = stripLayerExtraDefineField(tableName);
    if (!defRes.ok) return { success: false, error: defRes.error };
    return { success: true };
  }
  try {
    await db.execute(
      sql.raw(
        `ALTER TABLE ${quoteIdent(tableSchema)}.${quoteIdent(tableName)}
         ADD COLUMN extra jsonb;
         COMMENT ON COLUMN ${quoteIdent(tableSchema)}.${quoteIdent(tableName)}.extra IS '추가속성';`
      )
    );
    const defRes = stripLayerExtraDefineField(tableName);
    if (!defRes.ok) {
      return {
        success: false,
        error: defRes.error ?? '컬럼은 추가됐으나 항목 설정에서 extra를 빼지 못했습니다.',
      };
    }
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 정의 테이블 없으면 생성 (public) */
export async function ensureLayerExtraDefTable(): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.execute(sql.raw(`
CREATE TABLE IF NOT EXISTS public.layer_extra_def (
  id serial PRIMARY KEY,
  table_schema varchar(64) NOT NULL DEFAULT 'layer',
  table_name varchar(128) NOT NULL,
  field_name varchar(128) NOT NULL,
  data_type varchar(64) NOT NULL DEFAULT 'text',
  sort_order integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS layer_extra_def_schema_table_field_uidx
  ON public.layer_extra_def (table_schema, table_name, field_name);
COMMENT ON TABLE public.layer_extra_def IS '레이어 추가속성 정의';
`));
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** SHP 원본 필드 이력 테이블 없으면 생성 (public) */
export async function ensureLayerExtraSourceTable(): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.execute(sql.raw(`
CREATE TABLE IF NOT EXISTS public.layer_extra_source (
  id serial PRIMARY KEY,
  table_schema varchar(64) NOT NULL DEFAULT 'layer',
  table_name varchar(128) NOT NULL,
  source_field varchar(128) NOT NULL,
  field_name varchar(128) NOT NULL,
  data_type varchar(64) NOT NULL DEFAULT 'text',
  is_active boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT layer_extra_source_schema_table_src_uidx
    UNIQUE (table_schema, table_name, source_field)
);
COMMENT ON TABLE public.layer_extra_source IS 'SHP 추가속성 원본 필드 이력(구조검증·재업로드용)';
COMMENT ON COLUMN public.layer_extra_source.source_field IS 'SHP 원본 속성명';
COMMENT ON COLUMN public.layer_extra_source.is_active IS '현재 extra 값 반영 여부';
`));
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listLayerExtraSources(params?: {
  tableName?: string;
  tableSchema?: string;
  activeOnly?: boolean;
}): Promise<{ items: LayerExtraSourceItem[]; error?: string }> {
  const tableName = normTable(params?.tableName);
  const tableSchema = normSchema(params?.tableSchema);
  if (!tableName) return { items: [], error: 'tableName이 필요합니다.' };

  const ensured = await ensureLayerExtraSourceTable();
  if (!ensured.ok) return { items: [], error: ensured.error };

  try {
    const activeOnly = params?.activeOnly === true;
    const res = await db.execute(
      sql.raw(
        `SELECT id, source_field, field_name, data_type, is_active, sort_order
         FROM public.layer_extra_source
         WHERE table_schema = '${esc(tableSchema)}'
           AND lower(table_name) = lower('${esc(tableName)}')
           ${activeOnly ? 'AND is_active = true' : ''}
         ORDER BY sort_order ASC, id ASC`
      )
    );
    const items: LayerExtraSourceItem[] = (res.rows ?? []).map((r) => {
      const row = r as {
        id?: number;
        source_field?: string;
        field_name?: string;
        data_type?: string;
        is_active?: boolean | string;
        sort_order?: number;
      };
      const active = row.is_active === true || row.is_active === 't' || row.is_active === 'true';
      return {
        id: Number(row.id) || undefined,
        sourceField: String(row.source_field ?? '').trim(),
        fieldName: String(row.field_name ?? '').trim(),
        dataType: String(row.data_type ?? 'text').trim() || 'text',
        isActive: active,
        sortOrder: Number(row.sort_order) || 0,
      };
    }).filter((x) => x.sourceField);
    return { items };
  } catch (e: unknown) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * active 항목을 인자로 교체(UPSERT + 나머지 is_active=false).
 * 행은 삭제하지 않아 knownSources(이력)가 유지된다.
 */
export async function saveLayerExtraSourcesActive(params?: {
  tableName?: string;
  tableSchema?: string;
  items?: Array<{
    sourceField: string;
    fieldName: string;
    dataType?: string;
    sortOrder?: number;
  }>;
}): Promise<{ success: boolean; saved?: number; error?: string }> {
  const tableName = normTable(params?.tableName);
  const tableSchema = normSchema(params?.tableSchema);
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };

  const ensured = await ensureLayerExtraSourceTable();
  if (!ensured.ok) return { success: false, error: ensured.error };

  const rawItems = Array.isArray(params?.items) ? params!.items! : [];
  const cleaned: Array<{
    sourceField: string;
    fieldName: string;
    dataType: string;
    sortOrder: number;
  }> = [];
  const seen = new Set<string>();
  rawItems.forEach((it, idx) => {
    const sourceField = String(it?.sourceField ?? '').trim();
    if (!sourceField) return;
    const key = sourceField.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    cleaned.push({
      sourceField,
      fieldName: String(it?.fieldName ?? '').trim() || sourceField,
      dataType: String(it?.dataType ?? 'text').trim() || 'text',
      sortOrder: Number.isFinite(Number(it?.sortOrder)) ? Number(it.sortOrder) : idx + 1,
    });
  });

  try {
    for (const it of cleaned) {
      await db.execute(
        sql.raw(
          `INSERT INTO public.layer_extra_source
             (table_schema, table_name, source_field, field_name, data_type, is_active, sort_order)
           VALUES
             ('${esc(tableSchema)}', '${esc(tableName)}', '${esc(it.sourceField)}',
              '${esc(it.fieldName)}', '${esc(it.dataType)}', true, ${Number(it.sortOrder) || 0})
           ON CONFLICT (table_schema, table_name, source_field)
           DO UPDATE SET
             field_name = EXCLUDED.field_name,
             data_type = EXCLUDED.data_type,
             is_active = true,
             sort_order = EXCLUDED.sort_order`
        )
      );
    }
    if (cleaned.length === 0) {
      await db.execute(
        sql.raw(
          `UPDATE public.layer_extra_source
           SET is_active = false
           WHERE table_schema = '${esc(tableSchema)}'
             AND lower(table_name) = lower('${esc(tableName)}')`
        )
      );
    } else {
      const inList = cleaned.map((c) => `'${esc(c.sourceField.toLowerCase())}'`).join(', ');
      await db.execute(
        sql.raw(
          `UPDATE public.layer_extra_source
           SET is_active = false
           WHERE table_schema = '${esc(tableSchema)}'
             AND lower(table_name) = lower('${esc(tableName)}')
             AND lower(source_field) NOT IN (${inList})`
        )
      );
    }
    return { success: true, saved: cleaned.length };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getLayerExtraDefs(params?: {
  tableName?: string;
  tableSchema?: string;
}): Promise<{ items: LayerExtraDefItem[]; error?: string }> {
  try {
    await requireSession();
  } catch (e: unknown) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
  const tableName = normTable(params?.tableName);
  const tableSchema = normSchema(params?.tableSchema);
  if (!tableName) return { items: [], error: 'tableName이 필요합니다.' };

  const ensured = await ensureLayerExtraDefTable();
  if (!ensured.ok) return { items: [], error: ensured.error };

  try {
    const res = await db.execute(
      sql.raw(
        `SELECT id, field_name, data_type, sort_order
         FROM public.layer_extra_def
         WHERE table_schema = '${esc(tableSchema)}'
           AND lower(table_name) = lower('${esc(tableName)}')
         ORDER BY sort_order ASC, id ASC`
      )
    );
    const items: LayerExtraDefItem[] = (res.rows ?? []).map((r) => {
      const row = r as {
        id?: number;
        field_name?: string;
        data_type?: string;
        sort_order?: number;
      };
      return {
        id: Number(row.id) || undefined,
        fieldName: String(row.field_name ?? '').trim(),
        dataType: String(row.data_type ?? 'text').trim() || 'text',
        sortOrder: Number(row.sort_order) || 0,
      };
    }).filter((x) => x.fieldName);
    return { items };
  } catch (e: unknown) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 해당 레이어 정의를 통째로 교체 */
export async function saveLayerExtraDefs(params?: {
  tableName?: string;
  tableSchema?: string;
  items?: LayerExtraDefItem[];
}): Promise<{ success: boolean; saved?: number; error?: string }> {
  try {
    await requireSession();
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
  const tableName = normTable(params?.tableName);
  const tableSchema = normSchema(params?.tableSchema);
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };

  const ensured = await ensureLayerExtraDefTable();
  if (!ensured.ok) return { success: false, error: ensured.error };

  const rawItems = Array.isArray(params?.items) ? params!.items! : [];
  const cleaned: LayerExtraDefItem[] = [];
  const seen = new Set<string>();
  rawItems.forEach((it, idx) => {
    const fieldName = String(it?.fieldName ?? '').trim();
    if (!fieldName) return;
    const key = fieldName.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    cleaned.push({
      fieldName,
      dataType: String(it?.dataType ?? 'text').trim() || 'text',
      sortOrder: Number.isFinite(Number(it?.sortOrder)) ? Number(it.sortOrder) : idx + 1,
    });
  });

  try {
    await db.execute(
      sql.raw(
        `DELETE FROM public.layer_extra_def
         WHERE table_schema = '${esc(tableSchema)}'
           AND lower(table_name) = lower('${esc(tableName)}')`
      )
    );
    for (const it of cleaned) {
      await db.execute(
        sql.raw(
          `INSERT INTO public.layer_extra_def
             (table_schema, table_name, field_name, data_type, sort_order)
           VALUES
             ('${esc(tableSchema)}', '${esc(tableName)}', '${esc(it.fieldName)}',
              '${esc(it.dataType)}', ${Number(it.sortOrder) || 0})`
        )
      );
    }
    return { success: true, saved: cleaned.length };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function extraValueToString(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

function parseExtraJson(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  return raw;
}

/**
 * extra 컬럼 파싱.
 * - 배열: 건별 화면 순서 (저장 형식)
 * - 객체: 이전 형식. 정의 순번으로만 맞춤
 */
function parseExtraFields(
  raw: unknown,
  typeByName: Map<string, string>,
  orderByName: Map<string, number>
): LayerExtraFieldValue[] {
  const data = parseExtraJson(raw);
  if (data == null) return [];

  if (Array.isArray(data)) {
    const seen = new Set<string>();
    const fields: LayerExtraFieldValue[] = [];
    const legacyMeta = new Set(['fieldname', 'datatype', 'value', 'sortorder', 'n', 't', 'v', 'name']);
    data.forEach((item, idx) => {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) return;
      const rec = item as Record<string, unknown>;
      const legacyName = String(rec.fieldName ?? rec.n ?? rec.name ?? '').trim();
      const isLegacy =
        !!legacyName &&
        (Object.prototype.hasOwnProperty.call(rec, 'value') ||
          Object.prototype.hasOwnProperty.call(rec, 'v') ||
          Object.prototype.hasOwnProperty.call(rec, 'dataType') ||
          Object.prototype.hasOwnProperty.call(rec, 'sortOrder'));
      if (isLegacy) {
        const key = legacyName.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        fields.push({
          fieldName: legacyName,
          value: extraValueToString(rec.value ?? rec.v),
          dataType:
            String(rec.dataType ?? rec.t ?? typeByName.get(key) ?? 'text').trim() || 'text',
          sortOrder: idx + 1,
        });
        return;
      }
      // [{"컬럼명":"값", ...}] — 키=속성명, 값=속성값
      for (const [rawName, rawVal] of Object.entries(rec)) {
        const fieldName = String(rawName ?? '').trim();
        if (!fieldName) continue;
        if (legacyMeta.has(fieldName.toLowerCase())) continue;
        const key = fieldName.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        fields.push({
          fieldName,
          value: extraValueToString(rawVal),
          dataType: typeByName.get(key) ?? 'text',
          sortOrder: fields.length + 1,
        });
      }
    });
    return fields;
  }

  if (typeof data !== 'object') return [];

  const rec = data as Record<string, unknown>;
  if (Array.isArray(rec.items)) {
    return parseExtraFields(rec.items, typeByName, orderByName);
  }

  const fields: LayerExtraFieldValue[] = [];
  for (const [fieldNameRaw, value] of Object.entries(rec)) {
    const fieldName = String(fieldNameRaw ?? '').trim();
    if (!fieldName) continue;
    const key = fieldName.toLowerCase();
    fields.push({
      fieldName,
      value: extraValueToString(value),
      dataType: typeByName.get(key) ?? 'text',
      sortOrder: orderByName.get(key) ?? fields.length + 1,
    });
  }
  fields.sort((a, b) => a.sortOrder - b.sortOrder || a.fieldName.localeCompare(b.fieldName));
  return fields;
}

export async function getLayerRowExtra(params?: {
  tableName?: string;
  tableSchema?: string;
  keyField?: string;
  keyValue?: string;
}): Promise<{
  fields: LayerExtraFieldValue[];
  hasExtraColumn: boolean;
  error?: string;
}> {
  try {
    await requireSession();
  } catch (e: unknown) {
    return {
      fields: [],
      hasExtraColumn: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const tableName = normTable(params?.tableName);
  const tableSchema = normSchema(params?.tableSchema);
  const keyField = String(params?.keyField ?? '').trim();
  const keyValue = String(params?.keyValue ?? '').trim();
  if (!tableName || !keyField || !keyValue) {
    return { fields: [], hasExtraColumn: false, error: 'tableName·keyField·keyValue가 필요합니다.' };
  }

  if (!(await tableExists(tableSchema, tableName))) {
    return { fields: [], hasExtraColumn: false, error: '테이블을 찾을 수 없습니다.' };
  }
  const hasExtraColumn = await columnExists(tableSchema, tableName, 'extra');
  if (!hasExtraColumn) {
    return { fields: [], hasExtraColumn: false };
  }

  const defs = await getLayerExtraDefs({ tableName, tableSchema });
  const typeByName = new Map(
    defs.items.map((d) => [d.fieldName.toLowerCase(), d.dataType] as const)
  );
  const orderByName = new Map(
    defs.items.map((d) => [d.fieldName.toLowerCase(), d.sortOrder] as const)
  );

  try {
    const res = await db.execute(
      sql.raw(
        `SELECT ${quoteIdent('extra')} AS extra
         FROM ${quoteIdent(tableSchema)}.${quoteIdent(tableName)}
         WHERE ${quoteIdent(keyField)}::text = '${esc(keyValue)}'
         LIMIT 1`
      )
    );
    const raw = (res.rows?.[0] as { extra?: unknown } | undefined)?.extra;
    const fields = parseExtraFields(raw, typeByName, orderByName);
    return { fields, hasExtraColumn: true };
  } catch (e: unknown) {
    return {
      fields: [],
      hasExtraColumn: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 행 extra jsonb만 갱신. replaceDefs=true 이면 정의 테이블도 화면 항목으로 교체(신규용) */
export async function saveLayerRowExtra(params?: {
  tableName?: string;
  tableSchema?: string;
  keyField?: string;
  keyValue?: string;
  fields?: LayerExtraFieldValue[];
  /** 신규 저장 시에만 true — 정의 테이블 교체 */
  replaceDefs?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireSession();
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
  const tableName = normTable(params?.tableName);
  const tableSchema = normSchema(params?.tableSchema);
  const keyField = String(params?.keyField ?? '').trim();
  const keyValue = String(params?.keyValue ?? '').trim();
  if (!tableName || !keyField || !keyValue) {
    return { success: false, error: 'tableName·keyField·keyValue가 필요합니다.' };
  }

  if (!(await tableExists(tableSchema, tableName))) {
    return { success: false, error: '테이블을 찾을 수 없습니다.' };
  }

  const rawFields = Array.isArray(params?.fields) ? params!.fields! : [];
  const extraArr: LayerExtraFieldValue[] = [];
  const defItems: LayerExtraDefItem[] = [];
  const seen = new Set<string>();
  rawFields.forEach((f, idx) => {
    const fieldName = String(f?.fieldName ?? '').trim();
    if (!fieldName) return;
    const key = fieldName.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const dataType = String(f?.dataType ?? 'text').trim() || 'text';
    const sortOrder = idx + 1;
    extraArr.push({
      fieldName,
      dataType,
      value: f?.value == null ? '' : String(f.value),
      sortOrder,
    });
    defItems.push({
      fieldName,
      dataType,
      sortOrder,
    });
  });

  const hasExtra = await columnExists(tableSchema, tableName, 'extra');
  if (!hasExtra) {
    if (extraArr.length > 0) {
      return {
        success: false,
        error: `${tableSchema}.${tableName} 에 extra(jsonb) 컬럼이 없습니다. DB에 추가 후 다시 시도하세요.`,
      };
    }
    if (params?.replaceDefs === true) {
      const defRes = await saveLayerExtraDefs({
        tableName,
        tableSchema,
        items: defItems,
      });
      if (!defRes.success) {
        return { success: false, error: defRes.error ?? '정의 테이블 저장에 실패했습니다.' };
      }
    }
    return { success: true };
  }

  // 저장 형식: [{"컬럼명":"값", ...}] (레거시 fieldName/value 배열은 조회만 호환)
  const rowObj: Record<string, string> = {};
  for (const f of extraArr) {
    rowObj[f.fieldName] = f.value;
  }
  const jsonLiteral = JSON.stringify(extraArr.length > 0 ? [rowObj] : []).replace(/'/g, "''");

  try {
    await db.execute(
      sql.raw(
        `UPDATE ${quoteIdent(tableSchema)}.${quoteIdent(tableName)}
         SET ${quoteIdent('extra')} = '${jsonLiteral}'::jsonb
         WHERE ${quoteIdent(keyField)}::text = '${esc(keyValue)}'`
      )
    );
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (params?.replaceDefs === true) {
    const defRes = await saveLayerExtraDefs({
      tableName,
      tableSchema,
      items: defItems,
    });
    if (!defRes.success) {
      return { success: false, error: defRes.error ?? '정의 테이블 저장에 실패했습니다.' };
    }
  }

  return { success: true };
}
