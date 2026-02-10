/**
 * DevTest Service
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { spawn } from 'node:child_process';
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

/**
 * GeoServer 실행 (백그라운드로 시작)
 */
export async function startGeoServer() {
  if (process.platform !== 'win32') {
    return { success: false, error: 'GeoServer start is supported on Windows only.' };
  }

  const projectRoot = process.cwd();
  const scriptPath = path.join(projectRoot, 'geoserver_modules', 'scripts', 'start-geoserver.bat');
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `스크립트 없음: ${scriptPath} (cwd: ${projectRoot})` };
  }

  return new Promise<{ success: boolean; error?: string }>((resolve) => {
    const chunks: { out: string[]; err: string[] } = { out: [], err: [] };

    const child = spawn('cmd.exe', ['/c', scriptPath], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: projectRoot,
    });

    child.stdout?.on('data', (d: Buffer) => chunks.out.push(d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => chunks.err.push(d.toString('utf8')));

    const finish = (ok: boolean, err?: string) => {
      child.removeAllListeners();
      resolve(ok ? { success: true } : { success: false, error: err });
    };

    child.on('close', (code) => {
      if (code !== 0) {
        const errText = chunks.err.join('').trim() || chunks.out.join('').trim();
        finish(false, errText || `스크립트 종료 코드: ${code}`);
      } else {
        finish(true);
      }
    });

    child.on('error', (e) => finish(false, e.message));
    child.unref();

    // 스크립트가 빠르게 끝나지 않으면 성공으로 간주 (java 프로세스 시작됨)
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        finish(true);
      }
    }, 3000);
  });
}

/**
 * GeoServer 종료
 */
export async function stopGeoServer() {
  if (process.platform !== 'win32') {
    return { success: false, error: 'GeoServer stop is supported on Windows only.' };
  }

  const projectRoot = process.cwd();
  const scriptPath = path.join(projectRoot, 'geoserver_modules', 'scripts', 'stop-geoserver.bat');
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `스크립트 없음: ${scriptPath} (cwd: ${projectRoot})` };
  }

  return new Promise<{ success: boolean; error?: string; output?: string }>((resolve) => {
    const chunks: { out: string[]; err: string[] } = { out: [], err: [] };

    const child = spawn('cmd.exe', ['/c', scriptPath], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: projectRoot,
    });

    child.stdout?.on('data', (d: Buffer) => chunks.out.push(d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => chunks.err.push(d.toString('utf8')));

    const getOutput = () => [chunks.out.join(''), chunks.err.join('')].filter(Boolean).join('\n').trim();

    child.on('close', (code) => {
      const output = getOutput();
      resolve(code === 0 ? { success: true, output } : { success: false, error: output || `종료 코드: ${code}`, output });
    });

    child.on('error', (e) => resolve({ success: false, error: e.message }));
  });
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
  const datastoreName = params?.datastoreName?.trim() || 'postgres';
  const db = getDbConfig();

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

    const dataStoreBody = {
      dataStore: {
        name: datastoreName,
        type: 'PostGIS',
        enabled: true,
        connectionParameters: {
          entry: [
            { '@key': 'host', $: String(db.host) },
            { '@key': 'port', $: String(db.port) },
            { '@key': 'database', $: db.database },
            { '@key': 'schema', $: db.schema },
            { '@key': 'user', $: db.user },
            { '@key': 'passwd', $: db.password },
          ],
        },
      },
    };

    const dsRes = await geoserverFetch(
      baseUrl,
      `/rest/workspaces/${workspace}/datastores.json`,
      { method: 'POST', body: JSON.stringify(dataStoreBody) }
    );
    if (!dsRes.ok) {
      const text = await dsRes.text();
      return { success: false, error: `데이터 스토어 생성 실패: ${dsRes.status} ${text}` };
    }
    return { success: true, workspace, datastoreName };
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
  const datastoreName = params?.datastoreName?.trim() || 'postgres';

  try {
    const dsRes = await geoserverFetch(
      baseUrl,
      `/rest/workspaces/${workspace}/datastores/${datastoreName}.json`
    );
    if (!dsRes.ok) {
      const text = await dsRes.text();
      return { success: false, error: `데이터 스토어 조회 실패: ${dsRes.status} ${text}` };
    }
    const datastore = await dsRes.json();

    const ftRes = await geoserverFetch(
      baseUrl,
      `/rest/workspaces/${workspace}/datastores/${datastoreName}/featuretypes.json`
    );
    if (!ftRes.ok) {
      const text = await ftRes.text();
      return {
        success: true,
        datastore,
        error: `Feature types 조회 실패: ${ftRes.status} ${text}`,
        featureTypes: [],
      };
    }
    const ftData = await ftRes.json();
    const raw = ftData?.featureTypes?.featureType ?? ftData?.featureTypes;
    const featureTypes = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return { success: true, datastore, featureTypes };
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

/**
 * layer, public 스키마의 geometry 테이블 목록 조회
 */
export async function getLayerTableList() {
  try {
    const result = await db.execute(
      sql`
        SELECT f_table_schema, f_table_name, f_geometry_column
        FROM geometry_columns
        WHERE f_table_schema IN ('layer', 'public')
        ORDER BY f_table_schema, f_table_name
      `
    );
    const tables = (result.rows as Array<{
      f_table_schema: string;
      f_table_name: string;
      f_geometry_column: string;
    }>).map((r) => ({
      schema: r.f_table_schema,
      table: r.f_table_name,
      geometryColumn: r.f_geometry_column,
    }));
    return { success: true, tables };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg, tables: [] };
  }
}

