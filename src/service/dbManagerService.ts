/**
 * DbManager Service
 *
 * 주의:
 * - 사용자가 입력한 접속 정보로 외부 DB에 접속합니다.
 * - 운영 환경에서는 SSRF/권한/감사로그/암호 취급 정책을 반드시 적용해야 합니다.
 */

import { Client } from 'pg';

/**
 * 프로젝트 설정(환경 변수)에서 기본 DB 연결 정보 반환.
 * API 호출 시 params 는 사용하지 않음.
 */
export function getDefaultDbConfig(_params?: unknown): {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
} {
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      // postgresql://user:password@host:port/database
      const m = url.match(/^(?:postgres(?:ql)?:\/\/)([^:@]+):?([^@]*)@([^:\/]+):?(\d+)?\/?([^?\s]*)/);
      if (m) {
        const password = m[2] ? decodeURIComponent(m[2]) : '';
        return {
          username: decodeURIComponent(m[1] ?? ''),
          host: m[3] ?? '192.168.120.82',
          port: m[4] || '5432',
          database: (m[5] ?? '').replace(/\/$/, ''),
          password,
        };
      }
    } catch {
      // ignore
    }
  }
  return {
    host: process.env.DATABASE_HOST || '192.168.120.82',
    port: process.env.DATABASE_PORT || '5432',
    database: process.env.DATABASE_NAME || '',
    username: process.env.DATABASE_USER || '',
    password: process.env.DATABASE_PASSWORD || '',
  };
}
import {
  getSchemaDefinedTables,
  getSchemaDefinedColumns,
  getSchemaTableComment,
  getSchemaColumnComment,
  getSchemaPrimaryKeyColumnNames,
  type SchemaDefinedColumn,
} from '@/database/schemaSyncRegistry';

export type DbConnectionParams = {
  host: string;
  port: number | string;
  database: string;
  username: string;
  password?: string;
  ssl?: boolean;
};

export type SchemaTable = { schema: string; table: string };

export type ImportMode = 'create_and_import' | 'import_existing_only';

function toPort(port: number | string): number {
  const n = typeof port === 'number' ? port : Number(port);
  if (!Number.isFinite(n) || n <= 0) return 5432;
  return n;
}

