/**
 * 운영 기동(start) 전용 — drizzle 스키마 «고정 정책» 반영.
 * CREATE/ADD COLUMN 등 생성만 적용.
 * DROP · DELETE · TRUNCATE · ALTER(수정·타입변경)는 실행하지 않고 로그만 남김.
 * 집계·미리보기는 drizzle 정의 테이블만 대상 (DB 전용 테이블 DROP 제외).
 *
 * create vs rename 충돌(drizzle-kit 대화형):
 *   - 스키마·테이블명이 모두 같지 않으면 create
 *   - 동일 스키마 + 동일 테이블명일 때만 rename
 *   (메뉴 기본 선택=create 이므로 Enter 자동 확정. 관리 테이블만 introspect)
 *
 * 사용:
 *   run.ts setupDb(start) → runAdditiveSchemaSync()
 *   npx tsx scripts/drizzle-push-additive.ts          # apply
 *   npx tsx scripts/drizzle-push-additive.ts preview  # JSON → stdout, 로그 → stderr
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { is, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';

const LOG = '[drizzle-additive]';
const PUSH_SCHEMA_TIMEOUT_MS = 60_000;
const CONNECT_TIMEOUT_MS = 10_000;
const STATEMENT_TIMEOUT_MS = 30_000;
const POOL_END_TIMEOUT_MS = 2_000;
const MAX_APPLIED_LOG = 20;
const MAX_WARN_SAMPLES = 5;
const MAX_PREVIEW_ITEMS = 100;

const SCHEMA_FILTERS_FALLBACK = ['public', 'layer', 'next_gen_linkage'];

type PoolInternal = Pool & {
  _clients?: Array<{
    connection?: { stream?: { destroy?: () => void } };
  }>;
};

/** drizzle 스키마에 정의된 테이블 (schema.table + 테이블명) — DB 전용 객체 제외용 */
function collectManagedTableKeys(schemaMod: Record<string, unknown>): {
  names: string[];
  keys: Set<string>;
  schemas: string[];
} {
  const names = new Set<string>();
  const keys = new Set<string>();
  const schemas = new Set<string>();
  for (const value of Object.values(schemaMod)) {
    if (is(value, PgTable)) {
      const cfg = getTableConfig(value);
      const schemaName = (cfg.schema ?? 'public').trim() || 'public';
      const tableName = cfg.name.trim();
      if (!tableName) continue;
      names.add(tableName);
      keys.add(tableName);
      keys.add(`${schemaName}.${tableName}`);
      schemas.add(schemaName);
    }
  }
  return { names: [...names].sort(), keys, schemas: [...schemas].sort() };
}

function normalizeSqlIdent(raw: string): string {
  return String(raw ?? '')
    .replace(/^"+|"+$/g, '')
    .trim();
}

/** DROP/ALTER/CREATE SQL에서 참조 릴레이션 키(schema.table · table) 추출 */
function extractSqlRelationKeys(stmt: string): string[] {
  const n = stmt.replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  const re =
    /\b(?:TABLE|INDEX|VIEW|FROM|ON)\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([a-zA-Z_][\w$]*))(?:\s*\.\s*(?:"([^"]+)"|([a-zA-Z_][\w$]*)))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(n))) {
    const a = normalizeSqlIdent(m[1] || m[2] || '');
    const b = normalizeSqlIdent(m[3] || m[4] || '');
    if (a && b) {
      out.push(`${a}.${b}`, b);
    } else if (a) {
      out.push(`public.${a}`, a);
    }
  }
  return out;
}

/**
 * drizzle 정의 테이블에 대한 문만 남김.
 * DB에만 있는 레이어 테이블 DROP 등은 비교·통계에서 제외 (업로드 dbCompare와 동일 취지).
 */
function filterStatementsToManagedScope(statements: string[], managedKeys: Set<string>): string[] {
  return statements.filter((stmt) => {
    const category = classifySql(stmt);
    if (category === 'create') return true;
    const keys = extractSqlRelationKeys(stmt);
    if (keys.length === 0) {
      return category !== 'drop' && category !== 'delete';
    }
    return keys.some((k) => managedKeys.has(k));
  });
}