/**
 * GeoServer 레이어 생성 (layer, public 스키마의 geometry 테이블 → feature type)
 */
export async function createGeoServerLayers(params: {
  url?: string;
  workspace?: string;
} = {}) {
  const baseUrl = params?.url?.trim() || GEOSERVER_DEFAULT_URL;
  const workspace = params?.workspace?.trim() || 'ggnr';

  try {
    const listRes = await getLayerTableList();
    if (!listRes.success || !listRes.tables?.length) {
      return {
        success: false,
        error: listRes.error ?? 'geometry 테이블이 없습니다.',
        created: [],
        failed: [],
      };
    }

    const dbConfig = getDbConfig();
    const created: Array<{ schema: string; table: string }> = [];
    const failed: Array<{ schema: string; table: string; error: string }> = [];

    for (const t of listRes.tables) {
      const datastoreName = t.schema === 'layer' ? 'postgres_layer' : 'postgres';
      const featureName = t.table;

      const dsRes = await geoserverFetch(
        baseUrl,
        `/rest/workspaces/${workspace}/datastores/${datastoreName}.json`
      );
      if (!dsRes.ok && dsRes.status === 404) {
        const dsBody = {
          dataStore: {
            name: datastoreName,
            type: 'PostGIS',
            enabled: true,
            connectionParameters: {
              entry: [
                { '@key': 'host', $: String(dbConfig.host) },
                { '@key': 'port', $: String(dbConfig.port) },
                { '@key': 'database', $: dbConfig.database },
                { '@key': 'schema', $: t.schema },
                { '@key': 'user', $: dbConfig.user },
                { '@key': 'passwd', $: dbConfig.password },
              ],
            },
          },
        };
        const createDsRes = await geoserverFetch(
          baseUrl,
          `/rest/workspaces/${workspace}/datastores.json`,
          { method: 'POST', body: JSON.stringify(dsBody) }
        );
        if (!createDsRes.ok) {
          const text = await createDsRes.text();
          failed.push({ schema: t.schema, table: t.table, error: `데이터 스토어 생성 실패: ${text}` });
          continue;
        }
      } else if (!dsRes.ok) {
        failed.push({ schema: t.schema, table: t.table, error: `데이터 스토어 조회 실패: ${dsRes.status}` });
        continue;
      }

      const ftBody = {
        featureType: {
          name: featureName,
          nativeName: t.table,
          enabled: true,
          srs: 'EPSG:5181',
        },
      };

      const ftRes = await geoserverFetch(
        baseUrl,
        `/rest/workspaces/${workspace}/datastores/${datastoreName}/featuretypes.json`,
        { method: 'POST', body: JSON.stringify(ftBody) }
      );

      if (ftRes.ok || ftRes.status === 409) {
        created.push({ schema: t.schema, table: t.table });
      } else {
        const text = await ftRes.text();
        failed.push({ schema: t.schema, table: t.table, error: `${ftRes.status} ${text}` });
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
      return { success: true };
    }
    const text = await postRes.text();
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
      const text = await putRes.text();
      return { success: false, error: `스타일 수정 실패: ${putRes.status} ${text}` };
    }
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

type DefineLayerRow = {
  define_table_name?: string;
  define_table_shp_type?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
  define_table_idx?: string | number;
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
    return { success: true, tables: sortDefineLayerTables(tables) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg, tables: [] };
  }
}

const VALID_GEOMETRY_TYPES = new Set<string>(['POINT', 'LINE', 'POLYGON']);

/**
 * GeoServer 레이어 목록: 전체 레이어 목록은 tables.json(defineLayer) 기준으로 조회.
 * 도형 타입·제목은 tables.json, 스타일 보유 여부·layerType은 GeoServer에서 조회.
 */
export async function getGeoServerLayersWithStyleInfo(params: {
  url?: string;
  workspace?: string;
} = {}) {
  const baseUrl = (params?.url ?? GEOSERVER_DEFAULT_URL).replace(/\/$/, '');
  const workspace = params?.workspace?.trim() || 'ggnr';

  try {
    const defineRes = await getDefineLayerTables();
    if (!defineRes.success || !defineRes.tables?.length) {
      return { success: true, layers: [] as GeoServerLayerWithStyle[] };
    }

    const dbTableRes = await getLayerTableList();
    const dbLayerTableSet = new Set<string>(
      (dbTableRes.tables ?? [])
        .filter((t) => t.schema === 'layer')
        .map((t) => t.table)
    );

    const layers: GeoServerLayerWithStyle[] = [];

    for (const row of defineRes.tables) {
      const layerName = String(row.define_table_name ?? '').trim();
      if (!layerName) continue;

      const shpType = String(row.define_table_shp_type ?? '').toUpperCase();
      const geometryType = VALID_GEOMETRY_TYPES.has(shpType)
        ? (shpType as GeometryType)
        : undefined;
      const title = String(row.define_table_kor_name ?? '').trim() || undefined;
      const group = String(row.define_table_group ?? '').trim() || undefined;

      const layerRes = await geoserverFetch(
        baseUrl,
        `/rest/workspaces/${workspace}/layers/${encodeURIComponent(layerName)}.json`
      );
      const tableExists = dbLayerTableSet.has(layerName);

      if (!layerRes.ok) {
        layers.push({
          name: layerName,
          group,
          tableExists,
          published: false,
          hasCssStyle: false,
          geometryType,
          title,
        });
        continue;
      }
      const layerData = await layerRes.json();
      const layerObj = layerData?.layer ?? layerData;
      const layerType = layerObj?.type ?? undefined;

      const styleName =
        layerData?.layer?.defaultStyle?.name ?? layerData?.defaultStyle?.name;
      if (!styleName) {
        layers.push({
          name: layerName,
          group,
          tableExists,
          published: true,
          hasCssStyle: false,
          geometryType,
          layerType,
          title,
        });
        continue;
      }
      const styleRes = await geoserverFetch(
        baseUrl,
        `/rest/styles/${encodeURIComponent(styleName)}.json`
      );
      if (!styleRes.ok) {
        layers.push({
          name: layerName,
          group,
          tableExists,
          published: true,
          styleName,
          hasCssStyle: false,
          geometryType,
          layerType,
          title,
        });
        continue;
      }
      const styleData = await styleRes.json();
      const format = (styleData?.style?.format ?? styleData?.format ?? 'sld').toLowerCase();
      const hasCssStyle = format === 'css';
      layers.push({
        name: layerName,
        group,
        tableExists,
        published: true,
        styleName,
        hasCssStyle,
        geometryType,
        layerType,
        title,
      });
    }

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
  const layerName = params?.layerName?.trim();
  if (!layerName) return { success: false, error: '레이어 이름이 필요합니다.' };

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
      const geomRes = await getLayerGeometryType({
        url: baseUrl,
        workspace,
        layerName: layer.name,
      });
      const geometryType = geomRes.geometryType ?? 'POLYGON';
      const color = getMaterialToneColor(i);
      let styleProps: StyleProps;

      if (geometryType === 'POINT') {
        styleProps = {
          fillColor: color,
          strokeColor: '#FFFFFF',
          strokeWidth: 1.5,
          opacity: 1,
          size: 10,
        };
      } else if (geometryType === 'LINE') {
        styleProps = {
          strokeColor: color,
          strokeWidth: 2,
          opacity: 1,
        };
      } else {
        styleProps = {
          fillColor: color,
          strokeColor: darkerHex(color, 0.55),
          strokeWidth: 1,
          opacity: 0.5,
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
  const layerName = params?.layerName?.trim();
  if (!layerName) return { success: false, error: '레이어 이름이 필요합니다.' };

  try {
    const geomRes = await getLayerGeometryType({ url: baseUrl, workspace, layerName });
    const geometryType = geomRes.geometryType ?? 'POLYGON';
    const hash = layerName.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    const color = getMaterialToneColor(hash);
    let styleProps: StyleProps;

    if (geometryType === 'POINT') {
      styleProps = {
        fillColor: color,
        strokeColor: '#FFFFFF',
        strokeWidth: 1.5,
        opacity: 1,
        size: 10,
      };
    } else if (geometryType === 'LINE') {
      styleProps = {
        strokeColor: color,
        strokeWidth: 2,
        opacity: 1,
      };
    } else {
      styleProps = {
        fillColor: color,
        strokeColor: darkerHex(color, 0.55),
        strokeWidth: 1,
        opacity: 0.5,
      };
    }

    const createRes = await createGeoServerStyle({
      url: baseUrl,
      name: layerName,
      geometryType,
      styleProps,
    });
    if (!createRes.success) {
      const styleRes = await geoserverFetch(baseUrl, `/rest/styles/${encodeURIComponent(layerName)}.css`, {
        accept: 'text/css',
      });
      if (styleRes.ok) {
        const cssBody = buildCssFromSimpleStyle(geometryType, styleProps);
        const putRes = await geoserverFetch(baseUrl, `/rest/styles/${encodeURIComponent(layerName)}`, {
          method: 'PUT',
          body: cssBody,
          contentType: 'application/vnd.geoserver.geocss+css',
        });
        if (!putRes.ok) return { success: false, error: '스타일 수정 실패' };
      } else return { success: false, error: createRes.error ?? '스타일 생성 실패' };
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
const EMD_RI_NAME_COLUMNS = ['adm_nm', 'name', 'emd_nm', 'ri_nm'];

export type EmdRiOption = { code: string; name: string };

/**
 * 읍면동(emd) 목록 조회. emd_cd, 이름 반환. ORDER BY gid 만 적용.
 */
export async function getEmdRiOptions(params: { schema?: string } = {}) {
  const schema = (params?.schema ?? EMD_RI_SCHEMA).trim() || EMD_RI_SCHEMA;
  const result: { emd: EmdRiOption[]; error?: string } = { emd: [] };

  for (const nameCol of EMD_RI_NAME_COLUMNS) {
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
      break;
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
  for (const nameCol of EMD_RI_NAME_COLUMNS) {
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
      break;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      result.error = msg;
      continue;
    }
  }

  return result;
}

const DATA_SELECT_SCHEMA = 'public_layer';

/**
 * 데이터 선택용 테이블 목록 (스키마 내 테이블명)
 */
export async function getDataSelectTableList(params: { schema?: string } = {}) {
  const schema = (params?.schema ?? DATA_SELECT_SCHEMA).trim() || DATA_SELECT_SCHEMA;
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT table_name AS name FROM information_schema.tables
         WHERE table_schema = '${schema.replace(/'/g, "''")}' AND table_type = 'BASE TABLE'
         ORDER BY table_name`
      )
    );
    return { tables: (res.rows as { name: string }[]).map((r) => String(r?.name ?? '').trim()).filter(Boolean) };
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
