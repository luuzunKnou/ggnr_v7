/**
 * 보안등 — 수급(rdl_sclt_ps) + 공공(safemap) 통합 목록·상세 (조회 전용)
 */
import { pool } from '@/database/db';

type Params = Record<string, unknown>;

export type SecurityLightSource = 'supply' | 'public';

export type SecurityLightListItem = {
  key: string;
  source: SecurityLightSource;
  sourceLabel: string;
  id: string;
  location: string;
  manageNo: string;
  lon: number | null;
  lat: number | null;
};

export type SecurityLightSupplyDetail = {
  source: 'supply';
  id: string;
  manageNo: string;
  manageOrg: string;
  bjd: string;
  hjd: string;
  lightKind: string;
  fixtureModel: string;
  lightCapacity: string;
  installYmd: string;
  workNo: string;
  roadSectionNo: string;
  lon: number | null;
  lat: number | null;
};

export type SecurityLightPublicDetail = {
  source: 'public';
  id: string;
  manageNo: string;
  addr: string;
  roadNmAddr: string;
  fcltType: string;
  parcelAddress: string;
  manager: string;
  dataSource: string;
  lon: number | null;
  lat: number | null;
};

/** 수급 보안등 — 엑셀 적재 테이블 */
const SUPPLY_TABLE = 'security_light_supply';
const PUBLIC_TABLE = 'safemap';

function tx(v: unknown): string {
  return String(v ?? '').trim();
}

function escIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function toLonLat(row: Record<string, unknown>): { lon: number | null; lat: number | null } {
  const lon = Number(row.lon);
  const lat = Number(row.lat);
  return {
    lon: Number.isFinite(lon) ? lon : null,
    lat: Number.isFinite(lat) ? lat : null,
  };
}

function parseGeomJson(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  return raw;
}

function lonLatFromGeomJson(geomJson: unknown): { lon: number | null; lat: number | null } {
  if (!geomJson || typeof geomJson !== 'object' || !('coordinates' in geomJson)) {
    return { lon: null, lat: null };
  }
  const coords = (geomJson as { type?: string; coordinates?: unknown }).coordinates;
  const type = String((geomJson as { type?: string }).type ?? '');
  if (type === 'Point' && Array.isArray(coords) && coords.length >= 2) {
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    return {
      lon: Number.isFinite(lon) ? lon : null,
      lat: Number.isFinite(lat) ? lat : null,
    };
  }
  return { lon: null, lat: null };
}

async function tableExists(table: string): Promise<boolean> {
  const res = await pool.query<{ r: string | null }>(`SELECT to_regclass($1) AS r`, [
    `layer.${table}`,
  ]);
  return Boolean(res.rows[0]?.r);
}

