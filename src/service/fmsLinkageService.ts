/**
 * 안전점검 — layer 시설물 마스터 + 점검진단실적 (facil_no). 도로 테이블 한 쌍, 시스템 구분은 시설물구분
 */
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/database/db';
import { fmsIdentifierHeader } from '@/database/schema/fms_identifier_header';
import {
  FMS_FACILITY_TABLE,
  FMS_INSPECTION_TABLE,
  getFmsFacilGbnFilterForSystem,
} from '@/lib/fmsLinkage/fmsBinding';
import { defaultHeaderLabels } from '@/lib/fmsLinkage/fmsHeaderSeed';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';

const SKIP_DETAIL_FIELDS = new Set([
  'id',
  'geom',
  'sync_status',
  'synced_at',
  'created_at',
  'updated_at',
  'addr_sido',
  'addr_gugun',
  'addr_dong',
  'addr_detail',
]);

export type FmsLinkageListRow = {
  id: string;
  facilNo: string;
  facilNm: string;
  facilKind: string;
  facilOwner: string;
  addrFull: string;
};

export type FmsLinkageDetailAttr = {
  field: string;
  label: string;
  value: string;
};

export type FmsLinkageInspectionRow = {
  id: string;
  facilNo: string;
  dignSeq: string;
  dignGbn: string;
  startYmd: string;
  endYmd: string;
  stateGrade: string;
  attributes: FmsLinkageDetailAttr[];
};

