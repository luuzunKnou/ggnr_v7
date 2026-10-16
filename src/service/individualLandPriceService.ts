/**
 * 개별공시지가 — 목록은 부동산공시가격 공시지가 파일(land_linkage.koreps00039),
 * 상세 연도별 이력은 행망 공시지가 조회(우클릭 «공시지가 조회»와 같은 요청)를 쓴다.
 *
 * 파일 열은 모두 문자열이고 같은 필지·연도에 기준월만 다른 행(1월·7월 공시)이 있을 수 있어
 * 필지·연도마다 기준월·공시일자가 가장 늦은 1건만 쓴다.
 */
import { pool } from '@/database/db';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  KOREPS_PRICE_FILE_TABLE,
  KRAS_LAYER_CATALOG_SCHEMA,
  KRAS_LAYER_SCHEMA_CANDIDATES,
} from '@/integrations/krasLayerSync.config';
import { ensureLandPriceMemoTable } from './ensureLayerAppTables';
import { fetchKorepsPriceHistory } from './landLinkageService';
import { resolvePlatLocAndLotByPnus } from './layerRowService';

type Params = Record<string, unknown>;

const PRICE_TABLE = `"${KRAS_LAYER_CATALOG_SCHEMA}"."${KOREPS_PRICE_FILE_TABLE}"`;
const MEMO_TABLE = 'layer.land_price_memo';
const JIJUK_DEFAULT_SRID = 5181;
const LIST_PAGE_SIZE_MAX = 200;
const MEMO_MAX_LENGTH = 2000;
const YEARS_CACHE_MS = 10 * 60 * 1000;
const STANDARD_YN_VALUES = `('1', 'Y', 'y')`;

export type LandPriceSortKey = 'pnu' | 'price';

export type LandPriceYear = { year: string; count: number };

export type LandPriceEmd = { emdCd: string; emdName: string; count: number };

export type LandPriceRow = {
  pnu: string;
  location: string;
  lot: string;
  price: number | null;
  standardYn: string;
  announceDate: string;
};

export type LandPriceHistoryRow = {
  year: string;
  baseMonth: string;
  price: number | null;
  changeRate: number | null;
  announceDate: string;
  note: string;
};

export type LandPriceParcelDetail = {
  pnu: string;
  location: string;
  lot: string;
  jimok: string;
  areaSqm: number | null;
  standardYn: string;
  geometry: unknown;
  extent: [number, number, number, number] | null;
  history: LandPriceHistoryRow[];
  /** koreps: 행망 조회, file: 행망을 못 써서 공시지가 파일로 대신함 */
  historySource: 'koreps' | 'file';
  historyMessage: string;
};

export type LandPriceMemo = {
  memoKey: number;
  contents: string;
  createDate: string;
  createUser: string;
  mine: boolean;
};

function throwHttp(status: number, message: string): never {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  throw err;
}

async function requireUsr(): Promise<string> {
  const usrId = await getSessionUsrId();
  if (!usrId) throwHttp(401, '로그인이 필요합니다.');
  return usrId;
}