async function resolveColumn(table: string, candidates: string[]): Promise<string | null> {
  for (const cand of candidates) {
    const res = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'layer'
         AND lower(table_name) = lower($1)
         AND lower(column_name) = lower($2)
       LIMIT 1`,
      [table, cand]
    );
    const name = res.rows[0]?.column_name;
    if (name) return name;
  }
  return null;
}

function formatYmd(raw: unknown): string {
  const s = tx(raw).replace(/[^0-9]/g, '');
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return tx(raw);
}

/** 행정동 앞 숫자 코드 제거 (예: 02진량읍 → 진량읍) */
function stripHangdongCode(raw: unknown): string {
  return tx(raw).replace(/^\d+/, '').trim();
}

/**
 * 목록 위치: 읍·면·동·리만.
 * 시도·시군구·지번·도로명은 뺀다.
 */
function locationEupMyeonRi(parts: {
  hangdong?: unknown;
  detailArea?: unknown;
  addr?: unknown;
}): string {
  const hang = stripHangdongCode(parts.hangdong);
  const area = tx(parts.detailArea);
  if (hang || area) return [hang, area].filter(Boolean).join(' ');

  const addr = tx(parts.addr)
    .replace(/^([가-힣]+)(특별자치도|특별자치시|특별시|광역시|도)\s+/u, '')
    .replace(/^([가-힣]+)(시|군|구)\s+/u, '')
    .replace(/^([가-힣]+)(시|군|구)\s+/u, '')
    .trim();
  const tokens = addr.split(/\s+/).filter(Boolean);
  const kept = tokens
    .map((t) => t.replace(/^\d+/, ''))
    .filter((t) => /(읍|면|동|가|리)$/u.test(t));
  return kept.join(' ') || addr || '-';
}

function makeKey(source: SecurityLightSource, id: string): string {
  return `${source}:${id}`;
}

export function parseSecurityLightKey(
  key: string | null | undefined
): { source: SecurityLightSource; id: string } | null {
  const s = tx(key);
  const m = /^(supply|public):(.+)$/.exec(s);
  if (!m) return null;
  const source = m[1] as SecurityLightSource;
  const id = tx(m[2]);
  if (!id) return null;
  return { source, id };
}

type ColBag = Record<string, string | null>;

async function resolveSupplyCols(): Promise<ColBag | null> {
  if (!(await tableExists(SUPPLY_TABLE))) return null;
  const geom = await resolveColumn(SUPPLY_TABLE, ['geom']);
  if (!geom) return null;
  return {
    id: 'id',
    manageNo: 'manage_no',
    hangdong: 'hangdong',
    detailArea: 'detail_area',
    addr: 'addr',
    lampType: 'lamp_type',
    fixtureType: 'fixture_type',
    lampWatt: 'lamp_watt',
    firstInstallYmd: 'first_install_ymd',
    poleNo: 'pole_no',
    kepcoCustNo: 'kepco_cust_no',
    geom,
  };
}

async function resolvePublicCols(): Promise<ColBag | null> {
  if (!(await tableExists(PUBLIC_TABLE))) return null;
  const [
    id,
    seculightKey,
    manageNo,
    addr,
    roadNmAddr,
    fcltType,
    parcelAddress,
    manager,
    source,
    geom,
  ] = await Promise.all([
    resolveColumn(PUBLIC_TABLE, ['id', 'gid', 'ogc_fid']),
    resolveColumn(PUBLIC_TABLE, ['seculight_key']),
    resolveColumn(PUBLIC_TABLE, ['fclt_gvmnfc_nm']),
    resolveColumn(PUBLIC_TABLE, ['addr']),
    resolveColumn(PUBLIC_TABLE, ['road_nm_addr']),
    resolveColumn(PUBLIC_TABLE, ['fclt_type']),
    resolveColumn(PUBLIC_TABLE, ['parcel_address']),
    resolveColumn(PUBLIC_TABLE, ['create_user']),
    resolveColumn(PUBLIC_TABLE, ['source']),
    resolveColumn(PUBLIC_TABLE, ['geom', 'wkb_geometry']),
  ]);
  if (!geom || (!id && !seculightKey)) return null;
  return {
    id,
    seculightKey,
    manageNo,
    addr,
    roadNmAddr,
    fcltType,
    parcelAddress,
    manager,
    source,
    geom,
  };
}

function colExpr(alias: string, col: string | null, asName: string): string {
  if (!col) return `NULL::text AS ${escIdent(asName)}`;
  return `${alias}.${escIdent(col)}::text AS ${escIdent(asName)}`;
}

function geomSelect(alias: string, geomCol: string): string {
  const g = `${alias}.${escIdent(geomCol)}`;
  return `
    CASE WHEN ${g} IS NOT NULL THEN ST_X(ST_Transform(ST_PointOnSurface(${g}), 4326)) ELSE NULL END AS lon,
    CASE WHEN ${g} IS NOT NULL THEN ST_Y(ST_Transform(ST_PointOnSurface(${g}), 4326)) ELSE NULL END AS lat,
    CASE WHEN ${g} IS NOT NULL THEN ST_AsGeoJSON(ST_Transform(ST_PointOnSurface(${g}), 4326))::json ELSE NULL END AS geom_json
  `;
}

async function listSupply(
  keyword: string,
  limit: number
): Promise<SecurityLightListItem[]> {
  const cols = await resolveSupplyCols();
  if (!cols?.geom) return [];

  const whereParts: string[] = [`t.${escIdent(cols.geom)} IS NOT NULL`];
  const params: unknown[] = [];
  if (keyword) {
    params.push(`%${keyword}%`);
    const i = params.length;
    whereParts.push(
      `(t.manage_no ILIKE $${i} OR t.addr ILIKE $${i} OR t.hangdong ILIKE $${i} OR t.detail_area ILIKE $${i} OR t.pole_no ILIKE $${i})`
    );
  }

  params.push(limit);
  const sql = `
    SELECT
      t.id::text AS row_id,
      t.manage_no,
      t.addr,
      t.hangdong,
      t.detail_area,
      ${geomSelect('t', cols.geom)}
    FROM layer.${escIdent(SUPPLY_TABLE)} t
    WHERE ${whereParts.join(' AND ')}
    ORDER BY t.id ASC
    LIMIT $${params.length}
  `;
  const res = await pool.query<Record<string, unknown>>(sql, params);
  return res.rows.map((row) => {
    const id = tx(row.row_id);
    const location = locationEupMyeonRi({
      hangdong: row.hangdong,
      detailArea: row.detail_area,
      addr: row.addr,
    });
    const { lon, lat } = toLonLat(row);
    return {
      key: makeKey('supply', id),
      source: 'supply' as const,
      sourceLabel: '도로과',
      id,
      location,
      manageNo: tx(row.manage_no) || id,
      lon,
      lat,
    };
  });
}

async function listPublic(
  keyword: string,
  limit: number
): Promise<SecurityLightListItem[]> {
  const cols = await resolvePublicCols();
  if (!cols?.geom) return [];

  const idCol = cols.id ?? cols.seculightKey!;
  const whereParts: string[] = [`t.${escIdent(cols.geom)} IS NOT NULL`];
  const params: unknown[] = [];
  if (keyword) {
    params.push(`%${keyword}%`);
    const i = params.length;
    const searchCols = [
      cols.manageNo,
      cols.addr,
      cols.roadNmAddr,
      cols.parcelAddress,
      cols.seculightKey,
      cols.id,
    ]
      .filter(Boolean)
      .map((c) => `t.${escIdent(c!)}::text ILIKE $${i}`);
    if (searchCols.length) whereParts.push(`(${searchCols.join(' OR ')})`);
  }

  params.push(limit);
  const sql = `
    SELECT
      t.${escIdent(idCol)}::text AS row_id,
      ${colExpr('t', cols.manageNo, 'manage_no')},
      ${colExpr('t', cols.addr, 'addr')},
      ${colExpr('t', cols.roadNmAddr, 'road_nm_addr')},
      ${colExpr('t', cols.parcelAddress, 'parcel_address')},
      ${geomSelect('t', cols.geom)}
    FROM layer.${escIdent(PUBLIC_TABLE)} t
    WHERE ${whereParts.join(' AND ')}
    ORDER BY t.${escIdent(idCol)} DESC
    LIMIT $${params.length}
  `;
  const res = await pool.query<Record<string, unknown>>(sql, params);
  return res.rows.map((row) => {
    const id = tx(row.row_id);
    const location = locationEupMyeonRi({
      addr: tx(row.addr) || tx(row.parcel_address) || tx(row.road_nm_addr),
    });
    const { lon, lat } = toLonLat(row);
    return {
      key: makeKey('public', id),
      source: 'public' as const,
      sourceLabel: '재난안전',
      id,
      location,
      manageNo: tx(row.manage_no) || id,
      lon,
      lat,
    };
  });
}

export async function list(
  p: Params
): Promise<{ items: SecurityLightListItem[]; total: number }> {
  const keyword = tx(p.keyword);
  const source = tx(p.source) as SecurityLightSource | 'all' | '';
  const limit = Math.min(20000, Math.max(1, Number(p.limit ?? 5000)));

  const wantSupply = !source || source === 'all' || source === 'supply';
  const wantPublic = !source || source === 'all' || source === 'public';

  const [supply, pub] = await Promise.all([
    wantSupply ? listSupply(keyword, limit) : Promise.resolve([]),
    wantPublic ? listPublic(keyword, limit) : Promise.resolve([]),
  ]);

  const items = [...supply, ...pub].slice(0, limit);
  return { items, total: items.length };
}

export async function getSupply(
  p: Params
): Promise<{ item: SecurityLightSupplyDetail | null }> {
  const id = tx(p.id);
  if (!id) return { item: null };
  const cols = await resolveSupplyCols();
  if (!cols?.geom) return { item: null };

  const sql = `
    SELECT
      t.id::text AS row_id,
      t.manage_no,
      t.hangdong,
      t.detail_area,
      t.addr,
      t.lamp_type,
      t.fixture_type,
      t.lamp_watt,
      t.first_install_ymd,
      t.pole_no,
      t.kepco_cust_no,
      ${geomSelect('t', cols.geom)}
    FROM layer.${escIdent(SUPPLY_TABLE)} t
    WHERE t.id::text = $1
    LIMIT 1
  `;
  const res = await pool.query<Record<string, unknown>>(sql, [id]);
  const row = res.rows[0];
  if (!row) return { item: null };

  let { lon, lat } = toLonLat(row);
  if (lon == null || lat == null) {
    const fromGeom = lonLatFromGeomJson(parseGeomJson(row.geom_json));
    lon = fromGeom.lon;
    lat = fromGeom.lat;
  }

  return {
    item: {
      source: 'supply',
      id: tx(row.row_id),
      manageNo: tx(row.manage_no) || tx(row.row_id),
      manageOrg: tx(row.hangdong) || '-',
      bjd: tx(row.detail_area) || '-',
      hjd: tx(row.addr) || '-',
      lightKind: tx(row.lamp_type) || '-',
      fixtureModel: tx(row.fixture_type) || '-',
      lightCapacity: tx(row.lamp_watt) || '-',
      installYmd: formatYmd(row.first_install_ymd) || '-',
      workNo: tx(row.pole_no) || '-',
      roadSectionNo: tx(row.kepco_cust_no) || '-',
      lon,
      lat,
    },
  };
}

export async function getPublic(
  p: Params
): Promise<{ item: SecurityLightPublicDetail | null }> {
  const id = tx(p.id);
  if (!id) return { item: null };
  const cols = await resolvePublicCols();
  if (!cols?.geom) return { item: null };

  const idCol = cols.id ?? cols.seculightKey!;
  const sql = `
    SELECT
      t.${escIdent(idCol)}::text AS row_id,
      ${colExpr('t', cols.manageNo, 'manage_no')},
      ${colExpr('t', cols.addr, 'addr')},
      ${colExpr('t', cols.roadNmAddr, 'road_nm_addr')},
      ${colExpr('t', cols.fcltType, 'fclt_type')},
      ${colExpr('t', cols.parcelAddress, 'parcel_address')},
      ${colExpr('t', cols.manager, 'manager')},
      ${colExpr('t', cols.source, 'data_source')},
      ${geomSelect('t', cols.geom)}
    FROM layer.${escIdent(PUBLIC_TABLE)} t
    WHERE t.${escIdent(idCol)}::text = $1
    LIMIT 1
  `;
  const res = await pool.query<Record<string, unknown>>(sql, [id]);
  const row = res.rows[0];
  if (!row) return { item: null };

  let { lon, lat } = toLonLat(row);
  if (lon == null || lat == null) {
    const fromGeom = lonLatFromGeomJson(parseGeomJson(row.geom_json));
    lon = fromGeom.lon;
    lat = fromGeom.lat;
  }

  return {
    item: {
      source: 'public',
      id: tx(row.row_id),
      manageNo: tx(row.manage_no) || tx(row.row_id),
      addr: tx(row.addr) || '-',
      roadNmAddr: tx(row.road_nm_addr) || '-',
      fcltType: tx(row.fclt_type) || '-',
      parcelAddress: tx(row.parcel_address) || '-',
      manager: tx(row.manager) || '-',
      dataSource: tx(row.data_source) || '공공데이터',
      lon,
      lat,
    },
  };
}

export async function get(
  p: Params
): Promise<{
  item: SecurityLightSupplyDetail | SecurityLightPublicDetail | null;
}> {
  const parsed = parseSecurityLightKey(tx(p.key)) ?? {
    source: tx(p.source) as SecurityLightSource,
    id: tx(p.id),
  };
  if (!parsed.source || !parsed.id) return { item: null };
  if (parsed.source === 'supply') {
    const r = await getSupply({ id: parsed.id });
    return { item: r.item };
  }
  if (parsed.source === 'public') {
    const r = await getPublic({ id: parsed.id });
    return { item: r.item };
  }
  return { item: null };
}
