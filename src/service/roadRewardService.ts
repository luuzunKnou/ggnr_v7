/**
 * 보상편입용지 — layer.road_reward / road_reward_parcel
 * 필지 PNU·geom 은 읍면동+지번(당초) 주소로 지적에서 조회해 채운다.
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { fetchVworldCadastralGeomByPnu } from '@/lib/vworldCadastralGeom';
import { getJijukGeomByPnu } from './excelUploadService';
import { deleteTableRowByKey } from './layerRowService';

const MAIN_TABLE = 'road_reward';
const PARCEL_TABLE = 'road_reward_parcel';
const DEFAULT_SCHEMA = 'layer';
const SEARCH_SCHEMAS = ['layer', 'public'] as const;

const CASE_ATTR_FIELDS = [
  'name',
  'org',
  'policy',
  'unit',
  'detail',
  'budget_item',
  'stat_item',
  'appraisal1_name',
  'appraisal2_name',
] as const;

export type RoadRewardParcelDto = {
  id: string;
  ogcFid: number;
  pnu?: string;
  eupmyeonDong: string;
  jibunOriginal: string;
  jibunIncluded: string;
  areaOriginal: number;
  areaIncluded: number;
  jimok: string;
  appraisal1Value: number;
  appraisal2Value: number;
  appliedUnitPrice: number;
  compensationAmount: number;
  ownerAddress: string;
  ownerName: string;
  note: string;
  geometry3857?: Record<string, unknown> | null;
  extent3857?: [number, number, number, number] | null;
  mockLonLat: { lon: number; lat: number };
};

export type RoadRewardCaseDto = {
  id: string;
  ogcFid: number;
  name: string;
  org: string;
  policy: string;
  unit: string;
  detail: string;
  budgetItem: string;
  statItem: string;
  appraisal1Name: string;
  appraisal2Name: string;
  geometry3857?: Record<string, unknown> | null;
  extent3857?: [number, number, number, number] | null;
  parcels: RoadRewardParcelDto[];
  parcelCount?: number;
};

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function cell(raw: unknown): string {
  return String(raw ?? '').trim();
}

function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function resolveTableWithSchema(
  wantedLower: string
): Promise<{ tableName: string; schema: string } | null> {
  const schemasIn = SEARCH_SCHEMAS.map((s) => `'${esc(s)}'`).join(',');
  const res = await db.execute(
    sql.raw(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema IN (${schemasIn}) AND lower(table_name) = '${esc(wantedLower)}'
       ORDER BY CASE table_schema WHEN 'layer' THEN 0 ELSE 1 END
       LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { table_schema?: string; table_name?: string } | undefined;
  if (!row?.table_name) return null;
  return {
    tableName: String(row.table_name).trim(),
    schema: String(row.table_schema ?? DEFAULT_SCHEMA).trim(),
  };
}

async function getTableColumns(schema: string, table: string): Promise<string[]> {
  const res = await db.execute(
    sql.raw(
      `SELECT column_name AS name
       FROM information_schema.columns
       WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(table)}'
       ORDER BY ordinal_position`
    )
  );
  return (res.rows as { name?: string }[])
    .map((r) => String(r?.name ?? '').trim())
    .filter(Boolean);
}

function findColumn(columns: string[], name: string): string | null {
  const lower = name.toLowerCase();
  return columns.find((c) => c.toLowerCase() === lower) ?? null;
}

/** FK 컬럼 — DB에 따라 reward_key 또는 reward_ogc_fid */
function findParentKeyCol(columns: string[]): string | null {
  return findColumn(columns, 'reward_key') ?? findColumn(columns, 'reward_ogc_fid');
}

