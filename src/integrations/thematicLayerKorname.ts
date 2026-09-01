/**
 * 주제도(연속주제) 부모 테이블에 layer_korname 컬럼 보장·채우기.
 * tables.json 분할 자식(define_table_div_query + define_table_kor_name) 기준.
 */
import tables from '@/config/defineLayer/tables.json';
import { pool } from '@/database/db';
import { KRAS_THEMATIC_DEFINE_GROUPS } from '@/integrations/krasLayerSync.config';

const LOG = '[thematic-korname]';
export const LAYER_KORNAME_COLUMN = 'layer_korname';

type DefineTableRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
  define_table_schema?: string;
  define_table_parents_layer?: string;
  define_table_div_query?: string;
};

export type ThematicKornameFillResult = {
  parentTable: string;
  schema: string;
  ensuredColumn: boolean;
  updated: number;
  rules: number;
  skipped?: string;
};

function qi(ident: string): string {
  const n = ident.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error(`잘못된 식별자: ${ident}`);
  return `"${n}"`;
}

function isThematicGroup(group: string): boolean {
  if (!group) return false;
  if ((KRAS_THEMATIC_DEFINE_GROUPS as readonly string[]).includes(group)) return true;
  return group.startsWith('주제도');
}

/** `mnum LIKE '%CODE%'` → CODE (안전 문자만) */
export function extractMnumLikeCode(divQuery: string): string | null {
  const m = String(divQuery ?? '')
    .trim()
    .match(/^mnum\s+LIKE\s+'%([A-Za-z0-9]+)%'\s*$/i);
  return m?.[1] ?? null;
}

/** 부모 테이블 → [{ code, korName }] */
export function buildThematicKornameRulesByParent(): Map<
  string,
  { code: string; korName: string }[]
> {
  const byParent = new Map<string, { code: string; korName: string }[]>();
  for (const t of tables as DefineTableRow[]) {
    const schema = String(t.define_table_schema ?? '').trim();
    if (schema && schema !== 'public_layer' && schema !== 'layer') continue;
    const group = String(t.define_table_group ?? '').trim();
    if (!isThematicGroup(group)) continue;
    const parent = String(t.define_table_parents_layer ?? '').trim().toLowerCase();
    const kor = String(t.define_table_kor_name ?? '').trim();
    const code = extractMnumLikeCode(String(t.define_table_div_query ?? ''));
    if (!parent || !kor || !code) continue;
    const list = byParent.get(parent) ?? [];
    list.push({ code, korName: kor });
    byParent.set(parent, list);
  }
  return byParent;
}

export async function tableExists(schema: string, table: string): Promise<boolean> {
  const { rows } = await pool.query<{ c: string }>(
    `select to_regclass($1) as c`,
    [`${schema}.${table}`]
  );
  return Boolean(rows[0]?.c);
}

export async function columnExists(
  schema: string,
  table: string,
  column: string
): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `select exists(
       select 1 from information_schema.columns
       where table_schema = $1 and table_name = $2 and column_name = $3
     ) as ok`,
    [schema, table, column]
  );
  return Boolean(rows[0]?.ok);
}

/** 없으면 varchar 컬럼 추가. 추가했으면 true */
export async function ensureLayerKornameColumn(
  schema: string,
  table: string
): Promise<boolean> {
  if (await columnExists(schema, table, LAYER_KORNAME_COLUMN)) return false;
  await pool.query(
    `alter table ${qi(schema)}.${qi(table)}
     add column ${qi(LAYER_KORNAME_COLUMN)} character varying`
  );
  console.info(`${LOG} ADD COLUMN ${schema}.${table}.${LAYER_KORNAME_COLUMN}`);
  return true;
}

/**
 * 한 부모 테이블에 정의 규칙대로 layer_korname 채움.
 * schema 미지정이면 public_layer → layer 순으로 존재 테이블 사용.
 */
