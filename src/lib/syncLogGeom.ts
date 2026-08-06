/**
 * sync_log / excel_sync_log 전용 geometry 테이블 헬퍼.
 * 테이블 미존재 시 silent fail.
 * JSON(sl_/esl_ data)에는 GeoJSON 통째를 두고, 전용 geom 테이블은 공간 조인·폴백용으로 병행한다.
 */

export type SyncLogGeomSide = 'old' | 'new';

export function shouldStoreFullHistoryGeom(dbSchema: string | null | undefined): boolean {
  return String(dbSchema ?? '').trim() !== 'public_layer';
}

/** layer."t" 행 → 속성 + geom(GeoJSON) jsonb SQL */
export function excelLayerRowJsonbSql(alias = 't'): string {
  const a = alias.replace(/[^a-zA-Z0-9_]/g, '') || 't';
  return `(
    (COALESCE(row_to_json(${a}.*)::jsonb, '{}'::jsonb) - 'geom')
    || CASE
         WHEN ${a}.geom IS NULL THEN '{}'::jsonb
         ELSE jsonb_build_object('geom', ST_AsGeoJSON(${a}.geom)::jsonb)
       END
  )`;
}

/**
 * excel_sync_log_geom → esl_old_data / esl_new_data.geom (GeoJSON) 반영.
 * 메타({type,hash,_meta})만 있던 자리도 좌표로 덮어쓴다.
 */
export async function syncExcelSyncLogJsonGeomFromSideTable(params: {
  tableName: string;
  ehKey?: number | null;
}): Promise<void> {
  const tableName = params.tableName.replace(/[^a-zA-Z0-9_]/g, '');
  if (!tableName) return;
  const ehKey = params.ehKey != null ? Math.trunc(Number(params.ehKey)) : null;
  const ehClause =
    ehKey != null && Number.isFinite(ehKey) && ehKey > 0
      ? `AND esl.esl_eh_key = ${ehKey}`
      : '';
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql.raw(
      `UPDATE excel_sync_log esl
       SET esl_old_data = COALESCE(esl.esl_old_data, '{}'::jsonb)
         || jsonb_build_object('geom', ST_AsGeoJSON(g.eslg_geom)::jsonb)
       FROM excel_sync_log_geom g
       WHERE g.eslg_esl_key = esl.esl_key
         AND g.eslg_side = 'old'
         AND g.eslg_geom IS NOT NULL
         AND esl.esl_table_name = '${tableName}'
         AND esl.esl_old_data IS NOT NULL
         ${ehClause}`
    ));
    await db.execute(sql.raw(
      `UPDATE excel_sync_log esl
       SET esl_new_data = COALESCE(esl.esl_new_data, '{}'::jsonb)
         || jsonb_build_object('geom', ST_AsGeoJSON(g.eslg_geom)::jsonb)
       FROM excel_sync_log_geom g
       WHERE g.eslg_esl_key = esl.esl_key
         AND g.eslg_side = 'new'
         AND g.eslg_geom IS NOT NULL
         AND esl.esl_table_name = '${tableName}'
         AND esl.esl_new_data IS NOT NULL
         ${ehClause}`
    ));
  } catch (e) {
    console.warn(
      '[syncExcelSyncLogJsonGeomFromSideTable]',
      e instanceof Error ? e.message : e
    );
  }
}

/** ST_AsGeoJSON 결과 (jsonb). 없으면 null */
export async function fetchSyncLogGeomAsGeoJson(
  slKey: number,
  side: SyncLogGeomSide,
): Promise<unknown | null> {
  if (!Number.isFinite(slKey) || slKey <= 0) return null;
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute(sql.raw(
      `SELECT ST_AsGeoJSON(slg_geom)::jsonb AS g
       FROM sync_log_geom
       WHERE slg_sl_key = ${Math.trunc(slKey)} AND slg_side = '${side}'
       LIMIT 1`
    ));
    return (res.rows as Array<{ g: unknown }>)[0]?.g ?? null;
  } catch {
    return null;
  }
}

export async function fetchExcelSyncLogGeomAsGeoJson(
  eslKey: number,
  side: SyncLogGeomSide,
): Promise<unknown | null> {
  if (!Number.isFinite(eslKey) || eslKey <= 0) return null;
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute(sql.raw(
      `SELECT ST_AsGeoJSON(eslg_geom)::jsonb AS g
       FROM excel_sync_log_geom
       WHERE eslg_esl_key = ${Math.trunc(eslKey)} AND eslg_side = '${side}'
       LIMIT 1`
    ));
    return (res.rows as Array<{ g: unknown }>)[0]?.g ?? null;
  } catch {
    return null;
  }
}

