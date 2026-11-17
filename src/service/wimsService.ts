import { pool } from '@/database/db';
import {
  getWimsSchema,
  isWimsConfigured,
  WimsNotConfiguredError,
  wimsExecute,
} from '@/lib/wimsOracle';
import {
  WIMS_PAGE_SIZE,
  type WimsHistoryRow,
  type WimsListQuery,
  type WimsMeter,
  type WimsPair,
  type WimsParcelResult,
  type WimsStatQuery,
  type WimsStatRow,
} from '@/lib/wimsTypes';

const SEARCH_COLUMN: Record<string, string> = {
  gojikind: 'v.GOJIKIND',
  meterDay: 'v.METER_DAY',
  nabgiDate: 'v.NABGIDATE',
  customerNo: 'v.CUSTOMER_NO',
  meterNo: 'v.METER_NO',
  suname: 'v.SUNAME',
  areaCd: 'v.AREA_CD',
  admDong: 'v.ADM_DONG',
  lostnoAddr: 'v.LOSTNO_ADDR',
  roadAddr: 'v.ROAD_ADDR',
  useQty: 'TO_CHAR(v.USE_QTY)',
  freeQty: 'TO_CHAR(v.FREE_QTY)',
  induty: 'v.INDUTY',
  diam: 'TO_CHAR(v.DIAM)',
  delYn: 'v.DEL_YN',
};

const BLOCK_COLUMNS =
  'NABGIDATE, YM_CUSTNO, METER_YM, METER_MONTH, METER_DAY, CUSTOMER_NO, METER_NO, ' +
  'DONGCODE, ADM_DONG, SUNAME, LOSTNO_ADDR, ROAD_ADDR, USE_QTY, SUPCODE, INDUTY, ' +
  'SGUCODE, DIAM, BLOCK_NAME, AREA_CD, JOCODE, DEL_YN';

const SELECT_V1 = `${BLOCK_COLUMNS}, GOJIKIND, FREE_QTY`;
const SELECT_V2 = `${BLOCK_COLUMNS}, CAST(NULL AS CHAR(2)) AS GOJIKIND, CAST(NULL AS NUMBER) AS FREE_QTY`;

type BindMap = Record<string, string | number>;

class Sql {
  private chunks: string[] = [];
  readonly binds: BindMap = {};
  private n = 0;

  add(sql: string): void {
    this.chunks.push(sql);
  }

  bind(value: string | number): string {
    const name = `b${this.n++}`;
    this.binds[name] = value;
    return `:${name}`;
  }

  text(): string {
    return this.chunks.join('');
  }
}

