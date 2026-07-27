/**
 * DevTest Service
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCssFromSimpleStyle,
  darkerHex,
  getMaterialToneColor,
  parseSimpleStyleFromCss,
  replaceDefaultRuleInCss,
  type GeometryType,
  type StyleProps,
} from '@/lib/geoserverStyleUtils';
import { normalizeDefineTableSource } from '@/lib/defineLayerTablesNormalize';
export { startGeoServer, stopGeoServer } from '@/service/geoserverProcessService';

/** 심볼 베이스 URL (GeoServer가 이미지를 요청할 주소). NEXT_PUBLIC_APP_URL 없으면 localhost:3000 */
const SYMBOL_BASE_URL =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_APP_URL) || 'http://localhost:3000';

/**
 * 레이어(스타일) 이름과 동일한 심볼 파일이 public/symbol에 있는지 확인.
 * SVG 우선, 없으면 PNG. 있으면 전체 URL 반환, 없으면 null.
 */
/**
 * PostGIS 테이블 목록 Map에서 논리 이름 대소문자 무관 조회 (레거시 혼합 대소문자 테이블 호환).
 */
function resolveDbTableCaseInsensitive(
  dbTableMap: Map<string, { schema: string; table: string }>,
  logicalName: string
): { schema: string; table: string } | undefined {
  const key = String(logicalName ?? '').trim();
  if (!key) return undefined;
  const direct = dbTableMap.get(key);
  if (direct) return direct;
  const kl = key.toLowerCase();
  for (const [k, v] of dbTableMap.entries()) {
    if (k.toLowerCase() === kl) return v;
  }
  return undefined;
}

function resolveSymbolUrlForLayer(layerName: string): string | null {
  if (!layerName?.trim()) return null;
  const name = layerName.trim();
  const base = path.join(process.cwd(), 'public', 'symbol');
  const svgPath = path.join(base, `${name}.svg`);
  const pngPath = path.join(base, `${name}.png`);
  if (fs.existsSync(svgPath)) {
    return `${SYMBOL_BASE_URL.replace(/\/$/, '')}/symbol/${name}.svg`;
  }
  if (fs.existsSync(pngPath)) {
    return `${SYMBOL_BASE_URL.replace(/\/$/, '')}/symbol/${name}.png`;
  }
  return null;
}

/**
 * 데이터베이스 연결 테스트 및 정보 조회
 */
export async function testDatabaseConnection() {
  const results: any = {
    timestamp: new Date().toISOString(),
    connection: null,
    postgis: null,
    tables: null,
    functions: null,
    error: null,
  };

  try {
    // 1. 연결 테스트 및 PostgreSQL 버전 확인
    try {
      const connectionResult = await db.execute(
        sql`SELECT NOW() as current_time, version() as pg_version`
      );
      const row = connectionResult.rows[0] as any;
      results.connection = {
        success: true,
        currentTime: row.current_time,
        pgVersion: row.pg_version,
      };
    } catch (error: any) {
      results.connection = {
        success: false,
        error: error.message || 'Connection failed',
      };
      return results;
    }

    // 2. PostGIS 버전 확인
    try {
      const postgisResult = await db.execute(
        sql`SELECT PostGIS_version() as version`
      );
      const row = postgisResult.rows[0] as any;
      results.postgis = {
        available: true,
        version: row.version,
        enabled: true,
      };
    } catch (error: any) {
      results.postgis = {
        available: false,
        version: null,
        enabled: false,
        error: error.message || 'PostGIS check failed',
      };
    }

    // 3. 테이블 목록 조회
    try {
      const tablesResult = await db.execute(
        sql`
          SELECT 
            table_schema,
            table_name,
            table_type
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
          ORDER BY table_schema, table_name
        `
      );
      results.tables = {
        success: true,
        count: tablesResult.rows.length,
        list: tablesResult.rows as Array<{
          table_schema: string;
          table_name: string;
          table_type: string;
        }>,
      };
    } catch (error: any) {
      results.tables = {
        success: false,
        error: error.message || 'Failed to get tables',
        details: error.stack || undefined,
      };
    }

    return results;
  } catch (error: any) {
    results.error = error.message || 'Unknown error occurred';
    return results;
  }
}

/**
 * GeoServer 연결 테스트 (GET 요청, 10초 타임아웃)
 * 기본 인증: admin / geoserver
 */
export async function testGeoServer(params: { url?: string; username?: string; password?: string }) {
  const url = params?.url?.trim();
  if (!url) {
    return { success: false, error: 'URL이 필요합니다.', status: null, statusText: '', version: null };
  }

  const username = params?.username?.trim() || 'admin';
  const password = params?.password?.trim() || 'geoserver';
  const auth = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const baseUrl = url.replace(/\/$/, '');
    const versionUrl = `${baseUrl}/rest/about/version.json`;

    const res = await fetch(versionUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${auth}`,
      },
    });

    clearTimeout(timeout);

    if (res.ok) {
      let version: string | null = null;
      try {
        const json = await res.json();
        version = json.resource?.GeoServer?.version ?? json.GeoServer?.version ?? null;
      } catch {
        // ignore parse error
      }
      return {
        success: true,
        status: res.status,
        statusText: res.statusText,
        contentType: res.headers.get('content-type') ?? undefined,
        version,
        error: undefined,
      };
    }

    return {
      success: false,
      status: res.status,
      statusText: res.statusText,
      contentType: res.headers.get('content-type') ?? undefined,
      version: null,
      error: `HTTP ${res.status} ${res.statusText}`,
    };
  } catch (error: any) {
    const message = error.name === 'AbortError' ? '요청 시간 초과 (10초)' : error.message || '연결 실패';
    return { success: false, error: message, status: null, statusText: '', version: null };
  }
}

function getDbConfig() {
  return {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'postgres',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    schema: 'public',
  };
}

const GEOSERVER_DEFAULT_URL = 'http://localhost:8080/geoserver';
const GEOSERVER_AUTH = Buffer.from('admin:geoserver', 'utf8').toString('base64');

/** 작업공간 ggnr의 namespace URI. workspace 생성 시 GeoServer가 부여하는 값과 동일 — PostGIS 저장소에도 명시해야 Web UI NamespacePanel이 정상 동작 */
const GEOSERVER_NAMESPACE_URI = 'http://ggnr';

/** PostGIS 데이터 스토어 REST body 공통 생성. host/port/database/user/passwd(동적, env) + namespace/dbtype 등 PostGIS 고정 파라미터(정적) 포함 */
function buildPostgisDataStoreBody(
  name: string,
  schema: string,
  db: { host: string | number; port: string | number; database: string; user: string; password: string }
) {
  return {
    dataStore: {
      name,
      type: 'PostGIS',
      enabled: true,
      connectionParameters: {
        entry: [
          { '@key': 'host', $: String(db.host) },
          { '@key': 'port', $: String(db.port) },
          { '@key': 'database', $: db.database },
          { '@key': 'schema', $: schema },
          { '@key': 'user', $: db.user },
          { '@key': 'passwd', $: db.password },
          { '@key': 'dbtype', $: 'postgis' },
          { '@key': 'namespace', $: GEOSERVER_NAMESPACE_URI },
          { '@key': 'Loose bbox', $: 'true' },
          { '@key': 'Estimated extends', $: 'false' },
          { '@key': 'validate connections', $: 'true' },
          { '@key': 'preparedStatements', $: 'false' },
        ],
      },
    },
  };
}

async function geoserverFetch(
  baseUrl: string,
  path: string,
  options: { method?: string; body?: string; contentType?: string; accept?: string } = {}
) {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const headers: Record<string, string> = {
    Accept: options.accept ?? 'application/json',
    Authorization: `Basic ${GEOSERVER_AUTH}`,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = options.contentType ?? 'application/json';
  }
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body,
  });
  return res;
}

/**
 * GeoServer DB 연결 설정 (workspace + PostGIS 데이터 스토어 생성)
 */
export async function setupGeoServerDb(params: {
  url?: string;
  workspace?: string;
  datastoreName?: string;
} = {}) {
  const baseUrl = params?.url?.trim() || GEOSERVER_DEFAULT_URL;
  const workspace = params?.workspace?.trim() || 'ggnr';
  const db = getDbConfig();
  const targets = [
    { name: 'postgres_layer', schema: 'layer' },
    { name: 'postgres_public_layer', schema: 'public_layer' },
  ] as const;

  try {
    const wsRes = await geoserverFetch(baseUrl, `/rest/workspaces/${workspace}.json`);
    if (!wsRes.ok && wsRes.status !== 404) {
      const text = await wsRes.text();
      return { success: false, error: `Workspace 조회 실패: ${wsRes.status} ${text}` };
    }
    if (wsRes.status === 404) {
      const createRes = await geoserverFetch(baseUrl, '/rest/workspaces', {
        method: 'POST',
        body: JSON.stringify({ workspace: { name: workspace } }),
      });
      if (!createRes.ok) {
        const text = await createRes.text();
        return { success: false, error: `Workspace 생성 실패: ${createRes.status} ${text}` };
      }
    }

    const datastores: Array<{ name: string; schema: string; status: 'created' | 'exists' | 'updated' }> = [];

    const buildDataStoreBody = (name: string, schema: string) => buildPostgisDataStoreBody(name, schema, db);

    for (const target of targets) {
      const dsGetRes = await geoserverFetch(
        baseUrl,
        `/rest/workspaces/${workspace}/datastores/${target.name}.json`
      );
      if (dsGetRes.ok) {
        // 저장소가 이미 있으면 현재 프로젝트 env DB로 연결 정보 갱신 (run dev 시 접속 DB에 맞게 필드 반영)
        const putBody = buildDataStoreBody(target.name, target.schema);
        const dsPutRes = await geoserverFetch(
          baseUrl,
          `/rest/workspaces/${workspace}/datastores/${target.name}.json`,
          { method: 'PUT', body: JSON.stringify(putBody) }
        );
        if (dsPutRes.ok) {
          datastores.push({ name: target.name, schema: target.schema, status: 'updated' });
        } else {
          datastores.push({ name: target.name, schema: target.schema, status: 'exists' });
        }
        continue;
      }
      if (dsGetRes.status !== 404) {
        const text = await dsGetRes.text();
        return { success: false, error: `데이터 스토어 조회 실패(${target.name}): ${dsGetRes.status} ${text}` };
      }

      const dataStoreBody = buildDataStoreBody(target.name, target.schema);
      const dsRes = await geoserverFetch(
        baseUrl,
        `/rest/workspaces/${workspace}/datastores.json`,
        { method: 'POST', body: JSON.stringify(dataStoreBody) }
      );
      if (!dsRes.ok) {
        const text = await dsRes.text();
        return { success: false, error: `데이터 스토어 생성 실패(${target.name}): ${dsRes.status} ${text}` };
      }
      datastores.push({ name: target.name, schema: target.schema, status: 'created' });
    }

    return {
      success: true,
      workspace,
      datastoreName: targets.map((t) => t.name).join(','),
      datastores,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * GeoServer DB 연결 확인 (데이터 스토어 조회 + feature types 목록)
 */
export async function verifyGeoServerDbConnection(params: {
  url?: string;
  workspace?: string;
  datastoreName?: string;
} = {}) {
  const baseUrl = params?.url?.trim() || GEOSERVER_DEFAULT_URL;
  const workspace = params?.workspace?.trim() || 'ggnr';
  const targets = [
    { name: 'postgres_layer', schema: 'layer' },
    { name: 'postgres_public_layer', schema: 'public_layer' },
  ] as const;

  try {
    const featureTypes: Array<{ name?: string; datastoreName: string }> = [];
    const datastores: Array<{ name: string; schema: string; ok: boolean; error?: string }> = [];
    const errors: string[] = [];

    for (const target of targets) {
      const dsRes = await geoserverFetch(
        baseUrl,
        `/rest/workspaces/${workspace}/datastores/${target.name}.json`
      );
      if (!dsRes.ok) {
        const text = await dsRes.text();
        const err = `데이터 스토어 조회 실패(${target.name}): ${dsRes.status} ${text}`;
        datastores.push({ name: target.name, schema: target.schema, ok: false, error: err });
        errors.push(err);
        continue;
      }

      datastores.push({ name: target.name, schema: target.schema, ok: true });

      const ftRes = await geoserverFetch(
        baseUrl,
        `/rest/workspaces/${workspace}/datastores/${target.name}/featuretypes.json`
      );
      if (!ftRes.ok) {
        const text = await ftRes.text();
        errors.push(`Feature types 조회 실패(${target.name}): ${ftRes.status} ${text}`);
        continue;
      }
      const ftData = await ftRes.json();
      const raw = ftData?.featureTypes?.featureType ?? ftData?.featureTypes;
      const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const item of arr) {
        featureTypes.push({
          datastoreName: target.name,
          ...(typeof item === 'object' && item ? (item as Record<string, unknown>) : { name: String(item) }),
        });
      }
    }

    return {
      success: errors.length === 0,
      datastores,
      featureTypes,
      error: errors.length ? errors.join(' | ') : undefined,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * GeoServer에 생성된 레이어 목록 조회 (REST API)
 */
export async function getGeoServerLayerList(params: {
  url?: string;
  workspace?: string;
} = {}) {
  const baseUrl = params?.url?.trim() || GEOSERVER_DEFAULT_URL;
  const workspace = params?.workspace?.trim() || 'ggnr';

  try {
    const res = await geoserverFetch(
      baseUrl,
      `/rest/workspaces/${workspace}/layers.json`
    );
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `레이어 조회 실패: ${res.status} ${text}`, layers: [] };
    }
    const data = await res.json();
    const raw = data?.layers?.layer ?? data?.layers ?? [];
    const layers = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const names = layers.map((l: { name?: string }) => l?.name ?? String(l));
    return { success: true, layers: names };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg, layers: [] };
  }
}

/** 백업 테이블명 예: roadUseLedger_BAK20260423 (`_BAK` + 선택 숫자로 끝남, 대소문자 무시) */
const LAYER_BACKUP_TABLE_NAME_RE = /_bak\d*$/i;

/**
 * layer, public_layer 스키마의 geometry 테이블 목록 조회
 * 백업용 `…_BAK`, `…_BAK20260423` 형태 테이블은 레이어 목록·발행 UI에서 제외
 */
export async function getLayerTableList() {
  try {
    const result = await db.execute(
      sql`
        SELECT f_table_schema, f_table_name, f_geometry_column
        FROM geometry_columns
        WHERE f_table_schema IN ('layer', 'public_layer')
        ORDER BY f_table_schema, f_table_name
      `
    );
    const tables = (result.rows as Array<{
      f_table_schema: string;
      f_table_name: string;
      f_geometry_column: string;
    }>)
      .map((r) => ({
        schema: r.f_table_schema,
        table: r.f_table_name,
        geometryColumn: r.f_geometry_column,
      }))
      .filter((r) => !LAYER_BACKUP_TABLE_NAME_RE.test(String(r.table ?? '')));
    return { success: true, tables };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg, tables: [] };
  }
}

/** layer / public_layer 스키마에서 테이블 행 수 조회 (정의 스키마 우선) */
export async function getLayerTableRowCount(params: {
  tableName: string;
}): Promise<{ success: boolean; count: number; error?: string }> {
  const name = params?.tableName?.trim();
  if (!name) return { success: false, count: 0, error: 'tableName이 필요합니다.' };

  let preferred: 'layer' | 'public_layer' = 'layer';
  try {
    const defineRes = await getDefineLayerTables();
    if (defineRes.success && Array.isArray(defineRes.tables)) {
      const row = defineRes.tables.find(
        (r) =>
          String((r as Record<string, unknown>).define_table_name ?? '').trim().toLowerCase() ===
          name.toLowerCase()
      );
      if (row && String((row as Record<string, unknown>).define_table_schema ?? '').trim() === 'public_layer') {
        preferred = 'public_layer';
      }
    }
  } catch { /* ignore */ }

  const { resolveLayerPhysicalRelName } = await import('./standardService');
  const trySchemas: Array<'layer' | 'public_layer'> =
    preferred === 'layer' ? ['layer', 'public_layer'] : ['public_layer', 'layer'];

  for (const schema of trySchemas) {
    const physical = await resolveLayerPhysicalRelName(schema, name);
    if (!physical) continue;
    const safeSchema = schema.replace(/"/g, '');
    const safeTable = physical.replace(/"/g, '');
    try {
      const result = await db.execute(
        sql.raw(`SELECT count(*)::int AS cnt FROM "${safeSchema}"."${safeTable}"`)
      );
      const cnt = (result.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
      return { success: true, count: cnt };
    } catch {
      /* 다음 스키마 시도 */
    }
  }

  return { success: false, count: 0, error: `테이블을 찾을 수 없습니다: ${name}` };
}

/** layer / public_layer 스키마 테이블별 지오메트리 타입 */
export async function getLayerTableGeometryTypes(params?: {
  schema?: 'layer' | 'public_layer';
}): Promise<{
  success: boolean;
  types: Record<string, 'POINT' | 'LINE' | 'POLYGON'>;
  error?: string;
}> {
  const schema = params?.schema === 'public_layer' ? 'public_layer' : 'layer';
  try {
    const result = await db.execute(
      sql.raw(
        `SELECT f_table_name, type FROM geometry_columns WHERE f_table_schema = '${schema.replace(/'/g, "''")}'`
      )
    );
    const types: Record<string, 'POINT' | 'LINE' | 'POLYGON'> = {};
    for (const row of (result.rows as Array<{ f_table_name: string; type: string | number }>) ?? []) {
      const raw = row.type;
      const t = typeof raw === 'number'
        ? String(raw) // OGC: 1=Point,2=LineString,3=Polygon,4=MultiPoint,5=MultiLineString,6=MultiPolygon
        : String(raw ?? '').toUpperCase().replace(/^ST_/, '');
      if (typeof raw === 'number') {
        if (raw === 1 || raw === 4) types[row.f_table_name] = 'POINT';
        else if (raw === 2 || raw === 5) types[row.f_table_name] = 'LINE';
        else if (raw === 3 || raw === 6) types[row.f_table_name] = 'POLYGON';
      } else {
        if (/POINT|MULTIPOINT/.test(t)) types[row.f_table_name] = 'POINT';
        else if (/LINESTRING|MULTILINESTRING|LINE/.test(t)) types[row.f_table_name] = 'LINE';
        else if (/POLYGON|MULTIPOLYGON/.test(t)) types[row.f_table_name] = 'POLYGON';
      }
    }
    return { success: true, types };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, types: {}, error: msg };
  }
}