/**
 * compareShpWithTable 직후: 미결 sync_log에 대해 layer 스키마만 전용 도형 적재.
 * JSON에는 이미 GeoJSON이 들어가며, sync_log_geom은 공간 조인·폴백용.
 */
export async function fillPendingSyncLogGeoms(params: {
  tableName: string;
  dbSchema: string;
  syncTableName: string;
  matchTableName: string;
  useSpatialMatch: boolean;
  keyDb: string;
  keySync: string;
  geomDb: string;
  geomSync: string;
  fidDb: string;
  fidSync: string;
}): Promise<void> {
  if (!shouldStoreFullHistoryGeom(params.dbSchema)) return;

  const {
    tableName, dbSchema, syncTableName, matchTableName, useSpatialMatch,
    keyDb, keySync, geomDb, geomSync, fidDb, fidSync,
  } = params;
  const live = `${dbSchema}."${tableName}"`;
  const sync = `${dbSchema}."${syncTableName}"`;
  const matchFq = `${dbSchema}."${matchTableName}"`;

  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');

    // append: old=NULL, new=SHP
    if (useSpatialMatch) {
      await db.execute(sql.raw(
        `INSERT INTO sync_log_geom (slg_sl_key, slg_side, slg_geom)
         SELECT sl.sl_key, 'new', t."${geomSync}"
         FROM sync_log sl
         JOIN ${sync} t
           ON sl.sl_key_value = (t."${keySync}"::text || '#s' || t."${fidSync}"::text)
         WHERE sl.sl_table_name = '${tableName}'
           AND sl.sl_operation IS NULL
           AND sl.sl_old_data IS NULL
           AND t."${geomSync}" IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sync_log_geom g
             WHERE g.slg_sl_key = sl.sl_key AND g.slg_side = 'new'
           )
         ON CONFLICT DO NOTHING`
      ));
    } else {
      await db.execute(sql.raw(
        `INSERT INTO sync_log_geom (slg_sl_key, slg_side, slg_geom)
         SELECT sl.sl_key, 'new', t."${geomSync}"
         FROM sync_log sl
         JOIN ${sync} t ON t."${keySync}"::text = sl.sl_key_value
         WHERE sl.sl_table_name = '${tableName}'
           AND sl.sl_operation IS NULL
           AND sl.sl_old_data IS NULL
           AND t."${geomSync}" IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sync_log_geom g
             WHERE g.slg_sl_key = sl.sl_key AND g.slg_side = 'new'
           )
         ON CONFLICT DO NOTHING`
      ));
    }

    // conflict: old=DB, new=SHP
    if (useSpatialMatch) {
      await db.execute(sql.raw(
        `INSERT INTO sync_log_geom (slg_sl_key, slg_side, slg_geom)
         SELECT sl.sl_key, 'old', e."${geomDb}"
         FROM sync_log sl
         JOIN ${matchFq} p ON sl.sl_key_value = (p.key_val || '#' || p.db_fid::text)
         JOIN ${live} e ON e."${fidDb}" = p.db_fid
         WHERE sl.sl_table_name = '${tableName}'
           AND sl.sl_operation IS NULL
           AND sl.sl_old_data IS NOT NULL AND sl.sl_new_data IS NOT NULL
           AND e."${geomDb}" IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sync_log_geom g
             WHERE g.slg_sl_key = sl.sl_key AND g.slg_side = 'old'
           )
         ON CONFLICT DO NOTHING`
      ));
      await db.execute(sql.raw(
        `INSERT INTO sync_log_geom (slg_sl_key, slg_side, slg_geom)
         SELECT sl.sl_key, 'new', t."${geomSync}"
         FROM sync_log sl
         JOIN ${matchFq} p ON sl.sl_key_value = (p.key_val || '#' || p.db_fid::text)
         JOIN ${sync} t ON t."${fidSync}" = p.sync_fid
         WHERE sl.sl_table_name = '${tableName}'
           AND sl.sl_operation IS NULL
           AND sl.sl_old_data IS NOT NULL AND sl.sl_new_data IS NOT NULL
           AND t."${geomSync}" IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sync_log_geom g
             WHERE g.slg_sl_key = sl.sl_key AND g.slg_side = 'new'
           )
         ON CONFLICT DO NOTHING`
      ));
    } else {
      await db.execute(sql.raw(
        `INSERT INTO sync_log_geom (slg_sl_key, slg_side, slg_geom)
         SELECT sl.sl_key, 'old', e."${geomDb}"
         FROM sync_log sl
         JOIN ${live} e ON e."${keyDb}"::text = sl.sl_key_value
         WHERE sl.sl_table_name = '${tableName}'
           AND sl.sl_operation IS NULL
           AND sl.sl_old_data IS NOT NULL AND sl.sl_new_data IS NOT NULL
           AND e."${geomDb}" IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sync_log_geom g
             WHERE g.slg_sl_key = sl.sl_key AND g.slg_side = 'old'
           )
         ON CONFLICT DO NOTHING`
      ));
      await db.execute(sql.raw(
        `INSERT INTO sync_log_geom (slg_sl_key, slg_side, slg_geom)
         SELECT sl.sl_key, 'new', t."${geomSync}"
         FROM sync_log sl
         JOIN ${sync} t ON t."${keySync}"::text = sl.sl_key_value
         WHERE sl.sl_table_name = '${tableName}'
           AND sl.sl_operation IS NULL
           AND sl.sl_old_data IS NOT NULL AND sl.sl_new_data IS NOT NULL
           AND t."${geomSync}" IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sync_log_geom g
             WHERE g.slg_sl_key = sl.sl_key AND g.slg_side = 'new'
           )
         ON CONFLICT DO NOTHING`
      ));
    }

    // remove: old=DB, new=NULL
    if (useSpatialMatch) {
      await db.execute(sql.raw(
        `INSERT INTO sync_log_geom (slg_sl_key, slg_side, slg_geom)
         SELECT sl.sl_key, 'old', e."${geomDb}"
         FROM sync_log sl
         JOIN ${live} e ON sl.sl_key_value = (e."${keyDb}"::text || '#' || e."${fidDb}"::text)
         WHERE sl.sl_table_name = '${tableName}'
           AND sl.sl_operation IS NULL
           AND sl.sl_new_data IS NULL AND sl.sl_old_data IS NOT NULL
           AND e."${geomDb}" IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sync_log_geom g
             WHERE g.slg_sl_key = sl.sl_key AND g.slg_side = 'old'
           )
         ON CONFLICT DO NOTHING`
      ));
    } else {
      await db.execute(sql.raw(
        `INSERT INTO sync_log_geom (slg_sl_key, slg_side, slg_geom)
         SELECT sl.sl_key, 'old', e."${geomDb}"
         FROM sync_log sl
         JOIN ${live} e ON e."${keyDb}"::text = sl.sl_key_value
         WHERE sl.sl_table_name = '${tableName}'
           AND sl.sl_operation IS NULL
           AND sl.sl_new_data IS NULL AND sl.sl_old_data IS NOT NULL
           AND e."${geomDb}" IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sync_log_geom g
             WHERE g.slg_sl_key = sl.sl_key AND g.slg_side = 'old'
           )
         ON CONFLICT DO NOTHING`
      ));
    }
  } catch (e) {
    // 테이블 미생성 등 — hash/__rollback_geom 경로로 계속
    console.warn('[fillPendingSyncLogGeoms]', e instanceof Error ? e.message : e);
  }
}

