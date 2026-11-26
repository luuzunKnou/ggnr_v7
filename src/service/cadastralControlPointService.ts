/**
 * 지적기준점 — layer.cadastral_control_point (SHP 업로드) 목록·상세
 */
import { pool } from '@/database/db';

type Params = Record<string, unknown>;

export type CadastralControlPointKindCode =
  | 'triangulation'
  | 'triangulationAux'
  | 'traverse';

export type CadastralControlPointListItem = {
  id: string;
  pointNo: string;
  name: string;
  kind: string;
  kindCode: CadastralControlPointKindCode;
  landLoc: string;
  emd: string;
  address: string;
  x: number;
  y: number;
  crsSrc: string;
  marker: string;
  grade: string;
  route: string;
  doho: string;
  crossK: string;
  install: string;
  installedAt: string;
  survey: string;
  surveyedAt: string;
  /** EPSG:5181 — 목록은 기본 미포함, 상세·지도 맞춤용 */
  geom5181: [number, number] | null;
};

const SCHEMA = 'layer';
const TABLE = 'cadastral_control_point';

const KIND_TO_CODE: Record<string, CadastralControlPointKindCode> = {
  삼각점: 'triangulation',
  삼각보조점: 'triangulationAux',
  도근점: 'traverse',
};

const CODE_TO_KIND: Record<CadastralControlPointKindCode, string> = {
  triangulation: '삼각점',
  triangulationAux: '삼각보조점',
  traverse: '도근점',
};

function tx(v: unknown): string {
  return String(v ?? '').trim();
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseId(v: unknown): number | null {
  const n = Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function formatYmd(raw: string): string {
  const s = raw.replace(/\D/g, '');
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return raw;
}

/** land_loc 예: 11000-용상동 → 용상동 */
export function emdFromLandLoc(landLoc: string): string {
  const s = tx(landLoc);
  if (!s) return '';
  const i = s.indexOf('-');
  if (i >= 0) return s.slice(i + 1).trim() || s;
  return s;
}

export function kindToCode(kind: string): CadastralControlPointKindCode {
  return KIND_TO_CODE[tx(kind)] ?? 'traverse';
}

const POINT_GEOM = `ST_GeometryN(ST_CollectionExtract(t.geom, 1), 1)`;

const ATTR_SQL = `
  SELECT
    t.seq,
    t.kind,
    t.name,
    t.pt_no,
    t.crs_src,
    t.x_src,
    t.y_src,
    t.land_loc,
    t.address,
    t.marker,
    t.grade,
    t.route,
    t.doho,
    t.cross_k,
    t.install,
    t.inst_dt,
    t.survey,
    t.surv_dt
  FROM ${SCHEMA}.${TABLE} t
`;

const LIST_SQL_WITH_GEOM = `
  SELECT
    t.seq,
    t.kind,
    t.name,
    t.pt_no,
    t.crs_src,
    t.x_src,
    t.y_src,
    t.land_loc,
    t.address,
    t.marker,
    t.grade,
    t.route,
    t.doho,
    t.cross_k,
    t.install,
    t.inst_dt,
    t.survey,
    t.surv_dt,
    CASE WHEN t.geom IS NOT NULL THEN ST_X(${POINT_GEOM}) ELSE NULL END AS gx,
    CASE WHEN t.geom IS NOT NULL THEN ST_Y(${POINT_GEOM}) ELSE NULL END AS gy
  FROM ${SCHEMA}.${TABLE} t
`;

function mapRow(
  row: Record<string, unknown>,
  opts?: { requireGeom?: boolean }
): CadastralControlPointListItem | null {
  const seq = parseId(row.seq);
  if (seq == null) return null;
  const kind = tx(row.kind);
  const landLoc = tx(row.land_loc ?? row.landLoc);
  const gx = toNum(row.gx);
  const gy = toNum(row.gy);
  const x = toNum(row.x_src ?? row.xSrc) ?? 0;
  const y = toNum(row.y_src ?? row.ySrc) ?? 0;
  const hasGeom = gx != null && gy != null;
  if (opts?.requireGeom && !hasGeom) return null;
  return {
    id: String(seq),
    pointNo: tx(row.pt_no ?? row.ptNo) || String(seq),
    name: tx(row.name),
    kind,
    kindCode: kindToCode(kind),
    landLoc,
    emd: emdFromLandLoc(landLoc),
    address: tx(row.address),
    x,
    y,
    crsSrc: tx(row.crs_src ?? row.crsSrc),
    marker: tx(row.marker),
    grade: tx(row.grade),
    route: tx(row.route),
    doho: tx(row.doho),
    crossK: tx(row.cross_k ?? row.crossK),
    install: tx(row.install),
    installedAt: formatYmd(tx(row.inst_dt ?? row.instDt)),
    survey: tx(row.survey),
    surveyedAt: formatYmd(tx(row.surv_dt ?? row.survDt)),
    geom5181: hasGeom ? [gx!, gy!] : null,
  };
}

export async function list(
  p: Params = {}
): Promise<{ items: CadastralControlPointListItem[]; total: number }> {
  const keyword = tx(p.keyword);
  const typeCode = tx(p.type ?? p.kindCode) as CadastralControlPointKindCode | '';
  const limit = Math.min(20000, Math.max(1, Number(p.limit ?? 20000)));
  const includeGeom = p.includeGeom === true || p.includeGeom === 'true';

  const whereParts: string[] = ['t.geom IS NOT NULL'];
  const params: unknown[] = [];

  if (typeCode && CODE_TO_KIND[typeCode]) {
    params.push(CODE_TO_KIND[typeCode]);
    whereParts.push(`t.kind = $${params.length}`);
  }
  if (keyword) {
    params.push(`%${keyword}%`);
    const i = params.length;
    whereParts.push(
      `(COALESCE(t.pt_no,'') ILIKE $${i}
        OR COALESCE(t.name,'') ILIKE $${i}
        OR COALESCE(t.address,'') ILIKE $${i}
        OR COALESCE(t.land_loc,'') ILIKE $${i}
        OR COALESCE(t.kind,'') ILIKE $${i}
        OR COALESCE(t.survey,'') ILIKE $${i})`
    );
  }

  const whereClause = `WHERE ${whereParts.join(' AND ')}`;
  const selectSql = includeGeom ? LIST_SQL_WITH_GEOM : ATTR_SQL;

  const countRes = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM ${SCHEMA}.${TABLE} t ${whereClause}`,
    params
  );
  const total = Number(countRes.rows[0]?.c ?? 0);

  const dataRes = await pool.query<Record<string, unknown>>(
    `${selectSql} ${whereClause} ORDER BY t.seq ASC LIMIT $${params.length + 1}`,
    [...params, limit]
  );
  const items = dataRes.rows
    .map((r) => mapRow(r, { requireGeom: includeGeom }))
    .filter((v): v is CadastralControlPointListItem => v != null);
  return { items, total };
}

export async function get(
  p: Params
): Promise<{ item: CadastralControlPointListItem | null }> {
  const id = parseId(p.id ?? p.seq);
  if (id == null) return { item: null };
  const dataRes = await pool.query<Record<string, unknown>>(
    `${LIST_SQL_WITH_GEOM} WHERE t.seq = $1 LIMIT 1`,
    [id]
  );
  const row = dataRes.rows[0];
  if (!row) return { item: null };
  return { item: mapRow(row, { requireGeom: true }) };
}