function str(v: unknown): string {
  return String(v ?? '').trim();
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function yearParam(v: unknown): string {
  const s = str(v);
  return /^\d{4}$/.test(s) ? s : '';
}

function emdParam(v: unknown): string {
  const s = str(v).replace(/\D/g, '');
  return s.length === 8 ? s : '';
}

function pnuParam(v: unknown): string {
  const s = str(v).replace(/\D/g, '');
  return s.length === 19 ? s : '';
}

async function priceTableExists(): Promise<boolean> {
  const { rows } = await pool.query<{ c: string | null }>(`select to_regclass($1) as c`, [
    `${KRAS_LAYER_CATALOG_SCHEMA}.${KOREPS_PRICE_FILE_TABLE}`,
  ]);
  return Boolean(rows[0]?.c);
}

/** 원 단위 숫자만 남긴 공시지가 */
const PRICE_EXPR = `NULLIF(regexp_replace(coalesce(t.pnilp, ''), '[^0-9.]', '', 'g'), '')::numeric`;

/**
 * 필지·연도별 최신 1건. $1 = 연도 배열, 추가 조건은 extraWhere(파라미터 번호는 호출측이 맞춘다)
 */
function latestPerYearSql(extraWhere = ''): string {
  return `
    SELECT DISTINCT ON (btrim(t.pnu), btrim(t.base_year))
      btrim(t.pnu) AS pnu,
      btrim(t.base_year) AS yr,
      btrim(t.stdmt) AS stdmt,
      ${PRICE_EXPR} AS price,
      btrim(t.pjji_yn) AS pjji_yn,
      btrim(t.pann_ymd) AS pann_ymd,
      btrim(t.etc_cntn) AS etc
    FROM ${PRICE_TABLE} t
    WHERE btrim(t.base_year) = ANY($1::text[])
      ${extraWhere}
    ORDER BY btrim(t.pnu), btrim(t.base_year),
      btrim(t.stdmt) DESC NULLS LAST, btrim(t.pann_ymd) DESC NULLS LAST`;
}

/**
 * 지번 검색어 → 필지번호 조건. «12», «12-3», «산5», «산5-1», 19자리 필지번호.
 * 반환 값은 필지번호 정규식(대장구분·본번·부번 자리)
 */
function lotKeywordPattern(keyword: string): string | null {
  const kw = keyword.replace(/\s+/g, '');
  if (!kw) return null;
  if (/^\d{19}$/.test(kw)) return `^${kw}$`;
  const m = kw.match(/^(산)?(\d{1,4})(?:-(\d{1,4}))?$/u);
  if (!m) return null;
  const ledger = m[1] ? '2' : '[0-9]';
  const bon = m[2]!.padStart(4, '0');
  const bub = m[3] != null ? m[3].padStart(4, '0') : '[0-9]{4}';
  return `^[0-9]{10}${ledger}${bon}${bub}$`;
}

let yearsCache: { at: number; years: LandPriceYear[] } | null = null;

async function loadYears(): Promise<LandPriceYear[]> {
  if (yearsCache && Date.now() - yearsCache.at < YEARS_CACHE_MS) return yearsCache.years;
  if (!(await priceTableExists())) return [];
  const { rows } = await pool.query<{ yr: string; c: string }>(
    `SELECT btrim(base_year) AS yr, count(DISTINCT btrim(pnu))::text AS c
     FROM ${PRICE_TABLE}
     WHERE btrim(base_year) ~ '^[0-9]{4}$'
     GROUP BY 1
     ORDER BY 1 DESC`
  );
  const years = rows.map((r) => ({ year: r.yr, count: Number(r.c) || 0 }));
  yearsCache = { at: Date.now(), years };
  return years;
}

async function resolveYear(params: Params): Promise<string> {
  const years = await loadYears();
  const year = yearParam(params.year) || years[0]?.year || '';
  if (!year) throwHttp(404, '공시지가 파일 자료가 없습니다.');
  return year;
}

/** 읍면동 코드 → 이름 (공용 소재지 조회를 읍면동 단위로 사용) */
async function loadEmdNames(emdCds: string[]): Promise<Map<string, string>> {
  const fakePnus = emdCds.map((cd) => `${cd}00100010000`);
  const resolved = await resolvePlatLocAndLotByPnus(fakePnus);
  const out = new Map<string, string>();
  for (const cd of emdCds) {
    const name = resolved.get(`${cd}00100010000`)?.platLoc ?? '';
    out.set(cd, name || cd);
  }
  return out;
}

async function withAddress<T extends { pnu: string }>(
  rows: T[]
): Promise<(T & { location: string; lot: string })[]> {
  const resolved = await resolvePlatLocAndLotByPnus(rows.map((r) => r.pnu));
  return rows.map((r) => {
    const a = resolved.get(r.pnu);
    return { ...r, location: a?.platLoc ?? '', lot: a?.jibunLot ?? r.pnu };
  });
}

/** 파일에 있는 기준연도 목록(최신순) */
export async function years(): Promise<{ years: LandPriceYear[] }> {
  await requireUsr();
  return { years: await loadYears() };
}

/** 기준연도 자료가 있는 읍면동 목록 */
export async function emds(params: Params = {}): Promise<{ year: string; rows: LandPriceEmd[] }> {
  await requireUsr();
  const year = await resolveYear(params);
  const { rows } = await pool.query(
    `SELECT substr(btrim(t.pnu), 1, 8) AS emd_cd, count(DISTINCT btrim(t.pnu))::int AS cnt
     FROM ${PRICE_TABLE} t
     WHERE btrim(t.base_year) = $1
     GROUP BY 1
     ORDER BY 1`,
    [year]
  );
  const names = await loadEmdNames(rows.map((r) => str(r.emd_cd)));
  return {
    year,
    rows: rows.map((r) => ({
      emdCd: str(r.emd_cd),
      emdName: names.get(str(r.emd_cd)) ?? str(r.emd_cd),
      count: Number(r.cnt) || 0,
    })),
  };
}

type ListQuery = {
  sql: string;
  args: unknown[];
};

/**
 * 소재지 검색어 → 필지번호 앞자리(읍면동·리) 목록.
 * 기준연도 자료에 있는 법정동만 이름과 맞춰, 포함되면 그 앞자리로 좁힌다.
 */
async function locationPrefixesForKeyword(year: string, keyword: string): Promise<string[]> {
  const kw = keyword.replace(/\s+/g, '');
  if (!kw || !/[가-힣]/.test(kw)) return [];
  const { rows } = await pool.query<{ li: string }>(
    `SELECT DISTINCT substr(btrim(pnu), 1, 10) AS li
     FROM ${PRICE_TABLE}
     WHERE btrim(base_year) = $1 AND length(btrim(pnu)) >= 10`,
    [year]
  );
  const liCds = rows.map((r) => str(r.li)).filter((c) => /^\d{10}$/.test(c));
  if (!liCds.length) return [];
  const fakePnus = liCds.map((li) => `${li}100010000`);
  const resolved = await resolvePlatLocAndLotByPnus(fakePnus);
  const matched = new Set<string>();
  for (const li of liCds) {
    const plat = (resolved.get(`${li}100010000`)?.platLoc ?? '').replace(/\s+/g, '');
    if (!plat.includes(kw)) continue;
    matched.add(li);
    matched.add(li.slice(0, 8));
  }
  /** 긴 앞자리(리)를 우선 — 같은 읍면동의 다른 리까지 넓히지 않음 */
  const list = [...matched];
  return list.filter((p) => p.length === 10 || !list.some((o) => o.length === 10 && o.startsWith(p)));
}

async function buildListQuery(params: Params, year: string): Promise<ListQuery> {
  const args: unknown[] = [[year]];
  const priceWhere: string[] = [];
  const emd = emdParam(params.emd);
  if (emd) {
    args.push(`${emd}%`);
    priceWhere.push(`AND btrim(t.pnu) LIKE $${args.length}`);
  }
  const keyword = str(params.keyword);
  if (keyword) {
    const lotPattern = lotKeywordPattern(keyword);
    if (lotPattern) {
      args.push(lotPattern);
      priceWhere.push(`AND btrim(t.pnu) ~ $${args.length}`);
    } else {
      const prefixes = await locationPrefixesForKeyword(year, keyword);
      if (!prefixes.length) {
        priceWhere.push('AND false');
      } else {
        const parts = prefixes.map((p) => {
          args.push(`${p}%`);
          return `btrim(t.pnu) LIKE $${args.length}`;
        });
        priceWhere.push(`AND (${parts.join(' OR ')})`);
      }
    }
  }
  const standardWhere = params.standardOnly === true ? `AND p.pjji_yn IN ${STANDARD_YN_VALUES}` : '';
  return {
    sql: `WITH p AS (${latestPerYearSql(priceWhere.join(' '))})
      SELECT p.pnu, p.price::float8 AS price, p.pjji_yn, p.pann_ymd
      FROM p
      WHERE p.price > 0 ${standardWhere}`,
    args,
  };
}

function orderBySql(params: Params): string {
  const key = str(params.sort) as LandPriceSortKey;
  const dir = str(params.dir) === 'asc' ? 'ASC' : 'DESC';
  if (key === 'price') return `ORDER BY price ${dir} NULLS LAST, pnu`;
  return `ORDER BY pnu ${dir}`;
}

function toRow(r: Record<string, unknown>): Omit<LandPriceRow, 'location' | 'lot'> {
  return {
    pnu: str(r.pnu),
    price: num(r.price),
    standardYn: str(r.pjji_yn),
    announceDate: str(r.pann_ymd),
  };
}

/** 필지 목록(쪽 단위). sort: pnu | price, dir: asc | desc, standardOnly: 표준지만 */
export async function list(params: Params = {}): Promise<{
  year: string;
  total: number;
  page: number;
  pageSize: number;
  rows: LandPriceRow[];
}> {
  await requireUsr();
  const year = await resolveYear(params);
  const pageSize = Math.min(Math.max(Math.floor(Number(params.pageSize) || 50), 10), LIST_PAGE_SIZE_MAX);
  const page = Math.max(Math.floor(Number(params.page) || 1), 1);
  const q = await buildListQuery(params, year);
  const { rows } = await pool.query(
    `SELECT s.*, count(*) OVER()::int AS total_cnt
     FROM (${q.sql}) s
     ${orderBySql(params)}
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    q.args
  );
  const total = Number(rows[0]?.total_cnt) || 0;
  return {
    year,
    total,
    page,
    pageSize,
    rows: await withAddress(rows.map(toRow)),
  };
}

type JijukRef = { qualified: string; srid: number };
let jijukRefCache: JijukRef | null = null;

/**
 * 지적 도형 테이블 위치·좌표계. 열 정의 없이 값에만 좌표계가 붙은 경우가 있어 실제 도형 값으로 판단하고,
 * 좌표계가 비어 있으면(0) 5181로 본다
 */
async function resolveJijuk(): Promise<JijukRef | null> {
  if (jijukRefCache) return jijukRefCache;
  for (const schema of KRAS_LAYER_SCHEMA_CANDIDATES) {
    const { rows } = await pool.query<{ c: string | null }>(`select to_regclass($1) as c`, [`${schema}.jijuk`]);
    if (!rows[0]?.c) continue;
    const qualified = `"${schema}"."jijuk"`;
    let srid = 0;
    try {
      const res = await pool.query<{ srid: number }>(
        `SELECT ST_SRID(geom) AS srid FROM ${qualified} WHERE geom IS NOT NULL LIMIT 1`
      );
      srid = Number(res.rows[0]?.srid) || 0;
    } catch {
      srid = 0;
    }
    jijukRefCache = { qualified, srid };
    return jijukRefCache;
  }
  return null;
}

function jijukGeomSql(ref: JijukRef, col = 'j.geom'): string {
  return ref.srid > 0 ? col : `ST_SetSRID(${col}, ${JIJUK_DEFAULT_SRID})`;
}

/** 지도 클릭 위치(3857)의 필지번호 */
export async function pnuAtPoint(params: Params = {}): Promise<{ pnu: string | null }> {
  await requireUsr();
  const x = num(params.x);
  const y = num(params.y);
  if (x == null || y == null) throwHttp(400, '지도 위치가 올바르지 않습니다.');
  const ref = await resolveJijuk();
  if (!ref) return { pnu: null };
  const pt3857 = `ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 3857)`;
  const pt =
    ref.srid > 0
      ? `ST_Transform(${pt3857}, ${ref.srid})`
      : `ST_SetSRID(ST_Transform(${pt3857}, ${JIJUK_DEFAULT_SRID}), 0)`;
  const { rows } = await pool.query(
    `SELECT REGEXP_REPLACE(j.pnu::text, '[^0-9]', '', 'g') AS pnu
     FROM ${ref.qualified} j
     WHERE j.geom && ${pt} AND ST_Contains(j.geom, ${pt})
     LIMIT 1`,
    [x, y]
  );
  return { pnu: pnuParam(rows[0]?.pnu) || null };
}

function withChangeRates(rowsDesc: Omit<LandPriceHistoryRow, 'changeRate'>[]): LandPriceHistoryRow[] {
  return rowsDesc.map((r, i) => {
    const prev = rowsDesc[i + 1]?.price ?? null;
    return {
      ...r,
      changeRate: r.price != null && prev ? Math.round(((r.price - prev) / prev) * 10000) / 100 : null,
    };
  });
}

/** 행망 응답 → 연도별 1건(같은 연도면 기준월이 늦은 것), 최신순 */
async function loadKorepsHistory(pnu: string): Promise<{ rows: LandPriceHistoryRow[]; message: string }> {
  const res = await fetchKorepsPriceHistory({ pnu });
  const byYear = new Map<string, Omit<LandPriceHistoryRow, 'changeRate'>>();
  for (const item of res.rows) {
    const year = str(item.year);
    if (!/^\d{4}$/.test(year)) continue;
    const cur = byYear.get(year);
    if (cur && cur.baseMonth >= str(item.month)) continue;
    byYear.set(year, {
      year,
      baseMonth: str(item.month),
      price: item.price,
      announceDate: str(item.announceDate),
      note: str(item.remark),
    });
  }
  const rowsDesc = [...byYear.values()].sort((a, b) => b.year.localeCompare(a.year));
  return { rows: withChangeRates(rowsDesc), message: res.error || res.message || '' };
}

async function loadFileHistory(pnu: string): Promise<{ rows: LandPriceHistoryRow[]; standardYn: string }> {
  if (!(await priceTableExists())) return { rows: [], standardYn: '' };
  const yearList = (await loadYears()).map((y) => y.year);
  const { rows } = await pool.query(`${latestPerYearSql('AND btrim(t.pnu) = $2')}`, [yearList, pnu]);
  const desc = [...rows].sort((a, b) => str(b.yr).localeCompare(str(a.yr)));
  return {
    standardYn: str(desc[0]?.pjji_yn),
    rows: withChangeRates(
      desc.map((r) => ({
        year: str(r.yr),
        baseMonth: str(r.stdmt),
        price: num(r.price),
        announceDate: str(r.pann_ymd),
        note: str(r.etc),
      }))
    ),
  };
}

/** 필지 상세 — 소재지·지목·면적·도형 + 연도별 공시지가(행망, 안 되면 파일) */
export async function parcel(params: Params = {}): Promise<LandPriceParcelDetail> {
  await requireUsr();
  const pnu = pnuParam(params.pnu);
  if (!pnu) throwHttp(400, '필지번호가 올바르지 않습니다.');

  const [koreps, file] = await Promise.all([loadKorepsHistory(pnu), loadFileHistory(pnu)]);
  const useKoreps = koreps.rows.length > 0;

  let jimok = '';
  let areaSqm: number | null = null;
  let geometry: unknown = null;
  let extent: [number, number, number, number] | null = null;
  const ref = await resolveJijuk();
  if (ref) {
    const geom5181 =
      ref.srid > 0 && ref.srid !== JIJUK_DEFAULT_SRID
        ? `ST_Transform(j.geom, ${JIJUK_DEFAULT_SRID})`
        : jijukGeomSql(ref);
    const geom3857 = `ST_Transform(${jijukGeomSql(ref)}, 3857)`;
    const selectBy = (where: string) =>
      pool.query(
        `SELECT
           NULLIF(TRIM(SUBSTRING(j.jibun::text FROM '(?:산?[0-9]+(?:-[0-9]+)?)[[:space:]]*([가-힣]+)$')), '') AS jimok,
           ROUND(ST_Area(${geom5181})::numeric, 2)::float8 AS area_sqm,
           ST_AsGeoJSON(${geom3857}, 1)::json AS geometry,
           ST_XMin(${geom3857})::float8 AS xmin,
           ST_YMin(${geom3857})::float8 AS ymin,
           ST_XMax(${geom3857})::float8 AS xmax,
           ST_YMax(${geom3857})::float8 AS ymax
         FROM ${ref.qualified} j
         WHERE ${where} AND j.geom IS NOT NULL
         LIMIT 1`,
        [pnu]
      );
    let { rows } = await selectBy('j.pnu::text = $1');
    if (!rows.length) ({ rows } = await selectBy(`REGEXP_REPLACE(j.pnu::text, '[^0-9]', '', 'g') = $1`));
    const r = rows[0];
    if (r) {
      jimok = str(r.jimok);
      areaSqm = num(r.area_sqm);
      geometry = r.geometry;
      const ext = [num(r.xmin), num(r.ymin), num(r.xmax), num(r.ymax)];
      if (ext.every((n): n is number => n != null)) extent = ext as [number, number, number, number];
    }
  }

  const [withAddr] = await withAddress([{ pnu }]);
  return {
    pnu,
    location: withAddr?.location ?? '',
    lot: withAddr?.lot ?? pnu,
    jimok,
    areaSqm,
    standardYn: file.standardYn,
    geometry,
    extent,
    history: useKoreps ? koreps.rows : file.rows,
    historySource: useKoreps ? 'koreps' : 'file',
    historyMessage: useKoreps ? '' : koreps.message,
  };
}

let memoTableReady = false;

async function ensureMemoTable(): Promise<void> {
  if (memoTableReady) return;
  const res = await ensureLandPriceMemoTable();
  if (res.errors.length) throwHttp(500, `메모 테이블 준비 실패: ${res.errors.join(', ')}`);
  memoTableReady = true;
}

function memoContentsParam(v: unknown): string {
  const s = str(v);
  if (!s) throwHttp(400, '메모 내용을 입력하세요.');
  if (s.length > MEMO_MAX_LENGTH) throwHttp(400, `메모는 ${MEMO_MAX_LENGTH}자까지 입력할 수 있습니다.`);
  return s;
}

function memoKeyParam(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) throwHttp(400, '메모 번호가 올바르지 않습니다.');
  return n;
}

/** 필지 메모 목록(최신순) */
export async function memos(params: Params = {}): Promise<{ rows: LandPriceMemo[] }> {
  const usrId = await requireUsr();
  const pnu = pnuParam(params.pnu);
  if (!pnu) throwHttp(400, '필지번호가 올바르지 않습니다.');
  await ensureMemoTable();
  const { rows } = await pool.query(
    `SELECT m.memo_key, m.memo_contents,
       to_char(m.memo_create_date, 'YYYY-MM-DD HH24:MI') AS create_date,
       m.memo_create_user,
       COALESCE(NULLIF(TRIM(u.usr_name), ''), m.memo_create_user, '') AS create_user_name
     FROM ${MEMO_TABLE} m
     LEFT JOIN public.usr u ON u.usr_id::text = m.memo_create_user
     WHERE m.pnu = $1 AND m.memo_is_del = false
     ORDER BY m.memo_create_date DESC, m.memo_key DESC`,
    [pnu]
  );
  return {
    rows: rows.map((r) => ({
      memoKey: Number(r.memo_key),
      contents: str(r.memo_contents),
      createDate: str(r.create_date),
      createUser: str(r.create_user_name),
      mine: str(r.memo_create_user) === usrId,
    })),
  };
}

/** 필지 메모 등록 */
export async function addMemo(params: Params = {}): Promise<{ memoKey: number }> {
  const usrId = await requireUsr();
  const pnu = pnuParam(params.pnu);
  if (!pnu) throwHttp(400, '필지번호가 올바르지 않습니다.');
  const contents = memoContentsParam(params.contents);
  await ensureMemoTable();
  const { rows } = await pool.query(
    `INSERT INTO ${MEMO_TABLE} (pnu, memo_contents, memo_create_user) VALUES ($1, $2, $3) RETURNING memo_key`,
    [pnu, contents, usrId]
  );
  return { memoKey: Number(rows[0]?.memo_key) };
}

/** 필지 메모 수정 — 작성자 본인만 */
export async function updateMemo(params: Params = {}): Promise<{ ok: true }> {
  const usrId = await requireUsr();
  const memoKey = memoKeyParam(params.memoKey);
  const contents = memoContentsParam(params.contents);
  await ensureMemoTable();
  const { rowCount } = await pool.query(
    `UPDATE ${MEMO_TABLE} SET memo_contents = $1
     WHERE memo_key = $2 AND memo_create_user = $3 AND memo_is_del = false`,
    [contents, memoKey, usrId]
  );
  if (!rowCount) throwHttp(403, '본인이 작성한 메모만 수정할 수 있습니다.');
  return { ok: true };
}

/** 필지 메모 삭제 — 작성자 본인만 */
export async function deleteMemo(params: Params = {}): Promise<{ ok: true }> {
  const usrId = await requireUsr();
  const memoKey = memoKeyParam(params.memoKey);
  await ensureMemoTable();
  const { rowCount } = await pool.query(
    `UPDATE ${MEMO_TABLE} SET memo_is_del = true
     WHERE memo_key = $1 AND memo_create_user = $2 AND memo_is_del = false`,
    [memoKey, usrId]
  );
  if (!rowCount) throwHttp(403, '본인이 작성한 메모만 삭제할 수 있습니다.');
  return { ok: true };
}