function textOf(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function stripHyphen(value: string): string {
  return value.replace(/-/g, '').trim();
}

function pick(row: Record<string, unknown>, key: string): unknown {
  if (key in row) return row[key];
  const upper = key.toUpperCase();
  if (upper in row) return row[upper];
  return undefined;
}

function cleanPairs(pairs: WimsPair[] | undefined): WimsPair[] {
  const seen = new Set<string>();
  const out: WimsPair[] = [];
  for (const pair of pairs ?? []) {
    const customerNo = stripHyphen(textOf(pair?.customerNo));
    const meterNo = textOf(pair?.meterNo);
    if (!customerNo || !meterNo) continue;
    const key = `${customerNo}\0${meterNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ customerNo, meterNo });
    if (out.length >= 1000) break;
  }
  return out;
}

/** 수용가·계량기 쌍을 WITH 절로 올려 조인 — 대량 IN 보다 플랜이 안정적 */
function appendPairCte(sql: Sql, pairs: WimsPair[]): void {
  sql.add('pair_ids(CUSTOMER_NO, METER_NO) AS (\n');
  pairs.forEach((pair, index) => {
    if (index > 0) sql.add('  UNION ALL\n');
    sql.add(
      `  SELECT ${sql.bind(pair.customerNo)} AS CUSTOMER_NO, ${sql.bind(pair.meterNo)} AS METER_NO FROM DUAL\n`
    );
  });
  sql.add(')\n');
}

/** 수용가·계량기 조건. 없으면 false (전체 조회 금지) */
function appendIdFilter(
  sql: Sql,
  query: { pairs?: WimsPair[]; customerNo?: string; meterNo?: string },
  opts?: { usePairJoin?: boolean }
): boolean {
  const pairs = cleanPairs(query.pairs);
  if (pairs.length > 0) {
    if (opts?.usePairJoin) {
      sql.add(
        'AND EXISTS (\n' +
          '  SELECT 1 FROM pair_ids p\n' +
          '  WHERE p.CUSTOMER_NO = v.CUSTOMER_NO AND p.METER_NO = v.METER_NO\n' +
          ')\n'
      );
      return true;
    }
    const tuples = pairs
      .map((pair) => `(${sql.bind(pair.customerNo)}, ${sql.bind(pair.meterNo)})`)
      .join(', ');
    sql.add(`AND (v.CUSTOMER_NO, v.METER_NO) IN (${tuples})\n`);
    return true;
  }
  const customerNo = stripHyphen(textOf(query.customerNo));
  const meterNo = textOf(query.meterNo);
  if (customerNo && meterNo) {
    sql.add(`AND v.CUSTOMER_NO = ${sql.bind(customerNo)}\n`);
    sql.add(`AND v.METER_NO = ${sql.bind(meterNo)}\n`);
    return true;
  }
  if (meterNo) {
    sql.add(`AND v.METER_NO = ${sql.bind(meterNo)}\n`);
    return true;
  }
  if (customerNo) {
    sql.add(`AND v.CUSTOMER_NO = ${sql.bind(customerNo)}\n`);
    return true;
  }
  return false;
}

function appendEq(sql: Sql, column: string, raw: string | undefined): void {
  const value = textOf(raw);
  if (!value) return;
  sql.add(`AND ${column} = ${sql.bind(value.slice(0, 80))}\n`);
}

/** V_BLOCKINFO2 에는 GOJIKIND·FREE_QTY 컬럼이 없음 */
const V2_MISSING_SEARCH_KEYS = new Set(['gojikind', 'freeQty']);

function appendSearch(
  sql: Sql,
  keywordRaw: string | undefined,
  keys: string[] | undefined,
  opts?: { table?: 'V_BLOCKINFO' | 'V_BLOCKINFO2' }
): void {
  const keyword = textOf(keywordRaw);
  if (!keyword || !keys?.length) return;
  const allowedKeys =
    opts?.table === 'V_BLOCKINFO2'
      ? keys.filter((key) => !V2_MISSING_SEARCH_KEYS.has(key))
      : keys;
  const exprs = [...new Set(allowedKeys.map((key) => SEARCH_COLUMN[key]).filter(Boolean))];
  if (!exprs.length) return;
  const safe = keyword.slice(0, 80);
  const idSafe = stripHyphen(safe);
  sql.add('AND (\n');
  exprs.forEach((expr, index) => {
    sql.add(index > 0 ? '  OR ' : '  ');
    if (expr.endsWith('CUSTOMER_NO') && idSafe) {
      sql.add(`REPLACE(${expr}, '-', '') LIKE '%' || ${sql.bind(idSafe)} || '%'\n`);
    } else {
      sql.add(`${expr} LIKE '%' || ${sql.bind(safe)} || '%'\n`);
    }
  });
  sql.add(')\n');
}

function appendBranchFilters(
  sql: Sql,
  query: WimsListQuery | WimsStatQuery,
  opts?: {
    usePairJoin?: boolean;
    withSearch?: boolean;
    table?: 'V_BLOCKINFO' | 'V_BLOCKINFO2';
  }
): boolean {
  const hasId = appendIdFilter(sql, query, { usePairJoin: opts?.usePairJoin });
  if (!hasId) return false;
  const table = opts?.table ?? 'V_BLOCKINFO';
  if ('gojikind' in query && textOf(query.gojikind)) {
    // V_BLOCKINFO2 는 GOJIKIND 없음 → 종류 필터 시 해당 분기는 제외
    if (table === 'V_BLOCKINFO2') sql.add('AND 1=0\n');
    else appendEq(sql, 'v.GOJIKIND', query.gojikind);
  }
  if ('jocode' in query) appendEq(sql, 'v.JOCODE', query.jocode);
  if (opts?.withSearch !== false && 'searchKeyword' in query) {
    appendSearch(sql, query.searchKeyword, query.searchKeys, { table });
  }
  return true;
}

/** pairs 가 있으면 문장 선두 WITH pair_ids 를 붙인다. */
function prependPairWith(sql: Sql, query: { pairs?: WimsPair[] }): boolean {
  const pairs = cleanPairs(query.pairs);
  if (!pairs.length) return false;
  sql.add('WITH ');
  appendPairCte(sql, pairs);
  return true;
}

/**
 * 뷰 UNION 전에 필터를 각 분기에 넣어 스캔을 줄인다.
 * pair WITH 는 호출측에서 prependPairWith 로 먼저 붙인다.
 */
function appendFilteredUnion(
  sql: Sql,
  schema: string,
  query: WimsListQuery | WimsStatQuery,
  opts?: { withSearch?: boolean; usePairJoin?: boolean }
): boolean {
  const usePairJoin = Boolean(opts?.usePairJoin);

  const writeBranch = (
    selectList: string,
    table: 'V_BLOCKINFO' | 'V_BLOCKINFO2'
  ): boolean => {
    sql.add(`SELECT ${selectList}\nFROM ${schema}.${table} v\nWHERE 1=1\n`);
    return appendBranchFilters(sql, query, {
      usePairJoin,
      withSearch: opts?.withSearch,
      table,
    });
  };

  sql.add('(\n');
  if (!writeBranch(SELECT_V1, 'V_BLOCKINFO')) return false;
  sql.add('UNION ALL\n');
  if (!writeBranch(SELECT_V2, 'V_BLOCKINFO2')) return false;
  sql.add(') v\n');
  return true;
}

function mapHistory(row: Record<string, unknown>): WimsHistoryRow {
  const cell = (key: string) => textOf(pick(row, key));
  return {
    nabgiDate: cell('NABGIDATE'),
    ymCustNo: cell('YM_CUSTNO'),
    meterYm: cell('METER_YM'),
    meterMonth: cell('METER_MONTH'),
    meterDay: cell('METER_DAY'),
    customerNo: cell('CUSTOMER_NO'),
    meterNo: cell('METER_NO'),
    dongcode: cell('DONGCODE'),
    admDong: cell('ADM_DONG'),
    suname: cell('SUNAME'),
    lostnoAddr: cell('LOSTNO_ADDR'),
    roadAddr: cell('ROAD_ADDR'),
    useQty: cell('USE_QTY'),
    supcode: cell('SUPCODE'),
    induty: cell('INDUTY'),
    sgucode: cell('SGUCODE'),
    diam: cell('DIAM'),
    blockName: cell('BLOCK_NAME'),
    areaCd: cell('AREA_CD'),
    jocode: cell('JOCODE'),
    delYn: cell('DEL_YN'),
    gojikind: cell('GOJIKIND'),
    freeQty: cell('FREE_QTY'),
  };
}

function mapStat(row: Record<string, unknown>): WimsStatRow {
  const num = (key: string): number | null => {
    const value = pick(row, key);
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  return {
    customerNo: textOf(pick(row, 'customerNo')),
    meterNo: textOf(pick(row, 'meterNo')),
    induty: textOf(pick(row, 'induty')),
    suname: textOf(pick(row, 'suname')),
    roadAddr: textOf(pick(row, 'roadAddr')),
    avgUseQty: num('avgUseQty'),
    avgFreeQty: num('avgFreeQty'),
    delYn: textOf(pick(row, 'delYn')),
  };
}

function ymdOrEmpty(raw: string | undefined): string {
  const digits = textOf(raw).replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(0, 8) : '';
}

function requireSchema(): string {
  if (!isWimsConfigured()) throw new WimsNotConfiguredError();
  const schema = getWimsSchema();
  if (!schema || !/^[A-Z0-9_]+$/.test(schema)) throw new WimsNotConfiguredError();
  return schema;
}

function clampPageSize(value: number | undefined): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return WIMS_PAGE_SIZE;
  return Math.min(200, n);
}

export async function selectMetersInParcel(pnu: string): Promise<WimsMeter[]> {
  const code = textOf(pnu);
  if (!/^\d{19}$/.test(code)) return [];
  // 필지 1건 + 계량기 GIST(&&) 후보만 Within — 전체 계량기 변환 스캔 방지
  const result = await pool.query(
    `WITH parcel AS (
       SELECT
         CASE
           WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 5181)
           ELSE geom
         END AS g
       FROM public_layer.jijuk
       WHERE pnu = $1
         AND geom IS NOT NULL
       LIMIT 1
     )
     SELECT
       w.hom_num,
       w.hom_nam,
       w.hom_adr,
       w.met_num,
       ST_AsGeoJSON(
         ST_Transform(
           CASE
             WHEN ST_SRID(w.geom) = 0 THEN ST_SetSRID(w.geom, 5181)
             WHEN ST_SRID(w.geom) = 5181 THEN w.geom
             ELSE ST_Transform(w.geom, 5181)
           END,
           3857
         )
       ) AS geom
     FROM layer.wtl_meta_ps w
     CROSS JOIN parcel p
     WHERE w.geom IS NOT NULL
       AND w.geom && p.g
       AND ST_Within(
         CASE
           WHEN ST_SRID(w.geom) = 0 THEN ST_SetSRID(w.geom, 5181)
           WHEN ST_SRID(w.geom) = 5181 THEN w.geom
           ELSE ST_Transform(w.geom, 5181)
         END,
         p.g
       )
     ORDER BY w.hom_num ASC`,
    [code]
  );
  return result.rows.map((row) => ({
    homNum: textOf(row.hom_num),
    homNam: textOf(row.hom_nam),
    homAdr: textOf(row.hom_adr),
    metNum: textOf(row.met_num),
    geom: row.geom == null ? null : String(row.geom),
  }));
}

export function pairsFromMeters(meters: WimsMeter[]): WimsPair[] {
  return cleanPairs(meters.map((meter) => ({ customerNo: meter.homNum, meterNo: meter.metNum })));
}

/** 목록+총건수 1회 조회 (COUNT(*) OVER) */
export async function selectHistoryPage(
  query: WimsListQuery
): Promise<{ rows: WimsHistoryRow[]; totalCount: number }> {
  const schema = requireSchema();
  const pageSize = clampPageSize(query.pageSize);
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const offset = (page - 1) * pageSize;
  const usePairJoin = cleanPairs(query.pairs).length > 0;

  const sql = new Sql();
  if (usePairJoin) prependPairWith(sql, query);
  sql.add('SELECT * FROM (\n');
  sql.add('  SELECT v.*, COUNT(*) OVER() AS TOTAL_CNT\n');
  sql.add('  FROM ');
  if (!appendFilteredUnion(sql, schema, query, { usePairJoin })) {
    return { rows: [], totalCount: 0 };
  }
  sql.add('  ORDER BY v.METER_DAY DESC NULLS LAST\n');
  sql.add(')\n');
  sql.add(`OFFSET ${sql.bind(offset)} ROWS\n`);
  sql.add(`FETCH NEXT ${sql.bind(pageSize)} ROWS ONLY\n`);

  const rows = await wimsExecute(sql.text(), sql.binds);
  const totalRaw = rows[0] ? pick(rows[0], 'TOTAL_CNT') : 0;
  const totalCount = Number(totalRaw);
  return {
    rows: rows.map(mapHistory),
    totalCount: Number.isFinite(totalCount) ? totalCount : 0,
  };
}

export async function selectHistory(
  query: WimsListQuery,
  order: 'page' | 'excel'
): Promise<WimsHistoryRow[]> {
  if (order === 'page') {
    const page = await selectHistoryPage(query);
    return page.rows;
  }
  const schema = requireSchema();
  const usePairJoin = cleanPairs(query.pairs).length > 0;
  const sql = new Sql();
  if (usePairJoin) prependPairWith(sql, query);
  sql.add('SELECT v.*\nFROM ');
  if (!appendFilteredUnion(sql, schema, query, { usePairJoin })) return [];
  sql.add('ORDER BY CASE WHEN TRIM(v.METER_DAY) IS NULL THEN 1 ELSE 0 END ASC, v.METER_DAY DESC\n');
  const rows = await wimsExecute(sql.text(), sql.binds);
  return rows.map(mapHistory);
}

export async function selectHistoryCount(query: WimsListQuery): Promise<number> {
  const schema = requireSchema();
  const usePairJoin = cleanPairs(query.pairs).length > 0;
  const sql = new Sql();
  if (usePairJoin) prependPairWith(sql, query);
  sql.add('SELECT COUNT(*) AS CNT\nFROM ');
  if (!appendFilteredUnion(sql, schema, query, { usePairJoin })) return 0;
  const rows = await wimsExecute(sql.text(), sql.binds);
  const raw = rows[0] ? pick(rows[0], 'CNT') : 0;
  const count = Number(raw);
  return Number.isFinite(count) ? count : 0;
}

export async function selectStat(query: WimsStatQuery): Promise<WimsStatRow[]> {
  const schema = requireSchema();
  const pairs = cleanPairs(query.pairs);
  const usePairJoin = pairs.length > 0;
  const start = ymdOrEmpty(query.startYmd);
  const end = ymdOrEmpty(query.endYmd);
  const sql = new Sql();

  const writeBranch = (selectList: string, table: string): boolean => {
    sql.add(`SELECT ${selectList}\nFROM ${schema}.${table} v\nWHERE 1=1\n`);
    if (!appendIdFilter(sql, query, { usePairJoin })) return false;
    if (start) sql.add(`AND v.METER_DAY >= ${sql.bind(start)}\n`);
    if (end) sql.add(`AND v.METER_DAY <= ${sql.bind(end)}\n`);
    return true;
  };

  if (usePairJoin) {
    sql.add('WITH ');
    appendPairCte(sql, pairs);
  }
  sql.add('SELECT\n');
  sql.add('  v.CUSTOMER_NO AS "customerNo",\n');
  sql.add('  v.METER_NO AS "meterNo",\n');
  sql.add('  MAX(v.INDUTY) KEEP (DENSE_RANK LAST ORDER BY v.METER_DAY NULLS FIRST) AS "induty",\n');
  sql.add('  MAX(v.SUNAME) KEEP (DENSE_RANK LAST ORDER BY v.METER_DAY NULLS FIRST) AS "suname",\n');
  sql.add('  MAX(v.ROAD_ADDR) KEEP (DENSE_RANK LAST ORDER BY v.METER_DAY NULLS FIRST) AS "roadAddr",\n');
  sql.add('  AVG(v.USE_QTY) AS "avgUseQty",\n');
  sql.add('  AVG(v.FREE_QTY) AS "avgFreeQty",\n');
  sql.add('  MAX(v.DEL_YN) KEEP (DENSE_RANK LAST ORDER BY v.METER_DAY NULLS FIRST) AS "delYn"\n');
  sql.add('FROM (\n');
  if (!writeBranch(SELECT_V1, 'V_BLOCKINFO')) return [];
  sql.add('UNION ALL\n');
  if (!writeBranch(SELECT_V2, 'V_BLOCKINFO2')) return [];
  sql.add(') v\n');
  sql.add('GROUP BY v.CUSTOMER_NO, v.METER_NO\n');
  sql.add('ORDER BY v.CUSTOMER_NO ASC, v.METER_NO ASC');

  const rows = await wimsExecute(sql.text(), sql.binds);
  return rows.map(mapStat);
}

export async function loadParcelWims(pnu: string): Promise<WimsParcelResult> {
  const meters = await selectMetersInParcel(pnu);
  const pairs = pairsFromMeters(meters);
  if (!pairs.length) {
    return { meters, statList: [], dataList: [], totalCount: 0 };
  }
  const listQuery: WimsListQuery = { pairs, page: 1, pageSize: WIMS_PAGE_SIZE };
  const [statList, page] = await Promise.all([
    selectStat({ pairs }),
    selectHistoryPage(listQuery),
  ]);
  return {
    meters,
    statList,
    dataList: page.rows,
    totalCount: page.totalCount,
  };
}