function parseGeom3857(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function extentFromRow(row: Record<string, unknown>): [number, number, number, number] | null {
  if (row.xmin == null || row.ymin == null || row.xmax == null || row.ymax == null) return null;
  const coords = [Number(row.xmin), Number(row.ymin), Number(row.xmax), Number(row.ymax)];
  return coords.every((v) => Number.isFinite(v))
    ? (coords as [number, number, number, number])
    : null;
}

function extentCenterLonLat(
  extent: [number, number, number, number] | null
): { lon: number; lat: number } {
  if (!extent) return { lon: 129.4, lat: 36.99 };
  const cx = (extent[0] + extent[2]) / 2;
  const cy = (extent[1] + extent[3]) / 2;
  const lon = (cx * 180) / 20037508.34;
  const lat =
    (Math.atan(Math.exp((cy * Math.PI) / 20037508.34)) * 360) / Math.PI - 90;
  return {
    lon: Number(lon.toFixed(6)),
    lat: Number(lat.toFixed(6)),
  };
}

function computeDerived(
  appraisal1Value: number,
  appraisal2Value: number,
  areaIncluded: number
): { appliedUnitPrice: number; compensationAmount: number } {
  const a1 = Number.isFinite(appraisal1Value) ? appraisal1Value : 0;
  const a2 = Number.isFinite(appraisal2Value) ? appraisal2Value : 0;
  const area = Number.isFinite(areaIncluded) ? areaIncluded : 0;
  const appliedUnitPrice = Math.round((a1 + a2) / 2);
  const compensationAmount = Math.round(appliedUnitPrice * area);
  return { appliedUnitPrice, compensationAmount };
}

function mapCaseAttrs(row: Record<string, unknown>, ogcFid: number): Omit<RoadRewardCaseDto, 'parcels'> {
  return {
    id: String(ogcFid),
    ogcFid,
    name: cell(row.name),
    org: cell(row.org),
    policy: cell(row.policy),
    unit: cell(row.unit),
    detail: cell(row.detail),
    budgetItem: cell(row.budget_item),
    statItem: cell(row.stat_item),
    appraisal1Name: cell(row.appraisal1_name),
    appraisal2Name: cell(row.appraisal2_name),
    geometry3857: parseGeom3857(row.geom3857 ?? row.geom_geojson),
    extent3857: extentFromRow(row),
  };
}

function mapParcelRow(row: Record<string, unknown>): RoadRewardParcelDto | null {
  const ogcFid = Number(row.ogc_fid);
  if (!Number.isFinite(ogcFid)) return null;
  const appraisal1Value = num(row.appraisal1_value);
  const appraisal2Value = num(row.appraisal2_value);
  const areaIncluded = num(row.area_included);
  const storedUnit = num(row.applied_unit_price);
  const storedAmount = num(row.compensation_amount);
  const derived = computeDerived(appraisal1Value, appraisal2Value, areaIncluded);
  const extent3857 = extentFromRow(row);
  return {
    id: String(ogcFid),
    ogcFid,
    pnu: cell(row.pnu) || undefined,
    eupmyeonDong: cell(row.eupmyeon_dong),
    jibunOriginal: cell(row.jibun_original),
    jibunIncluded: cell(row.jibun_included),
    areaOriginal: num(row.area_original),
    areaIncluded,
    jimok: cell(row.jimok),
    appraisal1Value,
    appraisal2Value,
    appliedUnitPrice: storedUnit || derived.appliedUnitPrice,
    compensationAmount: storedAmount || derived.compensationAmount,
    ownerAddress: cell(row.owner_address),
    ownerName: cell(row.owner_name),
    note: cell(row.note),
    geometry3857: parseGeom3857(row.geom3857),
    extent3857,
    mockLonLat: extentCenterLonLat(extent3857),
  };
}

const geomExtentSelect = `
  ST_XMin(ST_Envelope(ST_Transform(r.geom, 3857)))::float8 AS xmin,
  ST_YMin(ST_Envelope(ST_Transform(r.geom, 3857)))::float8 AS ymin,
  ST_XMax(ST_Envelope(ST_Transform(r.geom, 3857)))::float8 AS xmax,
  ST_YMax(ST_Envelope(ST_Transform(r.geom, 3857)))::float8 AS ymax,
  ST_AsGeoJSON(ST_Transform(r.geom, 3857))::text AS geom3857`;

/** 지적 PNU는 19자리(행정10 + 대지/산1 + 본번4 + 부번4) */
function isValidPnuDigits(pnu: string): boolean {
  const d = String(pnu ?? '').replace(/\D/g, '');
  return d.length === 19 || d.length === 18;
}

function normalizeEupmyeonDong(raw: string): string {
  // 자료에 «울진면»으로 들어간 건은 실제 행정구역 «북면»
  return String(raw ?? '')
    .trim()
    .replace(/(^|\s)울진면(\s|$)/g, '$1북면$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 읍면동·지번만으로 본번/부번·산 여부를 분해.
 * excelUploadService.parseAddressForPnu 는 전체 주소에서 «산»을 무차별 제거해
 * «구산리» → «구 리» 로 깨지므로 보상편입용지는 별도 파서를 쓴다.
 */
function parseEmdJibunForPnu(
  eupmyeonDong: string,
  jibunOriginal: string
): { emdName: string; riName: string; bonbun: string; bubun: string; isMountain: boolean } | null {
  const emdPart = normalizeEupmyeonDong(eupmyeonDong);
  let jibun = String(jibunOriginal ?? '').replace(/번지/g, '').trim();
  if (!emdPart || !jibun) return null;

  const isMountain = /^산/.test(jibun);
  if (isMountain) jibun = jibun.replace(/^산\s*/, '').trim();

  const emdTokens = emdPart.split(/\s+/).filter(Boolean);
  let emdName = '';
  let riName = '';
  for (const t of emdTokens) {
    if (/(읍|면|동)$/.test(t)) emdName = t;
    else if (/리$/.test(t)) riName = t;
  }
  if (!emdName && emdTokens.length >= 1) emdName = emdTokens[0]!;
  if (!riName && emdTokens.length >= 2) riName = emdTokens[emdTokens.length - 1]!;
  if (!emdName || !riName) return null;

  const m = jibun.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const bonbun = (m[1] ?? '0').padStart(4, '0').slice(-4);
  const bubun = (m[2] ?? '0').padStart(4, '0').slice(-4);
  return { emdName, riName, bonbun, bubun, isMountain };
}

async function resolveRiCd(emdName: string, riName: string): Promise<string | null> {
  const nameCols = ['emd_nm', 'adm_nm', 'name'];
  let emdCd: string | null = null;
  for (const col of nameCols) {
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT emd_cd AS code FROM public_layer.emd
           WHERE ${quoteIdent(col)} = '${esc(emdName)}' LIMIT 1`
        )
      );
      const code = String((res.rows?.[0] as { code?: string } | undefined)?.code ?? '').trim();
      if (code) {
        emdCd = code;
        break;
      }
    } catch {
      /* 컬럼 없을 수 있음 */
    }
  }
  if (!emdCd) return null;

  const riNameCols = ['ri_nm', 'adm_nm', 'name'];
  for (const col of riNameCols) {
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT ri_cd AS code FROM public_layer.ri
           WHERE ri_cd LIKE '${esc(emdCd)}%' AND ${quoteIdent(col)} = '${esc(riName)}'
           LIMIT 1`
        )
      );
      const code = String((res.rows?.[0] as { code?: string } | undefined)?.code ?? '').trim();
      if (code) return code;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function buildPnu19(riCd: string, landType: '1' | '2', bonbun: string, bubun: string): string {
  return `${riCd}${landType}${bonbun}${bubun}`;
}

/** VWorld 연속지적 GeoJSON(4326) → WKT(5181) */
async function geoJson4326ToWkt5181(geometry4326: Record<string, unknown>): Promise<string | null> {
  try {
    const geojson = JSON.stringify(geometry4326).replace(/'/g, "''");
    const res = await db.execute(
      sql.raw(
        `SELECT ST_AsText(
           ST_Transform(
             ST_SetSRID(ST_GeomFromGeoJSON('${geojson}'), 4326),
             5181
           )
         ) AS wkt`
      )
    );
    const wkt = String((res.rows?.[0] as { wkt?: string } | undefined)?.wkt ?? '').trim();
    return wkt || null;
  } catch {
    return null;
  }
}

/** 로컬 지적 없으면 VWorld 연속지적 API로 geom 폴백 */
async function lookupVworldGeomByPnu(
  pnuDigits: string
): Promise<{ pnu: string; geomWkt5181: string | null }> {
  const digits = String(pnuDigits ?? '').replace(/\D/g, '');
  if (digits.length < 19) return { pnu: '', geomWkt5181: null };
  const hit = await fetchVworldCadastralGeomByPnu(digits.slice(0, 19));
  if (!hit) return { pnu: digits.slice(0, 19), geomWkt5181: null };
  const wkt = await geoJson4326ToWkt5181(hit.geometry4326);
  return { pnu: hit.pnu || digits.slice(0, 19), geomWkt5181: wkt };
}

async function lookupJijukGeomByPnuDigits(
  pnuDigits: string,
  preferMountain: boolean
): Promise<{ pnu: string; geomWkt5181: string | null }> {
  const digits = String(pnuDigits ?? '').replace(/\D/g, '');
  if (digits.length < 18) return { pnu: '', geomWkt5181: null };

  if (digits.length >= 19) {
    const wkt = await getJijukGeomByPnu(digits.slice(0, 19), 5181);
    if (wkt) return { pnu: digits.slice(0, 19), geomWkt5181: wkt };
  }

  const admin = digits.slice(0, 10);
  const lot = digits.length >= 19 ? digits.slice(11, 19) : digits.slice(10, 18);
  const landPrefer = preferMountain ? '2' : '1';
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT ST_AsText(ST_SetSRID(geom, 5181)) AS wkt,
                REGEXP_REPLACE(pnu::text, '[^0-9]', '', 'g') AS pnu_digits
         FROM public_layer.jijuk
         WHERE SUBSTRING(REGEXP_REPLACE(pnu::text, '[^0-9]', '', 'g'), 1, 10) = '${esc(admin)}'
           AND SUBSTRING(REGEXP_REPLACE(pnu::text, '[^0-9]', '', 'g'), 12, 8) = '${esc(lot)}'
         ORDER BY
           CASE SUBSTRING(REGEXP_REPLACE(pnu::text, '[^0-9]', '', 'g'), 11, 1)
             WHEN '${landPrefer}' THEN 0 ELSE 1 END,
           pnu
         LIMIT 1`
      )
    );
    const row = res.rows?.[0] as { wkt?: string; pnu_digits?: string } | undefined;
    if (row?.wkt) {
      const pnu = String(row.pnu_digits ?? '').replace(/\D/g, '');
      return {
        pnu: pnu.length >= 19 ? pnu.slice(0, 19) : pnu,
        geomWkt5181: String(row.wkt),
      };
    }
  } catch {
    /* ignore */
  }

  // 로컬 지적 없음 → VWorld 연속지적
  const pnu19 =
    digits.length >= 19
      ? digits.slice(0, 19)
      : `${digits.slice(0, 10)}${preferMountain ? '2' : '1'}${digits.slice(10, 18)}`;
  const fromVworld = await lookupVworldGeomByPnu(pnu19);
  if (fromVworld.geomWkt5181) return fromVworld;

  return { pnu: pnu19, geomWkt5181: null };
}

/** 읍면동+지번 → PNU(19)·지적 geom(5181 WKT) */
async function resolvePnuAndGeomWkt5181(
  eupmyeonDong: string,
  jibun: string,
  existingPnu?: string
): Promise<{ pnu: string; geomWkt5181: string | null }> {
  const parsed = parseEmdJibunForPnu(eupmyeonDong, jibun);
  const preferMountain = parsed?.isMountain ?? /^산/.test(String(jibun ?? '').trim());
  const explicitPnu = String(existingPnu ?? '').replace(/\D/g, '');

  if (explicitPnu.length === 19) {
    const byExisting = await lookupJijukGeomByPnuDigits(explicitPnu, preferMountain);
    if (byExisting.geomWkt5181) return byExisting;
  }

  if (parsed) {
    const riCd = await resolveRiCd(parsed.emdName, parsed.riName);
    if (riCd) {
      const landType: '1' | '2' = parsed.isMountain ? '2' : '1';
      const pnu19 = buildPnu19(riCd, landType, parsed.bonbun, parsed.bubun);
      const looked = await lookupJijukGeomByPnuDigits(pnu19, preferMountain);
      if (looked.geomWkt5181) return looked;
      // 산/대지 반대 유형도 한 번 더 (로컬·VWorld 모두)
      const altLand: '1' | '2' = landType === '2' ? '1' : '2';
      const altPnu = buildPnu19(riCd, altLand, parsed.bonbun, parsed.bubun);
      const alt = await lookupJijukGeomByPnuDigits(altPnu, altLand === '2');
      if (alt.geomWkt5181) return alt;
      // geom 없어도 19자리 PNU는 기록
      return { pnu: looked.pnu || pnu19, geomWkt5181: null };
    }
  }

  if (explicitPnu.length === 18 || explicitPnu.length === 19) {
    return lookupJijukGeomByPnuDigits(explicitPnu, preferMountain);
  }
  return { pnu: '', geomWkt5181: null };
}

/**
 * 지도·PNU 기준 지번: 편입 우선, 조회 실패 시 당초로 통째로 폴백.
 * pnu/geom 을 서로 다른 지번에서 섞지 않는다 (편입 pnu + 당초 geom 금지).
 */
async function resolveParcelPnuAndGeomByJibun(params: {
  eupmyeonDong: string;
  jibunIncluded?: string;
  jibunOriginal?: string;
  existingPnu?: string;
}): Promise<{ pnu: string; geomWkt5181: string | null }> {
  const emd = cell(params.eupmyeonDong);
  const included = cell(params.jibunIncluded);
  const original = cell(params.jibunOriginal);

  if (included) {
    const byIncluded = await resolvePnuAndGeomWkt5181(emd, included, undefined);
    if (byIncluded.geomWkt5181) return byIncluded;

    if (original && original !== included) {
      // 편입 도형 실패 시에만 당초로 완전 폴백 (pnu·geom 동일 지번)
      return resolvePnuAndGeomWkt5181(emd, original, undefined);
    }
    return byIncluded;
  }

  if (original) {
    return resolvePnuAndGeomWkt5181(
      emd,
      original,
      isValidPnuDigits(String(params.existingPnu ?? '')) ? params.existingPnu : undefined
    );
  }

  return { pnu: '', geomWkt5181: null };
}

/** pnu/geom 보강 — 편입 지번 우선. refreshAll 이면 전 행 재조회 */
export async function fillMissingParcelPnuGeom(params?: {
  rewardOgcFid?: number;
  /** true면 이미 geom 있는 행도 편입 지번 기준으로 다시 채움 */
  refreshAll?: boolean;
}): Promise<{ updated: number; error?: string }> {
  try {
    const meta = await resolveTableWithSchema(PARCEL_TABLE);
    if (!meta) return { updated: 0, error: `${PARCEL_TABLE} 테이블이 없습니다.` };
    const cols = await getTableColumns(meta.schema, meta.tableName);
    const parentCol = findParentKeyCol(cols);
    const hasGeom = findColumn(cols, 'geom');
    if (!parentCol) return { updated: 0, error: '부모키 컬럼이 없습니다.' };

    const safe = meta.tableName.replace(/"/g, '""');
    const safeSchema = meta.schema.replace(/"/g, '""');
    const rewardFid = Number(params?.rewardOgcFid);
    const filter =
      Number.isFinite(rewardFid) && rewardFid > 0
        ? ` AND ${quoteIdent(parentCol)} = ${Math.floor(rewardFid)}`
        : '';
    const refreshAll = params?.refreshAll === true;

    const res = await db.execute(
      sql.raw(
        `SELECT ogc_fid, pnu, eupmyeon_dong, jibun_original, jibun_included
         FROM "${safeSchema}"."${safe}"
         WHERE COALESCE(TRIM(eupmyeon_dong), '') <> ''
           AND (
             COALESCE(TRIM(jibun_included), '') <> ''
             OR COALESCE(TRIM(jibun_original), '') <> ''
           )
           ${
             refreshAll
               ? ''
               : `AND (
             COALESCE(TRIM(pnu), '') = ''
             OR LENGTH(REGEXP_REPLACE(COALESCE(pnu, ''), '[^0-9]', '', 'g')) <> 19
             OR ${hasGeom ? 'geom IS NULL' : 'FALSE'}
           )`
           }
         ${filter}
         ORDER BY ogc_fid
         LIMIT 2000`
      )
    );

    let updated = 0;
    for (const raw of res.rows ?? []) {
      const row = raw as Record<string, unknown>;
      const ogcFid = Number(row.ogc_fid);
      if (!Number.isFinite(ogcFid)) continue;
      const prevPnu = cell(row.pnu);
      const { pnu, geomWkt5181 } = await resolveParcelPnuAndGeomByJibun({
        eupmyeonDong: cell(row.eupmyeon_dong),
        jibunIncluded: cell(row.jibun_included),
        jibunOriginal: cell(row.jibun_original),
        // 전량 재조회 시 당초 PNU 잔존 방지
        existingPnu: refreshAll ? undefined : isValidPnuDigits(prevPnu) ? prevPnu : undefined,
      });

      const sets: string[] = [];
      if (isValidPnuDigits(pnu)) {
        sets.push(`pnu = '${esc(pnu)}'`);
      } else if (prevPnu && !isValidPnuDigits(prevPnu)) {
        sets.push(`pnu = NULL`);
      }
      if (hasGeom && geomWkt5181) {
        sets.push(`geom = ST_SetSRID(ST_GeomFromText('${esc(geomWkt5181)}'), 5181)`);
      }
      if (sets.length === 0) continue;

      await db.execute(
        sql.raw(
          `UPDATE "${safeSchema}"."${safe}"
           SET ${sets.join(', ')}
           WHERE ogc_fid = ${Math.floor(ogcFid)}`
        )
      );
      updated += 1;
    }

    if (updated > 0) {
      await recomputeMainGeomFromParcels(
        Number.isFinite(rewardFid) && rewardFid > 0 ? { rewardOgcFid: rewardFid } : undefined
      );
    }
    return { updated };
  } catch (e: unknown) {
    return { updated: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 목록 */
export async function listRows(params?: {
  keyword?: string;
  /** true면 목록 로드 전 pnu/geom 비어있는 필지를 주소로 일괄 채움 */
  fillPnuGeom?: boolean;
}): Promise<{ rows: RoadRewardCaseDto[]; error?: string }> {
  try {
    if (params?.fillPnuGeom !== false) {
      await fillMissingParcelPnuGeom();
    }

    const meta = await resolveTableWithSchema(MAIN_TABLE);
    if (!meta) return { rows: [], error: `${MAIN_TABLE} 테이블이 없습니다.` };
    const { tableName, schema } = meta;
    const columns = await getTableColumns(schema, tableName);
    const keyCol = findColumn(columns, 'ogc_fid');
    if (!keyCol) return { rows: [], error: 'ogc_fid 컬럼이 없습니다.' };
    const hasGeom = Boolean(findColumn(columns, 'geom'));

    const parcelMeta = await resolveTableWithSchema(PARCEL_TABLE);
    let parcelCountSelect = '0::int AS parcel_count';
    if (parcelMeta) {
      const pCols = await getTableColumns(parcelMeta.schema, parcelMeta.tableName);
      const parentCol = findParentKeyCol(pCols);
      if (parentCol) {
        const ps = parcelMeta.schema.replace(/"/g, '""');
        const pt = parcelMeta.tableName.replace(/"/g, '""');
        parcelCountSelect = `(
          SELECT COUNT(*)::int FROM "${ps}"."${pt}" p
          WHERE p.${quoteIdent(parentCol)} = r.${quoteIdent(keyCol)}
        ) AS parcel_count`;
      }
    }

    const attrSelect = CASE_ATTR_FIELDS.map((f) => {
      const col = findColumn(columns, f);
      return col
        ? `COALESCE(r.${quoteIdent(col)}::text, '') AS ${quoteIdent(f)}`
        : `''::text AS ${quoteIdent(f)}`;
    }).join(',\n      ');

    const geomSelect = hasGeom
      ? `${geomExtentSelect.replace(/r\.geom/g, `r.${quoteIdent('geom')}`)}`
      : `NULL::float8 AS xmin, NULL::float8 AS ymin, NULL::float8 AS xmax, NULL::float8 AS ymax, NULL::text AS geom3857`;

    const keyword = String(params?.keyword ?? '').trim();
    const kwClause = keyword
      ? ` AND (
          COALESCE(r.name::text, '') ILIKE '%${esc(keyword)}%'
          OR COALESCE(r.detail::text, '') ILIKE '%${esc(keyword)}%'
          OR COALESCE(r.org::text, '') ILIKE '%${esc(keyword)}%'
        )`
      : '';

    const safe = tableName.replace(/"/g, '""');
    const safeSchema = schema.replace(/"/g, '""');
    const sqlText = `
      SELECT
        r.${quoteIdent(keyCol)}::int AS ogc_fid,
        ${attrSelect},
        ${geomSelect},
        ${parcelCountSelect}
      FROM "${safeSchema}"."${safe}" r
      WHERE 1=1 ${kwClause}
      ORDER BY r.${quoteIdent(keyCol)} DESC
      LIMIT 5000`;

    const res = await db.execute(sql.raw(sqlText));
    const rows: RoadRewardCaseDto[] = (res.rows ?? [])
      .map((raw) => {
        const row = raw as Record<string, unknown>;
        const ogcFid = Number(row.ogc_fid);
        if (!Number.isFinite(ogcFid)) return null;
        return {
          ...mapCaseAttrs(row, ogcFid),
          parcels: [],
          parcelCount: num(row.parcel_count),
        };
      })
      .filter((x): x is RoadRewardCaseDto => x != null);
    return { rows };
  } catch (e: unknown) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 필지목록 */
export async function listParcelsByRewardOgcFid(params: {
  rewardOgcFid?: number | string;
}): Promise<{ items: RoadRewardParcelDto[]; error?: string }> {
  const rewardOgcFid = Number(params?.rewardOgcFid);
  if (!Number.isFinite(rewardOgcFid) || rewardOgcFid <= 0) return { items: [] };

  const meta = await resolveTableWithSchema(PARCEL_TABLE);
  if (!meta) return { items: [] };
  const cols = await getTableColumns(meta.schema, meta.tableName);
  const parentCol = findParentKeyCol(cols);
  if (!parentCol) return { items: [], error: '부모키 컬럼이 없습니다.' };
  const hasGeom = Boolean(findColumn(cols, 'geom'));

  const safe = meta.tableName.replace(/"/g, '""');
  const safeSchema = meta.schema.replace(/"/g, '""');
  const geomSelect = hasGeom
    ? `, ${geomExtentSelect}`
    : `, NULL::float8 AS xmin, NULL::float8 AS ymin, NULL::float8 AS xmax, NULL::float8 AS ymax, NULL::text AS geom3857`;

  const sqlText = `
    SELECT
      r.ogc_fid,
      COALESCE(r.pnu::text, '') AS pnu,
      COALESCE(r.eupmyeon_dong::text, '') AS eupmyeon_dong,
      COALESCE(r.jibun_original::text, '') AS jibun_original,
      COALESCE(r.jibun_included::text, '') AS jibun_included,
      r.area_original,
      r.area_included,
      COALESCE(r.jimok::text, '') AS jimok,
      r.appraisal1_value,
      r.appraisal2_value,
      r.applied_unit_price,
      r.compensation_amount,
      COALESCE(r.owner_address::text, '') AS owner_address,
      COALESCE(r.owner_name::text, '') AS owner_name,
      COALESCE(r.note::text, '') AS note
      ${geomSelect}
    FROM "${safeSchema}"."${safe}" r
    WHERE r.${quoteIdent(parentCol)} = ${Math.floor(rewardOgcFid)}
    ORDER BY r.ogc_fid`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const items = (res.rows ?? [])
      .map((r) => mapParcelRow(r as Record<string, unknown>))
      .filter((x): x is RoadRewardParcelDto => x != null);
    return { items };
  } catch (e: unknown) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 상세 1건 */
export async function getDetailByOgcFid(params: {
  ogcFid?: number | string;
  fillPnuGeom?: boolean;
}): Promise<{ row: RoadRewardCaseDto | null; error?: string }> {
  const ogcFid = Number(params?.ogcFid);
  if (!Number.isFinite(ogcFid) || ogcFid <= 0) {
    return { row: null, error: 'ogc_fid가 필요합니다.' };
  }

  if (params?.fillPnuGeom !== false) {
    await fillMissingParcelPnuGeom({ rewardOgcFid: ogcFid });
  }

  const meta = await resolveTableWithSchema(MAIN_TABLE);
  if (!meta) return { row: null, error: `${MAIN_TABLE} 테이블이 없습니다.` };
  const columns = await getTableColumns(meta.schema, meta.tableName);
  const keyCol = findColumn(columns, 'ogc_fid');
  if (!keyCol) return { row: null, error: 'ogc_fid 컬럼이 없습니다.' };
  const hasGeom = Boolean(findColumn(columns, 'geom'));

  const attrSelect = CASE_ATTR_FIELDS.map((f) => {
    const col = findColumn(columns, f);
    return col
      ? `COALESCE(r.${quoteIdent(col)}::text, '') AS ${quoteIdent(f)}`
      : `''::text AS ${quoteIdent(f)}`;
  }).join(',\n      ');

  const geomSelect = hasGeom
    ? geomExtentSelect.replace(/r\.geom/g, `r.${quoteIdent('geom')}`)
    : `NULL::float8 AS xmin, NULL::float8 AS ymin, NULL::float8 AS xmax, NULL::float8 AS ymax, NULL::text AS geom3857`;

  const safe = meta.tableName.replace(/"/g, '""');
  const safeSchema = meta.schema.replace(/"/g, '""');

  try {
    const res = await db.execute(
      sql.raw(
        `SELECT
           r.${quoteIdent(keyCol)}::int AS ogc_fid,
           ${attrSelect},
           ${geomSelect}
         FROM "${safeSchema}"."${safe}" r
         WHERE r.${quoteIdent(keyCol)} = ${Math.floor(ogcFid)}
         LIMIT 1`
      )
    );
    const row = res.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) return { row: null, error: '해당 건을 찾을 수 없습니다.' };

    const parcels = await listParcelsByRewardOgcFid({ rewardOgcFid: ogcFid });
    const mapped = mapCaseAttrs(row, ogcFid);
    // 건 geom이 없으면 필지 extent 합으로 지도 이동용 extent만 보강
    let extent3857 = mapped.extent3857 ?? null;
    if (!extent3857 && parcels.items.length > 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of parcels.items) {
        const e = p.extent3857;
        if (!e) continue;
        minX = Math.min(minX, e[0]);
        minY = Math.min(minY, e[1]);
        maxX = Math.max(maxX, e[2]);
        maxY = Math.max(maxY, e[3]);
      }
      if ([minX, minY, maxX, maxY].every((v) => Number.isFinite(v))) {
        extent3857 = [minX, minY, maxX, maxY];
      }
    }

    return {
      row: {
        ...mapped,
        extent3857,
        parcels: parcels.items,
        parcelCount: parcels.items.length,
      },
      ...(parcels.error ? { error: parcels.error } : {}),
    };
  } catch (e: unknown) {
    return { row: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getExtent3857ByOgcFid(params: {
  ogcFid?: number | string;
}): Promise<{ extent3857: [number, number, number, number] | null; error?: string }> {
  const detail = await getDetailByOgcFid({ ogcFid: params.ogcFid, fillPnuGeom: false });
  if (detail.error && !detail.row) return { extent3857: null, error: detail.error };
  return { extent3857: detail.row?.extent3857 ?? null };
}

type ParcelSaveInput = {
  ogcFid?: number | string;
  pnu?: string;
  eupmyeonDong?: string;
  jibunOriginal?: string;
  jibunIncluded?: string;
  areaOriginal?: number;
  areaIncluded?: number;
  jimok?: string;
  appraisal1Value?: number;
  appraisal2Value?: number;
  appliedUnitPrice?: number;
  compensationAmount?: number;
  ownerAddress?: string;
  ownerName?: string;
  note?: string;
  geomWkt5181?: string | null;
};

/**
 * 자식 필지 geom 합집합 → 부모 road_reward.geom.
 * 필지 도형이 하나도 없으면 부모 geom 을 NULL 로 둔다.
 */
/**
 * 필지 합집합으로 부모 geom 채움.
 * 기본은 부모 geom 이 비어 있을 때만 — 사용자가 그린 편입 범위를 덮어쓰지 않는다.
 */
export async function recomputeMainGeomFromParcels(params?: {
  rewardOgcFid?: number | string;
  /** true면 기존 부모 geom 도 필지 합집합으로 강제 교체 */
  force?: boolean;
}): Promise<{ updated: number; error?: string }> {
  try {
    const mainMeta = await resolveTableWithSchema(MAIN_TABLE);
    const parcelMeta = await resolveTableWithSchema(PARCEL_TABLE);
    if (!mainMeta || !parcelMeta) {
      return { updated: 0, error: 'road_reward / road_reward_parcel 테이블이 없습니다.' };
    }
    const mainCols = await getTableColumns(mainMeta.schema, mainMeta.tableName);
    const parcelCols = await getTableColumns(parcelMeta.schema, parcelMeta.tableName);
    const mainGeomCol = findColumn(mainCols, 'geom');
    const mainKeyCol = findColumn(mainCols, 'ogc_fid');
    const parentCol = findParentKeyCol(parcelCols);
    const parcelGeomCol = findColumn(parcelCols, 'geom');
    if (!mainGeomCol || !mainKeyCol || !parentCol || !parcelGeomCol) {
      return { updated: 0, error: 'geom/키 컬럼이 없습니다.' };
    }

    const ms = mainMeta.schema.replace(/"/g, '""');
    const mt = mainMeta.tableName.replace(/"/g, '""');
    const ps = parcelMeta.schema.replace(/"/g, '""');
    const pt = parcelMeta.tableName.replace(/"/g, '""');
    const rewardFid = Number(params?.rewardOgcFid);
    const fidFilter =
      Number.isFinite(rewardFid) && rewardFid > 0
        ? `AND m.${quoteIdent(mainKeyCol)} = ${Math.floor(rewardFid)}`
        : '';
    const emptyOnly = params?.force !== true;
    const emptyFilter = emptyOnly
      ? `AND m.${quoteIdent(mainGeomCol)} IS NULL`
      : '';

    const res = await db.execute(
      sql.raw(
        `UPDATE "${ms}"."${mt}" m
         SET ${quoteIdent(mainGeomCol)} = sub.union_geom
         FROM (
           SELECT
             p.${quoteIdent(parentCol)} AS reward_fid,
             ST_Multi(ST_UnaryUnion(ST_Collect(p.${quoteIdent(parcelGeomCol)}))) AS union_geom
           FROM "${ps}"."${pt}" p
           WHERE p.${quoteIdent(parcelGeomCol)} IS NOT NULL
           GROUP BY p.${quoteIdent(parentCol)}
         ) sub
         WHERE m.${quoteIdent(mainKeyCol)} = sub.reward_fid
         ${fidFilter}
         ${emptyFilter}`
      )
    );
    const updated = Number((res as { rowCount?: number }).rowCount ?? 0);
    return { updated };
  } catch (e: unknown) {
    return { updated: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function syncParcels(params: {
  rewardOgcFid: number;
  parcels: ParcelSaveInput[];
}): Promise<{ success: boolean; error?: string }> {
  const meta = await resolveTableWithSchema(PARCEL_TABLE);
  if (!meta) return { success: false, error: `${PARCEL_TABLE} 테이블이 없습니다.` };
  const cols = await getTableColumns(meta.schema, meta.tableName);
  const parentCol = findParentKeyCol(cols);
  if (!parentCol) return { success: false, error: '부모키 컬럼이 없습니다.' };
  const hasGeom = Boolean(findColumn(cols, 'geom'));
  const safe = meta.tableName.replace(/"/g, '""');
  const safeSchema = meta.schema.replace(/"/g, '""');
  const rewardOgcFid = Math.floor(params.rewardOgcFid);

  try {
    await db.execute(
      sql.raw(
        `DELETE FROM "${safeSchema}"."${safe}"
         WHERE ${quoteIdent(parentCol)} = ${rewardOgcFid}`
      )
    );

    for (const item of params.parcels ?? []) {
      const eupmyeonDong = cell(item.eupmyeonDong);
      const jibunOriginal = cell(item.jibunOriginal);
      const jibunIncluded = cell(item.jibunIncluded);
      const appraisal1Value = num(item.appraisal1Value);
      const appraisal2Value = num(item.appraisal2Value);
      const areaIncluded = num(item.areaIncluded);
      const derived = computeDerived(appraisal1Value, appraisal2Value, areaIncluded);
      const appliedUnitPrice = num(item.appliedUnitPrice) || derived.appliedUnitPrice;
      const compensationAmount = num(item.compensationAmount) || derived.compensationAmount;

      let pnu = cell(item.pnu).replace(/\D/g, '');
      let geomWkt =
        typeof item.geomWkt5181 === 'string' && item.geomWkt5181.trim()
          ? item.geomWkt5181.trim()
          : null;
      // 편입 지번이 있으면 지적에서 pnu·geom 을 다시 맞춤 (클라이언트에 남은 당초 도형 덮어쓰기)
      if (eupmyeonDong && (jibunIncluded || jibunOriginal)) {
        const resolved = await resolveParcelPnuAndGeomByJibun({
          eupmyeonDong,
          jibunIncluded,
          jibunOriginal,
          existingPnu: pnu,
        });
        if (resolved.pnu) pnu = resolved.pnu;
        if (resolved.geomWkt5181) geomWkt = resolved.geomWkt5181;
      }

      const insertCols = [
        quoteIdent(parentCol),
        'pnu',
        'eupmyeon_dong',
        'jibun_original',
        'jibun_included',
        'area_original',
        'area_included',
        'jimok',
        'appraisal1_value',
        'appraisal2_value',
        'applied_unit_price',
        'compensation_amount',
        'owner_address',
        'owner_name',
        'note',
      ];
      const insertVals = [
        String(rewardOgcFid),
        pnu ? `'${esc(pnu)}'` : 'NULL',
        `'${esc(eupmyeonDong)}'`,
        `'${esc(jibunOriginal)}'`,
        `'${esc(cell(item.jibunIncluded))}'`,
        String(num(item.areaOriginal)),
        String(areaIncluded),
        `'${esc(cell(item.jimok))}'`,
        String(appraisal1Value),
        String(appraisal2Value),
        String(appliedUnitPrice),
        String(compensationAmount),
        `'${esc(cell(item.ownerAddress))}'`,
        `'${esc(cell(item.ownerName))}'`,
        `'${esc(cell(item.note))}'`,
      ];
      if (hasGeom) {
        insertCols.push('geom');
        insertVals.push(
          geomWkt
            ? `ST_SetSRID(ST_GeomFromText('${esc(geomWkt)}'), 5181)`
            : 'NULL'
        );
      }

      await db.execute(
        sql.raw(
          `INSERT INTO "${safeSchema}"."${safe}" (${insertCols.join(', ')})
           VALUES (${insertVals.join(', ')})`
        )
      );
    }
    // 부모 geom 은 그린 편입 범위 우선 — 필지 합집합으로 덮지 않음
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function sqlTextOrNull(raw: unknown): string {
  const s = cell(raw);
  return s ? `'${esc(s)}'` : 'NULL';
}

function sqlNum(raw: unknown): string {
  return String(num(raw));
}

/**
 * defineLayer 없이 부모 테이블에 직접 INSERT/UPDATE.
 * (layerRowService.insert/update 는 defineLayer 필드만 허용해 road_reward 가 비어 있으면 DEFAULT VALUES 빈 행이 생김)
 */
async function upsertMainCase(params: {
  ogcFid?: number;
  isNew: boolean;
  dbValues: Record<string, string>;
  geomWkt5181: string | null;
  geomClear: boolean;
}): Promise<{ success: boolean; ogcFid?: number; error?: string }> {
  const meta = await resolveTableWithSchema(MAIN_TABLE);
  if (!meta) return { success: false, error: `${MAIN_TABLE} 테이블이 없습니다.` };
  const cols = await getTableColumns(meta.schema, meta.tableName);
  const geomCol = findColumn(cols, 'geom');
  const safe = meta.tableName.replace(/"/g, '""');
  const safeSchema = meta.schema.replace(/"/g, '""');

  const attrCols: string[] = [];
  const attrVals: string[] = [];
  for (const field of CASE_ATTR_FIELDS) {
    const col = findColumn(cols, field);
    if (!col) continue;
    attrCols.push(quoteIdent(col));
    attrVals.push(sqlTextOrNull(params.dbValues[field]));
  }
  if (attrCols.length === 0) {
    return { success: false, error: '저장할 속성 컬럼이 없습니다.' };
  }

  try {
    if (params.isNew) {
      const insertCols = [...attrCols];
      const insertVals = [...attrVals];
      if (geomCol && params.geomWkt5181) {
        insertCols.push(quoteIdent(geomCol));
        insertVals.push(
          `ST_SetSRID(ST_GeomFromText('${esc(params.geomWkt5181)}'), 5181)`
        );
      }
      const res = await db.execute(
        sql.raw(
          `INSERT INTO "${safeSchema}"."${safe}" (${insertCols.join(', ')})
           VALUES (${insertVals.join(', ')})
           RETURNING ogc_fid::int AS new_fid`
        )
      );
      const newFid = Number((res.rows?.[0] as { new_fid?: number } | undefined)?.new_fid);
      if (!Number.isFinite(newFid)) {
        return { success: false, error: '신규 ogc_fid를 확인하지 못했습니다.' };
      }
      return { success: true, ogcFid: newFid };
    }

    const fid = Math.floor(Number(params.ogcFid));
    if (!Number.isFinite(fid) || fid <= 0) {
      return { success: false, error: 'ogc_fid가 필요합니다.' };
    }
    const sets = attrCols.map((col, i) => `${col} = ${attrVals[i]}`);
    if (geomCol) {
      if (params.geomClear) {
        sets.push(`${quoteIdent(geomCol)} = NULL`);
      } else if (params.geomWkt5181) {
        sets.push(
          `${quoteIdent(geomCol)} = ST_SetSRID(ST_GeomFromText('${esc(params.geomWkt5181)}'), 5181)`
        );
      }
    }
    await db.execute(
      sql.raw(
        `UPDATE "${safeSchema}"."${safe}"
         SET ${sets.join(', ')}
         WHERE ogc_fid = ${fid}`
      )
    );
    return { success: true, ogcFid: fid };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 건 저장(신규·수정) + 선택적 필지 동기화 */
export async function saveRow(params: {
  ogcFid?: number | string;
  isNew?: boolean;
  values?: {
    name?: string;
    org?: string;
    policy?: string;
    unit?: string;
    detail?: string;
    budgetItem?: string;
    statItem?: string;
    appraisal1Name?: string;
    appraisal2Name?: string;
  };
  geomWkt5181?: string | null;
  geomClear?: boolean;
  parcels?: ParcelSaveInput[];
}): Promise<{ success: boolean; ogcFid?: number; error?: string }> {
  const valuesIn = params.values ?? {};
  const name = cell(valuesIn.name);
  if (!name) {
    return { success: false, error: '건명을 입력하세요.' };
  }
  const dbValues: Record<string, string> = {
    name,
    org: cell(valuesIn.org),
    policy: cell(valuesIn.policy),
    unit: cell(valuesIn.unit),
    detail: cell(valuesIn.detail),
    budget_item: cell(valuesIn.budgetItem),
    stat_item: cell(valuesIn.statItem),
    appraisal1_name: cell(valuesIn.appraisal1Name),
    appraisal2_name: cell(valuesIn.appraisal2Name),
  };

  const ogcFidNum = Number(params.ogcFid);
  const isNew = params.isNew === true || !Number.isFinite(ogcFidNum) || ogcFidNum <= 0;
  const geomWkt =
    typeof params.geomWkt5181 === 'string' && params.geomWkt5181.trim()
      ? params.geomWkt5181.trim()
      : null;
  const hasParcels = Array.isArray(params.parcels);

  try {
    // 부모 geom = 사용자가 그린 편입 범위. 필지 목록과 별개로 먼저 저장한다.
    const upserted = await upsertMainCase({
      ogcFid: ogcFidNum,
      isNew,
      dbValues,
      geomWkt5181: geomWkt,
      geomClear: params.geomClear === true,
    });
    if (!upserted.success || !upserted.ogcFid) {
      return { success: false, error: upserted.error ?? '저장에 실패했습니다.' };
    }
    const fid = upserted.ogcFid;

    if (hasParcels) {
      const sync = await syncParcels({ rewardOgcFid: fid, parcels: params.parcels! });
      if (!sync.success) return { success: false, ogcFid: fid, error: sync.error };
    }
    // 그린 도형이 없을 때만 필지 합집합으로 부모 geom 보강
    if (!geomWkt && params.geomClear !== true) {
      await recomputeMainGeomFromParcels({ rewardOgcFid: fid });
    }
    return { success: true, ogcFid: fid };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 단건 필지 저장(신규·수정) — 주소로 pnu/geom 보강 */
export async function saveParcel(params: {
  rewardOgcFid?: number | string;
  parcel?: ParcelSaveInput;
}): Promise<{ success: boolean; ogcFid?: number; error?: string }> {
  const rewardOgcFid = Number(params.rewardOgcFid);
  const parcel = params.parcel;
  if (!Number.isFinite(rewardOgcFid) || rewardOgcFid <= 0) {
    return { success: false, error: '보상편입용지 ogc_fid가 필요합니다.' };
  }
  if (!parcel) return { success: false, error: '필지 정보가 필요합니다.' };

  const meta = await resolveTableWithSchema(PARCEL_TABLE);
  if (!meta) return { success: false, error: `${PARCEL_TABLE} 테이블이 없습니다.` };
  const cols = await getTableColumns(meta.schema, meta.tableName);
  const parentCol = findParentKeyCol(cols);
  if (!parentCol) return { success: false, error: '부모키 컬럼이 없습니다.' };

  const eupmyeonDong = cell(parcel.eupmyeonDong);
  const jibunOriginal = cell(parcel.jibunOriginal);
  const jibunIncluded = cell(parcel.jibunIncluded);
  const appraisal1Value = num(parcel.appraisal1Value);
  const appraisal2Value = num(parcel.appraisal2Value);
  const areaIncluded = num(parcel.areaIncluded);
  const derived = computeDerived(appraisal1Value, appraisal2Value, areaIncluded);

  let pnu = cell(parcel.pnu).replace(/\D/g, '');
  let geomWkt =
    typeof parcel.geomWkt5181 === 'string' && parcel.geomWkt5181.trim()
      ? parcel.geomWkt5181.trim()
      : null;
  if (eupmyeonDong && (jibunIncluded || jibunOriginal)) {
    const resolved = await resolveParcelPnuAndGeomByJibun({
      eupmyeonDong,
      jibunIncluded,
      jibunOriginal,
      existingPnu: pnu,
    });
    if (resolved.pnu) pnu = resolved.pnu;
    if (resolved.geomWkt5181) geomWkt = resolved.geomWkt5181;
  }

  const values: Record<string, unknown> = {
    [parentCol]: Math.floor(rewardOgcFid),
    pnu: pnu || null,
    eupmyeon_dong: eupmyeonDong,
    jibun_original: jibunOriginal,
    jibun_included: cell(parcel.jibunIncluded),
    area_original: num(parcel.areaOriginal),
    area_included: areaIncluded,
    jimok: cell(parcel.jimok),
    appraisal1_value: appraisal1Value,
    appraisal2_value: appraisal2Value,
    applied_unit_price: num(parcel.appliedUnitPrice) || derived.appliedUnitPrice,
    compensation_amount: num(parcel.compensationAmount) || derived.compensationAmount,
    owner_address: cell(parcel.ownerAddress),
    owner_name: cell(parcel.ownerName),
    note: cell(parcel.note),
  };

  const parcelFid = Number(parcel.ogcFid);
  const hasGeom = Boolean(findColumn(cols, 'geom'));
  const safe = meta.tableName.replace(/"/g, '""');
  const safeSchema = meta.schema.replace(/"/g, '""');

  const colOrder = [
    parentCol,
    'pnu',
    'eupmyeon_dong',
    'jibun_original',
    'jibun_included',
    'area_original',
    'area_included',
    'jimok',
    'appraisal1_value',
    'appraisal2_value',
    'applied_unit_price',
    'compensation_amount',
    'owner_address',
    'owner_name',
    'note',
  ] as const;

  try {
    if (Number.isFinite(parcelFid) && parcelFid > 0) {
      const sets: string[] = [];
      for (const key of colOrder) {
        const col = findColumn(cols, key);
        if (!col) continue;
        const raw = values[key];
        if (typeof raw === 'number') {
          sets.push(`${quoteIdent(col)} = ${sqlNum(raw)}`);
        } else if (key === 'pnu') {
          sets.push(`${quoteIdent(col)} = ${sqlTextOrNull(raw)}`);
        } else {
          sets.push(`${quoteIdent(col)} = ${sqlTextOrNull(raw)}`);
        }
      }
      if (hasGeom && geomWkt) {
        sets.push(`geom = ST_SetSRID(ST_GeomFromText('${esc(geomWkt)}'), 5181)`);
      }
      if (sets.length === 0) return { success: false, error: '적용할 변경이 없습니다.' };
      await db.execute(
        sql.raw(
          `UPDATE "${safeSchema}"."${safe}"
           SET ${sets.join(', ')}
           WHERE ogc_fid = ${Math.floor(parcelFid)}`
        )
      );
      await recomputeMainGeomFromParcels({ rewardOgcFid });
      return { success: true, ogcFid: Math.floor(parcelFid) };
    }

    const insertCols: string[] = [];
    const insertVals: string[] = [];
    for (const key of colOrder) {
      const col = findColumn(cols, key);
      if (!col) continue;
      insertCols.push(quoteIdent(col));
      const raw = values[key];
      if (typeof raw === 'number') insertVals.push(sqlNum(raw));
      else insertVals.push(sqlTextOrNull(raw));
    }
    if (hasGeom) {
      insertCols.push('geom');
      insertVals.push(
        geomWkt ? `ST_SetSRID(ST_GeomFromText('${esc(geomWkt)}'), 5181)` : 'NULL'
      );
    }
    const res = await db.execute(
      sql.raw(
        `INSERT INTO "${safeSchema}"."${safe}" (${insertCols.join(', ')})
         VALUES (${insertVals.join(', ')})
         RETURNING ogc_fid::int AS new_fid`
      )
    );
    const newFid = Number((res.rows?.[0] as { new_fid?: number } | undefined)?.new_fid);
    await recomputeMainGeomFromParcels({ rewardOgcFid });
    return { success: true, ogcFid: Number.isFinite(newFid) ? newFid : undefined };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteParcel(params: {
  ogcFid?: number | string;
}): Promise<{ success: boolean; error?: string }> {
  const ogcFid = Number(params?.ogcFid);
  if (!Number.isFinite(ogcFid) || ogcFid <= 0) {
    return { success: false, error: '필지 ogc_fid가 필요합니다.' };
  }

  let rewardOgcFid: number | null = null;
  try {
    const meta = await resolveTableWithSchema(PARCEL_TABLE);
    if (meta) {
      const cols = await getTableColumns(meta.schema, meta.tableName);
      const parentCol = findParentKeyCol(cols);
      if (parentCol) {
        const safe = meta.tableName.replace(/"/g, '""');
        const safeSchema = meta.schema.replace(/"/g, '""');
        const res = await db.execute(
          sql.raw(
            `SELECT ${quoteIdent(parentCol)}::int AS reward_fid
             FROM "${safeSchema}"."${safe}"
             WHERE ogc_fid = ${Math.floor(ogcFid)}
             LIMIT 1`
          )
        );
        const fid = Number((res.rows?.[0] as { reward_fid?: number } | undefined)?.reward_fid);
        if (Number.isFinite(fid)) rewardOgcFid = fid;
      }
    }
  } catch {
    /* ignore */
  }

  const deleted = await deleteTableRowByKey({
    table: PARCEL_TABLE,
    schema: DEFAULT_SCHEMA,
    keyField: 'ogc_fid',
    keyValue: Math.floor(ogcFid),
  });
  if (deleted.success && rewardOgcFid != null) {
    await recomputeMainGeomFromParcels({ rewardOgcFid });
  }
  return deleted;
}

export async function deleteRow(params: {
  ogcFid?: number | string;
}): Promise<{ success: boolean; error?: string }> {
  const ogcFid = Number(params?.ogcFid);
  if (!Number.isFinite(ogcFid) || ogcFid <= 0) {
    return { success: false, error: 'ogc_fid가 필요합니다.' };
  }
  // FK ON DELETE CASCADE 로 필지목록도 함께 삭제
  return deleteTableRowByKey({
    table: MAIN_TABLE,
    schema: DEFAULT_SCHEMA,
    keyField: 'ogc_fid',
    keyValue: Math.floor(ogcFid),
  });
}