/**
 * GeoServer 레이어 생성
 * - 기준: tables.json(defineLayer)
 * - 생성할 레이어 목록은 tables.json(defineLayer)만 참조. DB 테이블 목록은 원본 테이블 존재·스키마 확인용.
 * - 일반 레이어: define_table_name == nativeName
 * - 분할 레이어: define_table_parents_layer + define_table_div_query 사용
 */
export async function createGeoServerLayers(params: {
  url?: string;
  workspace?: string;
} = {}) {
  const baseUrl = params?.url?.trim() || GEOSERVER_DEFAULT_URL;
  const workspace = params?.workspace?.trim() || 'ggnr';

  try {
    const defineRes = await getDefineLayerTables();
    if (!defineRes.success || !defineRes.tables?.length) {
      return {
        success: false,
        error: defineRes.error ?? 'defineLayer 테이블이 없습니다.',
        created: [],
        failed: [],
      };
    }

    const dbTableMap = new Map<string, { schema: string; table: string }>();
    const listRes = await getLayerTableList();
    if (listRes.success && Array.isArray(listRes.tables)) {
      for (const t of listRes.tables) {
        if (t.schema !== 'layer' && t.schema !== 'public_layer') continue;
        if (!dbTableMap.has(t.table) || t.schema === 'layer') {
          dbTableMap.set(t.table, { schema: t.schema, table: t.table });
        }
      }
    }

    const dbConfig = getDbConfig();
    const created: Array<{ schema: string; table: string }> = [];
    const failed: Array<{ schema: string; table: string; error: string }> = [];
    const checkedDatastores = new Set<string>();

    const ensureDatastore = async (schema: string, datastoreName: string) => {
      if (checkedDatastores.has(datastoreName)) return { success: true as const };

      const dsRes = await geoserverFetch(
        baseUrl,
        `/rest/workspaces/${workspace}/datastores/${datastoreName}.json`
      );
      if (!dsRes.ok && dsRes.status === 404) {
        const dsBody = buildPostgisDataStoreBody(datastoreName, schema, dbConfig);
        const createDsRes = await geoserverFetch(
          baseUrl,
          `/rest/workspaces/${workspace}/datastores.json`,
          { method: 'POST', body: JSON.stringify(dsBody) }
        );
        if (!createDsRes.ok) {
          const text = await createDsRes.text();
          return { success: false as const, error: `데이터 스토어 생성 실패: ${text}` };
        }
      } else if (!dsRes.ok) {
        return { success: false as const, error: `데이터 스토어 조회 실패: ${dsRes.status}` };
      }

      checkedDatastores.add(datastoreName);
      return { success: true as const };
    };

    /** FeatureType에 CQL 필터 설정 — 최상위 cqlFilter 속성 사용 (GeoServer REST 규격) */
    const setFeatureTypeCqlFilter = async (
      datastoreName: string,
      featureTypeName: string,
      cqlFilter: string
    ) => {
      const getRes = await geoserverFetch(
        baseUrl,
        `/rest/workspaces/${workspace}/datastores/${datastoreName}/featuretypes/${encodeURIComponent(featureTypeName)}.json`
      );
      if (!getRes.ok) {
        const text = await getRes.text();
        return { success: false as const, error: `FeatureType 조회 실패: ${getRes.status} ${text}` };
      }

      const ftData = await getRes.json();
      const featureType = ftData?.featureType ?? ftData;

      const putBody = JSON.stringify({
        featureType: {
          ...featureType,
          cqlFilter,
        },
      });

      const putRes = await geoserverFetch(
        baseUrl,
        `/rest/workspaces/${workspace}/datastores/${datastoreName}/featuretypes/${encodeURIComponent(featureTypeName)}`,
        { method: 'PUT', body: putBody }
      );
      if (!putRes.ok) {
        const text = await putRes.text();
        return { success: false as const, error: `FeatureType CQL 적용 실패: ${putRes.status} ${text}` };
      }
      return { success: true as const };
    };

    for (const row of defineRes.tables) {
      const defineLayerName = String(row.define_table_name ?? '').trim();
      if (!defineLayerName) continue;
      const publishName = defineLayerName.toLowerCase();

      const parentLayer = String(row.define_table_parents_layer ?? '').trim();
      const divQuery = String(row.define_table_div_query ?? '').trim();
      const isSplitLayer = !!parentLayer && !!divQuery;
      const sourceTableName = isSplitLayer ? parentLayer : defineLayerName;
      const sourceTable = resolveDbTableCaseInsensitive(dbTableMap, sourceTableName);

      if (!sourceTable) {
        failed.push({
          schema: isSplitLayer ? parentLayer : '(unknown)',
          table: defineLayerName,
          error: `원본 테이블 없음: ${sourceTableName}`,
        });
        continue;
      }

      const datastoreName =
        sourceTable.schema === 'layer'
          ? 'postgres_layer'
          : sourceTable.schema === 'public_layer'
            ? 'postgres_public_layer'
            : '';
      if (!datastoreName) {
        failed.push({
          schema: sourceTable.schema,
          table: defineLayerName,
          error: `지원하지 않는 스키마: ${sourceTable.schema}`,
        });
        continue;
      }
      const dsOk = await ensureDatastore(sourceTable.schema, datastoreName);
      if (!dsOk.success) {
        failed.push({ schema: sourceTable.schema, table: defineLayerName, error: dsOk.error });
        continue;
      }

      const ftBody = {
        featureType: {
          name: publishName,
          nativeName: sourceTable.table,
          enabled: true,
          srs: 'EPSG:5181',
          ...(divQuery ? { cqlFilter: divQuery } : {}),
        },
      };

      const ftRes = await geoserverFetch(
        baseUrl,
        `/rest/workspaces/${workspace}/datastores/${datastoreName}/featuretypes.json`,
        { method: 'POST', body: JSON.stringify(ftBody) }
      );

      if (ftRes.ok || ftRes.status === 409) {
        if (divQuery) {
          const ftCqlRes = await setFeatureTypeCqlFilter(datastoreName, publishName, divQuery);
          if (!ftCqlRes.success) {
            failed.push({ schema: sourceTable.schema, table: defineLayerName, error: ftCqlRes.error });
            continue;
          }
        }
        created.push({ schema: sourceTable.schema, table: publishName });
      } else {
        const text = await ftRes.text();
        failed.push({
          schema: sourceTable.schema,
          table: defineLayerName,
          error: `${ftRes.status} ${text}`,
        });
      }
    }

    return {
      success: failed.length === 0,
      created,
      failed,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg, created: [], failed: [] };
  }
}

/**
 * 단일 GeoServer 레이어 생성/재생성 (tables.json 기준, CQL 필터 포함)
 * - 기존 레이어·FeatureType 삭제 후 새로 생성 (재생성 시 완전히 다시 만듦)
 */
export async function createOrUpdateGeoServerLayer(params: {
  layerName: string;
  url?: string;
  workspace?: string;
}) {
  const baseUrl = (params?.url?.trim() || GEOSERVER_DEFAULT_URL).replace(/\/$/, '');
  const workspace = params?.workspace?.trim() || 'ggnr';
  const layerName = params?.layerName?.trim().toLowerCase();
  if (!layerName) {
    return { success: false as const, error: 'layerName이 필요합니다.' };
  }

  try {
    const defineRes = await getDefineLayerTables();
    if (!defineRes.success || !defineRes.tables?.length) {
      return { success: false as const, error: defineRes.error ?? 'defineLayer 테이블이 없습니다.' };
    }

    const row = defineRes.tables.find(
      (r) => String(r.define_table_name ?? '').trim().toLowerCase() === layerName
    );
    if (!row) {
      return { success: false as const, error: `tables.json에 레이어 '${layerName}'가 없습니다.` };
    }

    const dbTableMap = new Map<string, { schema: string; table: string }>();
    const listRes = await getLayerTableList();
    if (listRes.success && Array.isArray(listRes.tables)) {
      for (const t of listRes.tables) {
        if (t.schema !== 'layer' && t.schema !== 'public_layer') continue;
        if (!dbTableMap.has(t.table) || t.schema === 'layer') {
          dbTableMap.set(t.table, { schema: t.schema, table: t.table });
        }
      }
    }

    const parentLayer = String(row.define_table_parents_layer ?? '').trim();
    const divQuery = String(row.define_table_div_query ?? '').trim();
    const isSplitLayer = !!parentLayer && !!divQuery;
    const defineLayerName = String(row.define_table_name ?? '').trim();
    const sourceTableName = isSplitLayer ? parentLayer : defineLayerName;
    const sourceTable = resolveDbTableCaseInsensitive(dbTableMap, sourceTableName);

    if (!sourceTable) {
      return {
        success: false as const,
        error: `원본 테이블 없음: ${sourceTableName}`,
      };
    }

    const datastoreName =
      sourceTable.schema === 'layer'
        ? 'postgres_layer'
        : sourceTable.schema === 'public_layer'
          ? 'postgres_public_layer'
          : '';
    if (!datastoreName) {
      return {
        success: false as const,
        error: `지원하지 않는 스키마: ${sourceTable.schema}`,
      };
    }

    const dbConfig = getDbConfig();

    const ensureDatastore = async (schema: string, dsName: string) => {
      const dsRes = await geoserverFetch(
        baseUrl,
        `/rest/workspaces/${workspace}/datastores/${dsName}.json`
      );
      if (!dsRes.ok && dsRes.status === 404) {
        const dsBody = buildPostgisDataStoreBody(dsName, schema, dbConfig);
        const createDsRes = await geoserverFetch(
          baseUrl,
          `/rest/workspaces/${workspace}/datastores.json`,
          { method: 'POST', body: JSON.stringify(dsBody) }
        );
        if (!createDsRes.ok) {
          const text = await createDsRes.text();
          return { success: false as const, error: `데이터 스토어 생성 실패: ${text}` };
        }
      } else if (!dsRes.ok) {
        const text = await dsRes.text();
        return { success: false as const, error: `데이터 스토어 조회 실패: ${dsRes.status} ${text}` };
      }
      return { success: true as const };
    };

    const dsOk = await ensureDatastore(sourceTable.schema, datastoreName);
    if (!dsOk.success) return { success: false as const, error: dsOk.error };

    // 재생성: 기존 레이어·FeatureType 삭제 (없으면 404 무시)
    const delLayerRes = await geoserverFetch(
      baseUrl,
      `/rest/workspaces/${workspace}/layers/${encodeURIComponent(layerName)}`,
      { method: 'DELETE' }
    );
    if (!delLayerRes.ok && delLayerRes.status !== 404) {
      const text = await delLayerRes.text();
      return { success: false as const, error: `레이어 삭제 실패: ${delLayerRes.status} ${text}` };
    }

    const delFtRes = await geoserverFetch(
      baseUrl,
      `/rest/workspaces/${workspace}/datastores/${datastoreName}/featuretypes/${encodeURIComponent(layerName)}`,
      { method: 'DELETE' }
    );
    if (!delFtRes.ok && delFtRes.status !== 404) {
      const text = await delFtRes.text();
      return { success: false as const, error: `FeatureType 삭제 실패: ${delFtRes.status} ${text}` };
    }

    const ftBody = {
      featureType: {
        name: layerName,
        nativeName: sourceTable.table,
        enabled: true,
        srs: 'EPSG:5181',
        ...(divQuery ? { cqlFilter: divQuery } : {}),
      },
    };

    const ftRes = await geoserverFetch(
      baseUrl,
      `/rest/workspaces/${workspace}/datastores/${datastoreName}/featuretypes.json`,
      { method: 'POST', body: JSON.stringify(ftBody) }
    );

    if (!ftRes.ok) {
      const text = await ftRes.text();
      return { success: false as const, error: `FeatureType 생성 실패: ${ftRes.status} ${text}` };
    }

    // CQL은 POST body에 이미 포함했으므로 별도 PUT 하지 않음 (PUT 시 GeoServer가 동일 경로 move 시도 → Windows AccessDeniedException)
    return { success: true as const, layerName };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false as const, error: msg };
  }
}

