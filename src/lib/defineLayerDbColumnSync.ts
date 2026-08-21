/**
 * defineLayer fields JSON → DB 동기화용 PG 컬럼 정의
 */
import fs from 'node:fs';
import path from 'node:path';

import type { SchemaDefinedColumn } from '@/database/schemaSyncRegistry';
import { normalizeDefineFieldType } from '@/lib/defineLayerFieldTypeNormalize';

const FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');
const TABLES_JSON = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'tables.json');

type TablesJsonRow = {
  define_table_name?: string;
  define_table_schema?: string;
  define_table_kor_name?: string;
};

function defineFieldTypeToPg(rawType: unknown): string {
  const t = normalizeDefineFieldType(rawType);
  if (t === 'GEOMETRY') return 'geometry(Geometry,5181)';
  return 'text';
}

function loadDefineFields(tableName: string): Record<string, unknown>[] {
  const safe = tableName.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  const filePath = path.join(FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function findDefineLayerTableRow(tableName: string): TablesJsonRow | null {
  const key = tableName.trim().toLowerCase();
  if (!key) return null;
  try {
    if (!fs.existsSync(TABLES_JSON)) return null;
    const parsed = JSON.parse(fs.readFileSync(TABLES_JSON, 'utf-8'));
    if (!Array.isArray(parsed)) return null;
    for (const row of parsed as TablesJsonRow[]) {
      const name = String(row.define_table_name ?? '').trim().toLowerCase();
      if (name === key) return row;
    }
  } catch {
    return null;
  }
  return null;
}

/** tables.json에 등록된 layer/public_layer 테이블의 defineLayer 컬럼 정의 */
export function getDefineLayerDefinedColumns(
  schema: string,
  table: string
): SchemaDefinedColumn[] | null {
  const schemaLc = schema.trim().toLowerCase();
  const tableLc = table.trim().toLowerCase();
  if (!schemaLc || !tableLc) return null;

  const row = findDefineLayerTableRow(tableLc);
  if (!row) return null;

  const rowSchema = String(row.define_table_schema ?? 'layer').trim().toLowerCase();
  if (rowSchema !== schemaLc) return null;
  if (schemaLc !== 'layer' && schemaLc !== 'public_layer') return null;

  const fields = loadDefineFields(tableLc);
  if (fields.length === 0) return null;

  const cols: SchemaDefinedColumn[] = [];
  for (const f of fields) {
    const name = String(f.define_field_name ?? '').trim();
    if (!name) continue;
    const kor = String(f.define_field_kor_name ?? name).trim();
    cols.push({
      name,
      type: defineFieldTypeToPg(f.define_field_type),
      notNull: false,
      ...(kor ? { comment: kor } : {}),
    });
  }

  return cols.length > 0 ? cols : null;
}

export function getDefineLayerTableComment(schema: string, table: string): string | null {
  const row = findDefineLayerTableRow(table);
  if (!row) return null;
  const rowSchema = String(row.define_table_schema ?? 'layer').trim().toLowerCase();
  if (rowSchema !== schema.trim().toLowerCase()) return null;
  const kor = String(row.define_table_kor_name ?? '').trim();
  return kor || null;
}

export function getDefineLayerColumnComment(
  schema: string,
  table: string,
  columnName: string
): string | null {
  const cols = getDefineLayerDefinedColumns(schema, table);
  const col = cols?.find((c) => c.name === columnName);
  return col?.comment ?? null;
}

/** Drizzle 정의 우선, 없으면 defineLayer fields */
export function resolveDefinedColumns(
  schema: string,
  table: string,
  drizzleCols: SchemaDefinedColumn[] | null | undefined
): SchemaDefinedColumn[] | null {
  if (drizzleCols?.length) return drizzleCols;
  return getDefineLayerDefinedColumns(schema, table);
}

/** Drizzle registry에 없고 fields JSON이 있는 layer/public_layer 테이블 */
export function listDefineLayerTablesForSync(): Array<{ schema: string; table: string }> {
  try {
    if (!fs.existsSync(TABLES_JSON)) return [];
    const parsed = JSON.parse(fs.readFileSync(TABLES_JSON, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    const out: Array<{ schema: string; table: string }> = [];
    for (const row of parsed as TablesJsonRow[]) {
      const table = String(row.define_table_name ?? '').trim().toLowerCase();
      const schema = String(row.define_table_schema ?? 'layer').trim().toLowerCase();
      if (!table || (schema !== 'layer' && schema !== 'public_layer')) continue;
      const fields = loadDefineFields(table);
      if (fields.length === 0) continue;
      out.push({ schema, table });
    }
    return out;
  } catch {
    return [];
  }
}
