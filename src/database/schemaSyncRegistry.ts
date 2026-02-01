/**
 * database/schema에 정의된 테이블·컬럼 목록을 제공합니다.
 * 테이블 구조 동기화 시 "정의된 구조" 기준으로 사용합니다.
 * schema/ 폴더에 .ts 파일만 추가하면 자동으로 검사 대상에 포함됩니다 (index.ts 제외).
 */

import { getTableConfig } from 'drizzle-orm/pg-core';

type PgTableLike = Parameters<typeof getTableConfig>[0];

/** Webpack require.context: schema 폴더 내 .ts 파일만 로드 (index 제외) */
function getSchemaContext(): { keys: string[]; require: (key: string) => unknown } | null {
  if (typeof require === 'undefined') return null;
  const ctx = (require as NodeRequire & { context?: (dir: string, sub: boolean, re: RegExp) => { keys: () => string[]; (id: string): unknown } }).context?.(
    './schema',
    false,
    /^\.\/[^/]+\.ts$/
  );
  if (!ctx) return null;
  const keys = ctx.keys().filter((k) => !k.endsWith('index.ts') && k !== './index.ts');
  return { keys, require: (k: string) => ctx(k) };
}

function discoverSchemaTables(): {
  tables: PgTableLike[];
  tableCommentsByIndex: (string | undefined)[];
  columnCommentsByIndex: Record<string, string>[];
} {
  const tables: PgTableLike[] = [];
  const tableCommentsByIndex: (string | undefined)[] = [];
  const columnCommentsByIndex: Record<string, string>[] = [];

  const ctx = getSchemaContext();
  if (ctx) {
    ctx.keys.forEach((key) => {
      const mod = ctx.require(key) as Record<string, unknown>;
      if (!mod || typeof mod !== 'object') return;
      for (const [k, value] of Object.entries(mod)) {
        if (typeof value !== 'object' || value === null) continue;
        if (k.endsWith('TableComment') || k.endsWith('ColumnComments')) continue;
        try {
          const config = getTableConfig(value as PgTableLike);
          if (config?.name) {
            tables.push(value as PgTableLike);
            const tableComment = mod[`${k}TableComment`];
            const columnComments = mod[`${k}ColumnComments`];
            tableCommentsByIndex.push(
              typeof tableComment === 'string' ? tableComment : undefined
            );
            columnCommentsByIndex.push(
              typeof columnComments === 'object' && columnComments !== null && !Array.isArray(columnComments)
                ? (columnComments as Record<string, string>)
                : {}
            );
            break;
          }
        } catch {
          // not a pgTable
        }
      }
    });
  } else {
    /** require.context 미지원 시: index를 통해 로드 (index.ts에 export * 추가 필요) */
    const schemaExports = require('./schema') as Record<string, unknown>;
    for (const [key, value] of Object.entries(schemaExports)) {
      if (typeof value !== 'object' || value === null) continue;
      if (key.endsWith('TableComment') || key.endsWith('ColumnComments')) continue;
      try {
        const config = getTableConfig(value as PgTableLike);
        if (config?.name) {
          tables.push(value as PgTableLike);
          const tableComment = schemaExports[`${key}TableComment`];
          const columnComments = schemaExports[`${key}ColumnComments`];
          tableCommentsByIndex.push(
            typeof tableComment === 'string' ? tableComment : undefined
          );
          columnCommentsByIndex.push(
            typeof columnComments === 'object' && columnComments !== null && !Array.isArray(columnComments)
              ? (columnComments as Record<string, string>)
              : {}
          );
        }
      } catch {
        // not a pgTable
      }
    }
  }

  const withConfig = tables.map((t, i) => ({
    table: t,
    config: getTableConfig(t),
    tableComment: tableCommentsByIndex[i],
    columnComments: columnCommentsByIndex[i],
  }));
  withConfig.sort((a, b) => {
    const sa = a.config.schema ?? 'public';
    const sb = b.config.schema ?? 'public';
    if (sa !== sb) return sa.localeCompare(sb);
    return a.config.name.localeCompare(b.config.name);
  });

  return {
    tables: withConfig.map((x) => x.table),
    tableCommentsByIndex: withConfig.map((x) => x.tableComment),
    columnCommentsByIndex: withConfig.map((x) => x.columnComments),
  };
}

const { tables: schemaTables, tableCommentsByIndex: schemaTableCommentsByIndex, columnCommentsByIndex: schemaColumnCommentsByIndex } = discoverSchemaTables();