function quoteIdent(ident: string): string {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

function fq(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

/**
 * ADD COLUMN / CREATE TABLE 시 readonly(GENERATED) 컬럼이 되지 않도록
 * 타입 문자열에서 GENERATED 절을 제거한 "쓰기 가능" 기본 타입만 반환합니다.
 */
function toWritableColumnType(type: string): string {
  if (!type || typeof type !== 'string') return 'text';
  const t = type.trim();
  const generatedIdx = t.toUpperCase().indexOf(' GENERATED ');
  if (generatedIdx > 0) return t.slice(0, generatedIdx).trim();
  return t;
}

function createClient(params: DbConnectionParams): Client {
  return new Client({
    host: params.host,
    port: toPort(params.port),
    database: params.database,
    user: params.username,
    password: params.password,
    ssl: params.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 15000,
    statement_timeout: 0,
    query_timeout: 0,
  });
}

async function withClient<T>(params: DbConnectionParams, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    host: params.host,
    port: toPort(params.port),
    database: params.database,
    user: params.username,
    password: params.password,
    ssl: params.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 7000,
    statement_timeout: 15000,
    query_timeout: 15000,
  });

  await client.connect();
  try {
    return await fn(client);
  } finally {
    // 연결 정리
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

/**
 * 스키마 목록 조회
 */
export async function getSchemas(params: DbConnectionParams): Promise<{ schemas: string[] }> {
  const schemas = await withClient(params, async (client) => {
    const res = await client.query<{
      schema_name: string;
    }>(
      `
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ('information_schema')
        AND schema_name NOT LIKE 'pg_%'
      ORDER BY schema_name
      `
    );
    return res.rows.map((r) => r.schema_name);
  });

  return { schemas };
}

/**
 * 단순 연결 테스트 (빠른 ping)
 */
export async function testConnection(
  params: DbConnectionParams
): Promise<{ ok: true; serverTime: string; serverVersion: string }> {
  return await withClient(params, async (client) => {
    const res = await client.query<{ now: string; version: string }>(
      `SELECT NOW()::text as now, version()::text as version`
    );
    return {
      ok: true,
      serverTime: res.rows[0]?.now ?? '',
      serverVersion: res.rows[0]?.version ?? '',
    };
  });
}

async function tableExists(client: Client, schema: string, table: string): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_name = $2
        AND table_type = 'BASE TABLE'
    ) as "exists"
    `,
    [schema, table]
  );
  return Boolean(res.rows[0]?.exists);
}

type ColumnDef = {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  isGenerated: boolean;
};

async function getTableColumns(client: Client, schema: string, table: string): Promise<ColumnDef[]> {
  const res = await client.query<{
    column_name: string;
    data_type: string;
    not_null: boolean;
    default_value: string | null;
    is_generated: boolean;
  }>(
    `
    SELECT
      a.attname AS column_name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
      a.attnotnull AS not_null,
      pg_get_expr(ad.adbin, ad.adrelid) AS default_value,
      (a.attgenerated <> '') AS is_generated
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    LEFT JOIN pg_attrdef ad ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
    WHERE n.nspname = $1
      AND c.relname = $2
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum
    `,
    [schema, table]
  );

  return res.rows.map((r) => ({
    name: r.column_name,
    type: r.data_type,
    notNull: Boolean(r.not_null),
    defaultValue: r.default_value,
    isGenerated: Boolean(r.is_generated),
  }));
}

async function getDestColumnNameSet(client: Client, schema: string, table: string): Promise<Set<string>> {
  const cols = await getTableColumns(client, schema, table);
  return new Set(cols.map((c) => c.name));
}

async function getTableComment(client: Client, schema: string, table: string): Promise<string | null> {
  const res = await client.query<{ comment: string | null }>(
    `
    SELECT obj_description(c.oid) AS comment
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = $2
    `,
    [schema, table]
  );
  const comment = res.rows[0]?.comment;
  return typeof comment === 'string' ? comment : null;
}

const RELKIND_LABEL: Record<string, string> = {
  r: 'TABLE',
  v: 'VIEW',
  m: 'MATERIALIZED VIEW',
  i: 'INDEX',
  S: 'SEQUENCE',
  f: 'FOREIGN TABLE',
  p: 'PARTITIONED TABLE',
};

async function getTableCommentAndType(
  client: Client,
  schema: string,
  table: string
): Promise<{ comment: string | null; tableType: string }> {
  const res = await client.query<{ comment: string | null; relkind: string }>(
    `
    SELECT obj_description(c.oid) AS comment, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = $2
    `,
    [schema, table]
  );
  const row = res.rows[0];
  const comment = row && typeof row.comment === 'string' ? row.comment : null;
  const tableType = row ? (RELKIND_LABEL[row.relkind] ?? row.relkind) : 'TABLE';
  return { comment, tableType };
}

async function ensureSchema(client: Client, schema: string): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
}

async function createTableFromColumns(
  destClient: Client,
  schema: string,
  table: string,
  columns: ColumnDef[]
): Promise<void> {
  // 생성 컬럼/시퀀스/제약까지 완전 복제는 다음 단계(확장)에서.
  // 여기서는 "컬럼 정의 + NOT NULL + (가능한 DEFAULT)"까지만 적용.
  const colSql = columns
    .filter((c) => !c.isGenerated) // generated 컬럼은 정의 복제가 복잡하므로 일단 제외
    .map((c) => {
      const parts: string[] = [quoteIdent(c.name), c.type];
      if (c.notNull) parts.push('NOT NULL');

      // nextval(...) DEFAULT는 시퀀스가 없어서 깨질 수 있으므로 제외 (값은 INSERT로 복사)
      if (c.defaultValue && !/^nextval\(/i.test(c.defaultValue.trim())) {
        parts.push(`DEFAULT ${c.defaultValue}`);
      }
      return parts.join(' ');
    })
    .join(',\n  ');

  const sql = `CREATE TABLE IF NOT EXISTS ${fq(schema, table)} (\n  ${colSql}\n)`;
  await destClient.query(sql);
}

/**
 * 테이블 목록 조회 (스키마 내)
 */
export async function getTables(params: DbConnectionParams & { schema: string }): Promise<{ tables: string[] }> {
  const tables = await withClient(params, async (client) => {
    const res = await client.query<{
      table_name: string;
    }>(
      `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
      `,
      [params.schema]
    );
    return res.rows.map((r) => r.table_name);
  });

  return { tables };
}

/**
 * layer 스키마(또는 지정 스키마) 내 모든 테이블의 geom 컬럼 SRID를 5181로 설정.
 * pg_tileserv 등에서 좌표계가 설정된 레이어만 로드할 수 있으므로 사용.
 */
export async function setLayerSchemaGeomSrid(
  params: DbConnectionParams & { schema?: string }
): Promise<{
  schema: string;
  updatedCount: number;
  failedCount: number;
  results: Array<{
    schema: string;
    table: string;
    column: string;
    status: 'updated' | 'failed';
    error?: string;
  }>;
}> {
  const schema = (params.schema ?? 'layer').trim() || 'layer';
  const connectionParams: DbConnectionParams = {
    host: params.host,
    port: params.port,
    database: params.database,
    username: params.username,
    password: params.password,
    ssl: params.ssl,
  };

  const results: Array<{ schema: string; table: string; column: string; status: 'updated' | 'failed'; error?: string }> = [];

  await withClient(connectionParams, async (client) => {
    const res = await client.query<{
      f_table_schema: string;
      f_table_name: string;
      f_geometry_column: string;
    }>(
      `
      SELECT f_table_schema, f_table_name, f_geometry_column
      FROM geometry_columns
      WHERE f_table_schema = $1
      ORDER BY f_table_schema, f_table_name, f_geometry_column
      `,
      [schema]
    );

    for (const row of res.rows) {
      const { f_table_schema: s, f_table_name: t, f_geometry_column: c } = row;
      try {
        const sql = `ALTER TABLE ${fq(s, t)} ALTER COLUMN ${quoteIdent(c)} TYPE geometry(Geometry, 5181) USING ST_SetSRID(${quoteIdent(c)}::geometry, 5181)`;
        await client.query(sql);
        results.push({ schema: s, table: t, column: c, status: 'updated' });
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        results.push({ schema: s, table: t, column: c, status: 'failed', error: errMsg });
      }
    }
  });

  const updatedCount = results.filter((r) => r.status === 'updated').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;

  return {
    schema,
    updatedCount,
    failedCount,
    results,
  };
}

/**
 * 테이블 목록 조회 (여러 스키마)
 * - 스키마 체크박스 다중선택을 위한 배치 API
 */
export async function getTablesBySchemas(
  params: DbConnectionParams & { schemas: string[] }
): Promise<{ tablesBySchema: Record<string, string[]> }> {
  const schemas = (params.schemas || []).filter(Boolean);
  if (schemas.length === 0) return { tablesBySchema: {} };

  const tablesBySchema = await withClient(params, async (client) => {
    const res = await client.query<{
      table_schema: string;
      table_name: string;
    }>(
      `
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = ANY($1::text[])
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name
      `,
      [schemas]
    );

    const map: Record<string, string[]> = {};
    for (const row of res.rows) {
      if (!map[row.table_schema]) map[row.table_schema] = [];
      map[row.table_schema].push(row.table_name);
    }
    return map;
  });

  return { tablesBySchema };
}

/**
 * DEST에 SRC 스키마/테이블이 존재하는지 확인
 * - 입력된 (schema, table) 쌍을 기준으로 information_schema 조회
 */
export async function checkSchemaTablesExist(
  params: DbConnectionParams & { items: SchemaTable[] }
): Promise<{
  checkedAt: string;
  requestedSchemasCount: number;
  requestedTablesCount: number;
  existingSchemasCount: number;
  existingTablesCount: number;
  missingSchemas: string[];
  missingTables: SchemaTable[];
}> {
  const items = (params.items || []).filter((x) => x?.schema && x?.table);
  const requestedTablesCount = items.length;
  const requestedSchemas = Array.from(new Set(items.map((x) => x.schema))).sort();

  if (requestedTablesCount === 0) {
    return {
      checkedAt: new Date().toISOString(),
      requestedSchemasCount: 0,
      requestedTablesCount: 0,
      existingSchemasCount: 0,
      existingTablesCount: 0,
      missingSchemas: [],
      missingTables: [],
    };
  }

  const schemaArr = items.map((x) => x.schema);
  const tableArr = items.map((x) => x.table);

  const result = await withClient(params, async (client) => {
    // 1) 스키마 존재 확인
    const schemaRes = await client.query<{ schema_name: string }>(
      `
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = ANY($1::text[])
      `,
      [requestedSchemas]
    );
    const existingSchemas = schemaRes.rows.map((r) => r.schema_name);
    const existingSchemasSet = new Set(existingSchemas);
    const missingSchemas = requestedSchemas.filter((s) => !existingSchemasSet.has(s));

    // 2) (schema, table) 존재 확인 (BASE TABLE만)
    // NOTE: "table"은 SQL 키워드라 컬럼명으로 피해서 사용
    const pairRes = await client.query<{
      schema_name: string;
      table_name: string;
      exists: boolean;
    }>(
      `
      WITH req(schema_name, table_name) AS (
        SELECT *
        FROM unnest($1::text[], $2::text[])
      )
      SELECT
        req.schema_name,
        req.table_name,
        (t.table_name IS NOT NULL) AS "exists"
      FROM req
      LEFT JOIN information_schema.tables t
        ON t.table_schema = req.schema_name
       AND t.table_name = req.table_name
       AND t.table_type = 'BASE TABLE'
      `,
      [schemaArr, tableArr]
    );

    const missingTables: SchemaTable[] = [];
    let existingTablesCount = 0;

    for (const row of pairRes.rows) {
      if (row.exists) existingTablesCount += 1;
      else missingTables.push({ schema: row.schema_name, table: row.table_name });
    }

    return {
      existingSchemas,
      missingSchemas,
      existingTablesCount,
      missingTables,
    };
  });

  return {
    checkedAt: new Date().toISOString(),
    requestedSchemasCount: requestedSchemas.length,
    requestedTablesCount,
    existingSchemasCount: result.existingSchemas.length,
    existingTablesCount: result.existingTablesCount,
    missingSchemas: result.missingSchemas,
    missingTables: result.missingTables,
  };
}

/**
 * 데이터 가져오기(실행)
 * - 현재는 "모드 선택" 및 파라미터 전달이 정상인지 확인하는 1차 구현(서버측 동작 확인용)
 * - 다음 단계에서:
 *   - create_and_import: DEST에 스키마/테이블 없으면 생성(DDL 생성) 후 데이터 복사
 *   - import_existing_only: 존재하는 테이블만 대상으로 데이터 복사
 */
export async function importData(params: {
  src: DbConnectionParams;
  dest: DbConnectionParams;
  items: SchemaTable[];
  mode: ImportMode;
}): Promise<{
  startedAt: string;
  finishedAt: string;
  mode: ImportMode;
  requestedCount: number;
  willImportCount: number;
  importedTablesCount: number;
  importedRowsCount: number;
  skippedCount: number;
  results: Array<{
    schema: string;
    table: string;
    status: 'imported' | 'skipped' | 'failed';
    rowsCopied: number;
    reason?: string;
  }>;
}> {
  const startedAt = new Date().toISOString();
  const rawItems = (params.items || []).filter((x) => x?.schema && x?.table);
  const uniqMap = new Map<string, SchemaTable>();
  for (const it of rawItems) uniqMap.set(`${it.schema}.${it.table}`, it);
  const items = Array.from(uniqMap.values()).sort((a, b) => {
    if (a.schema === b.schema) return a.table.localeCompare(b.table);
    return a.schema.localeCompare(b.schema);
  });

  const requestedCount = items.length;
  const results: Array<{
    schema: string;
    table: string;
    status: 'imported' | 'skipped' | 'failed';
    rowsCopied: number;
    reason?: string;
  }> = [];

  const srcClient = createClient(params.src);
  const destClient = createClient(params.dest);

  let importedTablesCount = 0;
  let importedRowsCount = 0;
  let skippedCount = 0;

  await srcClient.connect();
  await destClient.connect();

  try {
    // willImportCount 계산(모드별)
    let willImportItems: SchemaTable[] = items;
    if (params.mode === 'import_existing_only') {
      const check = await checkSchemaTablesExist({
        ...params.dest,
        items,
      });
      const missingSchemaSet = new Set(check.missingSchemas);
      const missingTableKeySet = new Set(check.missingTables.map((t) => `${t.schema}.${t.table}`));
      willImportItems = items.filter(
        (t) => !missingSchemaSet.has(t.schema) && !missingTableKeySet.has(`${t.schema}.${t.table}`)
      );
    }

    const willImportCount = willImportItems.length;

    for (const { schema, table } of items) {
      const key = `${schema}.${table}`;
      const shouldImport = willImportItems.some((t) => `${t.schema}.${t.table}` === key);
      if (!shouldImport) {
        skippedCount += 1;
        results.push({ schema, table, status: 'skipped', rowsCopied: 0, reason: 'DEST에 테이블이 없음' });
        continue;
      }

      try {
        // create_and_import: 스키마/테이블 없으면 생성
        if (params.mode === 'create_and_import') {
          await ensureSchema(destClient, schema);
          const exists = await tableExists(destClient, schema, table);
          if (!exists) {
            const srcCols = await getTableColumns(srcClient, schema, table);
            if (srcCols.length === 0) throw new Error('SRC 테이블 컬럼 정보를 가져올 수 없습니다.');
            await createTableFromColumns(destClient, schema, table, srcCols);
          }
        }

        // 존재 확인(최종)
        const destExists = await tableExists(destClient, schema, table);
        if (!destExists) {
          skippedCount += 1;
          results.push({ schema, table, status: 'skipped', rowsCopied: 0, reason: 'DEST에 테이블이 없음' });
          continue;
        }

        // 컬럼 매칭(DEST에 있는 컬럼만 복사)
        const srcCols = await getTableColumns(srcClient, schema, table);
        const destColSet = await getDestColumnNameSet(destClient, schema, table);
        const columnsToCopy = srcCols
          .filter((c) => !c.isGenerated)
          .map((c) => c.name)
          .filter((name) => destColSet.has(name));

        if (columnsToCopy.length === 0) {
          throw new Error('복사 가능한 컬럼이 없습니다. (DEST 컬럼과 매칭 실패)');
        }

        // SRC 커서로 배치 읽기, DEST 배치 INSERT
        const colListSql = columnsToCopy.map(quoteIdent).join(', ');
        const srcSelectSql = `SELECT ${colListSql} FROM ${fq(schema, table)}`;

        const cursorName = `cur_${Math.random().toString(36).slice(2, 10)}`;
        const maxBatch = Math.max(1, Math.floor(65000 / columnsToCopy.length));
        const batchSize = Math.min(500, maxBatch);

        let copied = 0;

        await srcClient.query('BEGIN');
        await srcClient.query(`DECLARE ${cursorName} NO SCROLL CURSOR FOR ${srcSelectSql}`);

        await destClient.query('BEGIN');

        try {
          while (true) {
            const res = await srcClient.query(`FETCH FORWARD ${batchSize} FROM ${cursorName}`);
            if (res.rows.length === 0) break;

            const values: any[] = [];
            const rowsSql: string[] = [];
            let p = 1;
            for (const row of res.rows) {
              const placeholders: string[] = [];
              for (const col of columnsToCopy) {
                values.push((row as any)[col]);
                placeholders.push(`$${p++}`);
              }
              rowsSql.push(`(${placeholders.join(',')})`);
            }

            const insertSql = `INSERT INTO ${fq(schema, table)} (${colListSql}) VALUES ${rowsSql.join(',')}`;
            await destClient.query(insertSql, values);
            copied += res.rows.length;
          }

          await destClient.query('COMMIT');
          await srcClient.query(`CLOSE ${cursorName}`);
          await srcClient.query('COMMIT');
        } catch (e) {
          await destClient.query('ROLLBACK');
          await srcClient.query(`CLOSE ${cursorName}`).catch(() => undefined);
          await srcClient.query('ROLLBACK').catch(() => undefined);
          throw e;
        }

        importedTablesCount += 1;
        importedRowsCount += copied;
        results.push({ schema, table, status: 'imported', rowsCopied: copied });
      } catch (e: any) {
        results.push({
          schema,
          table,
          status: 'failed',
          rowsCopied: 0,
          reason: e?.message || String(e),
        });
      }
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      mode: params.mode,
      requestedCount,
      willImportCount,
      importedTablesCount,
      importedRowsCount,
      skippedCount,
      results,
    };
  } finally {
    await srcClient.end().catch(() => undefined);
    await destClient.end().catch(() => undefined);
  }
}

// --- 테이블 구조 동기화 (database/schema vs 실제 DB) ---

export type DbColumnDef = {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  isGenerated: boolean;
};

/**
 * 실제 DB의 테이블 컬럼 목록 조회
 */
export async function getTableColumnsFromDb(
  params: DbConnectionParams,
  schema: string,
  table: string
): Promise<DbColumnDef[]> {
  return withClient(params, (client) => getTableColumns(client, schema, table));
}

/** serial·integer, varchar·character varying, timestamp·timestamp without time zone 등을 동일 타입으로 취급 */
function isSameColumnType(defType: string, actualType: string): boolean {
  const d = defType.toLowerCase().trim();
  const a = actualType.toLowerCase().trim();
  if (d === a) return true;
  const int4Group = ['serial', 'serial4', 'integer', 'int4'];
  const int8Group = ['serial8', 'bigint', 'int8'];
  const varcharGroup = ['varchar', 'character varying'];
  const timestampGroup = ['timestamp without time zone', 'timestamp'];
  const inGroup = (t: string, group: string[]) =>
    group.some((g) => t === g || t.startsWith(g));
  if (inGroup(d, int4Group) && inGroup(a, int4Group)) return true;
  if (inGroup(d, int8Group) && inGroup(a, int8Group)) return true;
  if (inGroup(d, varcharGroup) && inGroup(a, varcharGroup)) return true;
  if (inGroup(d, timestampGroup) && inGroup(a, timestampGroup)) return true;
  return false;
}

export type SchemaSyncTableComparison = {
  definedTables: SchemaTable[];
  actualTables: SchemaTable[];
  onlyInSchema: SchemaTable[];
  onlyInDb: SchemaTable[];
  inBoth: SchemaTable[];
};

/**
 * 1단계: database/schema 테이블 목록 vs 실제 DB 테이블 목록 비교
 */
export async function getSchemaSyncComparison(
  params: DbConnectionParams
): Promise<SchemaSyncTableComparison> {
  const definedTables = getSchemaDefinedTables();
  const definedKeySet = new Set(definedTables.map((t) => `${t.schema}.${t.table}`));

  const { schemas } = await getSchemas(params);
  const schemasToCheck = schemas.length > 0 ? schemas : ['public'];
  const { tablesBySchema } = await getTablesBySchemas({ ...params, schemas: schemasToCheck });

  const actualTables: SchemaTable[] = [];
  for (const schema of Object.keys(tablesBySchema).sort()) {
    for (const table of (tablesBySchema[schema] ?? []).sort()) {
      actualTables.push({ schema, table });
    }
  }
  const actualKeySet = new Set(actualTables.map((t) => `${t.schema}.${t.table}`));

  const onlyInSchema = definedTables.filter((t) => !actualKeySet.has(`${t.schema}.${t.table}`));
  const onlyInDb = actualTables.filter((t) => !definedKeySet.has(`${t.schema}.${t.table}`));
  const inBoth = definedTables.filter((t) => actualKeySet.has(`${t.schema}.${t.table}`));

  return {
    definedTables,
    actualTables,
    onlyInSchema,
    onlyInDb,
    inBoth,
  };
}

export type SchemaSyncTableRow = {
  schema: string;
  table: string;
  status: 'only_in_schema' | 'in_both';
  definedColumnCount: number;
  actualColumnCount: number | null;
  columnsMatch: boolean | null;
  /** 불일치 시 간단 사유 (예: "추가 2, 누락 1, 타입다름 1") */
  columnsMatchReason: string | null;
  tableComment: string | null;
  tableType?: string;
};

/**
 * 스키마 파일 기준 테이블 목록 (상태·테이블 코멘트 일치 여부만 비교, 필드 비교 없음)
 * 스키마 폴더에 있는 모든 테이블(DB 유무와 관계없이)을 목록에 포함한다.
 */
export async function getSchemaSyncTableList(
  params: DbConnectionParams
): Promise<{ tables: SchemaSyncTableRow[] }> {
  const comparison = await getSchemaSyncComparison(params);
  const onlyInSchemaSet = new Set(
    comparison.onlyInSchema.map((t) => `${t.schema}.${t.table}`)
  );

  const definedTablesFromRegistry = getSchemaDefinedTables();
  const definedSorted = [...definedTablesFromRegistry].sort((a, b) => {
    if (a.schema !== b.schema) return a.schema.localeCompare(b.schema);
    return a.table.localeCompare(b.table);
  });

  const rows: SchemaSyncTableRow[] = definedSorted.map((t) => {
    const key = `${t.schema}.${t.table}`;
    const definedCols = getSchemaDefinedColumns(t.schema, t.table);
    const definedColumnCount = definedCols?.length ?? 0;
    const schemaComment = getSchemaTableComment(t.schema, t.table);
    if (onlyInSchemaSet.has(key)) {
      return {
        schema: t.schema,
        table: t.table,
        status: 'only_in_schema',
        definedColumnCount,
        actualColumnCount: null,
        columnsMatch: null,
        columnsMatchReason: null,
        tableComment: schemaComment ?? null,
      };
    }
    return {
      schema: t.schema,
      table: t.table,
      status: 'in_both',
      definedColumnCount,
      actualColumnCount: null,
      columnsMatch: null,
      columnsMatchReason: null,
      tableComment: schemaComment ?? null,
    };
  });

  await withClient(params, async (client) => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.status !== 'in_both') continue;
      const actualCols = await getTableColumns(client, r.schema, r.table);
      r.actualColumnCount = actualCols.length;
      const schemaTableComment = getSchemaTableComment(r.schema, r.table);
      const { comment: dbComment, tableType: relType } = await getTableCommentAndType(client, r.schema, r.table);
      const commentMismatch = (schemaTableComment ?? '') !== (dbComment ?? '');
      r.columnsMatch = !commentMismatch;
      r.tableComment = schemaTableComment ?? null;
      r.tableType = relType;
      r.columnsMatchReason = commentMismatch ? '테이블 코멘트 불일치' : null;
    }
  });

  return { tables: rows };
}

export type SchemaSyncColumnDiff = {
  name: string;
  definedType?: string;
  actualType?: string;
  action: 'add' | 'remove' | 'modify' | 'same';
};

export type SchemaSyncColumnComparison = {
  schema: string;
  table: string;
  definedColumns: SchemaDefinedColumn[];
  actualColumns: DbColumnDef[];
  toAdd: SchemaDefinedColumn[];
  toRemove: DbColumnDef[];
  toModify: Array<{ name: string; defined: SchemaDefinedColumn; actual: DbColumnDef }>;
  same: SchemaDefinedColumn[];
  primaryKeyColumns: string[];
};

/**
 * 2단계: 지정 테이블의 컬럼 비교 (정의 vs 실제)
 * API 호출 시 params 에 { ...connectionParams, schema, table } 전달
 */
export async function getTableColumnComparison(params: DbConnectionParams & {
  schema: string;
  table: string;
}): Promise<SchemaSyncColumnComparison | null> {
  const { schema, table } = params;
  const connectionParams: DbConnectionParams = {
    host: params.host,
    port: params.port,
    database: params.database,
    username: params.username,
    password: params.password,
    ssl: params.ssl,
  };
  const definedCols = getSchemaDefinedColumns(schema, table);
  if (!definedCols || definedCols.length === 0) return null;

  const actualCols = await getTableColumnsFromDb(connectionParams, schema, table);
  const definedByName = new Map(definedCols.map((c) => [c.name, c]));
  const actualByName = new Map(actualCols.map((c) => [c.name, c]));

  const toAdd: SchemaDefinedColumn[] = [];
  const toRemove: DbColumnDef[] = [];
  const toModify: Array<{ name: string; defined: SchemaDefinedColumn; actual: DbColumnDef }> = [];
  const same: SchemaDefinedColumn[] = [];

  for (const c of definedCols) {
    const actual = actualByName.get(c.name);
    if (!actual) {
      toAdd.push(c);
    } else if (!isSameColumnType(c.type, actual.type) || actual.notNull !== c.notNull) {
      toModify.push({ name: c.name, defined: c, actual });
    } else {
      same.push(c);
    }
  }
  for (const c of actualCols) {
    if (!definedByName.has(c.name)) toRemove.push(c);
  }

  const primaryKeyColumns = getSchemaPrimaryKeyColumnNames(schema, table);

  return {
    schema,
    table,
    definedColumns: definedCols,
    actualColumns: actualCols,
    toAdd,
    toRemove,
    toModify,
    same,
    primaryKeyColumns,
  };
}

export type SchemaSyncApplyOptions = {
  /** 생성할 테이블 (스키마에만 있는 테이블 중 선택) */
  tablesToCreate?: SchemaTable[];
  /** 테이블 코멘트만 동기화할 테이블 (양쪽 모두 있는 테이블). 비면 inBoth 전체 */
  tables?: SchemaTable[];
  /** 테이블별 추가할 컬럼명. key: "schema.table", value: 컬럼명[]. 비면 toAdd 전체 적용 */
  columnsToAddByTable?: Record<string, string[]>;
  /** 테이블별 삭제할 컬럼명 (DB에만 있는 컬럼). key: "schema.table", value: 컬럼명[] */
  columnsToRemoveByTable?: Record<string, string[]>;
  /** 컬럼 추가만 적용 (타입 변경 등은 제외) */
  addColumnsOnly?: boolean;
  /** true면 tables에 대해서는 테이블 코멘트만 반영하고 컬럼 동기화는 하지 않음 (2단계용) */
  tableCommentOnly?: boolean;
};

export type SchemaSyncReportItem = {
  schema: string;
  table: string;
  action: 'table_created' | 'table_comment_updated' | 'columns_added' | 'columns_dropped' | 'columns_modified' | 'skipped' | 'failed';
  detail?: string;
  columnsAdded?: string[];
  columnsDropped?: string[];
  error?: string;
};

export type SchemaSyncReport = {
  startedAt: string;
  finishedAt: string;
  options: SchemaSyncApplyOptions;
  results: SchemaSyncReportItem[];
  /** 실행된 SQL 목록 (순서대로) */
  executedSql: string[];
};

async function getTableColumnComparisonWithClient(
  client: Client,
  schema: string,
  table: string
): Promise<SchemaSyncColumnComparison | null> {
  const definedCols = getSchemaDefinedColumns(schema, table);
  if (!definedCols?.length) return null;

  const actualCols = await getTableColumns(client, schema, table);
  const definedByName = new Map(definedCols.map((c) => [c.name, c]));
  const actualByName = new Map(actualCols.map((c) => [c.name, c]));

  const toAdd: SchemaDefinedColumn[] = [];
  const toRemove: DbColumnDef[] = [];
  const toModify: Array<{ name: string; defined: SchemaDefinedColumn; actual: DbColumnDef }> = [];
  const same: SchemaDefinedColumn[] = [];

  for (const c of definedCols) {
    const actual = actualByName.get(c.name);
    if (!actual) toAdd.push(c);
    else if (!isSameColumnType(c.type, actual.type) || actual.notNull !== c.notNull) toModify.push({ name: c.name, defined: c, actual });
    else same.push(c);
  }
  for (const c of actualCols) {
    if (!definedByName.has(c.name)) toRemove.push(c);
  }

  const primaryKeyColumns = getSchemaPrimaryKeyColumnNames(schema, table);
  return { schema, table, definedColumns: definedCols, actualColumns: actualCols, toAdd, toRemove, toModify, same, primaryKeyColumns };
}

/**
 * 3~4단계: 동기화 적용 및 결과 리포트
 * - 누락 테이블: CREATE TABLE (정의 기준)
 * - 누락 컬럼: ALTER TABLE ADD COLUMN
 * - 타입 변경( toModify )은 addColumnsOnly true면 스킵
 * - API 호출 시 params 에 connection + fullUpdate, tables, addColumnsOnly 전달
 */
export async function applySchemaSync(
  params: DbConnectionParams & SchemaSyncApplyOptions
): Promise<SchemaSyncReport> {
  const startedAt = new Date().toISOString();
  const results: SchemaSyncReportItem[] = [];
  const executedSql: string[] = [];
  const {
    tablesToCreate = [],
    tables: selectedTables,
    columnsToAddByTable = {},
    columnsToRemoveByTable = {},
    addColumnsOnly = true,
    tableCommentOnly = false,
  } = params;
  const connectionParams: DbConnectionParams = {
    host: params.host,
    port: params.port,
    database: params.database,
    username: params.username,
    password: params.password,
    ssl: params.ssl,
  };

  const comparison = await getSchemaSyncComparison(connectionParams);
  const tablesToProcess: SchemaTable[] =
    (selectedTables?.length ?? 0) > 0
      ? (selectedTables ?? []).filter((t) =>
          comparison.inBoth.some((b) => b.schema === t.schema && b.table === t.table)
        )
      : comparison.inBoth;

  await withClient(connectionParams, async (client) => {
    for (const t of tablesToCreate) {
      const inOnlyInSchema = comparison.onlyInSchema.some((b) => b.schema === t.schema && b.table === t.table);
      if (!inOnlyInSchema) continue;
      try {
        const definedCols = getSchemaDefinedColumns(t.schema, t.table);
        if (!definedCols?.length) {
          results.push({ schema: t.schema, table: t.table, action: 'skipped', detail: '정의된 컬럼 없음' });
          continue;
        }
        const schemaSql = `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(t.schema)}`;
        executedSql.push(schemaSql);
        await client.query(schemaSql);
        const colSql = definedCols
          .map((c) => {
            const colType = toWritableColumnType(c.type);
            const parts = [quoteIdent(c.name), colType];
            if (c.notNull) parts.push('NOT NULL');
            return parts.join(' ');
          })
          .join(',\n  ');
        const createTableSql = `CREATE TABLE IF NOT EXISTS ${fq(t.schema, t.table)} (\n  ${colSql}\n)`;
        executedSql.push(createTableSql);
        await client.query(createTableSql);
        const tableComment = getSchemaTableComment(t.schema, t.table);
        if (tableComment) {
          const escaped = tableComment.replace(/'/g, "''");
          const commentSql = `COMMENT ON TABLE ${fq(t.schema, t.table)} IS '${escaped}'`;
          executedSql.push(commentSql);
          await client.query(commentSql);
        }
        results.push({
          schema: t.schema,
          table: t.table,
          action: 'table_created',
          detail: `테이블 생성 (${definedCols.length} 컬럼)`,
        });
      } catch (e: any) {
        results.push({
          schema: t.schema,
          table: t.table,
          action: 'failed',
          error: e?.message ?? String(e),
        });
      }
    }

    for (const t of tablesToProcess) {
      const inBoth = comparison.inBoth.some((b) => b.schema === t.schema && b.table === t.table);
      if (!inBoth) continue;

      const tableComment = getSchemaTableComment(t.schema, t.table);
      if (tableComment) {
        try {
          const escaped = tableComment.replace(/'/g, "''");
          const commentSql = `COMMENT ON TABLE ${fq(t.schema, t.table)} IS '${escaped}'`;
          executedSql.push(commentSql);
          await client.query(commentSql);
          results.push({
            schema: t.schema,
            table: t.table,
            action: 'table_comment_updated',
            detail: '테이블 코멘트 동기화',
          });
        } catch (e: any) {
          results.push({
            schema: t.schema,
            table: t.table,
            action: 'failed',
            error: e?.message ?? String(e),
          });
        }
      }

      if (tableCommentOnly) continue;

      const colDiff = await getTableColumnComparisonWithClient(client, t.schema, t.table);
      if (!colDiff) continue;

      try {
        const tableKey = `${t.schema}.${t.table}`;
        const selectedCols = columnsToAddByTable[tableKey];
        const toAddFiltered =
          selectedCols !== undefined
            ? colDiff.toAdd.filter((c) => selectedCols.includes(c.name))
            : colDiff.toAdd;
        const added: string[] = [];
        for (const c of toAddFiltered) {
          const colType = toWritableColumnType(c.type);
          const addColSql = `ALTER TABLE ${fq(t.schema, t.table)} ADD COLUMN IF NOT EXISTS ${quoteIdent(c.name)} ${colType}${c.notNull ? ' NOT NULL' : ''}`;
          executedSql.push(addColSql);
          await client.query(addColSql);
          const colComment = getSchemaColumnComment(t.schema, t.table, c.name);
          if (colComment) {
            const escaped = colComment.replace(/'/g, "''");
            const commentColSql = `COMMENT ON COLUMN ${fq(t.schema, t.table)}.${quoteIdent(c.name)} IS '${escaped}'`;
            executedSql.push(commentColSql);
            await client.query(commentColSql);
          }
          added.push(c.name);
        }
        if (added.length > 0) {
          results.push({
            schema: t.schema,
            table: t.table,
            action: 'columns_added',
            columnsAdded: added,
          });
        }
        if (!addColumnsOnly && colDiff.toModify.length > 0) {
          for (const { name, defined } of colDiff.toModify) {
            const colType = toWritableColumnType(defined.type);
            const alterSql = `ALTER TABLE ${fq(t.schema, t.table)} ALTER COLUMN ${quoteIdent(name)} TYPE ${colType}${defined.notNull ? ', ALTER COLUMN ' + quoteIdent(name) + ' SET NOT NULL' : ''}`;
            executedSql.push(alterSql);
            await client.query(alterSql);
          }
          results.push({
            schema: t.schema,
            table: t.table,
            action: 'columns_modified',
            detail: `${colDiff.toModify.length}개 컬럼 타입/제약 변경`,
          });
        }
        const toRemoveNames = columnsToRemoveByTable[tableKey] ?? [];
        const dropped: string[] = [];
        for (const colName of toRemoveNames) {
          try {
            const dropColSql = `ALTER TABLE ${fq(t.schema, t.table)} DROP COLUMN IF EXISTS ${quoteIdent(colName)}`;
            executedSql.push(dropColSql);
            await client.query(dropColSql);
            dropped.push(colName);
          } catch (dropErr: any) {
            results.push({
              schema: t.schema,
              table: t.table,
              action: 'failed',
              error: `DROP COLUMN ${colName}: ${dropErr?.message ?? String(dropErr)}`,
            });
          }
        }
        if (dropped.length > 0) {
          results.push({
            schema: t.schema,
            table: t.table,
            action: 'columns_dropped',
            columnsDropped: dropped,
          });
        }

        const didSomething =
          added.length > 0 || dropped.length > 0 || (!addColumnsOnly && colDiff.toModify.length > 0);
        if (!didSomething && !results.some((r) => r.schema === t.schema && r.table === t.table)) {
          results.push({ schema: t.schema, table: t.table, action: 'skipped', detail: '변경 없음' });
        }
      } catch (e: any) {
        results.push({
          schema: t.schema,
          table: t.table,
          action: 'failed',
          error: e?.message ?? String(e),
        });
      }
    }
  });

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    options: { tablesToCreate, tables: selectedTables, columnsToAddByTable, columnsToRemoveByTable, addColumnsOnly, tableCommentOnly },
    results,
    executedSql,
  };
}