/** Excel remove/conflict 로그 INSERT 직후: layer → old geom */
export async function insertExcelSyncLogGeomFromLayer(params: {
  eslKey: number;
  tableName: string;
  keyField: string;
  keyValue: string;
  side?: SyncLogGeomSide;
}): Promise<void> {
  const side = params.side ?? 'old';
  const tableName = params.tableName.replace(/[^a-zA-Z0-9_]/g, '');
  const keyField = params.keyField.replace(/[^a-zA-Z0-9_]/g, '');
  const safeKv = String(params.keyValue ?? '').replace(/'/g, "''");
  if (!tableName || !keyField || !safeKv) return;
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql.raw(
      `INSERT INTO excel_sync_log_geom (eslg_esl_key, eslg_side, eslg_geom)
       SELECT ${Math.trunc(params.eslKey)}, '${side}', t.geom
       FROM layer."${tableName}" t
       WHERE t."${keyField}"::text = '${safeKv}'
         AND t.geom IS NOT NULL
       LIMIT 1
       ON CONFLICT DO NOTHING`
    ));
  } catch (e) {
    console.warn('[insertExcelSyncLogGeomFromLayer]', e instanceof Error ? e.message : e);
  }
}

/** Excel append/conflict 로그 INSERT 직후: lon/lat(EPSG:4326) → new geom(5181) */
export async function insertExcelSyncLogGeomFromLonLat(params: {
  eslKey: number;
  lon: number;
  lat: number;
  side?: SyncLogGeomSide;
}): Promise<void> {
  const side = params.side ?? 'new';
  const lon = Number(params.lon);
  const lat = Number(params.lat);
  const eslKey = Math.trunc(params.eslKey);
  if (!Number.isFinite(eslKey) || eslKey <= 0 || !Number.isFinite(lon) || !Number.isFinite(lat)) return;
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql.raw(
      `INSERT INTO excel_sync_log_geom (eslg_esl_key, eslg_side, eslg_geom)
       VALUES (
         ${eslKey},
         '${side}',
         ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), 5181)
       )
       ON CONFLICT DO NOTHING`
    ));
  } catch (e) {
    console.warn('[insertExcelSyncLogGeomFromLonLat]', e instanceof Error ? e.message : e);
  }
}