function text(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

async function layerTableExists(table: string): Promise<boolean> {
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'layer' AND table_name = '${table}'
         LIMIT 1`
      )
    );
    return (res.rows?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function getFmsFacilityList(params?: { keyword?: string; system?: string }) {
  if (!(await layerTableExists(FMS_FACILITY_TABLE))) {
    return { rows: [] as FmsLinkageListRow[], total: 0 };
  }

  const sourceSql = `SELECT facil_no, facil_nm, facil_kind, facil_gbn, facil_owner, addr_full FROM layer.${FMS_FACILITY_TABLE}`;

  const keyword = text(params?.keyword);
  const like = keyword ? `%${keyword}%` : null;
  const gbnFilter = getFmsFacilGbnFilterForSystem(params?.system);
  const gbnSql =
    gbnFilter && gbnFilter.length > 0
      ? `AND facil_gbn IN (${gbnFilter.map((g) => `'${g.replace(/'/g, "''")}'`).join(',')})`
      : '';
  /** ST/WS 등 접두 무시, 번호 속 연도(4자리) → 나머지 오름차순 */
  const orderSql = `ORDER BY (substring(facil_no from '[0-9]{4}'))::integer ASC NULLS LAST, regexp_replace(facil_no, '^[A-Za-z]+', '') ASC NULLS LAST`;

  try {
    const res = like
      ? await db.execute(sql`
          SELECT facil_no, facil_nm, facil_kind, facil_owner, addr_full FROM (
            SELECT DISTINCT ON (facil_no) facil_no, facil_nm, facil_kind, facil_gbn, facil_owner, addr_full
            FROM (${sql.raw(sourceSql)}) u
            WHERE coalesce(facil_no, '') <> ''
            ${sql.raw(gbnSql)}
            ORDER BY facil_no
          ) d
          WHERE facil_nm ILIKE ${like}
             OR facil_no ILIKE ${like}
             OR coalesce(addr_full, '') ILIKE ${like}
             OR coalesce(facil_kind, '') ILIKE ${like}
             OR coalesce(facil_gbn, '') ILIKE ${like}
             OR coalesce(facil_owner, '') ILIKE ${like}
          ${sql.raw(orderSql)}
        `)
      : await db.execute(sql`
          SELECT facil_no, facil_nm, facil_kind, facil_owner, addr_full FROM (
            SELECT DISTINCT ON (facil_no) facil_no, facil_nm, facil_kind, facil_gbn, facil_owner, addr_full
            FROM (${sql.raw(sourceSql)}) u
            WHERE coalesce(facil_no, '') <> ''
            ${sql.raw(gbnSql)}
            ORDER BY facil_no
          ) d
          ${sql.raw(orderSql)}
        `);

    const rows: FmsLinkageListRow[] = (res.rows as Record<string, unknown>[]).map((r) => {
      const facilNo = text(r.facil_no);
      return {
        id: facilNo,
        facilNo,
        facilNm: text(r.facil_nm),
        facilKind: text(r.facil_kind),
        facilOwner: text(r.facil_owner),
        addrFull: formatAddressStripSidoSigungu(text(r.addr_full)),
      };
    });
    return { rows, total: rows.length };
  } catch {
    return { rows: [] as FmsLinkageListRow[], total: 0 };
  }
}

export type FmsFacilityOverlayRow = {
  facilNo: string;
  geom: Record<string, unknown>;
};

/** 지도 오버레이용 — geom 있는 시설만 (목록 검색·시스템 필터와 동일) */
export async function getFmsFacilityGeomOverlayList(params?: {
  keyword?: string;
  system?: string;
}): Promise<{ rows: FmsFacilityOverlayRow[]; error?: string }> {
  if (!(await layerTableExists(FMS_FACILITY_TABLE))) return { rows: [] };

  const sourceSql = `SELECT facil_no, facil_nm, facil_kind, facil_gbn, facil_owner, addr_full, geom
              FROM layer.${FMS_FACILITY_TABLE}
              WHERE geom IS NOT NULL`;

  const keyword = text(params?.keyword);
  const like = keyword ? `%${keyword}%` : null;
  const gbnFilter = getFmsFacilGbnFilterForSystem(params?.system);
  const gbnSql =
    gbnFilter && gbnFilter.length > 0
      ? `AND facil_gbn IN (${gbnFilter.map((g) => `'${g.replace(/'/g, "''")}'`).join(',')})`
      : '';

  try {
    const res = like
      ? await db.execute(sql`
          SELECT facil_no, geom FROM (
            SELECT DISTINCT ON (facil_no)
              facil_no, facil_nm, facil_kind, facil_gbn, facil_owner, addr_full,
              ST_AsGeoJSON(ST_Transform(geom, 3857))::json AS geom
            FROM (${sql.raw(sourceSql)}) u
            WHERE coalesce(facil_no, '') <> ''
            ${sql.raw(gbnSql)}
            ORDER BY facil_no
          ) d
          WHERE facil_nm ILIKE ${like}
             OR facil_no ILIKE ${like}
             OR coalesce(addr_full, '') ILIKE ${like}
             OR coalesce(facil_kind, '') ILIKE ${like}
             OR coalesce(facil_gbn, '') ILIKE ${like}
             OR coalesce(facil_owner, '') ILIKE ${like}
        `)
      : await db.execute(sql`
          SELECT facil_no, geom FROM (
            SELECT DISTINCT ON (facil_no)
              facil_no, facil_nm, facil_kind, facil_gbn, facil_owner, addr_full,
              ST_AsGeoJSON(ST_Transform(geom, 3857))::json AS geom
            FROM (${sql.raw(sourceSql)}) u
            WHERE coalesce(facil_no, '') <> ''
            ${sql.raw(gbnSql)}
            ORDER BY facil_no
          ) d
        `);

    const rows: FmsFacilityOverlayRow[] = [];
    for (const r of res.rows as Record<string, unknown>[]) {
      const facilNo = text(r.facil_no);
      const geom = r.geom;
      if (!facilNo || !geom || typeof geom !== 'object') continue;
      rows.push({ facilNo, geom: geom as Record<string, unknown> });
    }
    return { rows };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 지도 이동용 extent — geom 없으면 null */
export async function getFmsFacilityExtent3857ByFacilNo(params: {
  facilNo?: string;
  system?: string;
}): Promise<{ extent3857: [number, number, number, number] | null; error?: string }> {
  const facilNo = text(params?.facilNo);
  if (!facilNo) return { extent3857: null };

  if (!(await layerTableExists(FMS_FACILITY_TABLE))) return { extent3857: null };

  const escaped = facilNo.replace(/'/g, "''");

  try {
    const res = await db.execute(sql.raw(`
      SELECT
        ST_XMin(ST_Envelope(ST_Transform(geom, 3857)))::float8 AS xmin,
        ST_YMin(ST_Envelope(ST_Transform(geom, 3857)))::float8 AS ymin,
        ST_XMax(ST_Envelope(ST_Transform(geom, 3857)))::float8 AS xmax,
        ST_YMax(ST_Envelope(ST_Transform(geom, 3857)))::float8 AS ymax
      FROM layer.${FMS_FACILITY_TABLE}
      WHERE facil_no = '${escaped}'
        AND geom IS NOT NULL
      LIMIT 1
    `));
    const row = res.rows?.[0] as
      | { xmin?: number; ymin?: number; xmax?: number; ymax?: number }
      | undefined;
    if (!row) return { extent3857: null };
    const coords = [row.xmin, row.ymin, row.xmax, row.ymax].map(Number);
    if (coords.length === 4 && coords.every((v) => Number.isFinite(v))) {
      return { extent3857: coords as [number, number, number, number] };
    }
    return { extent3857: null };
  } catch (e) {
    return { extent3857: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function loadHeaderLabels(identifier: 'BASTB_MASTER' | 'MANTB_DIGN_RESULT'): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const rows = await db
      .select({
        colName: fmsIdentifierHeader.colName,
        colNameKor: fmsIdentifierHeader.colNameKor,
        colOrder: fmsIdentifierHeader.colOrder,
      })
      .from(fmsIdentifierHeader)
      .where(eq(fmsIdentifierHeader.identifier, identifier))
      .orderBy(asc(fmsIdentifierHeader.colOrder));
    for (const row of rows) {
      const key = text(row.colName).toLowerCase();
      if (!key) continue;
      map.set(key, text(row.colNameKor) || key);
    }
  } catch {
    /* 헤더 없으면 컬럼명 그대로 */
  }
  for (const [key, label] of Object.entries(defaultHeaderLabels(identifier))) {
    if (!map.has(key)) map.set(key, label);
  }
  return map;
}

function rowToAttributes(
  found: Record<string, unknown>,
  labels: Map<string, string>
): FmsLinkageDetailAttr[] {
  const attributes: FmsLinkageDetailAttr[] = [];
  const orderedKeys = [...labels.keys()];
  const restKeys = Object.keys(found).filter(
    (k) => !orderedKeys.includes(k) && !SKIP_DETAIL_FIELDS.has(k)
  );
  for (const field of [...orderedKeys, ...restKeys]) {
    if (SKIP_DETAIL_FIELDS.has(field)) continue;
    if (!(field in found) && !labels.has(field)) continue;
    attributes.push({
      field,
      label: labels.get(field) || field,
      value: field.endsWith('_ymd') ? formatYmd(text(found[field])) : text(found[field]),
    });
  }
  return attributes;
}

function formatYmd(raw: string): string {
  const s = text(raw);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}

async function loadInspectionsByFacilNo(facilNo: string): Promise<FmsLinkageInspectionRow[]> {
  if (!(await layerTableExists(FMS_INSPECTION_TABLE))) return [];

  const escaped = facilNo.replace(/'/g, "''");
  const sourceSql = `SELECT * FROM layer.${FMS_INSPECTION_TABLE} WHERE facil_no = '${escaped}'`;

  try {
    const res = await db.execute(sql`
      SELECT * FROM (
        SELECT DISTINCT ON (facil_no, dign_seq) *
        FROM (${sql.raw(sourceSql)}) u
        ORDER BY facil_no, dign_seq
      ) d
      ORDER BY end_ymd DESC NULLS LAST, dign_seq DESC NULLS LAST
    `);
    const labels = await loadHeaderLabels('MANTB_DIGN_RESULT');
    return (res.rows as Record<string, unknown>[]).map((r) => {
      const seq = text(r.dign_seq);
      return {
        id: `${text(r.facil_no)}::${seq}`,
        facilNo: text(r.facil_no),
        dignSeq: seq,
        dignGbn: text(r.dign_gbn),
        startYmd: formatYmd(text(r.start_ymd)),
        endYmd: formatYmd(text(r.end_ymd)),
        stateGrade: text(r.state_grade),
        attributes: rowToAttributes(r, labels),
      };
    });
  } catch {
    return [];
  }
}

export async function getFmsFacilityDetail(params?: { id?: string }) {
  const facilNo = text(params?.id);
  if (!facilNo) {
    return {
      error: '잘못된 식별자입니다.',
      row: null as null,
      attributes: [] as FmsLinkageDetailAttr[],
      inspections: [] as FmsLinkageInspectionRow[],
    };
  }

  let found: Record<string, unknown> | null = null;
  if (await layerTableExists(FMS_FACILITY_TABLE)) {
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT * FROM layer.${FMS_FACILITY_TABLE} WHERE facil_no = '${facilNo.replace(/'/g, "''")}' LIMIT 1`
        )
      );
      found = (res.rows as Record<string, unknown>[])[0] ?? null;
    } catch {
      found = null;
    }
  }

  if (!found) {
    return {
      error: '항목을 찾을 수 없습니다.',
      row: null as null,
      attributes: [] as FmsLinkageDetailAttr[],
      inspections: [] as FmsLinkageInspectionRow[],
    };
  }

  const labels = await loadHeaderLabels('BASTB_MASTER');
  const attributes = rowToAttributes(found, labels);
  const inspections = await loadInspectionsByFacilNo(facilNo);

  const row: FmsLinkageListRow = {
    id: facilNo,
    facilNo,
    facilNm: text(found.facil_nm),
    facilKind: text(found.facil_kind),
    facilOwner: text(found.facil_owner),
    addrFull: text(found.addr_full),
  };

  // 데이터 이력관리에 조회 저장을 위해 추가
  void import('./dataLogService')
    .then(({ recordViewLog }) =>
      recordViewLog({
        tableName: FMS_FACILITY_TABLE,
        keyField: 'facil_no',
        keyValue: facilNo,
        serviceName: '안전점검',
      })
    )
    .catch(() => {});

  return { row, attributes, inspections };
}

/** 시설 geom 미적재 행 — 주소/시설명 → 지적 필지 폴리곤 적재 */
export async function backfillFmsFacilityGeomAction(params?: { force?: boolean; limit?: number }) {
  const { backfillFmsFacilityGeom } = await import('@/lib/fmsLinkage/backfillFacilityGeom');
  return backfillFmsFacilityGeom(params);
}
