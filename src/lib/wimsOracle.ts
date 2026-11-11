import oracledb, { type Pool } from 'oracledb';

export type WimsConn = {
  host: string;
  port: string;
  dbName: string;
  user: string;
  password: string;
  connectType: 'SERVICENAME' | 'SID';
  /** 풀 재사용 키. 비밀번호는 포함하지 않고 로그에도 남기지 않는다. */
  key: string;
  schema: string;
  connectString: string;
};

export class WimsNotConfiguredError extends Error {
  constructor() {
    super('WIMS 연결 정보가 없습니다.');
    this.name = 'WimsNotConfiguredError';
  }
}

export class WimsUnreachableError extends Error {
  constructor(cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : cause != null ? String(cause) : '';
    super(detail ? `WIMS DB 접속에 실패했습니다. (${detail})` : 'WIMS DB 접속에 실패했습니다.');
    this.name = 'WimsUnreachableError';
  }
}

type CachedPool = { key: string; pool: Pool };
type GlobalWims = typeof globalThis & { __ggnrWimsPool?: CachedPool };

let pending: Promise<Pool> | null = null;
let pendingKey = '';

function ident(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value);
}

/** `호스트/포트/DB이름/사용자/비밀번호[/ServiceName|SID]` */
export function parseWimsInfo(raw: string | undefined | null): WimsConn | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const parts = text.split('/');
  if (parts.length < 5) return null;
  const host = parts[0]?.trim() ?? '';
  const port = parts[1]?.trim() ?? '';
  const dbName = parts[2]?.trim() ?? '';
  const user = parts[3]?.trim() ?? '';
  const password = parts[4] ?? '';
  const typeRaw = parts.length > 5 ? (parts[5] ?? '').trim() : 'SID';
  if (!host || !port || !dbName || !user || !password) return null;
  if (!ident(host) || !/^\d+$/.test(port) || !ident(dbName) || !/^[A-Za-z0-9_]+$/.test(user)) {
    return null;
  }
  const connectType = typeRaw.toUpperCase() === 'SERVICENAME' ? 'SERVICENAME' : 'SID';
  const connectString =
    connectType === 'SERVICENAME'
      ? `${host}:${port}/${dbName}`
      : `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${dbName})))`;
  let pwdTag = 0;
  for (let i = 0; i < password.length; i++) pwdTag = (pwdTag * 31 + password.charCodeAt(i)) >>> 0;
  return {
    host,
    port,
    dbName,
    user,
    password,
    connectType,
    key: `${host}|${port}|${dbName}|${user}|${connectType}|${pwdTag.toString(16)}`,
    schema: user.toUpperCase(),
    connectString,
  };
}

/** env 에 WIMS_INFO 가 유효하게 있을 때만 true. Oracle 접속은 하지 않는다. */
export function isWimsConfigured(): boolean {
  return parseWimsInfo(process.env.WIMS_INFO) != null;
}

export function getWimsSchema(): string | null {
  return parseWimsInfo(process.env.WIMS_INFO)?.schema ?? null;
}

export function isWimsConnectionFailure(err: unknown): boolean {
  if (err instanceof WimsUnreachableError) return true;
  if (err instanceof WimsNotConfiguredError) return false;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /NJS-|DPI-|ORA-12170|ORA-12541|ORA-12514|ORA-12505|ORA-01017|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|connect timed out|connection|접속/i.test(
    msg
  );
}

async function openPool(conn: WimsConn): Promise<Pool> {
  let pool: Pool | null = null;
  try {
    pool = await oracledb.createPool({
      user: conn.user,
      password: conn.password,
      connectString: conn.connectString,
      poolMin: 0,
      poolMax: 3,
      poolIncrement: 1,
      poolTimeout: 60,
      connectTimeout: 15,
      stmtCacheSize: 30,
    });
    const probe = await pool.getConnection();
    try {
      await probe.execute('SELECT 1 FROM DUAL');
    } finally {
      await probe.close();
    }
    return pool;
  } catch (err) {
    if (pool) {
      try {
        await pool.close(0);
      } catch {
        /* ignore */
      }
    }
    throw new WimsUnreachableError(err);
  }
}

/** 프로세스에서 연결 정보당 풀 하나. 같은 정보면 다시 붙지 않는다. */
export async function getWimsPool(): Promise<Pool> {
  const conn = parseWimsInfo(process.env.WIMS_INFO);
  if (!conn) throw new WimsNotConfiguredError();

  const g = globalThis as GlobalWims;
  if (g.__ggnrWimsPool?.key === conn.key) return g.__ggnrWimsPool.pool;

  if (!pending || pendingKey !== conn.key) {
    pendingKey = conn.key;
    const key = conn.key;
    pending = openPool(conn)
      .then((pool) => {
        if (g.__ggnrWimsPool && g.__ggnrWimsPool.key !== key) {
          void g.__ggnrWimsPool.pool.close(0).catch(() => undefined);
        }
        g.__ggnrWimsPool = { key, pool };
        return pool;
      })
      .catch((err) => {
        if (pendingKey === key) pending = null;
        throw err instanceof WimsUnreachableError ? err : new WimsUnreachableError(err);
      });
  }
  return pending;
}

/**
 * 설정만 보고 Oracle 을 건드리지 않거나, 설정이 있으면 접속 가능 여부만 확인한다.
 * 예외를 밖으로 던지지 않는다.
 */
export async function checkWimsStatus(): Promise<{
  configured: boolean;
  connected: boolean | null;
}> {
  if (!isWimsConfigured()) {
    return { configured: false, connected: null };
  }
  try {
    const pool = await getWimsPool();
    const connection = await pool.getConnection();
    try {
      await connection.execute('SELECT 1 FROM DUAL');
    } finally {
      await connection.close();
    }
    return { configured: true, connected: true };
  } catch (err) {
    console.error('[wimsOracle] check failed', err instanceof Error ? err.message : err);
    return { configured: true, connected: false };
  }
}

/**
 * 조회마다 풀에서 세션만 빌렸다가 반환한다.
 * 풀 자체는 캐시를 재사용한다. 실패해도 프로세스를 종료하지 않는다.
 */
export async function wimsExecute(
  sql: string,
  binds: Record<string, string | number> = {}
): Promise<Record<string, unknown>[]> {
  const pool = await getWimsPool();
  let connection;
  try {
    connection = await pool.getConnection();
  } catch (err) {
    throw err instanceof WimsUnreachableError ? err : new WimsUnreachableError(err);
  }
  try {
    const result = await connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    return (result.rows ?? []) as Record<string, unknown>[];
  } catch (err) {
    if (isWimsConnectionFailure(err)) throw new WimsUnreachableError(err);
    throw err;
  } finally {
    try {
      await connection.close();
    } catch {
      /* ignore */
    }
  }
}