// --- GeoServer Style (CSS) API ---

export type GeoServerStyleItem = { name: string; format?: string };

/**
 * GeoServer 스타일 목록 조회 (global styles)
 */
export async function getGeoServerStyleList(params: { url?: string } = {}) {
  const baseUrl = params?.url?.trim() || GEOSERVER_DEFAULT_URL;
  try {
    const res = await geoserverFetch(baseUrl, '/rest/styles.json');
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `스타일 목록 조회 실패: ${res.status} ${text}`, styles: [] };
    }
    const data = await res.json();
    const raw = data?.styles?.style ?? data?.style ?? [];
    const list: GeoServerStyleItem[] = Array.isArray(raw)
      ? raw.map((s: { name?: string; href?: string }) => ({
          name: s?.name ?? (s?.href ? s.href.replace(/.*\//, '').replace(/\.(css|sld)$/i, '') : ''),
          format: s?.href?.match(/\.(css|sld)$/i)?.[1]?.toLowerCase(),
        }))
      : raw?.name
        ? [{ name: raw.name, format: raw.href?.match(/\.(css|sld)$/i)?.[1]?.toLowerCase() }]
        : [];
    return { success: true, styles: list };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg, styles: [] };
  }
}

/**
 * GeoServer 스타일 단건 조회 (메타 + CSS 본문, 파싱된 styleProps/geometryType)
 */
