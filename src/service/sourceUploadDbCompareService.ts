import { getSchemaDefinedTables } from '@/database/schemaSyncRegistry';
import { formatSchemaDiffItemsTitle } from '@/lib/sourceUploadDbCompareFormat';
import {
  getDefaultDbConfig,
  getTableColumnComparisonWithClient,
  runWithDbClient,
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
 * 연결은 1개만 열어 테이블·컬럼 비교를 모두 수행한다 (연결 한도 초과 방지).
 */
export async function compareDrizzleSchemaForSourceUpload(
  conn: DbConnectionParams
): Promise<Pick<DbCompareSummary, 'items' | 'summaryText'> & { onlyInSchemaCount: number }> {
  const definedTables = getSchemaDefinedTables();
  const definedKeySet = new Set(definedTables.map((t) => `${t.schema}.${t.table}`));

  return runWithDbClient(conn, async (client) => {
    const schemaRes = await client.query<{ schema_name: string }>(
      `SELECT schema_name
       FROM information_schema.schemata
       WHERE schema_name NOT IN ('information_schema')
         AND schema_name NOT LIKE 'pg_%'
       ORDER BY schema_name`
    );
    const schemas = schemaRes.rows.map((r) => r.schema_name);
    const schemasToCheck = schemas.length > 0 ? schemas : ['public'];

    const tableRes = await client.query<{ table_schema: string; table_name: string }>(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_type = 'BASE TABLE'
         AND table_schema = ANY($1::text[])
       ORDER BY table_schema, table_name`,
      [schemasToCheck]
    );
    const actualKeySet = new Set(
      tableRes.rows.map((r) => `${r.table_schema}.${r.table_name}`)
    );

    const onlyInSchema = definedTables.filter((t) => !actualKeySet.has(`${t.schema}.${t.table}`));
    const inBoth = definedTables.filter((t) => actualKeySet.has(`${t.schema}.${t.table}`));

    const items: SchemaDiffItem[] = [];

    for (const t of onlyInSchema) {
      pushItem(items, {
        kind: 'missing_table',
        schema: t.schema,
        table: t.table,
        detail: '스키마에만 존재',
      });
    }

    for (const t of inBoth) {
      const colDiff = await getTableColumnComparisonWithClient(client, t.schema, t.table);
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
  });
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
    const raw = e instanceof Error ? e.message : String(e);
    const msg = /too many clients|too_many_connections|remaining connection slots/i.test(raw)
      ? '최대 데이터베이스 연결 개수를 초과했습니다.'
      : raw;
    return { ok: false, diffCount: 0, items: [], summaryText: msg, error: msg };
  }
}

export function formatDbCompareDialogSummary(summary: DbCompareSummary): string {
  if (summary.diffCount === 0) return '차이 없음';
  return formatSchemaDiffItemsTitle(summary.items, 8);
}

export { formatSchemaDiffItemsTitle };