/** ER 다이어그램 등에서 스키마 테이블+코멘트 목록 사용 (getTableConfig와 함께 사용) */
export function getDiscoveredTablesWithComments(): {
  table: PgTableLike;
  tableComment: string;
  columnComments: Record<string, string>;
}[] {
  return schemaTables.map((table, i) => ({
    table,
    tableComment: typeof schemaTableCommentsByIndex[i] === 'string' ? schemaTableCommentsByIndex[i]! : '',
    columnComments: schemaColumnCommentsByIndex[i] ?? {},
  }));
}

export type SchemaDefinedTable = { schema: string; table: string };

export type SchemaDefinedColumn = { name: string; type: string; notNull: boolean; comment?: string };

/** ADD COLUMN 시 readonly(GENERATED)가 되지 않도록 타입에서 GENERATED 절 제거 */
function toWritableColumnType(type: string): string {
  if (!type || typeof type !== 'string') return 'text';
  const t = type.trim();
  const generatedIdx = t.toUpperCase().indexOf(' GENERATED ');
  if (generatedIdx > 0) return t.slice(0, generatedIdx).trim();
  return t;
}

function getDefinedTablesUncached(): SchemaDefinedTable[] {
  const result: SchemaDefinedTable[] = [];
  for (const t of schemaTables) {
    const config = getTableConfig(t);
    const schemaName = config.schema ?? 'public';
    result.push({ schema: schemaName, table: config.name });
  }
  return result;
}

/**
 * database/schema에 정의된 테이블 목록 (schema.table)
 */
export function getSchemaDefinedTables(): SchemaDefinedTable[] {
  return getDefinedTablesUncached();
}

const definedColumnsCache = new Map<string, SchemaDefinedColumn[]>();

function getDefinedColumnsUncached(schema: string, table: string): SchemaDefinedColumn[] | null {
  for (let i = 0; i < schemaTables.length; i++) {
    const t = schemaTables[i];
    const config = getTableConfig(t);
    const schemaName = config.schema ?? 'public';
    if (schemaName === schema && config.name === table) {
      const columnComments = schemaColumnCommentsByIndex[i];
      const cols = config.columns.map((c) => {
        const pgCol = c as { name: string; getSQLType?: () => string; notNull?: boolean };
        const comment = columnComments?.[pgCol.name];
        return {
          name: pgCol.name,
          type: toWritableColumnType(typeof pgCol.getSQLType === 'function' ? pgCol.getSQLType() : 'text'),
          notNull: !!pgCol.notNull,
          ...(typeof comment === 'string' && comment.length > 0 ? { comment } : {}),
        };
      });
      return cols;
    }
  }
  return null;
}

/**
 * 지정한 테이블의 정의된 컬럼 목록 (없으면 null)
 */
export function getSchemaDefinedColumns(
  schema: string,
  table: string
): SchemaDefinedColumn[] | null {
  const key = `${schema}.${table}`;
  if (definedColumnsCache.has(key)) return definedColumnsCache.get(key)!;
  const cols = getDefinedColumnsUncached(schema, table);
  if (cols) definedColumnsCache.set(key, cols);
  return cols;
}

/**
 * 각 테이블 파일(xxxTableComment)에 정의된 테이블 코멘트 (없으면 null)
 */
export function getSchemaTableComment(schema: string, table: string): string | null {
  for (let i = 0; i < schemaTables.length; i++) {
    const config = getTableConfig(schemaTables[i]);
    const s = config.schema ?? 'public';
    if (s === schema && config.name === table) {
      const comment = schemaTableCommentsByIndex[i];
      return typeof comment === 'string' && comment.length > 0 ? comment : null;
    }
  }
  return null;
}

/**
 * 각 테이블 파일(xxxColumnComments)에 정의된 필드 코멘트 (없으면 null)
 */
export function getSchemaColumnComment(schema: string, table: string, columnName: string): string | null {
  for (let i = 0; i < schemaTables.length; i++) {
    const config = getTableConfig(schemaTables[i]);
    const s = config.schema ?? 'public';
    if (s === schema && config.name === table) {
      const comment = schemaColumnCommentsByIndex[i]?.[columnName];
      return typeof comment === 'string' && comment.length > 0 ? comment : null;
    }
  }
  return null;
}

/**
 * 지정한 테이블의 PK 컬럼명 목록 (스키마 정의 기준)
 */
export function getSchemaPrimaryKeyColumnNames(schema: string, table: string): string[] {
  for (const t of schemaTables) {
    const config = getTableConfig(t);
    const s = config.schema ?? 'public';
    if (s === schema && config.name === table) {
      const names: string[] = [];
      for (const pk of config.primaryKeys ?? []) {
        for (const col of pk.columns ?? []) {
          const name = (col as { name: string }).name;
          if (name && !names.includes(name)) names.push(name);
        }
      }
      return names;
    }
  }
  return [];
}