export async function getGeoServerStyle(params: { url: string; name: string }) {
  const baseUrl = (params?.url ?? GEOSERVER_DEFAULT_URL).replace(/\/$/, '');
  const name = params?.name?.trim();
  if (!name) return { success: false, error: '스타일 이름이 필요합니다.' };

  try {
    const metaRes = await geoserverFetch(baseUrl, `/rest/styles/${encodeURIComponent(name)}.json`);
    if (!metaRes.ok) {
      const text = await metaRes.text();
      return { success: false, error: `스타일 조회 실패: ${metaRes.status} ${text}` };
    }
    const meta = await metaRes.json();
    const format = (meta?.style?.format ?? meta?.format ?? 'sld').toLowerCase();

    const cssRes = await geoserverFetch(baseUrl, `/rest/styles/${encodeURIComponent(name)}.css`, {
      accept: 'text/css',
    });
    const body = cssRes.ok ? await cssRes.text() : '';

    if (format !== 'css' || !body) {
      return {
        success: true,
        name,
        format,
        body: body || '',
        styleProps: undefined,
        geometryType: undefined,
        editable: false,
      };
    }

    const { styleProps, geometryType } = parseSimpleStyleFromCss(body);
    return {
      success: true,
      name,
      format,
      body,
      styleProps,
      geometryType,
      editable: true,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * GeoServer CSS 스타일 생성 (이름 + 도형타입 + styleProps → CSS 생성 후 등록)
 * POST 시 본문은 CSS, name은 쿼리 파라미터로 전달 (JSON 본문 시 500 style handler 오류 방지)
 */
export async function createGeoServerStyle(params: {
  url?: string;
  name: string;
  geometryType: GeometryType;
  styleProps: StyleProps;
}) {
  const baseUrl = (params?.url ?? GEOSERVER_DEFAULT_URL).replace(/\/$/, '');
  const name = params?.name?.trim();
  if (!name) return { success: false, error: '스타일 이름이 필요합니다.' };
  const geometryType = params.geometryType ?? 'POLYGON';
  const styleProps = params.styleProps ?? {};

  try {
    const cssBody = buildCssFromSimpleStyle(geometryType, styleProps);
    const path = `/rest/styles?name=${encodeURIComponent(name)}`;
    const postRes = await geoserverFetch(baseUrl, path, {
      method: 'POST',
      body: cssBody,
      contentType: 'application/vnd.geoserver.geocss+css',
    });
    if (postRes.ok || postRes.status === 201) {
      writeCssStyleToDataDir(name, cssBody);
      return { success: true };
    }
    const text = await postRes.text();
    if (postRes.status === 403 && /already exists/i.test(text)) {
      return { success: true, alreadyExists: true as const };
    }
    return { success: false, error: `스타일 생성 실패: ${postRes.status} ${text}` };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * GeoServer CSS 스타일 수정 (* 블록만 styleProps로 교체, 나머지 규칙 유지)
 */
export async function updateGeoServerStyle(params: {
  url?: string;
  name: string;
  geometryType: GeometryType;
  styleProps: StyleProps;
  preserveExtraRules?: boolean;
}) {
  const baseUrl = (params?.url ?? GEOSERVER_DEFAULT_URL).replace(/\/$/, '');
  const name = params?.name?.trim();
  if (!name) return { success: false, error: '스타일 이름이 필요합니다.' };
  const geometryType = params.geometryType ?? 'POLYGON';
  const styleProps = params.styleProps ?? {};
  const preserveExtraRules = params.preserveExtraRules !== false;

  try {
    const getRes = await geoserverFetch(baseUrl, `/rest/styles/${encodeURIComponent(name)}.css`, {
      accept: 'text/css',
    });
    const existingCss = getRes.ok ? await getRes.text() : '';

    const newStarBlock = buildCssFromSimpleStyle(geometryType, styleProps);
    const cssBody = preserveExtraRules && existingCss
      ? replaceDefaultRuleInCss(existingCss, newStarBlock)
      : newStarBlock;

    const putRes = await geoserverFetch(baseUrl, `/rest/styles/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: cssBody,
      contentType: 'application/vnd.geoserver.geocss+css',
    });
    if (!putRes.ok) {
      const text = (await putRes.text()).replace(/\s+/g, ' ').trim().slice(0, 500);
      return {
        success: false,
        error: text
          ? `스타일 수정 실패: ${putRes.status} ${text}`
          : `스타일 수정 실패: ${putRes.status}`,
      };
    }
    writeCssStyleToDataDir(name, cssBody);
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * GeoServer 스타일 삭제
 */
export async function deleteGeoServerStyle(params: { url?: string; name: string }) {
  const baseUrl = (params?.url ?? GEOSERVER_DEFAULT_URL).replace(/\/$/, '');
  const name = params?.name?.trim();
  if (!name) return { success: false, error: '스타일 이름이 필요합니다.' };

  try {
    const res = await geoserverFetch(baseUrl, `/rest/styles/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const text = await res.text();
      const msg = res.status === 403 ? '사용 중인 스타일은 삭제할 수 없습니다.' : `${res.status} ${text}`;
      return { success: false, error: msg };
    }
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

// --- GeoServer Layer + Style (레이어 기준 스타일 정보) ---

export type GeoServerLayerWithStyle = {
  name: string;
  /** define_table_group */
  group?: string;
  /** DB layer 스키마에 해당 테이블이 있는지 */
  tableExists?: boolean;
  /** GeoServer에 해당 레이어가 publish 되어 있는지 */
  published?: boolean;
  styleName?: string;
  hasCssStyle: boolean;
  geometryType?: GeometryType;
  /** VECTOR | RASTER */
  layerType?: string;
  /** feature type title */
  title?: string;
  /** SRS e.g. EPSG:5181 */
  srs?: string;
};

function parseGeometryTypeFromAttributes(attrs: Array<{ binding?: string }>): GeometryType {
  const geomAttr = attrs.find((a) => /\.(Point|MultiPoint|Geometry)/i.test(a?.binding ?? ''));
  const lineAttr = attrs.find((a) => /\.(LineString|MultiLineString)/i.test(a?.binding ?? ''));
  const polyAttr = attrs.find((a) => /\.(Polygon|MultiPolygon)/i.test(a?.binding ?? ''));
  if (geomAttr && /Point|MultiPoint/i.test(geomAttr.binding ?? '')) return 'POINT';
  if (lineAttr) return 'LINE';
  if (polyAttr) return 'POLYGON';
  return 'POLYGON';
}

const DEFINE_LAYER_TABLES_PATH = path.join(
  process.cwd(),
  'src',
  'config',
  'defineLayer',
  'tables.json'
);

/** tables.json과 동일한 프로젝트 루트 기준 data_dir/styles 경로 (cwd 의존 최소화) */
function getStylesDir(): string {
  const projectRoot = path.resolve(path.dirname(DEFINE_LAYER_TABLES_PATH), '..', '..', '..');
  return path.join(projectRoot, 'geoserver_modules', 'data_dir', 'styles');
}

/** data_dir/styles 폴더에서 .css 파일이 있는 스타일 이름 Set (API 없이 사용) */
function getCssStyleNamesFromDataDir(): Set<string> {
  const set = new Set<string>();
  try {
    const stylesDir = getStylesDir();
    if (fs.existsSync(stylesDir)) {
      for (const f of fs.readdirSync(stylesDir)) {
        if (f.endsWith('.css')) set.add(path.basename(f, '.css').toLowerCase());
      }
    }
  } catch {
    // ignore
  }
  return set;
}

function writeCssStyleToDataDir(name: string, cssBody: string): void {
  try {
    const stylesDir = getStylesDir();
    fs.mkdirSync(stylesDir, { recursive: true });
    fs.writeFileSync(path.join(stylesDir, `${name}.css`), cssBody, 'utf-8');
  } catch {
    // non-fatal — GeoServer REST 등록은 이미 됐을 수 있음
  }
}

async function getGeoServerStyleNameSet(baseUrl: string): Promise<Set<string>> {
  const set = new Set<string>();
  const res = await getGeoServerStyleList({ url: baseUrl });
  if (res.success) {
    for (const s of res.styles ?? []) {
      if (s.name) set.add(s.name.toLowerCase());
    }
  }
  return set;
}

async function geoServerStyleExists(baseUrl: string, name: string): Promise<boolean> {
  const res = await geoserverFetch(baseUrl, `/rest/styles/${encodeURIComponent(name)}.json`);
  return res.ok;
}

type DefineLayerRow = {
  define_table_name?: string;
  define_table_shp_type?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
  define_table_idx?: string | number;
  define_table_source?: string;
  [key: string]: unknown;
};

function sortDefineLayerTables<T extends DefineLayerRow>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const groupA = String(a.define_table_group ?? '').toLowerCase();
    const groupB = String(b.define_table_group ?? '').toLowerCase();
    if (groupA !== groupB) return groupA.localeCompare(groupB);
    const idxA = parseInt(String(a.define_table_idx ?? '999999'), 10);
    const idxB = parseInt(String(b.define_table_idx ?? '999999'), 10);
    if (idxA !== idxB) return idxA - idxB;
    const nameA = String(a.define_table_name ?? '').toLowerCase();
    const nameB = String(b.define_table_name ?? '').toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

/**
 * 레이어 정보관리와 동일한 defineLayer config(tables.json)에서 테이블 목록 조회
 */
export async function getDefineLayerTables(): Promise<{
  success: boolean;
  tables?: DefineLayerRow[];
  error?: string;
}> {
  try {
    if (!fs.existsSync(DEFINE_LAYER_TABLES_PATH)) {
      return { success: false, error: 'tables.json not found', tables: [] };
    }
    const raw = fs.readFileSync(DEFINE_LAYER_TABLES_PATH, 'utf-8');
    const tables = JSON.parse(raw) as DefineLayerRow[];
    if (!Array.isArray(tables)) {
      return { success: false, error: 'Invalid tables format', tables: [] };
    }
    normalizeDefineTableSource(tables as Record<string, unknown>[]);
    return { success: true, tables: sortDefineLayerTables(tables) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg, tables: [] };
  }
}

const VALID_GEOMETRY_TYPES = new Set<string>(['POINT', 'LINE', 'POLYGON']);

/**
 * GeoServer 레이어 목록: 전체 레이어 목록은 tables.json(defineLayer) 기준으로 조회.
 * 도형 타입·제목은 tables.json, 발행 여부·styleName은 GeoServer API,
 * 스타일 보유(hasCssStyle)는 data_dir/styles + GeoServer REST 스타일 목록 기준.
 * 분할 레이어(define_table_parents_layer + define_table_div_query)는 자식 이름에 해당하는 물리 테이블이 없어도
 * 부모 테이블이 layer 스키마에 있으면 tableExists를 true로 둔다(레이어 정보관리 기본 목록 노출용).
 */
export async function getGeoServerLayersWithStyleInfo(params: {
  url?: string;
  workspace?: string;
} = {}) {
  const baseUrl = (params?.url ?? GEOSERVER_DEFAULT_URL).replace(/\/$/, '');
  const workspace = params?.workspace?.trim() || 'ggnr';

  try {
    const defineRes = await getDefineLayerTables();
    const defineTables = defineRes.success && defineRes.tables?.length ? defineRes.tables : [];

    const dbTableRes = await getLayerTableList();
    const dbLayerTableSetLc = new Set<string>(
      (dbTableRes.tables ?? [])
        .filter((t) => t.schema === 'layer' || t.schema === 'public_layer')
        .map((t) => String(t.table).toLowerCase())
    );

    const cssStyleNamesFromDir = getCssStyleNamesFromDataDir();
    const geoServerStyleNames = await getGeoServerStyleNameSet(baseUrl);

    // tables.json에 정의가 없어도 DB/GeoServer에 실제로 존재하는 테이블은 스타일 상태를 조회해야 함
    // (그렇지 않으면 스타일 편집 모달이 기존 스타일을 못 찾고 신규 추가 폼으로 빠짐)
    const defineRowByNameLc = new Map<string, Record<string, unknown>>();
    for (const row of defineTables) {
      const name = String((row as Record<string, unknown>).define_table_name ?? '').trim();
      if (name) defineRowByNameLc.set(name.toLowerCase(), row as Record<string, unknown>);
    }
    const allNamesLc = new Set<string>(defineRowByNameLc.keys());
    for (const t of dbTableRes.tables ?? []) {
      if (t.schema === 'layer' || t.schema === 'public_layer') {
        allNamesLc.add(String(t.table).toLowerCase());
      }
    }

    // 레이어별 REST 조회를 병렬로 수행하고, 개별 실패가 전체 스캔을 무효화하지 않도록 행마다 catch 처리
    const results = await Promise.all(
      Array.from(allNamesLc).map(async (geoLayerKey): Promise<GeoServerLayerWithStyle | null> => {
        const row = defineRowByNameLc.get(geoLayerKey) ?? {};
        const layerName = String(row.define_table_name ?? geoLayerKey).trim();
        if (!layerName) return null;

        const parentLayer = String(row.define_table_parents_layer ?? '').trim();
        const divQ = String(row.define_table_div_query ?? '').trim();
        const isSplitChild = Boolean(parentLayer && divQ);
        const tableExists =
          dbLayerTableSetLc.has(layerName.toLowerCase()) ||
          (isSplitChild && dbLayerTableSetLc.has(parentLayer.toLowerCase()));

        const shpType = String(row.define_table_shp_type ?? '').toUpperCase();
        const geometryType = VALID_GEOMETRY_TYPES.has(shpType)
          ? (shpType as GeometryType)
          : undefined;
        const title = String(row.define_table_kor_name ?? '').trim() || undefined;
        const group = String(row.define_table_group ?? '').trim() || undefined;
        const hasCssStyle =
          cssStyleNamesFromDir.has(geoLayerKey) ||
          cssStyleNamesFromDir.has(layerName.toLowerCase()) ||
          geoServerStyleNames.has(geoLayerKey);

        try {
          const layerRes = await geoserverFetch(
            baseUrl,
            `/rest/workspaces/${workspace}/layers/${encodeURIComponent(geoLayerKey)}.json`
          );

          if (!layerRes.ok) {
            return { name: layerName, group, tableExists, published: false, hasCssStyle, geometryType, title };
          }
          const layerData = await layerRes.json();
          const layerObj = layerData?.layer ?? layerData;
          const layerType = layerObj?.type ?? undefined;

          const styleName =
            layerData?.layer?.defaultStyle?.name ?? layerData?.defaultStyle?.name;
          if (!styleName) {
            return { name: layerName, group, tableExists, published: true, hasCssStyle, geometryType, layerType, title };
          }
          return { name: layerName, group, tableExists, published: true, styleName, hasCssStyle, geometryType, layerType, title };
        } catch {
          // 이 레이어 조회만 실패 처리 — Promise.all 전체를 reject시키지 않고 나머지는 계속 진행
          return { name: layerName, group, tableExists, published: false, hasCssStyle, geometryType, title };
        }
      })
    );

    const layers = results.filter((l): l is GeoServerLayerWithStyle => l !== null);

    return { success: true, layers };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg, layers: [] };
  }
}

/**
 * 레이어의 기본 스타일 지정
 */
export async function setLayerDefaultStyle(params: {
  url?: string;
  workspace?: string;
  layerName: string;
  styleName: string;
}) {
  const baseUrl = (params?.url ?? GEOSERVER_DEFAULT_URL).replace(/\/$/, '');
  const workspace = params?.workspace?.trim() || 'ggnr';
  const layerName = params?.layerName?.trim();
  const styleName = params?.styleName?.trim();
  if (!layerName || !styleName) {
    return { success: false, error: '레이어 이름과 스타일 이름이 필요합니다.' };
  }

  try {
    const res = await geoserverFetch(
      baseUrl,
      `/rest/workspaces/${workspace}/layers/${encodeURIComponent(layerName)}.json`
    );
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `레이어 조회 실패: ${res.status} ${text}` };
    }
    const layerData = await res.json();
    const layer = layerData?.layer ?? layerData;
    const body = JSON.stringify({
      layer: {
        ...layer,
        defaultStyle: { name: styleName },
      },
    });
    const putRes = await geoserverFetch(
      baseUrl,
      `/rest/workspaces/${workspace}/layers/${encodeURIComponent(layerName)}`,
      { method: 'PUT', body }
    );
    if (!putRes.ok) {
      const text = await putRes.text();
      return { success: false, error: `스타일 지정 실패: ${putRes.status} ${text}` };
    }
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * 레이어의 도형 타입 조회 (feature type attributes에서 geometry binding)
 */
export async function getLayerGeometryType(params: {
  url?: string;
  workspace?: string;
  layerName: string;
}): Promise<{ success: boolean; geometryType?: GeometryType; error?: string }> {
  const baseUrl = (params?.url ?? GEOSERVER_DEFAULT_URL).replace(/\/$/, '');
  const workspace = params?.workspace?.trim() || 'ggnr';
  const layerNameRaw = params?.layerName?.trim();
  if (!layerNameRaw) return { success: false, error: '레이어 이름이 필요합니다.' };
  const layerName = layerNameRaw.toLowerCase();

  try {
    const layerRes = await geoserverFetch(
      baseUrl,
      `/rest/workspaces/${workspace}/layers/${encodeURIComponent(layerName)}.json`
    );
    if (!layerRes.ok) return { success: false, error: '레이어 조회 실패' };
    const layerData = await layerRes.json();
    const resourceHref =
      layerData?.layer?.resource?.href ?? layerData?.resource?.href;
    if (!resourceHref) return { success: false, error: '리소스 정보 없음' };

    let ftPath = resourceHref.includes(baseUrl)
      ? resourceHref.slice(baseUrl.length).trim()
      : '';
    if (!ftPath || ftPath === '') {
      const m = resourceHref.match(/\/rest\/([\s\S]*)$/);
      ftPath = m ? `/rest/${m[1]}` : '/rest/';
    }
    if (!ftPath.startsWith('/')) ftPath = `/${ftPath}`;
    const ftRes = await geoserverFetch(baseUrl, ftPath);
    if (!ftRes.ok) return { success: false, error: 'Feature type 조회 실패' };
    const ftData = await ftRes.json();
    const attrs = ftData?.featureType?.attributes?.attribute ?? ftData?.attributes?.attribute ?? [];
    const arr = Array.isArray(attrs) ? attrs : attrs ? [attrs] : [];
    const geomAttr = arr.find(
      (a: { binding?: string }) =>
        /\.(Point|MultiPoint|Geometry)/i.test(a?.binding ?? '')
    );
    const lineAttr = arr.find(
      (a: { binding?: string }) =>
        /\.(LineString|MultiLineString)/i.test(a?.binding ?? '')
    );
    const polyAttr = arr.find(
      (a: { binding?: string }) =>
        /\.(Polygon|MultiPolygon)/i.test(a?.binding ?? '')
    );
    if (geomAttr && /Point|MultiPoint/i.test(geomAttr.binding ?? '')) {
      return { success: true, geometryType: 'POINT' };
    }
    if (lineAttr) return { success: true, geometryType: 'LINE' };
    if (polyAttr) return { success: true, geometryType: 'POLYGON' };
    if (geomAttr) return { success: true, geometryType: 'POINT' };
    return { success: true, geometryType: 'POLYGON' };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * 전체 자동 스타일 설정: CSS 스타일이 없는 레이어에 Material Tone 랜덤 색상으로 CSS 스타일 생성 후 지정
 * POINT: fill=Material 랜덤, stroke=#FFFFFF 고정 / LINE: stroke=Material 랜덤 / POLYGON: fill=Material 랜덤, stroke=더 어두운 색
 */
export async function applyAllDefaultStyles(params: {
  url?: string;
  workspace?: string;
} = {}) {
  const baseUrl = (params?.url ?? GEOSERVER_DEFAULT_URL).replace(/\/$/, '');
  const workspace = params?.workspace?.trim() || 'ggnr';

  try {
    const listRes = await getGeoServerLayersWithStyleInfo({ url: baseUrl, workspace });
    if (!listRes.success) {
      return { success: false, error: listRes.error, applied: [], failed: [] };
    }
    const toApply = (listRes.layers ?? []).filter((l) => !l.hasCssStyle);
    const applied: string[] = [];
    const failed: { name: string; error: string }[] = [];

    for (let i = 0; i < toApply.length; i++) {
      const layer = toApply[i];
      const geometryType =
        layer.geometryType && VALID_GEOMETRY_TYPES.has(layer.geometryType)
          ? layer.geometryType
          : 'POLYGON';
      const color = getMaterialToneColor(i);
      let styleProps: StyleProps;

      if (geometryType === 'POINT') {
        const symbolUrl = resolveSymbolUrlForLayer(layer.name);
        styleProps = {
          fillColor: color,
          strokeColor: '#FFFFFF',
          strokeWidth: 1.5,
          opacity: 0.5,
          size: 10,
          ...(symbolUrl ? { symbolUrl } : {}),
        };
      } else if (geometryType === 'LINE') {
        styleProps = {
          strokeColor: color,
          strokeWidth: 2,
          opacity: 0.5,
        };
      } else {
        styleProps = {
          fillColor: color,
          strokeColor: '#FFFFFF',
          strokeWidth: 1,
          opacity: 0.3,
        };
      }

      const createRes = await createGeoServerStyle({
        url: baseUrl,
        name: layer.name,
        geometryType,
        styleProps,
      });
      if (!createRes.success) {
        failed.push({ name: layer.name, error: createRes.error ?? '스타일 생성 실패' });
        continue;
      }
      const setRes = await setLayerDefaultStyle({
        url: baseUrl,
        workspace,
        layerName: layer.name,
        styleName: layer.name,
      });
      if (!setRes.success) {
        failed.push({ name: layer.name, error: setRes.error ?? '스타일 지정 실패' });
        continue;
      }
      applied.push(layer.name);
    }

    return {
      success: failed.length === 0,
      applied,
      failed,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg, applied: [], failed: [] };
  }
}

/**
 * 단일 레이어에 자동 스타일 적용 (스타일 없을 때만 유의미; 있으면 덮어씀)
 * Material Tone 색상은 레이어 이름 해시로 결정
 */
export async function applyDefaultStyleToLayer(params: {
  url?: string;
  workspace?: string;
  layerName: string;
}) {
  const baseUrl = (params?.url ?? GEOSERVER_DEFAULT_URL).replace(/\/$/, '');
  const workspace = params?.workspace?.trim() || 'ggnr';
  const layerName = params?.layerName?.trim().toLowerCase();
  if (!layerName) return { success: false, error: '레이어 이름이 필요합니다.' };

  try {
    let geometryType: GeometryType = 'POLYGON';
    let fromTables = false;
    const defineRes = await getDefineLayerTables();
    if (defineRes.success && defineRes.tables?.length) {
      const row = defineRes.tables.find(
        (r) => String(r.define_table_name ?? '').trim().toLowerCase() === layerName
      );
      const shpType = String(row?.define_table_shp_type ?? '').toUpperCase();
      if (VALID_GEOMETRY_TYPES.has(shpType)) {
        geometryType = shpType as GeometryType;
        fromTables = true;
      }
    }
    if (!fromTables) {
      const geomRes = await getLayerGeometryType({ url: baseUrl, workspace, layerName });
      if (geomRes.geometryType && VALID_GEOMETRY_TYPES.has(geomRes.geometryType)) {
        geometryType = geomRes.geometryType;
      }
    }
    const hash = layerName.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    const color = getMaterialToneColor(hash);
    let styleProps: StyleProps;

    if (geometryType === 'POINT') {
      const symbolUrl = resolveSymbolUrlForLayer(layerName);
      styleProps = {
        fillColor: color,
        strokeColor: '#FFFFFF',
        strokeWidth: 1.5,
        opacity: 0.5,
        size: 10,
        ...(symbolUrl ? { symbolUrl } : {}),
      };
    } else if (geometryType === 'LINE') {
      styleProps = {
        strokeColor: color,
        strokeWidth: 2,
        opacity: 0.5,
      };
    } else {
      styleProps = {
        fillColor: color,
        strokeColor: '#FFFFFF',
        strokeWidth: 1,
        opacity: 0.3,
      };
    }

    const cssBody = buildCssFromSimpleStyle(geometryType, styleProps);
    const createRes = await createGeoServerStyle({
      url: baseUrl,
      name: layerName,
      geometryType,
      styleProps,
    });

    if (createRes.success && 'alreadyExists' in createRes && createRes.alreadyExists) {
      const putRes = await geoserverFetch(baseUrl, `/rest/styles/${encodeURIComponent(layerName)}`, {
        method: 'PUT',
        body: cssBody,
        contentType: 'application/vnd.geoserver.geocss+css',
      });
      if (putRes.ok) writeCssStyleToDataDir(layerName, cssBody);
    } else if (!createRes.success) {
      const exists = await geoServerStyleExists(baseUrl, layerName);
      if (!exists) {
        return { success: false, error: createRes.error ?? '스타일 생성 실패' };
      }
      const putRes = await geoserverFetch(baseUrl, `/rest/styles/${encodeURIComponent(layerName)}`, {
        method: 'PUT',
        body: cssBody,
        contentType: 'application/vnd.geoserver.geocss+css',
      });
      if (putRes.ok) {
        writeCssStyleToDataDir(layerName, cssBody);
      } else if (!(await geoServerStyleExists(baseUrl, layerName))) {
        const text = await putRes.text().catch(() => '');
        return { success: false, error: `스타일 수정 실패: ${putRes.status} ${text}` };
      }
    }
    const setRes = await setLayerDefaultStyle({
      url: baseUrl,
      workspace,
      layerName,
      styleName: layerName,
    });
    if (!setRes.success) return { success: false, error: setRes.error ?? '스타일 지정 실패' };
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

const FALLBACK_STYLES = ['polygon', 'line', 'point'] as const;

/**
 * 레이어 속성 자동설정: DB layer 스키마 테이블 컬럼 정보를 defineLayer fields에 반영 (플레이스홀더)
 */
export async function applyDefaultAttributesToLayer(params: { layerName: string }) {
  const layerName = params?.layerName?.trim();
  if (!layerName) return { success: false, error: '레이어 이름이 필요합니다.' };
  try {
    // TODO: DB layer.layerName 컬럼 조회 후 defineLayer/fields/{tableName} 동기화
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * 레이어에서 사용 중인 스타일 제거: 기본 스타일로 바꾼 뒤 해당 스타일 삭제
 */
export async function deleteLayerStyle(params: {
  url?: string;
  workspace?: string;
  layerName: string;
}) {
  const baseUrl = (params?.url ?? GEOSERVER_DEFAULT_URL).replace(/\/$/, '');
  const workspace = params?.workspace?.trim() || 'ggnr';
  const layerName = params?.layerName?.trim();
  if (!layerName) return { success: false, error: '레이어 이름이 필요합니다.' };

  try {
    const layerRes = await geoserverFetch(
      baseUrl,
      `/rest/workspaces/${workspace}/layers/${encodeURIComponent(layerName)}.json`
    );
    if (!layerRes.ok) return { success: false, error: '레이어 조회 실패' };
    const layerData = await layerRes.json();
    const styleName =
      layerData?.layer?.defaultStyle?.name ?? layerData?.defaultStyle?.name;
    if (!styleName) return { success: false, error: '적용된 스타일이 없습니다.' };

    const geomRes = await getLayerGeometryType({ url: baseUrl, workspace, layerName });
    const geom = geomRes.geometryType ?? 'POLYGON';
    const fallback =
      geom === 'POINT' ? 'point' : geom === 'LINE' ? 'line' : 'polygon';
    let setStyleName = fallback;
    for (const s of FALLBACK_STYLES) {
      const ok = await geoserverFetch(baseUrl, `/rest/styles/${encodeURIComponent(s)}.json`).then(
        (r) => r.ok
      );
      if (ok) {
        setStyleName = s;
        break;
      }
    }

    const setRes = await setLayerDefaultStyle({
      url: baseUrl,
      workspace,
      layerName,
      styleName: setStyleName,
    });
    if (!setRes.success) {
      return { success: false, error: setRes.error ?? '기본 스타일 전환 실패' };
    }
    const delRes = await deleteGeoServerStyle({ url: baseUrl, name: styleName });
    if (!delRes.success) return { success: false, error: delRes.error };
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * layer 스키마에 있으나 tables.json에 정의되지 않은 geometry 테이블을 public_layer 스키마로 이전.
 * @param params.dryRun - true면 이동할 목록만 반환하고 ALTER 미실행
 */
export async function moveLayerUndefinedTablesToPublicLayer(params: { dryRun?: boolean } = {}) {
  const dryRun = !!params?.dryRun;

  const defineRes = await getDefineLayerTables();
  if (!defineRes.success || !defineRes.tables?.length) {
    return {
      success: false,
      error: defineRes.error ?? 'tables.json 없음 또는 비어 있음',
      moved: [],
      failed: [],
      dryRun,
    };
  }

  const definedNames = new Set<string>(
    defineRes.tables
      .map((r) => String(r.define_table_name ?? '').trim())
      .filter((n) => n.length > 0)
  );

  const listRes = await getLayerTableList();
  if (!listRes.success) {
    return {
      success: false,
      error: listRes.error ?? 'geometry_columns 조회 실패',
      moved: [],
      failed: [],
      dryRun,
    };
  }

  const layerTables = (listRes.tables ?? []).filter((t) => t.schema === 'layer');
  const toMove = layerTables.filter((t) => !definedNames.has(t.table));

  if (toMove.length === 0) {
    return {
      success: true,
      moved: [],
      failed: [],
      dryRun,
      message: '이동할 테이블이 없습니다.',
    };
  }

  if (dryRun) {
    return {
      success: true,
      moved: toMove.map((t) => t.table),
      failed: [],
      dryRun: true,
      message: `--dry-run: ${toMove.length}개 테이블 이동 예정`,
    };
  }

  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS public_layer`);

  const moved: string[] = [];
  const failed: Array<{ table: string; error: string }> = [];

  function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  for (const row of toMove) {
    const tableName = row.table;
    const alterSql = `ALTER TABLE layer.${quoteIdent(tableName)} SET SCHEMA public_layer`;
    try {
      await db.execute(sql.raw(alterSql));
      moved.push(tableName);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push({ table: tableName, error: msg });
    }
  }

  return {
    success: true,
    moved,
    failed,
    dryRun: false,
    message: `이동 완료: ${moved.length}개, 실패: ${failed.length}개`,
  };
}

/**
 * GeoServer 로그 파일 마지막 N줄 읽기 (폴링용)
 * 웹 Admin LogPage와 동일: data_dir/logs/geoserver.log (logging.xml location 기준)
 */
export async function getGeoServerLog(params: { maxLines?: number } = {}) {
  const maxLines = Math.min(Math.max(Number(params?.maxLines) || 200, 1), 500);
  const projectRoot = process.cwd();
  const logPath = path.join(projectRoot, 'geoserver_modules', 'data_dir', 'logs', 'geoserver.log');

  try {
    if (!fs.existsSync(logPath)) {
      return { success: true, lines: [], path: logPath, message: '로그 파일이 없습니다.' };
    }
    const content = fs.readFileSync(logPath, 'utf-8');
    const allLines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const lines = allLines.slice(-maxLines);
    return { success: true, lines, path: logPath };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg, lines: [], path: logPath };
  }
}

const EMD_RI_SCHEMA = 'public_layer';
/** emd 테이블 한글명 후보 (컬럼이 없으면 다음 시도) */
const EMD_LIST_NAME_COLUMNS = ['adm_nm', 'emd_nm', 'name', 'ri_nm'];
/** ri 테이블 표시명은 리명 컬럼 우선 (emd_nm 만 있으면 잘못된 라벨·빈 결과로 끊길 수 있음) */
const RI_LIST_NAME_COLUMNS = ['ri_nm', 'name', 'adm_nm', 'emd_nm'];

/**
 * geometry_columns.srid 이 0·NULL·음수면 PostGIS가 원본 SRID를 모름 → ST_Transform 불가.
 * 이 프로젝트는 행정경계·레이어 실좌표가 EPSG:5181인 경우가 많아 5181로 간주한다.
 */
function normalizedLayerSrid5181(catalogSrid: unknown): number {
  const n = Number(catalogSrid);
  if (catalogSrid == null || !Number.isFinite(n) || n <= 0) return 5181;
  return Math.floor(n);
}

/** geometry 컬럼명(따옴표 이스케이프만 된 식별자) 기준 5181 WKT·centroid SELECT 식 */
function sqlExprsGeometryTo5181Wkt(geomColEscaped: string, catalogSrid: unknown): { wktExpr: string; centroidExpr: string } {
  const srid = normalizedLayerSrid5181(catalogSrid);
  const col = `"${geomColEscaped}"`;
  if (srid === 5181) {
    return {
      wktExpr: `ST_AsText(${col})`,
      centroidExpr: `ST_X(ST_Centroid(${col})) AS center_x, ST_Y(ST_Centroid(${col})) AS center_y`,
    };
  }
  const g = `ST_SetSRID(${col}, ${srid})`;
  return {
    wktExpr: `ST_AsText(ST_Transform(${g}, 5181))`,
    centroidExpr: `ST_X(ST_Transform(ST_Centroid(${g}), 5181)) AS center_x, ST_Y(ST_Transform(ST_Centroid(${g}), 5181)) AS center_y`,
  };
}

export type EmdRiOption = { code: string; name: string };

/**
 * 읍면동(emd) 목록 조회. emd_cd, 이름 반환. ORDER BY gid 만 적용.
 */
export async function getEmdRiOptions(params: { schema?: string } = {}) {
  const schema = (params?.schema ?? EMD_RI_SCHEMA).trim() || EMD_RI_SCHEMA;
  const result: { emd: EmdRiOption[]; error?: string } = { emd: [] };

  for (const nameCol of EMD_LIST_NAME_COLUMNS) {
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT "emd_cd" AS code, "${nameCol}" AS name FROM "${schema}"."emd"
           WHERE "${nameCol}" IS NOT NULL AND TRIM(COALESCE("${nameCol}"::text, '')) <> ''
           ORDER BY "gid"`
        )
      );
      const rows = (res.rows as { code: string; name: string }[]).map((r) => ({
        code: String(r?.code ?? '').trim(),
        name: String(r?.name ?? '').trim(),
      })).filter((r) => r.code && r.name);
      const seen = new Set<string>();
      result.emd = rows.filter((r) => {
        if (seen.has(r.code)) return false;
        seen.add(r.code);
        return true;
      });
      if (result.emd.length > 0) break;
    } catch {
      continue;
    }
  }

  if (result.emd.length === 0 && !result.error) {
    result.error = 'emd 목록을 가져오지 못했습니다.';
  }
  return result;
}

/**
 * 선택한 읍면동(emd_cd) 하위 리(ri) 목록 조회.
 * ri_cd에 emd_cd를 포함하는 행만 (ri_cd LIKE emd_cd || '%'), ORDER BY gid.
 */
export async function getRiOptionsByEmd(params: { schema?: string; emdCode: string } = { emdCode: '' }) {
  const schema = (params?.schema ?? EMD_RI_SCHEMA).trim() || EMD_RI_SCHEMA;
  const emdCode = String(params?.emdCode ?? '').trim();
  const result: { ri: EmdRiOption[]; error?: string } = { ri: [] };

  if (!emdCode) {
    return result;
  }

  const safeEmdCode = emdCode.replace(/'/g, "''");
  for (const nameCol of RI_LIST_NAME_COLUMNS) {
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT "ri_cd" AS code, "${nameCol}" AS name FROM "${schema}"."ri"
           WHERE "ri_cd" LIKE '${safeEmdCode}' || '%'
             AND "${nameCol}" IS NOT NULL AND TRIM(COALESCE("${nameCol}"::text, '')) <> ''
           ORDER BY "gid"`
        )
      );
      const rows = (res.rows as { code: string; name: string }[]).map((r) => ({
        code: String(r?.code ?? '').trim(),
        name: String(r?.name ?? '').trim(),
      })).filter((r) => r.code && r.name);
      const seen = new Set<string>();
      result.ri = rows.filter((r) => {
        if (seen.has(r.code)) return false;
        seen.add(r.code);
        return true;
      });
      if (result.ri.length > 0) break;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      result.error = msg;
      continue;
    }
  }

  return result;
}

/**
 * 읍면동(emd) 코드로 해당 행의 도형 WKT(5181) 조회. 지도 표시 및 공간 검색용.
 */
export async function getEmdGeometry(params: { schema?: string; emdCode: string } = { emdCode: '' }) {
  const schema = (params?.schema ?? EMD_RI_SCHEMA).trim() || EMD_RI_SCHEMA;
  const emdCode = String(params?.emdCode ?? '').trim();
  if (!emdCode) return { wkt: null as string | null, error: 'emdCode required' };

  const esc = (s: string) => s.replace(/'/g, "''");
  try {
    const gcRes = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name, srid FROM geometry_columns
         WHERE f_table_schema = '${esc(schema)}' AND f_table_name = 'emd' LIMIT 1`
      )
    );
    const gcRow = gcRes.rows?.[0] as { name?: string; srid?: number } | undefined;
    if (!gcRow?.name) return { wkt: null, error: 'emd geometry column not found' };
    const geomCol = String(gcRow.name).trim().replace(/"/g, '""');
    const { wktExpr, centroidExpr } = sqlExprsGeometryTo5181Wkt(geomCol, gcRow.srid);
    const res = await db.execute(
      sql.raw(
        `SELECT ${wktExpr} AS wkt, ${centroidExpr} FROM "${schema.replace(/"/g, '""')}"."emd"
         WHERE "emd_cd" = '${esc(emdCode)}' LIMIT 1`
      )
    );
    const row = res.rows?.[0] as { wkt?: string; center_x?: number; center_y?: number } | undefined;
    const wkt = row?.wkt != null ? String(row.wkt).trim() : null;
    const center =
      row?.center_x != null && row?.center_y != null
        ? { x: Number(row.center_x), y: Number(row.center_y) }
        : null;
    return { wkt, center };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { wkt: null, error: msg };
  }
}

/**
 * 그린 도형(EPSG:5181 WKT)과 겹치는 읍/면/동 이름·사업 구역 대비 위치 조회.
 * 필지분석 «도형 그리기» «대상»·경고 표시용.
 * 경계만 맞닿는(ST_Touches) 인접 읍면동은 이름 목록에서 제외한다.
 */
export async function getEmdNamesByWkt(params: { schema?: string; wkt: string } = { wkt: '' }) {
  const schema = (params?.schema ?? EMD_RI_SCHEMA).trim() || EMD_RI_SCHEMA;
  const wkt = String(params?.wkt ?? '').trim();
  if (!wkt) {
    return {
      names: [] as string[],
      projectScope: 'inside' as const,
      error: 'wkt required',
    };
  }

  const esc = (s: string) => s.replace(/'/g, "''");
  const qSchema = `"${schema.replace(/"/g, '""')}"`;
  try {
    const gcRes = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name, srid FROM geometry_columns
         WHERE f_table_schema = '${esc(schema)}' AND f_table_name = 'emd' LIMIT 1`
      )
    );
    const gcRow = gcRes.rows?.[0] as { name?: string; srid?: number } | undefined;
    if (!gcRow?.name) {
      return { names: [] as string[], projectScope: 'inside' as const, error: 'emd geometry column not found' };
    }
    const geomCol = String(gcRow.name).trim().replace(/"/g, '""');
    const col = `"${geomCol}"`;
    const srid = normalizedLayerSrid5181(gcRow.srid);
    const emdGeom5181 =
      srid === 5181 ? `ST_SetSRID(${col}, 5181)` : `ST_Transform(ST_SetSRID(${col}, ${srid}), 5181)`;
    const projectUnion5181 =
      srid === 5181
        ? `ST_SetSRID(ST_Union(${col}), 5181)`
        : `ST_Transform(ST_SetSRID(ST_Union(${col}), ${srid}), 5181)`;
    const drawGeom = `ST_GeomFromText('${esc(wkt)}', 5181)`;

    const scopeRes = await db.execute(
      sql.raw(
        `WITH draw AS (
           SELECT ${drawGeom} AS geom
         ),
         project AS (
           SELECT ${projectUnion5181} AS geom
           FROM ${qSchema}."emd"
           WHERE ${col} IS NOT NULL
         )
         SELECT
           CASE
             WHEN p.geom IS NULL THEN 'inside'
             WHEN NOT ST_Intersects(d.geom, p.geom) THEN 'fully_outside'
             WHEN ST_Within(d.geom, p.geom) OR ST_CoveredBy(d.geom, p.geom) THEN 'inside'
             ELSE 'partially_outside'
           END AS project_scope
         FROM draw d
         CROSS JOIN project p`
      )
    );
    const scopeRow = scopeRes.rows?.[0] as { project_scope?: string } | undefined;
    const rawScope = String(scopeRow?.project_scope ?? 'inside');
    const projectScope =
      rawScope === 'fully_outside' || rawScope === 'partially_outside' ? rawScope : ('inside' as const);

    // 이름 컬럼 결정 (테이블에 실제 존재하는 첫 후보)
    const colRes = await db.execute(
      sql.raw(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = '${esc(schema)}' AND table_name = 'emd'`
      )
    );
    const cols = new Set(
      (colRes.rows as Array<{ column_name?: string }>).map((r) => String(r.column_name ?? ''))
    );
    const nameCol = EMD_LIST_NAME_COLUMNS.find((c) => cols.has(c));
    if (!nameCol) {
      return { names: [] as string[], projectScope, error: 'emd name column not found' };
    }
    const nameColEsc = `"${nameCol.replace(/"/g, '""')}"`;

    const res = await db.execute(
      sql.raw(
        `SELECT DISTINCT ${nameColEsc} AS name
         FROM ${qSchema}."emd"
         WHERE ${col} IS NOT NULL
           AND ${nameColEsc} IS NOT NULL
           AND TRIM(COALESCE(${nameColEsc}::text, '')) <> ''
           AND ST_Intersects(${emdGeom5181}, ${drawGeom})
           AND NOT ST_Touches(${emdGeom5181}, ${drawGeom})
         ORDER BY name`
      )
    );
    const names = (res.rows as Array<{ name?: unknown }>)
      .map((r) => String(r.name ?? '').trim())
      .filter((s) => s.length > 0);
    return { names, projectScope, error: undefined as string | undefined };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { names: [] as string[], projectScope: 'inside' as const, error: msg };
  }
}

/**
 * schema.emd 전체 읍면동 도형을 합쳐(union) 사업 시군구 외곽선 WKT(EPSG:5181)로 반환.
 * 필지분석 진입 시 지도에 대상 시군구 경계를 표시하는 용도.
 */
export async function getProjectEmdBoundary5181(params: { schema?: string } = {}) {
  const schema = (params?.schema ?? EMD_RI_SCHEMA).trim() || EMD_RI_SCHEMA;
  const esc = (s: string) => s.replace(/'/g, "''");
  try {
    const gcRes = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name, srid FROM geometry_columns
         WHERE f_table_schema = '${esc(schema)}' AND f_table_name = 'emd' LIMIT 1`
      )
    );
    const gcRow = gcRes.rows?.[0] as { name?: string; srid?: number } | undefined;
    if (!gcRow?.name) return { wkt: null as string | null, error: 'emd geometry column not found' };
    const geomCol = String(gcRow.name).trim().replace(/"/g, '""');
    const col = `"${geomCol}"`;
    const srid = normalizedLayerSrid5181(gcRow.srid);
    const unionExpr =
      srid === 5181
        ? `ST_Union(${col})`
        : `ST_Transform(ST_SetSRID(ST_Union(${col}), ${srid}), 5181)`;
    const res = await db.execute(
      sql.raw(
        `SELECT ST_AsText(${unionExpr}) AS wkt FROM "${schema.replace(/"/g, '""')}"."emd"`
      )
    );
    const row = res.rows?.[0] as { wkt?: string } | undefined;
    const wkt = row?.wkt != null ? String(row.wkt).trim() : null;
    return { wkt };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { wkt: null as string | null, error: msg };
  }
}

/**
 * schema.emd 테이블의 모든 읍면동 도형 envelope를 WGS84(4326) 경위도 bbox로 반환.
 * ITS CCTV 등 bbox 고정용 — geometry_columns 기준으로 SRID 처리(getEmdGeometry와 동일).
 */
export async function getEmdExtentWgs84(params: { schema?: string } = {}) {
  const schema = (params?.schema ?? EMD_RI_SCHEMA).trim() || EMD_RI_SCHEMA;
  const esc = (s: string) => s.replace(/'/g, "''");
  const qSchema = `"${schema.replace(/"/g, '""')}"`;
  try {
    const gcRes = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name, srid FROM geometry_columns
         WHERE f_table_schema = '${esc(schema)}' AND f_table_name = 'emd' LIMIT 1`
      )
    );
    const gcRow = gcRes.rows?.[0] as { name?: string; srid?: number } | undefined;
    if (!gcRow?.name) {
      return { minX: null as number | null, maxX: null, minY: null, maxY: null, error: 'emd geometry column not found' };
    }
    const geomCol = String(gcRow.name).trim().replace(/"/g, '""');
    const colRef = `"${geomCol}"`;
    const srid = normalizedLayerSrid5181(gcRow.srid);

    const res = await db.execute(
      sql.raw(
        `SELECT
           ST_XMin(env4326)::float8 AS min_x,
           ST_XMax(env4326)::float8 AS max_x,
           ST_YMin(env4326)::float8 AS min_y,
           ST_YMax(env4326)::float8 AS max_y
         FROM (
           SELECT ST_Transform(ST_SetSRID(ST_Extent(${colRef}), ${srid}), 4326) AS env4326
           FROM ${qSchema}."emd"
           WHERE ${colRef} IS NOT NULL
         ) sub
         WHERE env4326 IS NOT NULL`
      )
    );
    const row = res.rows?.[0] as
      | { min_x?: unknown; max_x?: unknown; min_y?: unknown; max_y?: unknown }
      | undefined;
    if (!row) {
      return {
        minX: null as number | null,
        maxX: null,
        minY: null,
        maxY: null,
        error: 'emd 테이블에 유효한 도형이 없거나 범위를 계산할 수 없습니다.',
      };
    }
    const minX = Number(row.min_x);
    const maxX = Number(row.max_x);
    const minY = Number(row.min_y);
    const maxY = Number(row.max_y);
    if (![minX, maxX, minY, maxY].every((n) => Number.isFinite(n))) {
      return { minX: null, maxX: null, minY: null, maxY: null, error: 'emd 범위 좌표가 유효하지 않습니다.' };
    }
    if (minX >= maxX || minY >= maxY) {
      return { minX: null, maxX: null, minY: null, maxY: null, error: 'emd envelope 가 역전되었습니다.' };
    }
    return { minX, maxX, minY, maxY, error: undefined as string | undefined };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { minX: null, maxX: null, minY: null, maxY: null, error: msg };
  }
}

/**
 * schema.emd 모든 도형의 envelope 를 EPSG:5181 평면으로 반환.
 * EMD 도형이 5181 로 저장되어 있으므로 `ST_Extent` 를 5181 그대로 사용. SRID 가 다르면 5181 로 변환.
 */
export async function getEmdExtent5181(params: { schema?: string } = {}) {
  const schema = (params?.schema ?? EMD_RI_SCHEMA).trim() || EMD_RI_SCHEMA;
  const esc = (s: string) => s.replace(/'/g, "''");
  const qSchema = `"${schema.replace(/"/g, '""')}"`;
  try {
    const gcRes = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name, srid FROM geometry_columns
         WHERE f_table_schema = '${esc(schema)}' AND f_table_name = 'emd' LIMIT 1`
      )
    );
    const gcRow = gcRes.rows?.[0] as { name?: string; srid?: number } | undefined;
    if (!gcRow?.name) {
      return { minX: null as number | null, maxX: null, minY: null, maxY: null, error: 'emd geometry column not found' };
    }
    const geomCol = String(gcRow.name).trim().replace(/"/g, '""');
    const colRef = `"${geomCol}"`;
    const srid = normalizedLayerSrid5181(gcRow.srid);
    const env5181Expr =
      srid === 5181
        ? `ST_SetSRID(ST_Extent(${colRef}), 5181)`
        : `ST_Transform(ST_SetSRID(ST_Extent(${colRef}), ${srid}), 5181)`;
    const res = await db.execute(
      sql.raw(
        `SELECT
           ST_XMin(env5181)::float8 AS min_x,
           ST_XMax(env5181)::float8 AS max_x,
           ST_YMin(env5181)::float8 AS min_y,
           ST_YMax(env5181)::float8 AS max_y
         FROM (
           SELECT ${env5181Expr} AS env5181
           FROM ${qSchema}."emd"
           WHERE ${colRef} IS NOT NULL
         ) sub
         WHERE env5181 IS NOT NULL`
      )
    );
    const row = res.rows?.[0] as
      | { min_x?: unknown; max_x?: unknown; min_y?: unknown; max_y?: unknown }
      | undefined;
    if (!row) {
      return {
        minX: null as number | null,
        maxX: null,
        minY: null,
        maxY: null,
        error: 'emd 테이블에 유효한 도형이 없거나 범위를 계산할 수 없습니다.',
      };
    }
    const minX = Number(row.min_x);
    const maxX = Number(row.max_x);
    const minY = Number(row.min_y);
    const maxY = Number(row.max_y);
    if (![minX, maxX, minY, maxY].every((n) => Number.isFinite(n))) {
      return { minX: null, maxX: null, minY: null, maxY: null, error: 'emd 5181 범위 좌표가 유효하지 않습니다.' };
    }
    if (minX >= maxX || minY >= maxY) {
      return { minX: null, maxX: null, minY: null, maxY: null, error: 'emd 5181 envelope 가 역전되었습니다.' };
    }
    return { minX, maxX, minY, maxY, error: undefined as string | undefined };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { minX: null, maxX: null, minY: null, maxY: null, error: msg };
  }
}

/**
 * 리(ri) 코드로 해당 행의 도형 WKT(5181) 조회. 지도 표시 및 공간 검색용.
 */
export async function getRiGeometry(params: { schema?: string; riCode: string } = { riCode: '' }) {
  const schema = (params?.schema ?? EMD_RI_SCHEMA).trim() || EMD_RI_SCHEMA;
  const riCode = String(params?.riCode ?? '').trim();
  if (!riCode) return { wkt: null as string | null, error: 'riCode required' };

  const esc = (s: string) => s.replace(/'/g, "''");
  try {
    const gcRes = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name, srid FROM geometry_columns
         WHERE f_table_schema = '${esc(schema)}' AND f_table_name = 'ri' LIMIT 1`
      )
    );
    const gcRow = gcRes.rows?.[0] as { name?: string; srid?: number } | undefined;
    if (!gcRow?.name) return { wkt: null, error: 'ri geometry column not found' };
    const geomCol = String(gcRow.name).trim().replace(/"/g, '""');
    const { wktExpr, centroidExpr } = sqlExprsGeometryTo5181Wkt(geomCol, gcRow.srid);
    const res = await db.execute(
      sql.raw(
        `SELECT ${wktExpr} AS wkt, ${centroidExpr} FROM "${schema.replace(/"/g, '""')}"."ri"
         WHERE "ri_cd" = '${esc(riCode)}' LIMIT 1`
      )
    );
    const row = res.rows?.[0] as { wkt?: string; center_x?: number; center_y?: number } | undefined;
    const wkt = row?.wkt != null ? String(row.wkt).trim() : null;
    const center =
      row?.center_x != null && row?.center_y != null
        ? { x: Number(row.center_x), y: Number(row.center_y) }
        : null;
    return { wkt, center };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { wkt: null, error: msg };
  }
}

/**
 * EPSG:5181 WKT 여러 개를 DB에서 합쳐 단일 도형 WKT로 반환(지도·공간검색용).
 * 빈 항목·실패 시 null.
 */
export async function unionWkts5181(params: { wkts?: string[] } = {}) {
  const wkts = Array.isArray(params?.wkts)
    ? params.wkts.map((w) => String(w ?? '').trim()).filter(Boolean)
    : [];
  if (wkts.length === 0) return { wkt: null as string | null, error: 'wkts required' as string | undefined };
  if (wkts.length === 1) {
    return { wkt: wkts[0], center: null as { x: number; y: number } | null };
  }
  const max = 30;
  if (wkts.length > max) {
    return { wkt: null, error: `wkts length exceeds ${max}` };
  }
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "''");
  const geomExprs = wkts.map((w) => `ST_SetSRID(ST_GeomFromText('${esc(w)}'), 5181)`);
  const arr = geomExprs.join(', ');
  const q = `SELECT ST_AsText(ST_UnaryUnion(ST_Collect(ARRAY[${arr}]::geometry[]))) AS wkt,
    ST_X(ST_Centroid(ST_UnaryUnion(ST_Collect(ARRAY[${arr}]::geometry[])))) AS center_x,
    ST_Y(ST_Centroid(ST_UnaryUnion(ST_Collect(ARRAY[${arr}]::geometry[])))) AS center_y`;
  try {
    const res = await db.execute(sql.raw(q));
    const row = res.rows?.[0] as { wkt?: string; center_x?: number; center_y?: number } | undefined;
    const wkt = row?.wkt != null ? String(row.wkt).trim() : null;
    const center =
      row?.center_x != null && row?.center_y != null
        ? { x: Number(row.center_x), y: Number(row.center_y) }
        : null;
    return { wkt, center };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { wkt: null, error: msg };
  }
}

/** 데이터 선택(테이블/필드/값) 검색 스키마. defineLayer·GeoServer 레이어와 동일하게 layer 스키마 사용 */
const DATA_SELECT_SCHEMA = 'layer';

const DATA_SELECT_TABLES_JSON_PATH = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'tables.json');

/**
 * 데이터 선택용 테이블 목록. tables.json(defineLayer)의 define_table_shp_type이 POLYGON/MULTIPOLYGON인 테이블만 반환.
 */
export async function getDataSelectTableList(params: { schema?: string } = {}) {
  const schema = (params?.schema ?? DATA_SELECT_SCHEMA).trim() || DATA_SELECT_SCHEMA;
  try {
    if (!fs.existsSync(DATA_SELECT_TABLES_JSON_PATH)) {
      return { tables: [], error: 'tables.json not found' };
    }
    const raw = fs.readFileSync(DATA_SELECT_TABLES_JSON_PATH, 'utf-8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return { tables: [], error: 'Invalid tables.json format' };
    const shpTypeUpper = (v: unknown) => String(v ?? '').trim().toUpperCase();
    const polygonTypes = new Set(['POLYGON', 'MULTIPOLYGON']);
    const schemaUpper = schema.toUpperCase();
    const tables = (arr as { define_table_name?: string; define_table_schema?: string; define_table_shp_type?: string }[])
      .filter(
        (r) =>
          (shpTypeUpper(r.define_table_schema) || 'LAYER') === schemaUpper &&
          polygonTypes.has(shpTypeUpper(r.define_table_shp_type))
      )
      .map((r) => String(r.define_table_name ?? '').trim())
      .filter(Boolean);
    tables.sort((a, b) => a.localeCompare(b));
    return { tables: [...new Set(tables)] };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { tables: [], error: msg };
  }
}

/**
 * 데이터 선택용 필드(컬럼) 목록
 */
export async function getDataSelectFieldList(params: { schema?: string; table: string } = { table: '' }) {
  const schema = (params?.schema ?? DATA_SELECT_SCHEMA).trim() || DATA_SELECT_SCHEMA;
  const table = String(params?.table ?? '').trim();
  if (!table) return { fields: [] };
  const safeTable = table.replace(/'/g, "''");
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT column_name AS name FROM information_schema.columns
         WHERE table_schema = '${schema.replace(/'/g, "''")}' AND table_name = '${safeTable}'
         ORDER BY ordinal_position`
      )
    );
    return { fields: (res.rows as { name: string }[]).map((r) => String(r?.name ?? '').trim()).filter(Boolean) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { fields: [], error: msg };
  }
}

/** layer 등 스키마 테이블의 컬럼명·데이터타입 (defineLayer 필드 자동 생성용) */
export async function getTableColumnInfo(params: { schema: string; table: string }): Promise<{
  success: boolean;
  columns: Array<{ name: string; dataType: string }>;
  error?: string;
}> {
  const schema = String(params?.schema ?? '').trim();
  const table = String(params?.table ?? '').trim();
  if (!schema || !table) return { success: false, columns: [] };
  const safeSchema = schema.replace(/'/g, "''");
  const safeTable = table.replace(/'/g, "''");
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT column_name AS name, data_type AS data_type
         FROM information_schema.columns
         WHERE table_schema = '${safeSchema}' AND table_name = '${safeTable}'
         ORDER BY ordinal_position`
      )
    );
    const columns = (res.rows as Array<{ name: string; data_type: string }>).map((r) => ({
      name: String(r?.name ?? '').trim(),
      dataType: String(r?.data_type ?? '').trim(),
    })).filter((r) => r.name.length > 0);
    return { success: true, columns };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, columns: [], error: msg };
  }
}

