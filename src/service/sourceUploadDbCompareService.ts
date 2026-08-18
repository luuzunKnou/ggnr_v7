import { getSchemaDefinedTables } from '@/database/schemaSyncRegistry';
import { formatSchemaDiffItemsTitle } from '@/lib/sourceUploadDbCompareFormat';
import {
  getDefaultDbConfig,
  getSchemaSyncComparison,
  getTableColumnComparison,
  type DbConnectionParams,
} from '@/service/dbManagerService';

export type SchemaDiffItem = {
  kind: 'missing_table' | 'extra_table' | 'missing_column' | 'extra_column' | 'modified_column';
  schema: string;
  table: string;
  column?: string;
  detail?: string;
};

export type DbCompareSummary = {
  ok: boolean;
  diffCount: number;
  items: SchemaDiffItem[];
  summaryText: string;
  error?: string;
};

const MAX_ITEMS = 40;

function pushItem(items: SchemaDiffItem[], item: SchemaDiffItem): void {
  if (items.length < MAX_ITEMS) items.push(item);
}

/**
 * 소스코드 업로드 전용 — 공유 normalizeColumnTypeForCompare 결과를 한 번 더 거름.
 * 예: geometry(Geometry, 5181) vs geometry(Geometry,5181) 공백 차이.
 * dbManagerService 공유 유틸은 수정하지 않는다.
 */
function normalizeTypeForSourceUploadCompare(type: string): string {
  return type.toLowerCase().replace(/\s+/g, '');
}

function isSameTypeForSourceUpload(definedType: string, actualType: string): boolean {
  return (
    normalizeTypeForSourceUploadCompare(definedType) ===
    normalizeTypeForSourceUploadCompare(actualType)
  );
}

/**
 * 소스코드 업로드용: Drizzle(database/schema)에 정의된 테이블만 DB와 비교.
 * DB에만 있는 layer.* 등은 차이로 보지 않는다.
 */
export async function compareDrizzleSchemaForSourceUpload(
  conn: DbConnectionParams
): Promise<Pick<DbCompareSummary, 'items' | 'summaryText'> & { onlyInSchemaCount: number }> {
  const definedTables = getSchemaDefinedTables();
  const definedKeySet = new Set(definedTables.map((t) => `${t.schema}.${t.table}`));

  const comparison = await getSchemaSyncComparison(conn);
  const items: SchemaDiffItem[] = [];

  const onlyInSchema = comparison.onlyInSchema.filter((t) =>
    definedKeySet.has(`${t.schema}.${t.table}`)
  );
  const inBoth = comparison.inBoth.filter((t) => definedKeySet.has(`${t.schema}.${t.table}`));

  for (const t of onlyInSchema) {
    pushItem(items, {
      kind: 'missing_table',
      schema: t.schema,
      table: t.table,
      detail: '스키마에만 존재',
    });
  }

  for (const t of inBoth) {
    const colDiff = await getTableColumnComparison({ ...conn, schema: t.schema, table: t.table });
    if (!colDiff) continue;
    for (const c of colDiff.toAdd) {
      pushItem(items, {
        kind: 'missing_column',
        schema: t.schema,
        table: t.table,
        column: c.name,
        detail: c.type,
      });
    }
    for (const c of colDiff.toRemove) {
      pushItem(items, {
        kind: 'extra_column',
        schema: t.schema,
        table: t.table,
        column: c.name,
        detail: c.type,
      });
    }
    for (const m of colDiff.toModify) {
      const typeSame = isSameTypeForSourceUpload(m.defined.type, m.actual.type);
      const notNullSame = m.defined.notNull === m.actual.notNull;
      // 공유 비교의 표기 차이만인 경우(공백 등) 업로드 경고에서 제외
      if (typeSame && notNullSame) continue;
      pushItem(items, {
        kind: 'modified_column',
        schema: t.schema,
        table: t.table,
        column: m.name,
        detail: typeSame
          ? `NOT NULL ${m.actual.notNull} → ${m.defined.notNull}`
          : `${m.actual.type} → ${m.defined.type}`,
      });
    }
  }

  const summaryParts: string[] = [];
  if (onlyInSchema.length) summaryParts.push(`미생성 테이블 ${onlyInSchema.length}`);
  const colIssues = items.filter((i) => i.column).length;
  if (colIssues) summaryParts.push(`컬럼 차이 ${colIssues}`);

  return {
    items,
    onlyInSchemaCount: onlyInSchema.length,
    summaryText:
      items.length === 0 ? '차이 없음' : summaryParts.join(', ') || `차이 ${items.length}건`,
  };
}

export async function compareSchemaWithConnectedDb(): Promise<DbCompareSummary> {
  const cfg = getDefaultDbConfig();
  if (!cfg.host || !cfg.database) {
    return {
      ok: false,
      diffCount: 0,
      items: [],
      summaryText: 'DB 연결 정보 없음',
      error: 'DB 연결 정보 없음',
    };
  }

  const conn = {
    host: cfg.host,
    port: Number(cfg.port) || 5432,
    database: cfg.database,
    username: cfg.username ?? '',
    password: cfg.password ?? '',
  };

  try {
    const { items, summaryText } = await compareDrizzleSchemaForSourceUpload(conn);
    const uniqueCount = items.length;
    return {
      ok: uniqueCount === 0,
      diffCount: uniqueCount,
      items,
      summaryText,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, diffCount: 0, items: [], summaryText: msg, error: msg };
  }
}

export function formatDbCompareDialogSummary(summary: DbCompareSummary): string {
  if (summary.diffCount === 0) return '차이 없음';
  return formatSchemaDiffItemsTitle(summary.items, 8);
}

export { formatSchemaDiffItemsTitle };
