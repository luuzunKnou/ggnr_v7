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
  if (!text) {
    console.log('[wimsOracle.parse] empty WIMS_INFO');
    return null;
  }
  const parts = text.split('/');
  if (parts.length < 5) {
    console.log('[wimsOracle.parse] parts < 5', { parts: parts.length });
    return null;
  }
  const host = parts[0]?.trim() ?? '';
  const port = parts[1]?.trim() ?? '';
  const dbName = parts[2]?.trim() ?? '';
  const user = parts[3]?.trim() ?? '';
  const password = parts[4] ?? '';
  const typeRaw = parts.length > 5 ? (parts[5] ?? '').trim() : 'SID';
  if (!host || !port || !dbName || !user || !password) {
    console.log('[wimsOracle.parse] missing field', {
      host: Boolean(host),
      port: Boolean(port),
      dbName: Boolean(dbName),
      user: Boolean(user),
      password: Boolean(password),
    });
    return null;
  }
  if (!ident(host) || !/^\d+$/.test(port) || !ident(dbName) || !/^[A-Za-z0-9_]+$/.test(user)) {
    console.log('[wimsOracle.parse] invalid format', {
      hostOk: ident(host),
      portOk: /^\d+$/.test(port),
      dbOk: ident(dbName),
      userOk: /^[A-Za-z0-9_]+$/.test(user),
      host,
      port,
      dbName,
      user,
    });
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

export function isWimsConfigured(): boolean {
  const raw = process.env.WIMS_INFO;
  const parsed = parseWimsInfo(raw);
  console.log('[wimsOracle.isConfigured]', {
    hasEnv: raw != null,
    envLen: String(raw ?? '').length,
    enabled: parsed != null,
    host: parsed?.host ?? null,
    schema: parsed?.schema ?? null,
    connectType: parsed?.connectType ?? null,
  });
  return parsed != null;
}

export function getWimsSchema(): string | null {
  return parseWimsInfo(process.env.WIMS_INFO)?.schema ?? null;
}

async function openPool(conn: WimsConn): Promise<Pool> {
  const pool = await oracledb.createPool({
    user: conn.user,
    password: conn.password,
    connectString: conn.connectString,
    poolMin: 1,
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
}

/** 프로세스에서 연결 정보당 풀 하나. 같은 정보면 다시 붙지 않는다. */
export async function getWimsPool(): Promise<Pool> {
  const conn = parseWimsInfo(process.env.WIMS_INFO);
  if (!conn) {
    throw new Error('WIMS 연결 정보가 없습니다.');
  }
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
        throw err;
      });
  }
  return pending;
}

export async function wimsExecute(
  sql: string,
  binds: Record<string, string | number> = {}
): Promise<Record<string, unknown>[]> {
  const pool = await getWimsPool();
  const connection = await pool.getConnection();
  try {
    const result = await connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    return (result.rows ?? []) as Record<string, unknown>[];
  } finally {
    await connection.close();
  }
}