/**
 * drizzle-kit pushSchema 는 create/rename 을 키보드로 묻는다.
 * 메뉴 항목 0번 = create. 정책상 «동일 스키마+동일 테이블»이 아니면 create 이므로 Enter 자동 전송.
 * (동일 스키마+동일 테이블 rename 후보는 충돌 메뉴에 거의 안 뜸)
 * 항목마다 stdout 프롬프트에서 대상명을 읽어 auto(create) 로그를 남긴다.
 */
function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

type ConflictPromptInfo = {
  kind: string;
  target: string;
  detail?: string;
};

function parseConflictPrompt(chunk: string): ConflictPromptInfo | null {
  const text = stripAnsi(chunk).replace(/\r/g, '');
  const col = text.match(
    /Is\s+(.+?)\s+column in\s+(.+?)\s+table created or renamed/i
  );
  if (col) {
    return { kind: 'column', target: col[1].trim(), detail: `table=${col[2].trim()}` };
  }
  const named = text.match(
    /Is\s+(.+?)\s+(table|view|enum|schema|sequence)\s+created or renamed/i
  );
  if (named) {
    return { kind: named[2].toLowerCase(), target: named[1].trim() };
  }
  return null;
}

function withAutoCreateConflictAnswers<T>(
  fn: () => Promise<T>,
  log: (msg: string) => void
): Promise<T> {
  const stdin = process.stdin;
  const originalOn = stdin.on.bind(stdin);
  const originalWrite = process.stdout.write.bind(process.stdout);

  let lastPrompt: ConflictPromptInfo | null = null;
  let stdoutBuf = '';
  let autoCount = 0;

  const onStdoutChunk = (chunk: string) => {
    stdoutBuf += chunk;
    if (stdoutBuf.length > 16_000) stdoutBuf = stdoutBuf.slice(-8_000);
    const parsed = parseConflictPrompt(stdoutBuf);
    if (parsed) lastPrompt = parsed;
  };

  (process.stdout.write as unknown) = ((
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void
  ) => {
    const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    onStdoutChunk(str);
    if (typeof encoding === 'function') {
      return originalWrite(chunk, encoding);
    }
    return originalWrite(chunk, encoding as BufferEncoding | undefined, cb);
  }) as typeof process.stdout.write;

  const acceptCreate = () => {
    let attempts = 0;
    const tick = () => {
      attempts += 1;
      // hanji 메뉴 write 가 throttle 되어 프롬프트 파싱이 늦을 수 있음
      if (!lastPrompt && attempts < 15) {
        setTimeout(tick, 20);
        return;
      }
      const info = lastPrompt;
      autoCount += 1;
      if (info) {
        const where = info.detail ? ` (${info.detail})` : '';
        log(
          `${LOG} auto(create) — ${info.kind} ${info.target}${where} — rename 무시, create 자동 확정`
        );
      } else {
        log(`${LOG} auto(create) — (대상 미파싱) — create 자동 확정 #${autoCount}`);
      }
      lastPrompt = null;
      try {
        stdin.emit('keypress', '\r', { name: 'return' });
      } catch {
        /* ignore */
      }
    };
    setImmediate(tick);
  };

  (stdin as NodeJS.EventEmitter).on = ((
    event: string | symbol,
    listener: (...args: unknown[]) => void
  ) => {
    const result = originalOn(event as string, listener as (...args: unknown[]) => void);
    if (event === 'keypress') acceptCreate();
    return result;
  }) as typeof stdin.on;

  return fn().finally(() => {
    (stdin as NodeJS.EventEmitter).on = originalOn as typeof stdin.on;
    process.stdout.write = originalWrite;
    if (autoCount > 0) {
      log(`${LOG} auto(create) — 총 ${autoCount}건 자동 확정`);
    } else {
      log(`${LOG} auto(create) — 대화형 create/rename 질문 없음`);
    }
  });
}

/** create=적용, drop/delete/alter=미실행 */
export type SqlCategory = 'create' | 'drop' | 'delete' | 'alter';

export type SchemaPreviewItem = {
  category: SqlCategory;
  sql: string;
  summary: string;
};