/** Excel append/conflict: WKT → new geom */
export async function insertExcelSyncLogGeomFromWkt(params: {
  eslKey: number;
  wkt: string;
  srid?: number;
  side?: SyncLogGeomSide;
}): Promise<void> {
  const side = params.side ?? 'new';
  const eslKey = Math.trunc(params.eslKey);
  const wkt = String(params.wkt ?? '').trim();
  if (!Number.isFinite(eslKey) || eslKey <= 0 || !wkt) return;
  const srid = params.srid === 4326 ? 4326 : 5181;
  const safeWkt = wkt.replace(/'/g, "''");
  const geomSql =
    srid === 4326
      ? `ST_Transform(ST_SetSRID(ST_GeomFromText('${safeWkt}'), 4326), 5181)`
      : `ST_SetSRID(ST_GeomFromText('${safeWkt}'), 5181)`;
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql.raw(
      `INSERT INTO excel_sync_log_geom (eslg_esl_key, eslg_side, eslg_geom)
       VALUES (${eslKey}, '${side}', ${geomSql})
       ON CONFLICT DO NOTHING`
    ));
  } catch (e) {
    console.warn('[insertExcelSyncLogGeomFromWkt]', e instanceof Error ? e.message : e);
  }
}

/** 미결·미반영 의도 Excel 로그: layer 기존 도형 → old (삭제·변경 공통) */
export async function fillPendingExcelSyncLogOldGeoms(params: {
  tableName: string;
  keyField: string;
}): Promise<void> {
  const tableName = params.tableName.replace(/[^a-zA-Z0-9_]/g, '');
  const keyField = params.keyField.replace(/[^a-zA-Z0-9_]/g, '');
  if (!tableName || !keyField) return;
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql.raw(
      `INSERT INTO excel_sync_log_geom (eslg_esl_key, eslg_side, eslg_geom)
       SELECT esl.esl_key, 'old', t.geom
       FROM excel_sync_log esl
       JOIN layer."${tableName}" t ON t."${keyField}"::text = esl.esl_key_value
       WHERE esl.esl_table_name = '${tableName}'
         AND (esl.esl_operation IS NULL OR esl.esl_applied_at IS NULL)
         AND esl.esl_old_data IS NOT NULL
         AND t.geom IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM excel_sync_log_geom g
           WHERE g.eslg_esl_key = esl.esl_key AND g.eslg_side = 'old'
         )
       ON CONFLICT DO NOTHING`
    ));
  } catch (e) {
    console.warn('[fillPendingExcelSyncLogOldGeoms]', e instanceof Error ? e.message : e);
  }
}

/**
 * 미결·미반영 의도 Excel 로그: 엑셀 지오코딩 좌표/WKT → new (신규·변경).
 */
