/**
 * 레이어 추가속성(Extra) — 정의 테이블 + 행 jsonb(extra) 조회·저장
 * - 정의: public.layer_extra_def (신규 화면 템플릿)
 * - 행: 대상 테이블 extra jsonb 컬럼 (배열로 건별 순서 저장, 객체는 이전 형식)
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  buildLayerExtraDefineField,
  isLayerExtraFieldName,
  layerExtraDefineViewOff,
} from '@/lib/layerExtraField';
import * as fs from 'fs';
import * as path from 'path';

export type LayerExtraDefItem = {
  id?: number;
  fieldName: string;
  dataType: string;
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

/** extra 컬럼 항목 설정 — 보기 분류 체크 전부 해제. 없으면 추가 */
function upsertLayerExtraDefineField(tableName: string): { ok: boolean; error?: string } {
  const filePath = defineFieldsFilePath(tableName);
  if (!String(tableName ?? '').trim()) return { ok: false, error: 'tableName이 필요합니다.' };
  try {
    let fields: Record<string, unknown>[] = [];
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (Array.isArray(parsed)) fields = parsed as Record<string, unknown>[];
    }
    const idx = fields.findIndex((f) =>
      isLayerExtraFieldName(String(f.define_field_name ?? ''))
    );
    if (idx >= 0) {
      fields[idx] = { ...fields[idx], ...layerExtraDefineViewOff() };
    } else {
      const maxIdx = fields.reduce((m, f) => {
        const n = parseInt(String(f.define_field_idx ?? '0'), 10);
        return Number.isFinite(n) ? Math.max(m, n) : m;
      }, 0);
      fields.push(buildLayerExtraDefineField(maxIdx + 1));
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(fields, null, 2)}\n`, 'utf-8');
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
    const defRes = upsertLayerExtraDefineField(tableName);
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
    const defRes = upsertLayerExtraDefineField(tableName);
    if (!defRes.ok) {
      return {
        success: false,
        error: defRes.error ?? '컬럼은 추가됐으나 항목 설정 반영에 실패했습니다.',
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
    data.forEach((item, idx) => {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) return;
      const rec = item as Record<string, unknown>;
      const fieldName = String(rec.fieldName ?? rec.n ?? rec.name ?? '').trim();
      if (!fieldName) return;
      const key = fieldName.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      fields.push({
        fieldName,
        value: extraValueToString(rec.value ?? rec.v),
        dataType:
          String(rec.dataType ?? rec.t ?? typeByName.get(key) ?? 'text').trim() || 'text',
        sortOrder: idx + 1,
      });
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

  const jsonLiteral = JSON.stringify(extraArr).replace(/'/g, "''");

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
