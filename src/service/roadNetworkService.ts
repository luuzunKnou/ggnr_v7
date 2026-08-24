/**
 * 도로망도 — layer.rdl_* 종류·개설별 LINE 테이블 통합 목록
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import type {
  RoadNetworkGeom,
  RoadNetworkOpenStatus,
  RoadNetworkPoint,
  RoadNetworkRow,
  RoadNetworkType,
} from '@/app/(pages)/map/_mapContents/road/roadNetwork/roadNetworkMock';
import {
  cleanRoadNetworkDisplayText,
  formatRoadNetworkNumericAttr,
} from '@/app/(pages)/map/_mapContents/road/roadNetwork/roadNetworkFormat';
import {
  deleteTableRowByKey,
  insertTableRow,
  updateTableRowByKey,
} from './layerRowService';

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

async function resolveLayerTableName(wantedLower: string): Promise<string | null> {
  const res = await db.execute(
    sql.raw(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'layer' AND lower(table_name) = '${esc(wantedLower)}'
       LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { table_name?: string } | undefined;
  const name = String(row?.table_name ?? '').trim();
  return name || null;
}

type SourceDef = {
  table: string;
  roadType: RoadNetworkType;
  openStatus: RoadNetworkOpenStatus;
  /** SQL expression for road name (aliases t) */
  nameExpr: string;
  /** SQL expression for road no */
  noExpr: string;
  /** SQL expression for dept/admin */
  deptExpr: string;
  /** 입체교차로 등 — 길이·방위·굴곡도 (없으면 빈 문자열) */
  lengthAttrExpr?: string;
  defenseExpr?: string;
  sinuosityExpr?: string;
  detailReasonExpr?: string;
  addressExpr?: string;
};

const LENGTH_ATTR_EXPR = `COALESCE(NULLIF(trim(both from t.length::text), ''), '')`;
const DEFENSE_EXPR = `COALESCE(NULLIF(trim(both from t.defense::text), ''), '')`;
const SINUOSITY_EXPR = `COALESCE(NULLIF(trim(both from t.sinuosity::text), ''), '')`;
const DETAIL_REASON_EXPR = `COALESCE(NULLIF(trim(both from t.alwnc_resn::text), ''), '')`;
const ADDRESS_RBP_EXPR = `COALESCE(NULLIF(trim(both from t.rbp_cn::text), ''), '')`;
const ADDRESS_REP_EXPR = `COALESCE(NULLIF(trim(both from t.rep_cn::text), ''), '')`;