export async function fillPendingExcelSyncLogNewGeomsFromCoords(params: {
  tableName: string;
  coordsByKey: Record<string, { x: number; y: number } | { wkt: string; srid?: number }>;
}): Promise<void> {
  const tableName = params.tableName.replace(/[^a-zA-Z0-9_]/g, '');
  if (!tableName) return;
  const entries = Object.entries(params.coordsByKey ?? {}).filter(([k]) => String(k).trim());
  if (entries.length === 0) return;

  try {
    const { pool } = await import('@/database/db');

    for (const [rawKey, coord] of entries) {
      const keyValue = String(rawKey).trim();
      let geomSql: string | null = null;
      if ('wkt' in coord && coord.wkt) {
        const srid = coord.srid === 4326 ? 4326 : 5181;
        const safeWkt = String(coord.wkt).replace(/'/g, "''");
        geomSql =
          srid === 4326
            ? `ST_Transform(ST_SetSRID(ST_GeomFromText('${safeWkt}'), 4326), 5181)`
            : `ST_SetSRID(ST_GeomFromText('${safeWkt}'), 5181)`;
      } else if ('x' in coord && 'y' in coord) {
        const x = Number(coord.x);
        const y = Number(coord.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        geomSql = `ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), 4326), 5181)`;
      }
      if (!geomSql) continue;

      try {
        await pool.query(
          `INSERT INTO excel_sync_log_geom (eslg_esl_key, eslg_side, eslg_geom)
           SELECT esl.esl_key, 'new', ${geomSql}
           FROM excel_sync_log esl
           WHERE esl.esl_table_name = $1
             AND (esl.esl_operation IS NULL OR esl.esl_applied_at IS NULL)
             AND esl.esl_new_data IS NOT NULL
             AND esl.esl_key_value = $2
             AND NOT EXISTS (
               SELECT 1 FROM excel_sync_log_geom g
               WHERE g.eslg_esl_key = esl.esl_key AND g.eslg_side = 'new'
             )
           ON CONFLICT DO NOTHING`,
          [tableName, keyValue]
        );
      } catch (rowErr) {
        console.warn(
          '[fillPendingExcelSyncLogNewGeomsFromCoords] key=',
          keyValue,
          rowErr instanceof Error ? rowErr.message : rowErr
        );
      }
    }
  } catch (e) {
    console.warn('[fillPendingExcelSyncLogNewGeomsFromCoords]', e instanceof Error ? e.message : e);
  }
}

/** layer 테이블에서 키로 GeoJSON 조회 (상세 미니맵 보강용) */
export async function fetchLayerGeomAsGeoJson(params: {
  tableName: string;
  keyField: string;
  keyValue: string;
}): Promise<unknown | null> {
  const tableName = params.tableName.replace(/[^a-zA-Z0-9_]/g, '');
  const keyField = params.keyField.replace(/[^a-zA-Z0-9_]/g, '');
  const keyValue = String(params.keyValue ?? '').trim();
  if (!tableName || !keyField || !keyValue) return null;
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    const safeKv = keyValue.replace(/'/g, "''");
    const res = await db.execute(sql.raw(
      `SELECT ST_AsGeoJSON(t.geom)::jsonb AS g
       FROM layer."${tableName}" t
       WHERE t."${keyField}"::text = '${safeKv}' AND t.geom IS NOT NULL
       LIMIT 1`
    ));
    return (res.rows as Array<{ g: unknown }>)[0]?.g ?? null;
  } catch {
    return null;
  }
}

/** 반영 확정 후: append/conflict 행에 new geom 일괄 적재. */
export async function fillExcelSyncLogNewGeoms(params: {
  ehKey: number;
  tableName: string;
  keyField: string;
}): Promise<void> {
  const ehKey = Math.trunc(params.ehKey);
  const tableName = params.tableName.replace(/[^a-zA-Z0-9_]/g, '');
  const keyField = params.keyField.replace(/[^a-zA-Z0-9_]/g, '');
  if (!Number.isFinite(ehKey) || ehKey <= 0 || !tableName || !keyField) return;
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql.raw(
      `INSERT INTO excel_sync_log_geom (eslg_esl_key, eslg_side, eslg_geom)
       SELECT esl.esl_key, 'new', t.geom
       FROM excel_sync_log esl
       JOIN layer."${tableName}" t ON t."${keyField}"::text = esl.esl_key_value
       WHERE esl.esl_eh_key = ${ehKey}
         AND esl.esl_table_name = '${tableName}'
         AND esl.esl_operation IN ('append', 'conflict')
         AND t.geom IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM excel_sync_log_geom g
           WHERE g.eslg_esl_key = esl.esl_key AND g.eslg_side = 'new'
         )
       ON CONFLICT DO NOTHING`
    ));
  } catch (e) {
    console.warn('[fillExcelSyncLogNewGeoms]', e instanceof Error ? e.message : e);
  }
}
