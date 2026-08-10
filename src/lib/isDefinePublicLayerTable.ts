import fs from 'fs';
import path from 'path';

const TABLES_JSON_PATH = path.join(
  process.cwd(),
  'src',
  'config',
  'defineLayer',
  'tables.json'
);

/**
 * tables.json 기준 define_table_schema 가 public_layer 인지 판별.
 * 정의가 없거나 읽기 실패 시 false.
 */
export function isDefinePublicLayerTable(tableName: string): boolean {
  const name = String(tableName ?? '').trim();
  if (!name) return false;
  try {
    if (!fs.existsSync(TABLES_JSON_PATH)) return false;
    const raw = fs.readFileSync(TABLES_JSON_PATH, 'utf-8');
    const tables = JSON.parse(raw) as Array<{
      define_table_name?: string;
      define_table_schema?: string;
    }>;
    if (!Array.isArray(tables)) return false;
    const target = name.toLowerCase();
    const row = tables.find(
      (t) => String(t.define_table_name ?? '').trim().toLowerCase() === target
    );
    return String(row?.define_table_schema ?? '').trim() === 'public_layer';
  } catch {
    return false;
  }
}
