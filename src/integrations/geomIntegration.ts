import { pool } from '@/database/db';
import { resolveGeomWkt5181FromAddress, resolveGeomWkt5181FromPlace } from '@/lib/geomWkt5181';

function qi(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function assertSafeIdent(name: string, label: string): string {
  const n = name.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error(`Invalid ${label}: ${name}`);
  return n;
}

function optionalSafeIdent(name: unknown, label: string): string | null {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return null;
  return assertSafeIdent(trimmed, label);
}

export type GeomIntegrationTableRow = {
  tableName: string;
  geomColumn: string;
};

export type GeomIntegrationColumnRow = {
  columnName: string;
  dataType: string;
};

export async function listGeomIntegrationTables(): Promise<{ rows: GeomIntegrationTableRow[] }> {
  const { rows } = await pool.query<GeomIntegrationTableRow>(
    `SELECT DISTINCT
       c.f_table_name AS "tableName",
       c.f_geometry_column AS "geomColumn"
     FROM geometry_columns c
     INNER JOIN information_schema.tables t
       ON t.table_schema = c.f_table_schema AND t.table_name = c.f_table_name
     WHERE c.f_table_schema = 'layer'
       AND t.table_type = 'BASE TABLE'
     ORDER BY c.f_table_name ASC`
  );
  return { rows };
}

export async function listGeomIntegrationColumns(p: {
  tableName: string;
}): Promise<{ rows: GeomIntegrationColumnRow[] }> {
  const table = assertSafeIdent(p.tableName, 'table');
  const { rows } = await pool.query<GeomIntegrationColumnRow>(
    `SELECT column_name AS "columnName", data_type AS "dataType"
     FROM information_schema.columns
     WHERE table_schema = 'layer' AND table_name = $1
     ORDER BY ordinal_position ASC`,
    [table]
  );
  return { rows };
}

async function resolvePrimaryKeyColumn(table: string): Promise<string> {
  const { rows } = await pool.query<{ column_name: string }>(
    `SELECT a.attname AS column_name
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     JOIN pg_class c ON c.oid = i.indrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE i.indisprimary AND n.nspname = 'layer' AND c.relname = $1
     LIMIT 1`,
    [table]
  );
  const pk = rows[0]?.column_name?.trim();
  if (pk && /^[a-z_][a-z0-9_]*$/i.test(pk)) return pk.toLowerCase();

  const { rows: cols } = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'layer' AND table_name = $1
       AND column_name IN ('ogc_fid', 'id')
     ORDER BY CASE column_name WHEN 'ogc_fid' THEN 0 ELSE 1 END
     LIMIT 1`,
    [table]
  );
  const fallback = cols[0]?.column_name?.trim();
  if (fallback && /^[a-z_][a-z0-9_]*$/i.test(fallback)) return fallback.toLowerCase();
  throw new Error(`PK 컬럼을 찾을 수 없습니다: layer.${table}`);
}

async function resolveGeomWktForRow(params: {
  addr: string;
  placeName: string;
}): Promise<{ wkt: string | null; lon: number | null; lat: number | null; source: 'address' | 'place' | null }> {
  const addr = String(params.addr ?? '').trim();
  const placeName = String(params.placeName ?? '').trim();

  if (addr) {
    const fromAddr = await resolveGeomWkt5181FromAddress(addr);
    if (fromAddr.wkt) return { ...fromAddr, source: 'address' };
  }
  if (placeName) {
    const fromPlace = await resolveGeomWkt5181FromPlace(placeName);
    if (fromPlace.wkt) return { ...fromPlace, source: 'place' };
  }
  return { wkt: null, lon: null, lat: null, source: null };
}

export async function runGeomIntegration(params: {
  tableName: string;
  addressColumn?: string | null;
  placeNameColumn?: string | null;
  geomColumn?: string | null;
  ijlKey?: number;
  onProgress?: (message: string) => void | Promise<void>;
}): Promise<{ total: number; success: number; fail: number; skip: number }> {
  const table = assertSafeIdent(params.tableName, 'table');
  const addressColumn = optionalSafeIdent(params.addressColumn, 'addressColumn');
  const placeNameColumn = optionalSafeIdent(params.placeNameColumn, 'placeNameColumn');
  if (!addressColumn && !placeNameColumn) {
    throw new Error('주소 컬럼 또는 장소명 컬럼 중 하나 이상이 필요합니다.');
  }

  const pkColumn = await resolvePrimaryKeyColumn(table);

  const { rows: colRows } = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'layer' AND table_name = $1`,
    [table]
  );
  const colSet = new Set(colRows.map((r) => r.column_name.toLowerCase()));
  if (addressColumn && !colSet.has(addressColumn)) {
    throw new Error(`주소 컬럼이 없습니다: ${addressColumn}`);
  }
  if (placeNameColumn && !colSet.has(placeNameColumn)) {
    throw new Error(`장소명 컬럼이 없습니다: ${placeNameColumn}`);
  }

  const geomColumn = optionalSafeIdent(params.geomColumn, 'geomColumn') ?? 'geom';
  if (!colSet.has(geomColumn)) {
    throw new Error(`geom 컬럼이 없습니다: layer.${table}.${geomColumn}`);
  }

  const hasLonLat = colSet.has('lon') && colSet.has('lat');
  const fromClause = `${qi('layer')}.${qi(table)}`;

  const selectParts = [`${qi(pkColumn)} AS pk`];
  if (addressColumn) selectParts.push(`${qi(addressColumn)} AS addr`);
  else selectParts.push(`''::text AS addr`);
  if (placeNameColumn) selectParts.push(`${qi(placeNameColumn)} AS place_name`);
  else selectParts.push(`''::text AS place_name`);

  const whereParts: string[] = [];
  if (addressColumn) {
    whereParts.push(`btrim(COALESCE(${qi(addressColumn)}::text, '')) <> ''`);
  }
  if (placeNameColumn) {
    whereParts.push(`btrim(COALESCE(${qi(placeNameColumn)}::text, '')) <> ''`);
  }
  const whereClause = whereParts.length ? `WHERE (${whereParts.join(' OR ')})` : '';

  const selectSql = `SELECT ${selectParts.join(', ')} FROM ${fromClause} ${whereClause}`;
  const { rows } = await pool.query<{ pk: string | number; addr: string; place_name: string }>(selectSql);

  const total = rows.length;
  let success = 0;
  let fail = 0;
  let skip = 0;

  const report = async (message: string) => {
    await params.onProgress?.(message);
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const pk = row.pk;
    const addr = String(row.addr ?? '').trim();
    const placeName = String(row.place_name ?? '').trim();
    const seq = i + 1;

    if (!addr && !placeName) {
      skip += 1;
      continue;
    }

    const resolved = await resolveGeomWktForRow({ addr, placeName });
    if (!resolved.wkt) {
      fail += 1;
      const label = [addr && `주소:${addr}`, placeName && `장소:${placeName}`].filter(Boolean).join(' | ');
      await report(`진행 ${seq}/${total} | 성공 ${success} | 실패 ${fail} | 스킵 ${skip} | 좌표 조회 실패: ${label}`);
      continue;
    }

    const lonStr = resolved.lon != null ? String(resolved.lon) : null;
    const latStr = resolved.lat != null ? String(resolved.lat) : null;

    if (hasLonLat && lonStr && latStr) {
      await pool.query(
        `UPDATE ${fromClause}
         SET ${qi(geomColumn)} = ST_GeomFromText($1, 5181), lon = $2, lat = $3
         WHERE ${qi(pkColumn)} = $4`,
        [resolved.wkt, lonStr, latStr, pk]
      );
    } else {
      await pool.query(
        `UPDATE ${fromClause}
         SET ${qi(geomColumn)} = ST_GeomFromText($1, 5181)
         WHERE ${qi(pkColumn)} = $2`,
        [resolved.wkt, pk]
      );
    }

    success += 1;
    if (seq === total || seq % 5 === 0) {
      await report(`진행 ${seq}/${total} | 성공 ${success} | 실패 ${fail} | 스킵 ${skip}`);
    }
  }

  const summary = `완료 ${total}/${total} | 성공 ${success} | 실패 ${fail} | 스킵 ${skip}`;
  await report(summary);
  return { total, success, fail, skip };
}
