/**
 * StandardList용 서비스 (레이어 목록/테이블 데이터)
 * schema 파라미터로 layer / public_layer 구분 (기본값 layer)
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_SCHEMA = 'layer';
const ALLOWED_SCHEMAS = new Set(['layer', 'public_layer']);
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

function resolveSchema(raw?: string): string {
  const s = String(raw ?? '').trim() || DEFAULT_SCHEMA;
  return ALLOWED_SCHEMAS.has(s) ? s : DEFAULT_SCHEMA;
}

/**
 * 테이블 이름과 스키마로 행 조회.
 * spatialWkt/spatialSrid가 있으면 도형 내 데이터만 조회 (ST_Intersects).
 */
export async function getTableData(params: {
  table: string;
  schema?: string;
  limit?: number;
  offset?: number;
  spatialWkt?: string;
  spatialSrid?: number;
} = { table: '' }) {
  const table = String(params?.table ?? '').trim().toLowerCase();
  if (!table) return { rows: [], total: 0 };

  const schema = resolveSchema(params?.schema).toLowerCase();
  let limit = typeof params?.limit === 'number' && params.limit > 0 ? params.limit : DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  const offset = typeof params?.offset === 'number' && params.offset >= 0 ? params.offset : 0;
  const spatialWkt = typeof params?.spatialWkt === 'string' ? params.spatialWkt.trim() : '';
  const spatialSrid = typeof params?.spatialSrid === 'number' ? params.spatialSrid : 5181;

  const safeSchema = schema.replace(/"/g, '""');
  const safeTable = table.replace(/"/g, '""');
  const esc = (s: string) => s.replace(/'/g, "''");

  try {
    const colRes = await db.execute(
      sql.raw(
        `SELECT column_name AS name FROM information_schema.columns
         WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(table)}'
         ORDER BY ordinal_position`
      )
    );
    const columns = (colRes.rows as { name: string }[]).map((r) => String(r?.name ?? '').trim()).filter(Boolean);
    if (columns.length === 0) return { rows: [], total: 0 };

    let geomCol: string | null = null;
    let tableSrid = 4326;
    try {
      const gcRes = await db.execute(
        sql.raw(
          `SELECT f_geometry_column AS name, srid FROM geometry_columns
           WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(table)}'
           LIMIT 1`
        )
      );
      const gcRow = gcRes.rows?.[0] as { name?: string; srid?: number } | undefined;
      if (gcRow?.name) {
        geomCol = String(gcRow.name).trim();
        tableSrid = gcRow.srid ?? 4326;
      }
    } catch {
      // no geometry column
    }

    const safeGeomCol = geomCol ? geomCol.replace(/"/g, '""') : '';
    const selectList = columns
      .map((c) => {
        if (geomCol && c === geomCol) {
          return `ST_AsGeoJSON(ST_Transform("${safeGeomCol}", 4326))::json AS "${safeGeomCol}"`;
        }
        return `"${c.replace(/"/g, '""')}"`;
      })
      .join(', ');

    const whereClause =
      spatialWkt && geomCol
        ? (() => {
            const geomFromText = `ST_GeomFromText('${spatialWkt.replace(/'/g, "''")}', ${spatialSrid})`;
            const searchGeom =
              tableSrid !== spatialSrid ? `ST_Transform(${geomFromText}, ${tableSrid})` : geomFromText;
            return ` WHERE ST_Intersects("${safeGeomCol}", ${searchGeom})`;
          })()
        : '';

    const [countRes, dataRes] = await Promise.all([
      db.execute(
        sql.raw(`SELECT COUNT(*) AS total FROM "${safeSchema}"."${safeTable}"${whereClause}`)
      ),
      db.execute(
        sql.raw(
          `SELECT ${selectList} FROM "${safeSchema}"."${safeTable}"${whereClause} LIMIT ${limit} OFFSET ${offset}`
        )
      ),
    ]);

    const totalRow = countRes.rows?.[0] as { total?: string | number } | undefined;
    const total =
      totalRow?.total != null ? Math.max(0, parseInt(String(totalRow.total), 10) || 0) : 0;
    const rows = (dataRes.rows ?? []) as Record<string, unknown>[];
    return { rows, total };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { rows: [], total: 0, error: msg };
  }
}

const FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');

/** 테이블 필드 설정에서 define_field_is_key === 'true' 인 필드명 반환 */
function getKeyFieldName(tableName: string): string | null {
  const safe = tableName.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fs.existsSync(filePath)) return null;
    const fields: Record<string, string>[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const keyField = Array.isArray(fields) ? fields.find((f) => String(f?.define_field_is_key ?? '').toLowerCase() === 'true') : null;
    return keyField ? String(keyField.define_field_name ?? '').trim() || null : null;
  } catch {
    return null;
  }
}

/**
 * 키 값으로 테이블에서 단일 행 조회 (URL dataKey 복원용).
 * 데이터 설정(define_field_is_key)에 지정된 키 필드로만 조회.
 */
export async function getTableRowByKey(params: {
  table: string;
  schema?: string;
  keyValue: string | number;
}) {
  const table = String(params?.table ?? '').trim().toLowerCase();
  if (!table) return { row: null };
  const schema = resolveSchema(params?.schema).toLowerCase();
  const keyValue = params?.keyValue;
  if (keyValue == null || keyValue === '') return { row: null };

  const keyFieldName = getKeyFieldName(params?.table?.trim() || table);
  if (!keyFieldName) return { row: null };

  const safeSchema = schema.replace(/"/g, '""');
  const safeTable = table.replace(/"/g, '""');
  const escapedKey = String(keyValue).replace(/'/g, "''");
  const safeKeyCol = keyFieldName.replace(/"/g, '""');
  const esc = (s: string) => s.replace(/'/g, "''");

  try {
    const colRes = await db.execute(
      sql.raw(
        `SELECT column_name AS name FROM information_schema.columns
         WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(table)}'
         ORDER BY ordinal_position`
      )
    );
    const columns = (colRes.rows as { name: string }[]).map((r) => String(r?.name ?? '').trim()).filter(Boolean);
    if (columns.length === 0 || !columns.includes(keyFieldName)) return { row: null };

    let geomCol: string | null = null;
    try {
      const gcRes = await db.execute(
        sql.raw(
          `SELECT f_geometry_column AS name FROM geometry_columns
           WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(table)}'
           LIMIT 1`
        )
      );
      const gcRow = gcRes.rows?.[0] as { name?: string } | undefined;
      if (gcRow?.name) geomCol = String(gcRow.name).trim();
    } catch {
      // no geometry column
    }

    const safeGeomCol = geomCol ? geomCol.replace(/"/g, '""') : '';
    const selectList = columns
      .map((c) => {
        if (geomCol && c === geomCol) {
          return `ST_AsGeoJSON(ST_Transform("${safeGeomCol}", 4326))::json AS "${safeGeomCol}"`;
        }
        return `"${c.replace(/"/g, '""')}"`;
      })
      .join(', ');

    const dataRes = await db.execute(
      sql.raw(
        `SELECT ${selectList} FROM "${safeSchema}"."${safeTable}" WHERE "${safeKeyCol}" = '${escapedKey}' LIMIT 1`
      )
    );
    const row = (dataRes.rows?.[0] ?? null) as Record<string, unknown> | null;
    return { row };
  } catch {
    return { row: null };
  }
}
const TABLES_JSON_PATH = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'tables.json');

let _tablesJsonCache: Record<string, unknown>[] | null = null;
function getTablesJson(): Record<string, unknown>[] {
  if (_tablesJsonCache) return _tablesJsonCache;
  try {
    _tablesJsonCache = JSON.parse(fs.readFileSync(TABLES_JSON_PATH, 'utf-8'));
  } catch { _tablesJsonCache = []; }
  return _tablesJsonCache!;
}

function getTitleFieldName(tableName: string): string | null {
  const safe = tableName.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fs.existsSync(filePath)) return null;
    const fields: Record<string, string>[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const titleField = fields.find((f) => f.define_field_show_title === 'true');
    return titleField ? String(titleField.define_field_name ?? '') : null;
  } catch { return null; }
}

function getTableKorName(tableName: string): string {
  const tables = getTablesJson();
  const row = tables.find((r) => String(r.define_table_name ?? '') === tableName);
  return row ? String(row.define_table_kor_name ?? tableName) : tableName;
}

/** identifyFeatures용 테이블 메타 캐시 (schema.table → geomCol, tableSrid, columns). 동일 테이블 재조회 시 메타 쿼리 2회 생략. */
const identifyTableMetaCache = new Map<
  string,
  { geomCol: string; tableSrid: number; columns: string[] }
>();

/**
 * 클릭 좌표 기준으로 여러 테이블에서 교차 도형을 검색.
 * params.x, params.y: 클릭 좌표 (EPSG:3857)
 * params.buffer: 버퍼 크기 (미터 단위, 기본 10)
 * params.tables: 검색할 테이블 이름 배열
 * params.srid: 좌표 SRID (기본 3857)
 */
export async function identifyFeatures(params: {
  x: number;
  y: number;
  buffer?: number;
  tables: string[];
  srid?: number;
  schema?: string;
}) {
  const { x, y, tables, srid = 3857 } = params;
  const buffer = typeof params.buffer === 'number' && params.buffer >= 0 ? params.buffer : 10;
  const schema = resolveSchema(params.schema).toLowerCase();

  if (!Array.isArray(tables) || tables.length === 0) return { results: [] };
  if (typeof x !== 'number' || typeof y !== 'number') return { results: [] };

  // 지도 클릭 데이터 목록 로그 (서버)
  console.log(
    `[FeatureIdentify] buffer=${buffer > 0 ? `${buffer.toFixed(1)}m` : '없음'} — 클릭 좌표 (${x.toFixed(1)}, ${y.toFixed(1)}) — ${tables.length}개 레이어 검색 중...`
  );

  const safeSchema = schema.replace(/"/g, '""');
  const esc = (s: string) => s.replace(/'/g, "''");
  const results: {
    tableName: string;
    korName: string;
    titleField: string | null;
    features: { titleValue: string; data: Record<string, unknown> }[];
  }[] = [];
  const queries: string[] = [];

  await Promise.all(
    tables.map(async (tableName) => {
      const tableLower = String(tableName).trim().toLowerCase();
      const safeTable = tableLower.replace(/"/g, '""');
      if (!safeTable) return;

      const cacheKey = `${schema}.${tableLower}`;
      let geomCol: string;
      let tableSrid: number;
      let columns: string[];

      try {
        const cached = identifyTableMetaCache.get(cacheKey);
        if (cached) {
          geomCol = cached.geomCol;
          tableSrid = cached.tableSrid;
          columns = cached.columns;
        } else {
          const gcRes = await db.execute(
            sql.raw(
              `SELECT f_geometry_column AS name, srid FROM geometry_columns
               WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(tableLower)}'
               LIMIT 1`
            )
          );
          const gcRow = gcRes.rows?.[0] as { name?: string; srid?: number } | undefined;
          if (!gcRow?.name) return;
          geomCol = String(gcRow.name).trim();
          tableSrid = gcRow.srid ?? 4326;

          const colRes = await db.execute(
            sql.raw(
              `SELECT column_name AS name FROM information_schema.columns
               WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(tableLower)}'
               ORDER BY ordinal_position`
            )
          );
          columns = (colRes.rows as { name: string }[]).map((r) => String(r?.name ?? '').trim()).filter(Boolean);
          if (columns.length === 0) return;
          identifyTableMetaCache.set(cacheKey, { geomCol, tableSrid, columns });
        }

        const safeGeomCol = geomCol.replace(/"/g, '""');
        const point = `ST_SetSRID(ST_MakePoint(${x}, ${y}), ${srid})`;
        const transformed = tableSrid !== srid
          ? `ST_Transform(${point}, ${tableSrid})`
          : point;
        const searchGeom = buffer > 0 ? `ST_Buffer(${transformed}, ${buffer})` : transformed;

        const selectList = columns
          .map((c) => {
            if (c === geomCol) return `ST_AsGeoJSON(ST_Transform("${safeGeomCol}", 4326))::json AS "${safeGeomCol}"`;
            return `"${c.replace(/"/g, '""')}"`;
          })
          .join(', ');

        const queryStr = `SELECT ${selectList} FROM "${safeSchema}"."${safeTable}" WHERE ST_Intersects("${safeGeomCol}", ${searchGeom}) LIMIT 50`;
        queries.push(`[${tableName} (SRID:${tableSrid})] ${queryStr}`);

        const dataRes = await db.execute(sql.raw(queryStr));
        const rawFeatures = (dataRes.rows ?? []) as Record<string, unknown>[];
        if (rawFeatures.length > 0) {
          const korName = getTableKorName(tableName);
          const titleField = getTitleFieldName(tableName);
          const nonGeomCols = columns.filter((c) => c !== geomCol);
          const features = rawFeatures.map((row) => {
            let titleValue = '';
            if (titleField) {
              const key = Object.keys(row).find((k) => k.toLowerCase() === titleField.toLowerCase());
              titleValue = key ? String(row[key] ?? '') : '';
            }
            if (!titleValue && nonGeomCols.length > 0) {
              const fallback = Object.keys(row).find((k) => k.toLowerCase() === nonGeomCols[0].toLowerCase());
              titleValue = fallback ? String(row[fallback] ?? '') : '';
            }
            return { titleValue, data: row };
          });
          results.push({ tableName, korName, titleField, features });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        queries.push(`[${tableName}] ERROR: ${msg}`);
      }
    })
  );

  // 결과 요약 로그 (서버, 쿼리/결과는 위 루프에서 logQueryAndResult로 출력됨)
  if (results.length > 0) {
    const total = results.reduce((s, r) => s + r.features.length, 0);
    console.log(`[FeatureIdentify] ${total}건 발견 (${results.length}개 레이어)`);
    for (const r of results) {
      console.log(`[FeatureIdentify]   └ ${r.tableName}: ${r.features.length}건`);
    }
  } else {
    console.log('[FeatureIdentify] 해당 위치에 도형 없음');
  }

  return { results, queries };
}

/**
 * 주소정보 패널용: public_layer.jijuk에서 클릭 좌표(3857) 포함 필지 1건 조회.
 * 테이블/스키마/컬럼(geom)/좌표계(5181) 고정, 쿼리 1회만 실행.
 */
export async function getJijukParcelAtPoint(params: { x: number; y: number }) {
  const { x, y } = params;
  if (typeof x !== 'number' || typeof y !== 'number') return { results: [] };

  const schema = 'public_layer';
  const tableName = 'jijuk';
  const geomCol = 'geom';
  const tableSrid = 5181;
  const srid = 3857;

  const point = `ST_SetSRID(ST_MakePoint(${x}, ${y}), ${srid})`;
  const pointInTable = `ST_Transform(${point}, ${tableSrid})`;
  const queryStr = `SELECT "gid", "pnu", "jibun", "bchk", ST_AsGeoJSON(ST_Transform("${geomCol}", 4326))::json AS "${geomCol}" FROM "${schema}"."${tableName}" WHERE ST_Intersects("${geomCol}", ${pointInTable}) LIMIT 50`;

  try {
    const dataRes = await db.execute(sql.raw(queryStr));
    const rawFeatures = (dataRes.rows ?? []) as Record<string, unknown>[];
    const korName = getTableKorName(tableName);
    const titleField = getTitleFieldName(tableName);
    const features = rawFeatures.map((row) => {
      let titleValue = '';
      if (titleField) {
        const key = Object.keys(row).find((k) => k.toLowerCase() === titleField.toLowerCase());
        titleValue = key ? String(row[key] ?? '') : '';
      }
      if (!titleValue) {
        const fallback = Object.keys(row).find((k) => k.toLowerCase() === 'jibun');
        titleValue = fallback ? String(row[fallback] ?? '') : '';
      }
      return { titleValue, data: row };
    });
    return {
      results: rawFeatures.length > 0 ? [{ tableName, korName, titleField, features }] : [],
    };
  } catch {
    return { results: [] };
  }
}

/**
 * 도형(WKT) 내에 포함된 레이어별 건수 조회.
 * 레이어 목록 도형(사각형/다각형/원형) 그리기 후, 해당 도형과 교차하는 레이어만 반환.
 * params.wkt: WKT 문자열 (SRID는 params.srid)
 * params.srid: WKT 좌표계 (기본 5181). 지도에서 3857로 그렸다면 클라이언트에서 5181로 변환 후 전달 권장.
 * params.tables: 검색할 테이블 이름 배열
 * params.schema: 스키마 (기본 layer)
 */
export async function getLayersInGeometry(params: {
  wkt: string;
  srid?: number;
  tables: string[];
  schema?: string;
}) {
  const wkt = typeof params.wkt === 'string' ? params.wkt.trim() : '';
  const srid = typeof params.srid === 'number' ? params.srid : 5181;
  const tables = Array.isArray(params.tables) ? params.tables : [];
  const schema = resolveSchema(params.schema).toLowerCase();
  const esc = (s: string) => s.replace(/'/g, "''");

  if (!wkt || tables.length === 0) return { layers: [] as { tableName: string; count: number }[] };

  const results: { tableName: string; count: number }[] = [];

  await Promise.all(
    tables.map(async (tableName) => {
      const tableLower = String(tableName).trim().toLowerCase();
      const safeTable = tableLower.replace(/"/g, '""');
      const safeSchema = schema.replace(/"/g, '""');
      if (!safeTable) return;

      try {
        const gcRes = await db.execute(
          sql.raw(
            `SELECT f_geometry_column AS name, srid FROM geometry_columns
             WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(tableLower)}'
             LIMIT 1`
          )
        );
        const gcRow = gcRes.rows?.[0] as { name?: string; srid?: number } | undefined;
        if (!gcRow?.name) return;
        const geomCol = String(gcRow.name).trim();
        const tableSrid = gcRow.srid ?? 4326;
        const safeGeomCol = geomCol.replace(/"/g, '""');

        const geomFromText = `ST_GeomFromText('${wkt.replace(/'/g, "''")}', ${srid})`;
        const searchGeom =
          tableSrid !== srid ? `ST_Transform(${geomFromText}, ${tableSrid})` : geomFromText;

        const queryStr = `SELECT COUNT(*) AS cnt FROM "${safeSchema}"."${safeTable}" WHERE ST_Intersects("${safeGeomCol}", ${searchGeom})`;
        const countRes = await db.execute(sql.raw(queryStr));
        const row = countRes.rows?.[0] as { cnt?: string | number } | undefined;
        const count = row?.cnt != null ? Math.max(0, parseInt(String(row.cnt), 10) || 0) : 0;
        if (count > 0) results.push({ tableName: tableLower, count });
      } catch {
        // skip table on error
      }
    })
  );

  return { layers: results };
}

/**
 * 테이블 전체 건수만 조회 (레이어 펼치기 전 배지 표시용)
 */
export async function getTableCount(params: { table: string; schema?: string } = { table: '' }) {
  const table = String(params?.table ?? '').trim().toLowerCase();
  if (!table) return { total: 0 };

  const schema = resolveSchema(params?.schema).toLowerCase();
  const safeSchema = schema.replace(/"/g, '""');
  const safeTable = table.replace(/"/g, '""');

  try {
    const countRes = await db.execute(
      sql.raw(`SELECT COUNT(*) AS total FROM "${safeSchema}"."${safeTable}"`)
    );
    const totalRow = countRes.rows?.[0] as { total?: string | number } | undefined;
    const total =
      totalRow?.total != null ? Math.max(0, parseInt(String(totalRow.total), 10) || 0) : 0;
    return { total };
  } catch (e: unknown) {
    return { total: 0 };
  }
}
