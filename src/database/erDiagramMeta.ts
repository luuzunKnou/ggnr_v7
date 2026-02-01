/**
 * ER 다이어그램 메타 — 스키마에서 동적으로 추출
 * - 논리: 테이블/컬럼 코멘트(한글) 사용
 * - 물리: 실제 테이블명/컬럼명 사용
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import { getDiscoveredTablesWithComments } from './schemaSyncRegistry';
import type { PgTable } from 'drizzle-orm/pg-core';

export type ErColumn = {
  name: string;
  type: string;
  pk: boolean;
  fk?: { table: string; column: string };
  /** 논리 다이어그램용 한글 코멘트 */
  comment?: string;
};

export type ErTable = {
  tableName: string;
  tableComment: string;
  columns: ErColumn[];
};

export type ErRelation = {
  fromTable: string;
  fromCol: string;
  toTable: string;
  toCol: string;
};

/** Drizzle columnType → Mermaid ER 타입 문자열 */
function toErType(columnType: string): string {
  const normalized = columnType.replace(/^Pg/, '').toLowerCase();
  if (normalized === 'timestampstring') return 'timestamp';
  return normalized;
}

/** 스키마에서 ER 테이블·관계 목록 생성 */
function buildErDiagramMeta(): { tables: ErTable[]; relations: ErRelation[] } {
  const relations: ErRelation[] = [];
  const tables: ErTable[] = [];

  const discovered = getDiscoveredTablesWithComments();

  for (const { table, tableComment, columnComments } of discovered) {
    const config = getTableConfig(table as PgTable);
    const tableName = config.name;
    const primaryKeyNames = new Set<string>();
    for (const pk of config.primaryKeys ?? []) {
      for (const col of (pk as { columns: { name: string }[] }).columns ?? []) {
        if (col?.name) primaryKeyNames.add(col.name);
      }
    }
    const fkByColumn = new Map<string, { table: string; column: string }>();
    for (const fk of config.foreignKeys ?? []) {
      const ref = fk.reference();
      const fromCols = ref.columns;
      const toCols = ref.foreignColumns;
      const foreignTable = ref.foreignTable as PgTable;
      const toTable = getTableConfig(foreignTable).name;
      for (let i = 0; i < fromCols.length && i < toCols.length; i++) {
        const fromCol = fromCols[i] as { name: string };
        const toCol = toCols[i] as { name: string };
        if (fromCol?.name && toCol?.name) {
          fkByColumn.set(fromCol.name, { table: toTable, column: toCol.name });
          relations.push({
            fromTable: tableName,
            fromCol: fromCol.name,
            toTable,
            toCol: toCol.name,
          });
        }
      }
    }

    const columns: ErColumn[] = config.columns.map((c) => {
      const col = c as { name: string; columnType: string; primary?: boolean };
      const name = col.name;
      const pk = col.primary === true || primaryKeyNames.has(name);
      const fk = fkByColumn.get(name);
      return {
        name,
        type: toErType(col.columnType ?? 'text'),
        pk,
        ...(fk && { fk }),
        comment: columnComments[name] ?? name,
      };
    });

    tables.push({
      tableName,
      tableComment: tableComment || tableName,
      columns,
    });
  }

  return { tables, relations };
}

const meta = buildErDiagramMeta();

export const erDiagramMeta = {
  tables: meta.tables,
  relations: meta.relations,
};