/**
 * 데이터 선택용 필드 값 목록 (DISTINCT, 필터 선택용)
 */
export async function getDataSelectValueList(params: { schema?: string; table: string; field: string } = { table: '', field: '' }) {
  const schema = (params?.schema ?? DATA_SELECT_SCHEMA).trim() || DATA_SELECT_SCHEMA;
  const table = String(params?.table ?? '').trim();
  const field = String(params?.field ?? '').trim();
  if (!table || !field) return { values: [] };
  const safeSchema = schema.replace(/"/g, '""');
  const safeTable = table.replace(/"/g, '""');
  const safeField = field.replace(/"/g, '""');
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT DISTINCT "${safeField}" AS val FROM "${safeSchema}"."${safeTable}"
         WHERE "${safeField}" IS NOT NULL AND TRIM(COALESCE("${safeField}"::text, '')) <> ''
         ORDER BY 1 LIMIT 500`
      )
    );
    return { values: (res.rows as { val: string }[]).map((r) => String(r?.val ?? '').trim()).filter(Boolean) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { values: [], error: msg };
  }
}

/**
 * 테이블/필드/값 조건에 맞는 행들의 도형을 합쳐 WKT(5181)와 중심점 반환. 지도 표시 및 공간 검색용.
 */
export async function getGeometryByFieldValue(params: {
  schema?: string;
  table: string;
  field: string;
  value: string;
} = { table: '', field: '', value: '' }) {
  const schema = (params?.schema ?? DATA_SELECT_SCHEMA).trim() || DATA_SELECT_SCHEMA;
  const table = String(params?.table ?? '').trim();
  const field = String(params?.field ?? '').trim();
  const value = String(params?.value ?? '').trim();
  if (!table || !field) return { wkt: null as string | null, center: null, error: 'table and field required' };

  const esc = (s: string) => s.replace(/'/g, "''");
  try {
    const gcRes = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name, srid FROM geometry_columns
         WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(table)}' LIMIT 1`
      )
    );
    const gcRow = gcRes.rows?.[0] as { name?: string; srid?: number } | undefined;
    if (!gcRow?.name) return { wkt: null, center: null, error: 'geometry column not found' };
    const geomCol = String(gcRow.name).trim().replace(/"/g, '""');
    const srid = normalizedLayerSrid5181(gcRow.srid);
    const safeSchema = schema.replace(/"/g, '""');
    const safeTable = table.replace(/"/g, '""');
    const safeField = field.replace(/"/g, '""');
    const col = `"${geomCol}"`;
    const geomCore5181 =
      srid === 5181
        ? `ST_SetSRID(ST_Union(${col}), 5181)`
        : `ST_Transform(ST_SetSRID(ST_Union(${col}), ${srid}), 5181)`;
    const geomUnion = `ST_SimplifyPreserveTopology(${geomCore5181}, 5)`;
    const wktExpr = `ST_AsText(${geomUnion})`;
    const centroidExpr = `ST_X(ST_Centroid(${geomUnion})) AS center_x, ST_Y(ST_Centroid(${geomUnion})) AS center_y`;
    const res = await db.execute(
      sql.raw(
        `SELECT ${wktExpr} AS wkt, ${centroidExpr} FROM "${safeSchema}"."${safeTable}"
         WHERE "${safeField}" = '${esc(value)}'`
      )
    );
    const row = res.rows?.[0] as { wkt?: string; center_x?: number; center_y?: number } | undefined;
    const wkt = row?.wkt != null ? String(row.wkt).trim() : null;
    const center =
      row?.center_x != null && row?.center_y != null
        ? { x: Number(row.center_x), y: Number(row.center_y) }
        : null;
    return { wkt, center };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { wkt: null, center: null, error: msg };
  }
}

const DEFINE_LAYER_FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');
const DEFINE_LAYER_CODES_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'codes');
const LAYER_SETUP_SKIP_COLUMNS = new Set(['ogc_fid', 'geom']);

export type LayerSetupIssueType =
  | 'geoserver_layer'
  | 'geoserver_style'
  | 'define_layer'
  | 'define_field'
  | 'define_code'
  | 'temp_sync_table'
  | 'schema_mismatch';

/** SHP 업로드 비교/조회용 임시 테이블(_sync_*, _sync_shpread_*) */
function isShpSyncTempTableName(tableName: string): boolean {
  return tableName.startsWith('_sync_');
}

function normalizeLayerSchema(value: unknown): 'layer' | 'public_layer' {
  return String(value ?? '').trim() === 'public_layer' ? 'public_layer' : 'layer';
}

export type LayerSetupIssueRow = {
  rowKey: string;
  /** DB에 실제로 있는 스키마 */
  schema: 'layer' | 'public_layer';
  tableName: string;
  korName: string;
  group: string;
  shpType: string;
  source: string;
  issues: LayerSetupIssueType[];
  missingFields: string[];
  missingCodeFields: string[];
  /** 레이어 설정(Layer)의 정의 스키마. schema_mismatch 시 이동/잔여 판정 기준 */
  defineSchema?: 'layer' | 'public_layer';
  /**
   * schema_mismatch 처리:
   * - move: 정의 스키마로 ALTER SET SCHEMA
   * - drop: 정의 스키마에 정상본이 있어 잘못된 스키마 잔여만 DROP
   */
  schemaMismatchAction?: 'move' | 'drop';
};

function readDefineFieldsFile(tableName: string): Record<string, unknown>[] {
  const safe = String(tableName).replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(DEFINE_LAYER_FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readDefineCodesFile(tableName: string, fieldName: string): unknown[] {
  const safe = `${tableName}__${fieldName}`.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(DEFINE_LAYER_CODES_DIR, `field_${safe}.json`);
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadAllLayerSchemaColumns(): Promise<
  Map<string, Array<{ name: string; dataType: string }>>
> {
  const map = new Map<string, Array<{ name: string; dataType: string }>>();
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT table_schema AS schema, table_name AS table_name, column_name AS name, data_type AS data_type
         FROM information_schema.columns
         WHERE table_schema IN ('layer', 'public_layer')
         ORDER BY table_schema, table_name, ordinal_position`
      )
    );
    for (const row of res.rows as Array<{ schema?: string; table_name?: string; name?: string; data_type?: string }>) {
      const schema = String(row.schema ?? '').trim();
      const table = String(row.table_name ?? '').trim();
      const name = String(row.name ?? '').trim();
      if (!schema || !table || !name) continue;
      const key = `${schema}:${table.toLowerCase()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ name, dataType: String(row.data_type ?? '').trim() });
    }
  } catch {
    // empty map — per-table fallback in scan
  }
  return map;
}

/**
 * 레이어 목록 탭과 동일 기준(DB 테이블 전체)으로 설정 누락·오류 스캔
 */
export async function scanLayerSetupIssues(params: { url?: string } = {}) {
  const baseUrl = (params?.url ?? GEOSERVER_DEFAULT_URL).replace(/\/$/, '');

  try {
    const [listRes, defineRes, geomLayerRes, geomPublicRes, styleInfoRes, allColumns, geoServerStyleNames] =
      await Promise.all([
        getLayerTableList(),
        getDefineLayerTables(),
        getLayerTableGeometryTypes({ schema: 'layer' }),
        getLayerTableGeometryTypes({ schema: 'public_layer' }),
        getGeoServerLayersWithStyleInfo({ url: baseUrl }),
        loadAllLayerSchemaColumns(),
        getGeoServerStyleNameSet(baseUrl),
      ]);

    if (!listRes.success) {
      return { success: false, error: listRes.error ?? 'DB 테이블 목록 조회 실패', layers: [] as LayerSetupIssueRow[], issueCount: 0 };
    }

    const defineTables = defineRes.success && defineRes.tables?.length ? defineRes.tables : [];
    const defineByKey = new Map<string, Record<string, unknown>>();
    const defineByName = new Map<string, Record<string, unknown>>();
    for (const t of defineTables) {
      const name = String((t as Record<string, unknown>).define_table_name ?? '').trim();
      if (!name) continue;
      const schema = normalizeLayerSchema((t as Record<string, unknown>).define_table_schema);
      defineByKey.set(`${schema}:${name.toLowerCase()}`, t as Record<string, unknown>);
      if (!defineByName.has(name.toLowerCase())) {
        defineByName.set(name.toLowerCase(), t as Record<string, unknown>);
      }
    }

    const styleInfoMap: Record<string, { published: boolean; hasCssStyle: boolean }> = {};
    if (styleInfoRes.success && Array.isArray(styleInfoRes.layers)) {
      for (const layer of styleInfoRes.layers) {
        if (layer.name) {
          const key = String(layer.name).toLowerCase();
          styleInfoMap[key] = {
            published: layer.published ?? false,
            hasCssStyle: layer.hasCssStyle ?? false,
          };
        }
      }
    }

    const geomTypes: Record<string, string> = {
      ...((geomLayerRes as { types?: Record<string, string> }).types ?? {}),
      ...((geomPublicRes as { types?: Record<string, string> }).types ?? {}),
    };

    const dbTableKeys = new Set<string>();
    for (const t of listRes.tables ?? []) {
      if (t.schema !== 'layer' && t.schema !== 'public_layer') continue;
      const name = String(t.table ?? '').trim();
      if (!name) continue;
      const sch = t.schema === 'public_layer' ? 'public_layer' : 'layer';
      dbTableKeys.add(`${sch}:${name.toLowerCase()}`);
    }

    const layers: LayerSetupIssueRow[] = [];

    for (const t of listRes.tables ?? []) {
      if (t.schema !== 'layer' && t.schema !== 'public_layer') continue;
      const schema = t.schema === 'public_layer' ? 'public_layer' : 'layer';
      const tableName = String(t.table ?? '').trim();
      if (!tableName) continue;

      const defineKey = `${schema}:${tableName.toLowerCase()}`;

      // SHP 비교 잔여 임시 테이블 — 정의/GeoServer 이슈로 취급하지 않고 삭제 대상으로만 노출
      if (isShpSyncTempTableName(tableName)) {
        layers.push({
          rowKey: defineKey,
          schema,
          tableName,
          korName: '',
          group: '',
          shpType: '',
          source: '',
          issues: ['temp_sync_table'],
          missingFields: [],
          missingCodeFields: [],
        });
        continue;
      }

      const defineExact = defineByKey.get(defineKey);
      const defineByTableName = defineByName.get(tableName.toLowerCase());
      let define = defineExact;
      let defineSchema: 'layer' | 'public_layer' | undefined = defineExact
        ? schema
        : undefined;
      let schemaMismatchAction: 'move' | 'drop' | undefined;
      const issues: LayerSetupIssueType[] = [];
      const missingFields: string[] = [];
      const missingCodeFields: string[] = [];

      if (!defineExact && defineByTableName) {
        const targetSchema = normalizeLayerSchema(defineByTableName.define_table_schema);
        if (targetSchema !== schema) {
          issues.push('schema_mismatch');
          define = defineByTableName;
          defineSchema = targetSchema;
          // 정의 스키마에 정상본이 있으면 이동 불가 → 잘못된 스키마 잔여 DROP
          schemaMismatchAction = dbTableKeys.has(`${targetSchema}:${tableName.toLowerCase()}`)
            ? 'drop'
            : 'move';
          if (schemaMismatchAction === 'drop') {
            const shpType =
              String(define?.define_table_shp_type ?? '').trim() ||
              String(geomTypes[tableName] ?? geomTypes[tableName.toLowerCase()] ?? '').trim();
            layers.push({
              rowKey: defineKey,
              schema,
              tableName,
              korName: String(define?.define_table_kor_name ?? '').trim(),
              group: String(define?.define_table_group ?? '').trim(),
              shpType,
              source: String(define?.define_table_source ?? '').trim(),
              issues: ['schema_mismatch'],
              missingFields: [],
              missingCodeFields: [],
              defineSchema,
              schemaMismatchAction: 'drop',
            });
            continue;
          }
        } else {
          define = defineByTableName;
          defineSchema = targetSchema;
        }
      } else if (!defineExact) {
        issues.push('define_layer');
      }

      const colKey = `${schema}:${tableName.toLowerCase()}`;
      let dbColumns = allColumns.get(colKey) ?? [];
      if (dbColumns.length === 0) {
        const colRes = await getTableColumnInfo({ schema, table: tableName });
        dbColumns = colRes.success ? colRes.columns : [];
      }
      const dbFieldNames = dbColumns
        .map((c) => c.name.toLowerCase())
        .filter((n) => n && !LAYER_SETUP_SKIP_COLUMNS.has(n));

      const defineFields = readDefineFieldsFile(tableName);
      const defineFieldNames = new Set(
        defineFields.map((f) => String(f.define_field_name ?? '').trim().toLowerCase()).filter(Boolean)
      );

      for (const name of dbFieldNames) {
        if (!defineFieldNames.has(name)) missingFields.push(name);
      }
      if (missingFields.length > 0) issues.push('define_field');

      for (const f of defineFields) {
        if (String(f.define_field_type ?? '').toUpperCase() !== 'CODE') continue;
        const fieldName = String(f.define_field_name ?? '').trim();
        if (!fieldName) continue;
        const codes = readDefineCodesFile(tableName, fieldName);
        if (codes.length === 0) missingCodeFields.push(fieldName);
      }
      if (missingCodeFields.length > 0) issues.push('define_code');

      const styleInfo = styleInfoMap[tableName.toLowerCase()];
      const published = styleInfo?.published ?? false;
      let hasCssStyle = styleInfo?.hasCssStyle ?? false;
      if (!hasCssStyle) {
        hasCssStyle = geoServerStyleNames.has(tableName.toLowerCase());
      }
      if (!published) issues.push('geoserver_layer');
      if (!hasCssStyle) issues.push('geoserver_style');

      if (issues.length === 0) continue;

      const shpType =
        String(define?.define_table_shp_type ?? '').trim() ||
        String(geomTypes[tableName] ?? geomTypes[tableName.toLowerCase()] ?? '').trim();

      layers.push({
        rowKey: defineKey,
        schema,
        tableName,
        korName: String(define?.define_table_kor_name ?? '').trim(),
        group: String(define?.define_table_group ?? '').trim(),
        shpType,
        source: String(define?.define_table_source ?? '').trim(),
        issues,
        missingFields,
        missingCodeFields,
        defineSchema,
        schemaMismatchAction,
      });
    }

    return { success: true, layers, issueCount: layers.length };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg, layers: [] as LayerSetupIssueRow[], issueCount: 0 };
  }
}

async function writeDefineCodesFile(tableName: string, fieldName: string, codes: unknown[]) {
  const safe = `${tableName}__${fieldName}`.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(DEFINE_LAYER_CODES_DIR, `field_${safe}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(codes, null, 2), 'utf-8');
}

/** CODE 필드 코드 정의를 DB DISTINCT 값으로 생성 (값 없으면 미분류 1건) */
export async function syncDefineCodesFromDb(params: {
  schema: 'layer' | 'public_layer';
  tableName: string;
  fieldName: string;
}) {
  const schema = params.schema === 'public_layer' ? 'public_layer' : 'layer';
  const tableName = String(params.tableName ?? '').trim();
  const fieldName = String(params.fieldName ?? '').trim();
  if (!tableName || !fieldName) return { success: false, error: 'tableName, fieldName이 필요합니다.' };

  try {
    const valRes = await getDataSelectValueList({ schema, table: tableName, field: fieldName });
    const values = Array.isArray(valRes.values) ? valRes.values.filter(Boolean) : [];
    const codes =
      values.length > 0
        ? values.map((v, i) => ({
            define_code_key: String(90000 + i),
            define_code_field_key: '',
            define_code_name: v,
            define_code_kor_name: v,
          }))
        : [
            {
              define_code_key: '90000',
              define_code_field_key: '',
              define_code_name: '000',
              define_code_kor_name: '미분류',
            },
          ];
    await writeDefineCodesFile(tableName, fieldName, codes);
    return { success: true, count: codes.length };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * 레이어 설정 오류 자동 수정
 * (임시테이블 삭제 → 스키마 이동 → define → code → geoserver layer → style 순)
 */
export async function fixLayerSetupIssues(params: {
  tableName: string;
  schema?: 'layer' | 'public_layer';
  issues?: LayerSetupIssueType[];
  missingCodeFields?: string[];
  url?: string;
  geometryType?: string;
  group?: string;
  /** schema_mismatch 이동 대상. 없으면 tables.json에서 조회 */
  defineSchema?: 'layer' | 'public_layer';
  /** schema_mismatch: move | drop. 없으면 대상 존재 여부로 판정 */
  schemaMismatchAction?: 'move' | 'drop';
}) {
  const tableName = String(params.tableName ?? '').trim();
  // 2026-07-23 이수빈: 빌드 오류 수정
  let schema: 'layer' | 'public_layer' =
    params.schema === 'public_layer' ? 'public_layer' : 'layer';
  const baseUrl = (params?.url ?? GEOSERVER_DEFAULT_URL).replace(/\/$/, '');
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };

  const issueSet = new Set(params.issues ?? []);
  const fixed: string[] = [];
  const errors: string[] = [];
  const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

  try {
    // SHP 업로드 잔여 임시 테이블은 DROP만 수행 (정의·GeoServer 생성 금지)
    if (issueSet.has('temp_sync_table') || isShpSyncTempTableName(tableName)) {
      try {
        const { db } = await import('@/database/db');
        const { sql } = await import('drizzle-orm');
        await db.execute(sql.raw(`DROP TABLE IF EXISTS ${schema}."${tableName}"`));
        fixed.push('temp_sync_table');
        return { success: true, fixed, errors };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, fixed, errors: [msg], error: msg };
      }
    }

    // 레이어 설정 스키마와 DB 스키마가 다르면: 정의 스키마로 이동, 또는 잔여 DROP
    if (issueSet.has('schema_mismatch')) {
      let targetSchema: 'layer' | 'public_layer' | undefined =
        params.defineSchema === 'public_layer' || params.defineSchema === 'layer'
          ? params.defineSchema
          : undefined;
      if (!targetSchema) {
        const defineRes = await getDefineLayerTables();
        const row = defineRes.success
          ? defineRes.tables?.find(
              (r) =>
                String((r as Record<string, unknown>).define_table_name ?? '')
                  .trim()
                  .toLowerCase() === tableName.toLowerCase()
            )
          : undefined;
        targetSchema = row
          ? normalizeLayerSchema((row as Record<string, unknown>).define_table_schema)
          : undefined;
      }
      if (!targetSchema || targetSchema === schema) {
        errors.push('정의 스키마를 확인할 수 없거나 이미 동일합니다.');
      } else {
        try {
          const { db } = await import('@/database/db');
          const { sql } = await import('drizzle-orm');
          const existsRes = await db.execute(
            sql.raw(
              `SELECT 1 FROM information_schema.tables
               WHERE table_schema = '${targetSchema}' AND table_name = '${tableName.replace(/'/g, "''")}'
               LIMIT 1`
            )
          );
          const targetExists = (existsRes.rows?.length ?? 0) > 0;
          const action: 'move' | 'drop' =
            params.schemaMismatchAction === 'move' || params.schemaMismatchAction === 'drop'
              ? params.schemaMismatchAction
              : targetExists
                ? 'drop'
                : 'move';

          if (action === 'drop') {
            // 정의 스키마에 정상본이 있을 때만 잘못된 스키마 잔여 삭제
            if (!targetExists) {
              errors.push(
                `정의 스키마(${targetSchema})에 '${tableName}'이(가) 없어 잔여를 삭제할 수 없습니다.`
              );
            } else {
              await db.execute(
                sql.raw(`DROP TABLE IF EXISTS ${schema}.${quoteIdent(tableName)}`)
              );
              fixed.push('schema_mismatch');
              return { success: true, fixed, errors };
            }
          } else if (targetExists) {
            errors.push(
              `대상 스키마(${targetSchema})에 '${tableName}'이(가) 이미 있어 이동할 수 없습니다.`
            );
          } else {
            await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${targetSchema}`));
            await db.execute(
              sql.raw(
                `ALTER TABLE ${schema}.${quoteIdent(tableName)} SET SCHEMA ${targetSchema}`
              )
            );
            fixed.push('schema_mismatch');
            schema = targetSchema;
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`스키마 불일치 수정 실패: ${msg}`);
        }
      }
      // 스키마 처리 실패 시 이후 단계는 잘못된 스키마로 동작할 수 있어 중단
      if (errors.length > 0) {
        return {
          success: false,
          fixed,
          errors,
          error: errors.join(' | '),
        };
      }
    }

    if (issueSet.has('define_layer') || issueSet.has('define_field')) {
      const { createDefineTableAndFieldsByTableName } = await import('./shpUploadService');
      const geom =
        params.geometryType && VALID_GEOMETRY_TYPES.has(params.geometryType.toUpperCase())
          ? (params.geometryType.toUpperCase() as 'POINT' | 'LINE' | 'POLYGON')
          : undefined;
      const defRes = await createDefineTableAndFieldsByTableName({
        tableName,
        dbSchema: schema,
        geometryType: geom,
        group: params.group?.trim() || undefined,
      });
      if (!defRes.success) {
        errors.push(defRes.error ?? '레이어/필드 정의 생성 실패');
      } else {
        if (issueSet.has('define_layer')) fixed.push('define_layer');
        if (issueSet.has('define_field')) fixed.push('define_field');
      }
    }

    if (issueSet.has('define_code')) {
      let codeFields = params.missingCodeFields ?? [];
      if (codeFields.length === 0) {
        const fields = readDefineFieldsFile(tableName);
        codeFields = fields
          .filter((f) => String(f.define_field_type ?? '').toUpperCase() === 'CODE')
          .map((f) => String(f.define_field_name ?? '').trim())
          .filter((name) => name && readDefineCodesFile(tableName, name).length === 0);
      }
      for (const fieldName of codeFields) {
        const codeRes = await syncDefineCodesFromDb({ schema, tableName, fieldName });
        if (!codeRes.success) errors.push(`${fieldName}: ${codeRes.error ?? '코드 생성 실패'}`);
      }
      if (codeFields.length > 0 && errors.length === 0) fixed.push('define_code');
    }

    if (issueSet.has('geoserver_layer')) {
      const layerRes = await createOrUpdateGeoServerLayer({
        layerName: tableName,
        url: baseUrl,
      });
      if (!layerRes.success) errors.push(layerRes.error ?? 'GeoServer 레이어 생성 실패');
      else fixed.push('geoserver_layer');
    }

    if (issueSet.has('geoserver_style')) {
      const styleRes = await applyDefaultStyleToLayer({
        layerName: tableName,
        url: baseUrl,
      });
      if (!styleRes.success) errors.push(styleRes.error ?? 'GeoServer 스타일 생성 실패');
      else fixed.push('geoserver_style');
    }

    return {
      success: errors.length === 0,
      fixed,
      errors,
      error: errors.length ? errors.join(' | ') : undefined,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, fixed, errors: [...errors, msg], error: msg };
  }
}