export type SchemaPreviewResult = {
  ok: boolean;
  error?: string;
  counts: {
    create: number;
    drop: number;
    delete: number;
    alter: number;
  };
  items: SchemaPreviewItem[];
  warnings: string[];
  hasDataLoss: boolean;
};

export type AdditiveSyncResult = {
  applied: number;
  skipped: number;
  failed: number;
  skippedDrop: number;
  skippedAlter: number;
  skippedDestructive: number;
  failedUnique: number;
};

function classifySql(raw: string): SqlCategory {
  const n = raw.replace(/\s+/g, ' ').trim();

  // 생성(ADD COLUMN 포함) — ALTER … ADD 는 create
  if (/^CREATE\s+(TABLE|SCHEMA|INDEX|UNIQUE\s+INDEX|TYPE|ENUM)/i.test(n)) {
    return 'create';
  }
  if (/^ALTER\s+TABLE\b/i.test(n) && /\bADD\s+(COLUMN|CONSTRAINT)\b/i.test(n)) {
    return 'create';
  }
  if (/^COMMENT\s+ON\b/i.test(n)) {
    return 'create';
  }

  if (/\bDROP\s+(TABLE|SCHEMA|VIEW|MATERIALIZED\s+VIEW|TYPE|INDEX|SEQUENCE)\b/i.test(n)) {
    return 'drop';
  }
  if (/^DROP\b/i.test(n)) {
    return 'drop';
  }

  if (/\bTRUNCATE\b/i.test(n) || /\bDELETE\s+FROM\b/i.test(n)) {
    return 'delete';
  }

  // ALTER 수정·삭제형 (DROP COLUMN, TYPE, RENAME, PK 등)
  if (/\bALTER\s+TABLE\b/i.test(n) && /\bDROP\s+(COLUMN|CONSTRAINT)\b/i.test(n)) {
    return 'alter';
  }
  if (/\bSET\s+DATA\s+TYPE\b/i.test(n) || (/\bALTER\s+COLUMN\b/i.test(n) && /\bTYPE\b/i.test(n))) {
    return 'alter';
  }
  if (/\bDROP\s+PRIMARY\s+KEY\b/i.test(n) || /\bDROP\s+CONSTRAINT\b/i.test(n)) {
    return 'alter';
  }
  if (/\bRENAME\b/i.test(n)) {
    return 'alter';
  }
  if (/^ALTER\b/i.test(n)) {
    return 'alter';
  }

  // 나머지는 생성 계열로 시도
  return 'create';
}

function summarizeSql(raw: string, category: SqlCategory): string {
  const n = raw.replace(/\s+/g, ' ').trim();
  const table =
    n.match(/(?:TABLE|INDEX|SCHEMA|VIEW|FROM)\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)/i)?.[1] ?? '';
  switch (category) {
    case 'create':
      if (/\bADD\s+COLUMN\b/i.test(n)) return `컬럼 추가${table ? ` (${table})` : ''}`;
      if (/\bADD\s+CONSTRAINT\b/i.test(n)) return `제약 추가${table ? ` (${table})` : ''}`;
      if (/\bCREATE\s+INDEX\b/i.test(n) || /\bCREATE\s+UNIQUE\s+INDEX\b/i.test(n)) {
        return `인덱스 생성${table ? ` (${table})` : ''}`;
      }
      if (/\bCREATE\s+SCHEMA\b/i.test(n)) return `스키마 생성${table ? ` (${table})` : ''}`;
      if (/\bCREATE\s+TABLE\b/i.test(n)) return `테이블 생성${table ? ` (${table})` : ''}`;
      if (/^COMMENT\s+ON\b/i.test(n)) return '코멘트';
      return `생성${table ? ` (${table})` : ''}`;
    case 'drop':
      return `삭제(DROP)${table ? ` (${table})` : ''}`;
    case 'delete':
      return `데이터 비우기${table ? ` (${table})` : ''}`;
    case 'alter':
      if (/\bDROP\s+COLUMN\b/i.test(n)) return `컬럼 삭제${table ? ` (${table})` : ''}`;
      if (/\bTYPE\b/i.test(n)) return `타입 변경${table ? ` (${table})` : ''}`;
      return `스키마 수정(ALTER)${table ? ` (${table})` : ''}`;
  }
}