const SOURCES: SourceDef[] = [
  {
    table: 'rdl_national1_ls',
    roadType: '국도',
    openStatus: '개설',
    // 원본 도로명만 — 번호·ogc_fid로 임의 생성하지 않음
    nameExpr: `COALESCE(NULLIF(trim(both from t.road_name::text), ''), '')`,
    noExpr: `COALESCE(NULLIF(trim(both from t.road_no::text), ''), '')`,
    deptExpr: `''`,
  },
  {
    table: 'rdl_national2_interc_ls',
    roadType: '입체교차로',
    openStatus: '개설',
    // 원본 name만 — 플레이스홀더는 빈 값 (연장·ogc_fid로 채우지 않음)
    nameExpr: `CASE
      WHEN NULLIF(trim(both from COALESCE(t.name::text, '')), '') IS NULL
        OR trim(both from t.name::text) ~ '^[-–—\\\\/.]+$'
      THEN ''
      ELSE trim(both from t.name::text)
    END`,
    noExpr: `''`,
    deptExpr: `''`,
    lengthAttrExpr: LENGTH_ATTR_EXPR,
    defenseExpr: DEFENSE_EXPR,
    sinuosityExpr: SINUOSITY_EXPR,
  },
  {
    table: 'rdl_nsprov_0610_ls',
    roadType: '국지도',
    openStatus: '개설',
    nameExpr: `COALESCE(NULLIF(trim(both from t.rn::text), ''), '')`,
    noExpr: `COALESCE(NULLIF(trim(both from t.road_no::text), ''), '')`,
    deptExpr: `''`,
    lengthAttrExpr: LENGTH_ATTR_EXPR,
    defenseExpr: DEFENSE_EXPR,
    sinuosityExpr: SINUOSITY_EXPR,
    detailReasonExpr: DETAIL_REASON_EXPR,
  },
  {
    table: 'rdl_prov_0610_ls',
    roadType: '지방도',
    openStatus: '개설',
    nameExpr: `COALESCE(NULLIF(trim(both from t.rn::text), ''), '')`,
    noExpr: `COALESCE(NULLIF(trim(both from t.road_no::text), ''), '')`,
    deptExpr: `''`,
    lengthAttrExpr: LENGTH_ATTR_EXPR,
    defenseExpr: DEFENSE_EXPR,
  },
  {
    table: 'rdl_county_opn_ls',
    roadType: '군도',
    openStatus: '개설',
    nameExpr: `COALESCE(NULLIF(trim(both from t.name::text), ''), '')`,
    noExpr: `COALESCE(NULLIF(trim(both from t.no::text), ''), NULLIF(trim(both from t.admin_no::text), ''), '')`,
    deptExpr: `COALESCE(NULLIF(trim(both from t.admin::text), ''), '')`,
    lengthAttrExpr: LENGTH_ATTR_EXPR,
    defenseExpr: DEFENSE_EXPR,
    sinuosityExpr: SINUOSITY_EXPR,
  },
  {
    table: 'rdl_county_uopn_ls',
    roadType: '군도',
    openStatus: '미개설',
    nameExpr: `COALESCE(NULLIF(trim(both from t.name::text), ''), '')`,
    noExpr: `COALESCE(NULLIF(trim(both from t.no::text), ''), NULLIF(trim(both from t.admin_no::text), ''), '')`,
    deptExpr: `COALESCE(NULLIF(trim(both from t.admin::text), ''), '')`,
    lengthAttrExpr: LENGTH_ATTR_EXPR,
    defenseExpr: DEFENSE_EXPR,
    sinuosityExpr: SINUOSITY_EXPR,
  },
  {
    table: 'rdl_perch_opn_ls',
    roadType: '농도',
    openStatus: '개설',
    nameExpr: `COALESCE(NULLIF(trim(both from t.name::text), ''), '')`,
    noExpr: `COALESCE(NULLIF(trim(both from t.no::text), ''), NULLIF(trim(both from t.admin_no::text), ''), '')`,
    deptExpr: `COALESCE(NULLIF(trim(both from t.admin::text), ''), '')`,
    lengthAttrExpr: LENGTH_ATTR_EXPR,
    defenseExpr: DEFENSE_EXPR,
    sinuosityExpr: SINUOSITY_EXPR,
  },
  {
    table: 'rdl_perch_uopn_ls',
    roadType: '농도',
    openStatus: '미개설',
    nameExpr: `COALESCE(NULLIF(trim(both from t.name::text), ''), '')`,
    noExpr: `COALESCE(NULLIF(trim(both from t.no::text), ''), NULLIF(trim(both from t.admin_no::text), ''), '')`,
    deptExpr: `COALESCE(NULLIF(trim(both from t.admin::text), ''), '')`,
    lengthAttrExpr: LENGTH_ATTR_EXPR,
    defenseExpr: DEFENSE_EXPR,
    sinuosityExpr: SINUOSITY_EXPR,
  },
  {
    table: 'rdl_sprd_0610_ls',
    roadType: '일반도로',
    openStatus: '개설',
    nameExpr: `COALESCE(NULLIF(trim(both from t.rn::text), ''), NULLIF(trim(both from t.name::text), ''), '')`,
    noExpr: `COALESCE(NULLIF(trim(both from t.rds_man_no::text), ''), '')`,
    deptExpr: `''`,
    lengthAttrExpr: LENGTH_ATTR_EXPR,
    defenseExpr: DEFENSE_EXPR,
    detailReasonExpr: DETAIL_REASON_EXPR,
    addressExpr: ADDRESS_RBP_EXPR,
  },
  {
    table: 'rdl_frl_0610_ls',
    roadType: '임도',
    openStatus: '개설',
    nameExpr: `COALESCE(NULLIF(trim(both from t.rn::text), ''), '')`,
    noExpr: `COALESCE(NULLIF(trim(both from t.rds_man_no::text), ''), '')`,
    deptExpr: `''`,
    lengthAttrExpr: LENGTH_ATTR_EXPR,
    defenseExpr: DEFENSE_EXPR,
    sinuosityExpr: SINUOSITY_EXPR,
    detailReasonExpr: DETAIL_REASON_EXPR,
    addressExpr: ADDRESS_REP_EXPR,
  },
];