export async function fillLayerKornameForParent(
  parentTable: string,
  schemaHint?: 'public_layer' | 'layer'
): Promise<ThematicKornameFillResult> {
  const parent = parentTable.trim().toLowerCase();
  const rules = buildThematicKornameRulesByParent().get(parent) ?? [];
  if (!rules.length) {
    return {
      parentTable: parent,
      schema: schemaHint ?? 'public_layer',
      ensuredColumn: false,
      updated: 0,
      rules: 0,
      skipped: '정의 규칙 없음',
    };
  }

  let schema: 'public_layer' | 'layer' | null = schemaHint ?? null;
  if (!schema) {
    if (await tableExists('public_layer', parent)) schema = 'public_layer';
    else if (await tableExists('layer', parent)) schema = 'layer';
  }
  if (!schema || !(await tableExists(schema, parent))) {
    return {
      parentTable: parent,
      schema: schema ?? 'public_layer',
      ensuredColumn: false,
      updated: 0,
      rules: rules.length,
      skipped: '테이블 없음',
    };
  }

  if (!(await columnExists(schema, parent, 'mnum'))) {
    return {
      parentTable: parent,
      schema,
      ensuredColumn: false,
      updated: 0,
      rules: rules.length,
      skipped: 'mnum 컬럼 없음',
    };
  }

  const ensuredColumn = await ensureLayerKornameColumn(schema, parent);
  let updated = 0;
  for (const r of rules) {
    const { rowCount } = await pool.query(
      `update ${qi(schema)}.${qi(parent)}
       set ${qi(LAYER_KORNAME_COLUMN)} = $1
       where mnum like $2
         and (
           ${qi(LAYER_KORNAME_COLUMN)} is distinct from $1
         )`,
      [r.korName, `%${r.code}%`]
    );
    updated += rowCount ?? 0;
  }

  return {
    parentTable: parent,
    schema,
    ensuredColumn,
    updated,
    rules: rules.length,
  };
}

/** 정의에 있는 모든 주제도 부모 테이블 처리 */
export async function fillAllThematicLayerKornames(): Promise<ThematicKornameFillResult[]> {
  const byParent = buildThematicKornameRulesByParent();
  const results: ThematicKornameFillResult[] = [];
  for (const parent of [...byParent.keys()].sort()) {
    const r = await fillLayerKornameForParent(parent);
    results.push(r);
    if (r.skipped) {
      console.info(`${LOG} skip ${parent}: ${r.skipped}`);
    } else {
      console.info(
        `${LOG} ${r.schema}.${parent} rules=${r.rules} updated=${r.updated} colAdded=${r.ensuredColumn}`
      );
    }
  }
  return results;
}

/**
 * GeoCSS 라벨 — 기본은 종류명만.
 * 광로·소로·대로·중로는 THEMATIC_LABEL_WITH_ALIAS_EXPRESSION 사용.
 */
export const THEMATIC_LABEL_EXPRESSION = 'layer_korname';

/** 도로폭 구분(광로·소로·대로·중로) — 종류명 + (있으면) 별칭 */
export const THEMATIC_LABEL_WITH_ALIAS_EXPRESSION =
  "if_then_else(isNull(alias), layer_korname, if_then_else(equalTo(alias, ''), layer_korname, Concatenate(Concatenate(layer_korname, ' ('), Concatenate(alias, ')'))))";

/** 주제도 라벨 기본 글자 크기 */
export const THEMATIC_LABEL_FONT_SIZE = 12;

const ROAD_WIDTH_KOR_PREFIX = /^(광로|소로|대로|중로)/;

export function usesThematicAliasLabel(korName: string): boolean {
  return ROAD_WIDTH_KOR_PREFIX.test(String(korName ?? '').trim());
}

/** 레이어 정의명 → 라벨 표현식 */
export function resolveThematicLabelExpression(layerName: string): string {
  const name = layerName.trim().toLowerCase();
  for (const t of tables as DefineTableRow[]) {
    if (String(t.define_table_name ?? '').trim().toLowerCase() !== name) continue;
    if (usesThematicAliasLabel(String(t.define_table_kor_name ?? ''))) {
      return THEMATIC_LABEL_WITH_ALIAS_EXPRESSION;
    }
    break;
  }
  return THEMATIC_LABEL_EXPRESSION;
}