function isUniqueConstraintSql(raw: string): boolean {
  return /\bADD\s+CONSTRAINT\b/i.test(raw) || /\bUNIQUE\b/i.test(raw);
}

function shorten(s: string, max = 200): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max)}…`;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} ${ms}ms 초과`));
      setImmediate(() => {
        try {
          onTimeout?.();
        } catch {
          /* ignore */
        }
      });
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** 진행 중 쿼리를 끊고 풀을 폐기 — end() 무한 대기 방지 */
function forceClosePool(pool: Pool): void {
  try {
    const internal = pool as PoolInternal;
    for (const client of internal._clients ?? []) {
      try {
        client.connection?.stream?.destroy?.();
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  try {
    void pool.end().catch(() => undefined);
  } catch {
    /* ignore */
  }
}

function logLine(msg: string, toStderr = false): void {
  if (toStderr) {
    console.error(msg);
  } else {
    console.log(msg);
  }
}

type CollectResult = {
  statements: string[];
  warnings: string[];
  hasDataLoss: boolean;
  error?: string;
  errorKind?: 'init' | 'timeout' | 'pushSchema' | 'env';
};

async function collectStatements(opts?: { quiet?: boolean }): Promise<CollectResult & { pool: Pool | null }> {
  const quiet = opts?.quiet === true;
  const log = (m: string) => {
    if (!quiet) logLine(m);
    else logLine(m, true);
  };

  const database = process.env.DATABASE_NAME || '';
  const user = process.env.DATABASE_USER || '';
  if (!database || !user) {
    return {
      statements: [],
      warnings: [],
      hasDataLoss: false,
      error: 'DB env 없음',
      errorKind: 'env',
      pool: null,
    };
  }

  let schemaMod: Record<string, unknown>;
  let pushSchema: typeof import('drizzle-kit/api').pushSchema;
  try {
    schemaMod = (await import('../src/database/schema')) as Record<string, unknown>;
    ({ pushSchema } = await import('drizzle-kit/api'));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`${LOG} fail(init) — schema 또는 drizzle-kit/api 로드 실패 — ${msg}`);
    return {
      statements: [],
      warnings: [],
      hasDataLoss: false,
      error: msg,
      errorKind: 'init',
      pool: null,
    };
  }

  const { names: managedTables, keys: managedKeys, schemas: managedSchemas } =
    collectManagedTableKeys(schemaMod);
  if (managedTables.length === 0) {
    log(`${LOG} skip — drizzle 스키마에 테이블이 없음`);
    return {
      statements: [],
      warnings: [],
      hasDataLoss: false,
      pool: null,
    };
  }

  const schemaFilters = managedSchemas.length > 0 ? managedSchemas : SCHEMA_FILTERS_FALLBACK;
  const host = process.env.DATABASE_HOST || 'localhost';
  const port = process.env.DATABASE_PORT ? parseInt(process.env.DATABASE_PORT, 10) : 5432;

  log(`${LOG} info — DB ${host}:${port}/${database} user=${user}`);
  log(
    `${LOG} info — create/rename: 스키마·테이블명 불일치면 create 자동 (동일 스키마+동일 테이블만 rename)`
  );
  log(
    `${LOG} info — 비교 범위: 스키마 ${schemaFilters.join(',')} · drizzle 정의 테이블 ${managedTables.length}개 (DB 전용 테이블 DROP 등은 제외)`
  );

  const pool = new Pool({
    host,
    port,
    database,
    user,
    password: process.env.DATABASE_PASSWORD || '',
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: CONNECT_TIMEOUT_MS,
    allowExitOnIdle: true,
  });
  pool.on('connect', (client) => {
    void client.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`).catch(() => undefined);
  });
  const db = drizzle(pool);

  try {
    // tablesFilter = 관리 테이블 allowlist 만 사용.
    // postgis extensionsFilters(!spatial_ref_sys 등)를 붙이면 drizzle-kit 필터 로직상
    // 부정 매칭이 allowlist를 깨서 DB 전용 테이블이 다시 rename 후보로 섞인다.
    const result = await withTimeout(
      withAutoCreateConflictAnswers(
        () => pushSchema(schemaMod, db as never, schemaFilters, managedTables),
        log
      ),
      PUSH_SCHEMA_TIMEOUT_MS,
      'pushSchema',
      () => forceClosePool(pool)
    );
    const rawStatements = result.statementsToExecute ?? [];
    const statements = filterStatementsToManagedScope(rawStatements, managedKeys);
    const omitted = rawStatements.length - statements.length;
    if (omitted > 0) {
      log(
        `${LOG} info — DB 전용·비관리 객체 관련 SQL ${omitted}건 제외 (정의 테이블만 집계)`
      );
    }
    return {
      statements,
      warnings: (result.warnings ?? []).map(String),
      hasDataLoss: result.hasDataLoss === true,
      pool,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = /초과|timeout/i.test(msg);
    log(
      isTimeout
        ? `\n${LOG} fail(timeout) — pushSchema ${PUSH_SCHEMA_TIMEOUT_MS / 1000}초 초과 — additive 중단, 기동은 계속`
        : `\n${LOG} fail(pushSchema) — ${msg} — additive 중단, 기동은 계속`
    );
    setImmediate(() => forceClosePool(pool));
    return {
      statements: [],
      warnings: [],
      hasDataLoss: false,
      error: msg,
      errorKind: isTimeout ? 'timeout' : 'pushSchema',
      pool: null,
    };
  }
}

async function endPool(pool: Pool | null): Promise<void> {
  if (!pool) return;
  let ended = false;
  try {
    await Promise.race([
      pool.end().then(() => {
        ended = true;
      }),
      new Promise<void>((resolve) => setTimeout(resolve, POOL_END_TIMEOUT_MS)),
    ]);
  } catch {
    /* ignore */
  }
  if (!ended) forceClosePool(pool);
}

/** 실행 없이 집계·목록만 (모달용) */
export async function previewAdditiveSchemaSync(): Promise<SchemaPreviewResult> {
  const collected = await collectStatements({ quiet: true });
  try {
    if (collected.errorKind === 'env') {
      return {
        ok: false,
        error: 'DB 환경변수가 없어 스키마 미리보기를 할 수 없습니다.',
        counts: { create: 0, drop: 0, delete: 0, alter: 0 },
        items: [],
        warnings: [],
        hasDataLoss: false,
      };
    }
    if (collected.error) {
      return {
        ok: false,
        error: collected.error,
        counts: { create: 0, drop: 0, delete: 0, alter: 0 },
        items: [],
        warnings: collected.warnings,
        hasDataLoss: collected.hasDataLoss,
      };
    }

    const counts = { create: 0, drop: 0, delete: 0, alter: 0 };
    const items: SchemaPreviewItem[] = [];
    for (const stmt of collected.statements) {
      const category = classifySql(stmt);
      counts[category] += 1;
      if (items.length < MAX_PREVIEW_ITEMS) {
        items.push({
          category,
          sql: shorten(stmt, 280),
          summary: summarizeSql(stmt, category),
        });
      }
    }
    return {
      ok: true,
      counts,
      items,
      warnings: collected.warnings.slice(0, MAX_WARN_SAMPLES),
      hasDataLoss: collected.hasDataLoss,
    };
  } finally {
    await endPool(collected.pool);
  }
}

/**
 * 추가만 스키마 동기화. 예외를 throw 하지 않고 로그 + 결과 반환.
 */
export async function runAdditiveSchemaSync(): Promise<AdditiveSyncResult> {
  const empty: AdditiveSyncResult = {
    applied: 0,
    skipped: 0,
    failed: 0,
    skippedDrop: 0,
    skippedAlter: 0,
    skippedDestructive: 0,
    failedUnique: 0,
  };

  console.log(`${LOG} start — additive schema sync`);

  const collected = await collectStatements({ quiet: false });
  try {
    if (collected.errorKind === 'env') {
      console.warn(`${LOG} skip(env) — DB env 없음, additive sync 생략`);
      console.log(`${LOG} done — applied=0 skipped=0 failed=0`);
      return empty;
    }
    if (collected.error) {
      console.log(`${LOG} done — applied=0 skipped=0 failed=1`);
      return { ...empty, failed: 1 };
    }

    if (collected.hasDataLoss || collected.warnings.length > 0) {
      console.warn(
        `${LOG} warn(dataLoss) — drizzle 경고 ${collected.warnings.length}건 (삭제·truncate 후보는 미실행)`
      );
      for (const w of collected.warnings.slice(0, MAX_WARN_SAMPLES)) {
        console.warn(`${LOG} warn(dataLoss) — ${shorten(String(w), 240)}`);
      }
      if (collected.warnings.length > MAX_WARN_SAMPLES) {
        console.warn(
          `${LOG} warn(dataLoss) — …외 ${collected.warnings.length - MAX_WARN_SAMPLES}건`
        );
      }
    }

    if (collected.statements.length === 0) {
      console.log(`${LOG} info — no statements to apply`);
      console.log(`${LOG} done — applied=0 skipped=0 failed=0`);
      return empty;
    }

    const pool = collected.pool;
    if (!pool) {
      console.log(`${LOG} done — applied=0 skipped=0 failed=1`);
      return { ...empty, failed: 1 };
    }
    const db = drizzle(pool);
    const counts = { ...empty };
    let appliedLogged = 0;

    for (const stmt of collected.statements) {
      const category = classifySql(stmt);
      if (category === 'drop') {
        counts.skipped += 1;
        counts.skippedDrop += 1;
        console.warn(`${LOG} skip(DROP) — ${shorten(stmt)} 미실행 (데이터 보존)`);
        continue;
      }
      if (category === 'alter') {
        counts.skipped += 1;
        counts.skippedAlter += 1;
        console.warn(`${LOG} skip(ALTER) — ${shorten(stmt)} 미실행 (고정 정책)`);
        continue;
      }
      if (category === 'delete') {
        counts.skipped += 1;
        counts.skippedDestructive += 1;
        console.warn(`${LOG} skip(destructive) — ${shorten(stmt)} 미실행`);
        continue;
      }

      try {
        await db.execute(sql.raw(stmt));
        counts.applied += 1;
        if (appliedLogged < MAX_APPLIED_LOG) {
          console.log(`${LOG} applied: ${shorten(stmt)}`);
          appliedLogged += 1;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        counts.failed += 1;
        if (isUniqueConstraintSql(stmt)) {
          counts.failedUnique += 1;
          console.error(`${LOG} fail(unique) — ${shorten(stmt)} — ${shorten(msg, 160)}`);
          console.error(`${LOG} fail(unique) — 기동은 계속. 데이터 정리 후 수동 재적용 권장`);
        } else {
          console.error(`${LOG} fail(sql) — ${shorten(stmt)} — ${shorten(msg, 160)}`);
          console.error(`${LOG} fail(sql) — 해당 문만 건너뛰고 계속`);
        }
      }
    }

    if (counts.applied > MAX_APPLIED_LOG) {
      console.log(`${LOG} applied: … and ${counts.applied - MAX_APPLIED_LOG} more`);
    }
    if (counts.skippedAlter > 0) {
      console.warn(
        `${LOG} skip(ALTER) — 코드와 DB가 다를 수 있음. 필요 시 개발자 PC에서 수동 반영`
      );
    }

    console.log(
      `${LOG} done — applied=${counts.applied} skipped=${counts.skipped} failed=${counts.failed}` +
        ` skippedDrop=${counts.skippedDrop} skippedAlter=${counts.skippedAlter}` +
        ` skippedDestructive=${counts.skippedDestructive} failedUnique=${counts.failedUnique}`
    );
    return counts;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG} fail(init) — ${msg}`);
    console.log(`${LOG} done — applied=0 skipped=0 failed=1`);
    return { ...empty, failed: 1 };
  } finally {
    await endPool(collected.pool);
  }
}

async function main(): Promise<void> {
  const mode = (process.argv[2] || 'apply').toLowerCase();
  if (mode === 'preview') {
    const result = await previewAdditiveSchemaSync();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  await runAdditiveSchemaSync();
}

const isCli =
  typeof process.argv[1] === 'string' &&
  /drizzle-push-additive\.(ts|js|mts|cjs)/i.test(process.argv[1].replace(/\\/g, '/'));
if (isCli) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