function parseLengthM(raw: unknown): number {
  if (raw == null) return 0;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function parseGeom(raw: unknown): RoadNetworkGeom | null {
  if (raw == null) return null;
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const g = obj as { type?: string; coordinates?: unknown };
  if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
    return { type: 'LineString', coordinates: g.coordinates as [number, number][] };
  }
  if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
    return { type: 'MultiLineString', coordinates: g.coordinates as [number, number][][] };
  }
  return null;
}

function endpointFromGeom(
  geom: RoadNetworkGeom | null,
  which: 'start' | 'end'
): RoadNetworkPoint | null {
  if (!geom) return null;
  let coords: [number, number][] | null = null;
  if (geom.type === 'LineString') {
    coords = geom.coordinates;
  } else if (geom.type === 'MultiLineString' && geom.coordinates.length > 0) {
    coords = which === 'start' ? geom.coordinates[0]! : geom.coordinates[geom.coordinates.length - 1]!;
  }
  if (!coords?.length) return null;
  const pt = which === 'start' ? coords[0]! : coords[coords.length - 1]!;
  const lon = Number(pt[0]);
  const lat = Number(pt[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

function buildSelect(src: SourceDef, safeTbl: string): string {
  const roadTypeLit = esc(src.roadType);
  const openLit = esc(src.openStatus);
  const tableLit = esc(src.table);
  const lengthAttrExpr = src.lengthAttrExpr ?? `''`;
  const defenseExpr = src.defenseExpr ?? `''`;
  const sinuosityExpr = src.sinuosityExpr ?? `''`;
  const detailReasonExpr = src.detailReasonExpr ?? `''`;
  const addressExpr = src.addressExpr ?? `''`;
  return `SELECT
    '${tableLit}' || ':' || t.ogc_fid::text AS id,
    ${src.nameExpr} AS "roadName",
    ${src.noExpr} AS "roadNo",
    '${roadTypeLit}'::text AS "roadType",
    '${openLit}'::text AS "openStatus",
    ROUND(ST_Length(ST_Transform(t.geom, 5186))::numeric, 1)::float8 AS "lengthM",
    ${src.deptExpr} AS dept,
    ${lengthAttrExpr} AS "lengthAttr",
    ${defenseExpr} AS defense,
    ${sinuosityExpr} AS sinuosity,
    ${detailReasonExpr} AS "detailReason",
    ${addressExpr} AS address,
    ST_AsGeoJSON(ST_Transform(t.geom, 4326))::json AS geom
  FROM layer."${safeTbl}" t`;
}

/**
 * 도로망도 통합 목록 (국도·지방도·군도·농도·일반도로·임도 등).
 * 유지보수·민원·첨부·이력은 빈 배열 — 화면 세션에서만 편집.
 */
export async function getRoadNetworkList(params?: {
  keyword?: string;
}): Promise<{ rows: RoadNetworkRow[] }> {
  const keyword = String(params?.keyword ?? '').trim();
  const parts: string[] = [];

  for (const src of SOURCES) {
    const tableName = await resolveLayerTableName(src.table);
    if (!tableName) continue;
    const safeTbl = tableName.replace(/"/g, '""');
    parts.push(buildSelect(src, safeTbl));
  }

  if (parts.length === 0) {
    return { rows: [] };
  }

  const kwClause = keyword
    ? ` WHERE (
        COALESCE(u."roadName", '') ILIKE '%${esc(keyword)}%'
        OR COALESCE(u."roadNo", '') ILIKE '%${esc(keyword)}%'
        OR COALESCE(u."roadType", '') ILIKE '%${esc(keyword)}%'
        OR COALESCE(u.dept, '') ILIKE '%${esc(keyword)}%'
      )`
    : '';

  const res = await db.execute(
    sql.raw(
      `SELECT * FROM (
         ${parts.join('\nUNION ALL\n')}
       ) u
       ${kwClause}
       ORDER BY
         CASE u."roadType"
           WHEN '국도' THEN 1
           WHEN '지방도' THEN 2
           WHEN '국지도' THEN 3
           WHEN '군도' THEN 4
           WHEN '농도' THEN 5
           WHEN '일반도로' THEN 6
           WHEN '임도' THEN 7
           WHEN '입체교차로' THEN 8
           ELSE 9
         END,
         CASE
           WHEN NULLIF(trim(both from COALESCE(u."roadNo", '')), '') ~ '^[0-9]+$'
           THEN (trim(both from u."roadNo"))::bigint
           ELSE NULL
         END NULLS LAST,
         CASE
           WHEN NULLIF(trim(both from COALESCE(u."roadNo", '')), '') ~ '^[0-9]+$'
           THEN 0 ELSE 1
         END,
         u."roadNo",
         CASE
           WHEN u."roadName" ~ '[0-9]+'
           THEN (substring(u."roadName" from '[0-9]+'))::bigint
           ELSE NULL
         END NULLS LAST,
         u."roadName",
         u.id
       LIMIT 8000`
    )
  );

  const rows: RoadNetworkRow[] = (res.rows ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const geom = parseGeom(row.geom);
    const roadType = String(row.roadType ?? '일반도로').trim() as RoadNetworkType;
    const openStatus = (String(row.openStatus ?? '개설').trim() || '개설') as RoadNetworkOpenStatus;
    return {
      id: String(row.id ?? '').trim(),
      roadName: cleanRoadNetworkDisplayText(row.roadName),
      roadNo: cleanRoadNetworkDisplayText(row.roadNo),
      roadType,
      openStatus,
      lengthM: parseLengthM(row.lengthM),
      sect: '',
      dept: String(row.dept ?? '').trim(),
      manager: '',
      startPoint: '',
      endPoint: '',
      startPointCoord: endpointFromGeom(geom, 'start'),
      endPointCoord: endpointFromGeom(geom, 'end'),
      lengthAttr: String(row.lengthAttr ?? '').trim(),
      defense: String(row.defense ?? '').trim(),
      sinuosity: formatRoadNetworkNumericAttr(row.sinuosity),
      detailReason: String(row.detailReason ?? '').trim(),
      address: String(row.address ?? '').trim(),
      designateDate: '',
      geom,
      maintenance: [],
      complaints: [],
      attachments: [],
      history: [],
    };
  });

  return { rows };
}

function resolveTargetSource(
  roadType: RoadNetworkType,
  openStatus: RoadNetworkOpenStatus
): SourceDef | null {
  const open = openStatus === '미개설' ? '미개설' : '개설';
  const hit = SOURCES.find((s) => s.roadType === roadType && s.openStatus === open);
  if (hit) return hit;
  // 개설/미개설 테이블이 없는 종류는 개설 테이블로
  return SOURCES.find((s) => s.roadType === roadType) ?? null;
}

function parseStoredId(id: string): { table: string; ogcFid: number } | null {
  const raw = String(id ?? '').trim();
  const m = /^([a-z0-9_]+):(\d+)$/i.exec(raw);
  if (!m) return null;
  return { table: m[1]!.toLowerCase(), ogcFid: Number(m[2]) };
}

function isClientOnlyId(id: string): boolean {
  const s = String(id ?? '').trim();
  return s === '__new__' || s.startsWith('local-') || s.startsWith('new-') || !parseStoredId(s);
}

type AttrSqlValue = { col: string; sql: string };

async function getColumnTypeMap(table: string): Promise<Map<string, string>> {
  const res = await db.execute(
    sql.raw(
      `SELECT lower(column_name) AS name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'layer' AND lower(table_name) = lower('${esc(table)}')`
    )
  );
  const map = new Map<string, string>();
  for (const r of res.rows ?? []) {
    const row = r as { name?: string; data_type?: string };
    const n = String(row.name ?? '').trim();
    if (n) map.set(n, String(row.data_type ?? '').toLowerCase());
  }
  return map;
}

function isNumericDataType(dataType: string): boolean {
  return (
    dataType.includes('numeric') ||
    dataType.includes('double') ||
    dataType.includes('real') ||
    dataType.includes('integer') ||
    dataType.includes('bigint') ||
    dataType.includes('smallint') ||
    dataType.includes('decimal')
  );
}

function toSqlLiteral(raw: string, dataType: string): { ok: true; sql: string } | { ok: false; error: string } {
  const v = raw.trim();
  if (!v) return { ok: true, sql: 'NULL' };
  if (isNumericDataType(dataType)) {
    if (!/^-?\d+(\.\d+)?$/.test(v)) {
      return { ok: false, error: `숫자만 입력하세요: ${v}` };
    }
    return { ok: true, sql: v };
  }
  return { ok: true, sql: `'${esc(v)}'` };
}

function buildAttrSqlValues(
  table: string,
  typeMap: Map<string, string>,
  input: {
    roadName: string;
    roadNo: string;
    roadType: RoadNetworkType;
    dept: string;
    lengthAttr?: string;
    defense?: string;
    sinuosity?: string;
    detailReason?: string;
    address?: string;
  }
): { ok: true; values: AttrSqlValue[] } | { ok: false; error: string } {
  const name = input.roadName.trim();
  const no = input.roadNo.trim();
  const dept = input.dept.trim();
  const lengthAttr = String(input.lengthAttr ?? '').trim();
  const defense = String(input.defense ?? '').trim();
  const sinuosity = String(input.sinuosity ?? '').trim();
  const detailReason = String(input.detailReason ?? '').trim();
  const address = String(input.address ?? '').trim();
  const planned: { col: string; val: string }[] = [];
  const add = (col: string, val: string) => {
    if (typeMap.has(col.toLowerCase())) planned.push({ col, val });
  };

  switch (table) {
    case 'rdl_national1_ls':
      add('road_name', name);
      add('road_no', no);
      add('road_type', '국도');
      break;
    case 'rdl_national2_interc_ls':
      // name varchar(1) — 컬럼 길이만큼만 저장
      add('name', name.slice(0, 1));
      add('length', lengthAttr);
      add('defense', defense);
      add('sinuosity', sinuosity);
      break;
    case 'rdl_nsprov_0610_ls':
      add('rn', name.slice(0, 80));
      add('road_no', no);
      add('road_type', '국가지원지방');
      add('length', lengthAttr);
      add('defense', defense);
      add('sinuosity', sinuosity);
      add('alwnc_resn', detailReason);
      break;
    case 'rdl_prov_0610_ls':
      add('rn', name.slice(0, 10));
      add('road_no', no);
      add('road_type', '지방도');
      add('length', lengthAttr);
      add('defense', defense);
      break;
    case 'rdl_county_opn_ls':
    case 'rdl_county_uopn_ls':
      add('name', name.slice(0, 16));
      add('no', no);
      add('admin_no', no ? `군도${no}` : '');
      add('admin', dept);
      add('admin_clas', '군도');
      add('length', lengthAttr);
      add('defense', defense);
      add('sinuosity', sinuosity);
      break;
    case 'rdl_perch_opn_ls':
    case 'rdl_perch_uopn_ls':
      add('name', name.slice(0, 16));
      add('no', no);
      add('admin_no', no);
      add('admin', dept);
      add('admin_clas', '농도');
      add('length', lengthAttr);
      add('defense', defense);
      add('sinuosity', sinuosity);
      break;
    case 'rdl_sprd_0610_ls':
      add('rn', name.slice(0, 80));
      add('rds_man_no', no);
      add('rbp_cn', address);
      add('alwnc_resn', detailReason);
      add('length', lengthAttr);
      add('defense', defense);
      break;
    case 'rdl_frl_0610_ls':
      add('rn', name.slice(0, 80));
      add('rds_man_no', no);
      add('rep_cn', address);
      add('alwnc_resn', detailReason);
      add('length', lengthAttr);
      add('defense', defense);
      add('sinuosity', sinuosity);
      break;
    default:
      add('road_name', name);
      add('rn', name);
      add('name', name);
      add('road_no', no);
      add('no', no);
      add('admin', dept);
      break;
  }

  const values: AttrSqlValue[] = [];
  for (const p of planned) {
    const dt = typeMap.get(p.col.toLowerCase()) ?? 'text';
    const lit = toSqlLiteral(p.val, dt);
    if (!lit.ok) {
      return { ok: false, error: `${p.col}: ${lit.error}` };
    }
    values.push({ col: p.col, sql: lit.sql });
  }
  return { ok: true, values };
}

async function readGeomGeoJson4326(
  table: string,
  ogcFid: number
): Promise<RoadNetworkGeom | null> {
  const tableName = await resolveLayerTableName(table);
  if (!tableName) return null;
  const safeTbl = tableName.replace(/"/g, '""');
  const res = await db.execute(
    sql.raw(
      `SELECT ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS g
       FROM layer."${safeTbl}"
       WHERE ogc_fid = ${ogcFid} AND geom IS NOT NULL
       LIMIT 1`
    )
  );
  return parseGeom((res.rows?.[0] as { g?: unknown } | undefined)?.g);
}

function geomSqlExpr(geom: RoadNetworkGeom | null | undefined): string | null {
  if (!geom) return null;
  // MultiLineString / LineString 모두 허용
  const normalized: RoadNetworkGeom =
    geom.type === 'MultiLineString'
      ? geom
      : { type: 'LineString', coordinates: geom.coordinates };
  const json = JSON.stringify(normalized).replace(/'/g, "''");
  return `ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${json}'), 4326), 5181))`;
}

function attrSqlValuesToRecord(values: AttrSqlValue[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const v of values) {
    if (v.sql === 'NULL') {
      out[v.col] = null;
      continue;
    }
    if (v.sql.startsWith("'") && v.sql.endsWith("'")) {
      out[v.col] = v.sql.slice(1, -1).replace(/''/g, "'");
      continue;
    }
    out[v.col] = v.sql;
  }
  return out;
}

async function geomToWkt5181(geom: RoadNetworkGeom | null | undefined): Promise<string | null> {
  const expr = geomSqlExpr(geom);
  if (!expr) return null;
  try {
    const res = await db.execute(sql.raw(`SELECT ST_AsText(${expr}) AS wkt`));
    const wkt = String((res.rows?.[0] as { wkt?: string } | undefined)?.wkt ?? '').trim();
    return wkt || null;
  } catch {
    return null;
  }
}

async function fetchOneRowById(id: string): Promise<RoadNetworkRow | null> {
  const parsed = parseStoredId(id);
  if (!parsed) return null;
  const src = SOURCES.find((s) => s.table === parsed.table);
  if (!src) return null;
  const tableName = await resolveLayerTableName(src.table);
  if (!tableName) return null;
  const safeTbl = tableName.replace(/"/g, '""');
  const select = buildSelect(src, safeTbl);
  const res = await db.execute(
    sql.raw(
      `SELECT * FROM (${select}) u WHERE u.id = '${esc(id)}' LIMIT 1`
    )
  );
  const row = res.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const geom = parseGeom(row.geom);
  return {
    id: String(row.id ?? '').trim(),
    roadName: cleanRoadNetworkDisplayText(row.roadName),
    roadNo: cleanRoadNetworkDisplayText(row.roadNo),
    roadType: String(row.roadType ?? src.roadType).trim() as RoadNetworkType,
    openStatus: (String(row.openStatus ?? src.openStatus).trim() || '개설') as RoadNetworkOpenStatus,
    lengthM: parseLengthM(row.lengthM),
    sect: '',
    dept: String(row.dept ?? '').trim(),
    manager: '',
    startPoint: '',
    endPoint: '',
    startPointCoord: endpointFromGeom(geom, 'start'),
    endPointCoord: endpointFromGeom(geom, 'end'),
    lengthAttr: String(row.lengthAttr ?? '').trim(),
    defense: String(row.defense ?? '').trim(),
    sinuosity: formatRoadNetworkNumericAttr(row.sinuosity),
    detailReason: String(row.detailReason ?? '').trim(),
    address: String(row.address ?? '').trim(),
    designateDate: '',
    geom,
    maintenance: [],
    complaints: [],
    attachments: [],
    history: [],
  };
}

export type SaveRoadNetworkInput = {
  id?: string;
  roadName?: string;
  roadNo?: string;
  roadType?: RoadNetworkType;
  openStatus?: RoadNetworkOpenStatus;
  dept?: string;
  manager?: string;
  startPoint?: string;
  endPoint?: string;
  lengthAttr?: string;
  defense?: string;
  sinuosity?: string;
  detailReason?: string;
  address?: string;
  geom?: RoadNetworkGeom | null;
};

/**
 * 도로망도 저장 — 종류·개설여부에 맞는 layer.rdl_* 테이블에 INSERT/UPDATE
 */
export async function saveRoadNetworkRow(
  params: SaveRoadNetworkInput
): Promise<{ success: boolean; row?: RoadNetworkRow; error?: string }> {
  const roadType = (String(params.roadType ?? '일반도로').trim() || '일반도로') as RoadNetworkType;
  const openStatus = (String(params.openStatus ?? '개설').trim() || '개설') as RoadNetworkOpenStatus;
  const roadName = String(params.roadName ?? '').trim();
  if (roadType !== '입체교차로' && !roadName) {
    return { success: false, error: '도로명을 입력하세요.' };
  }

  const target = resolveTargetSource(roadType, openStatus);
  if (!target) return { success: false, error: '저장할 도로종류 테이블을 찾지 못했습니다.' };

  const tableName = await resolveLayerTableName(target.table);
  if (!tableName) return { success: false, error: `테이블이 없습니다: ${target.table}` };
  const typeMap = await getColumnTypeMap(tableName);
  const built = buildAttrSqlValues(target.table, typeMap, {
    roadName,
    roadNo: String(params.roadNo ?? '').trim(),
    roadType,
    dept: String(params.dept ?? '').trim(),
    lengthAttr: String(params.lengthAttr ?? '').trim(),
    defense: String(params.defense ?? '').trim(),
    sinuosity: String(params.sinuosity ?? '').trim(),
    detailReason: String(params.detailReason ?? '').trim(),
    address: String(params.address ?? '').trim(),
  });
  if (!built.ok) return { success: false, error: built.error };

  let geom = params.geom ?? null;
  const id = String(params.id ?? '').trim();
  const parsed = parseStoredId(id);
  const attrValues = attrSqlValuesToRecord(built.values);

  try {
    if (parsed && parsed.table !== target.table) {
      if (!geom) {
        geom = await readGeomGeoJson4326(parsed.table, parsed.ogcFid);
      }
      const oldTbl = await resolveLayerTableName(parsed.table);
      if (oldTbl) {
        const deleted = await deleteTableRowByKey({
          table: parsed.table,
          schema: 'layer',
          keyField: 'ogc_fid',
          keyValue: parsed.ogcFid,
        });
        if (!deleted.success) {
          return { success: false, error: deleted.error ?? '기존 행 삭제에 실패했습니다.' };
        }
      }
    }

    const geomWkt5181 = await geomToWkt5181(geom);
    const geomClear = params.geom === null;
    const moveInsert = Boolean(parsed && parsed.table !== target.table);

    if (!parsed || moveInsert || isClientOnlyId(id)) {
      if (Object.keys(attrValues).length === 0 && !geomWkt5181) {
        return { success: false, error: '저장할 도형 또는 속성이 없습니다.' };
      }
      const inserted = await insertTableRow({
        table: target.table,
        schema: 'layer',
        keyField: 'ogc_fid',
        values: attrValues,
        allowPhysicalColumns: true,
        geomWkt5181,
      });
      if (!inserted.success) {
        return { success: false, error: inserted.error ?? '등록에 실패했습니다.' };
      }
      const ogcFid = Number(inserted.keyValue);
      if (!Number.isFinite(ogcFid)) {
        return { success: false, error: '등록 후 식별자를 확인하지 못했습니다.' };
      }
      const row = await fetchOneRowById(`${target.table}:${ogcFid}`);
      if (!row) return { success: false, error: '등록 후 조회에 실패했습니다.' };
      return { success: true, row };
    }

    const updated = await updateTableRowByKey({
      table: target.table,
      schema: 'layer',
      keyField: 'ogc_fid',
      keyValue: parsed.ogcFid,
      changes: attrValues,
      allowPhysicalColumns: true,
      geomWkt5181,
      geomClear,
    });
    if (!updated.success) {
      if (updated.error === '변경할 항목이 없습니다.') {
        const row = await fetchOneRowById(id);
        return row ? { success: true, row } : { success: false, error: '수정할 행이 없습니다.' };
      }
      return { success: false, error: updated.error ?? '수정에 실패했습니다.' };
    }
    const row = await fetchOneRowById(`${target.table}:${parsed.ogcFid}`);
    if (!row) return { success: false, error: '수정 후 조회에 실패했습니다.' };
    return { success: true, row };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
    const cause =
      e && typeof e === 'object' && 'cause' in e
        ? (e as { cause?: { message?: string } }).cause?.message
        : undefined;
    return { success: false, error: cause || msg };
  }
}

/**
 * 도로망도 1건 삭제 (layer.rdl_* ogc_fid)
 */
export async function deleteRoadNetworkRow(params: {
  id?: string;
}): Promise<{ success: boolean; error?: string }> {
  const id = String(params.id ?? '').trim();
  if (isClientOnlyId(id) && !parseStoredId(id)) {
    return { success: true };
  }
  const parsed = parseStoredId(id);
  if (!parsed) return { success: false, error: '삭제할 식별자가 올바르지 않습니다.' };
  if (!SOURCES.some((s) => s.table === parsed.table)) {
    return { success: false, error: '삭제할 수 없는 테이블입니다.' };
  }
  const tableName = await resolveLayerTableName(parsed.table);
  if (!tableName) return { success: false, error: '테이블이 없습니다.' };
  return deleteTableRowByKey({
    table: parsed.table,
    schema: 'layer',
    keyField: 'ogc_fid',
    keyValue: parsed.ogcFid,
  });
}
