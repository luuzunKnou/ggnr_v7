import { pool } from '@/database/db';
import { getWimsSchema, isWimsConfigured, wimsExecute } from '@/lib/wimsOracle';
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

function blockFrom(schema: string): string {
  return (
    '(' +
    `SELECT ${BLOCK_COLUMNS}, GOJIKIND, FREE_QTY FROM ${schema}.V_BLOCKINFO` +
    ' UNION ALL ' +
    `SELECT ${BLOCK_COLUMNS}, CAST(NULL AS CHAR(2)) AS GOJIKIND, CAST(NULL AS NUMBER) AS FREE_QTY FROM ${schema}.V_BLOCKINFO2` +
    ')'
  );
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

/** 수용가·계량기 조건. 없으면 false (전체 조회 금지) */
function appendIdFilter(sql: Sql, query: { pairs?: WimsPair[]; customerNo?: string; meterNo?: string }): boolean {
  const pairs = cleanPairs(query.pairs);
  if (pairs.length > 0) {
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

function appendLike(sql: Sql, column: string, raw: string | undefined): void {
  const value = textOf(raw);
  if (!value) return;
  sql.add(`AND ${column} LIKE '%' || ${sql.bind(value.slice(0, 80))} || '%'\n`);
}

function appendSearch(sql: Sql, keywordRaw: string | undefined, keys: string[] | undefined): void {
  const keyword = textOf(keywordRaw);
  if (!keyword || !keys?.length) return;
  const exprs = [...new Set(keys.map((key) => SEARCH_COLUMN[key]).filter(Boolean))];
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

function appendListFilters(sql: Sql, query: WimsListQuery): boolean {
  const hasId = appendIdFilter(sql, query);
  if (!hasId) return false;
  appendLike(sql, 'v.GOJIKIND', query.gojikind);
  appendLike(sql, 'v.JOCODE', query.jocode);
  appendSearch(sql, query.searchKeyword, query.searchKeys);
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
  if (!isWimsConfigured()) throw new Error('WIMS 연결 정보가 없습니다.');
  const schema = getWimsSchema();
  if (!schema || !/^[A-Z0-9_]+$/.test(schema)) throw new Error('WIMS 연결 정보가 없습니다.');
  return schema;
}

export async function selectMetersInParcel(pnu: string): Promise<WimsMeter[]> {
  const code = textOf(pnu);
  if (!/^\d{19}$/.test(code)) return [];
  const result = await pool.query(
    `SELECT
       w.hom_num,
       w.hom_nam,
       w.hom_adr,
       w.met_num,
       ST_AsGeoJSON(
         ST_Transform(
           CASE
             WHEN ST_SRID(w.geom) = 0 THEN ST_SetSRID(w.geom, 5181)
             ELSE w.geom
           END,
           3857
         )
       ) AS geom
     FROM layer.wtl_meta_ps w
     JOIN public_layer.jijuk j ON j.pnu = $1
     WHERE w.geom IS NOT NULL
       AND j.geom IS NOT NULL
       AND ST_Within(
         CASE
           WHEN ST_SRID(w.geom) = 0 THEN ST_SetSRID(w.geom, 5181)
           ELSE ST_Transform(w.geom, 5181)
         END,
         CASE
           WHEN ST_SRID(j.geom) = 0 THEN ST_SetSRID(j.geom, 5181)
           ELSE ST_Transform(j.geom, 5181)
         END
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

export async function selectHistory(
  query: WimsListQuery,
  order: 'page' | 'excel'
): Promise<WimsHistoryRow[]> {
  const schema = requireSchema();
  const sql = new Sql();
  sql.add(`SELECT v.*\nFROM ${blockFrom(schema)} v\nWHERE 1=1\n`);
  if (!appendListFilters(sql, query)) return [];
  if (order === 'excel') {
    sql.add('ORDER BY CASE WHEN TRIM(v.METER_DAY) IS NULL THEN 1 ELSE 0 END ASC, v.METER_DAY DESC\n');
  } else {
    const pageSize = clampPageSize(query.pageSize);
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const offset = (page - 1) * pageSize;
    sql.add('ORDER BY v.METER_DAY DESC NULLS LAST\n');
    sql.add(`OFFSET ${sql.bind(offset)} ROWS\n`);
    sql.add(`FETCH NEXT ${sql.bind(pageSize)} ROWS ONLY\n`);
  }
  const rows = await wimsExecute(sql.text(), sql.binds);
  return rows.map(mapHistory);
}

export async function selectHistoryCount(query: WimsListQuery): Promise<number> {
  const schema = requireSchema();
  const sql = new Sql();
  sql.add(`SELECT COUNT(*) AS CNT\nFROM ${blockFrom(schema)} v\nWHERE 1=1\n`);
  if (!appendListFilters(sql, query)) return 0;
  const rows = await wimsExecute(sql.text(), sql.binds);
  const raw = rows[0] ? pick(rows[0], 'CNT') : 0;
  const count = Number(raw);
  return Number.isFinite(count) ? count : 0;
}

export async function selectStat(query: WimsStatQuery): Promise<WimsStatRow[]> {
  const schema = requireSchema();
  const sql = new Sql();
  sql.add('SELECT\n');
  sql.add('  v.CUSTOMER_NO AS "customerNo",\n');
  sql.add('  v.METER_NO AS "meterNo",\n');
  sql.add('  MAX(v.INDUTY) KEEP (DENSE_RANK LAST ORDER BY v.METER_DAY NULLS FIRST) AS "induty",\n');
  sql.add('  MAX(v.SUNAME) KEEP (DENSE_RANK LAST ORDER BY v.METER_DAY NULLS FIRST) AS "suname",\n');
  sql.add('  MAX(v.ROAD_ADDR) KEEP (DENSE_RANK LAST ORDER BY v.METER_DAY NULLS FIRST) AS "roadAddr",\n');
  sql.add('  AVG(v.USE_QTY) AS "avgUseQty",\n');
  sql.add('  AVG(v.FREE_QTY) AS "avgFreeQty",\n');
  sql.add('  MAX(v.DEL_YN) KEEP (DENSE_RANK LAST ORDER BY v.METER_DAY NULLS FIRST) AS "delYn"\n');
  sql.add(`FROM ${blockFrom(schema)} v\nWHERE 1=1\n`);
  if (!appendIdFilter(sql, query)) return [];
  const start = ymdOrEmpty(query.startYmd);
  const end = ymdOrEmpty(query.endYmd);
  if (start) sql.add(`AND v.METER_DAY >= ${sql.bind(start)}\n`);
  if (end) sql.add(`AND v.METER_DAY <= ${sql.bind(end)}\n`);
  sql.add('GROUP BY v.CUSTOMER_NO, v.METER_NO\n');
  sql.add('ORDER BY v.CUSTOMER_NO ASC, v.METER_NO ASC');
  const rows = await wimsExecute(sql.text(), sql.binds);
  return rows.map(mapStat);
}

function clampPageSize(value: number | undefined): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return WIMS_PAGE_SIZE;
  return Math.min(200, n);
}

export async function loadParcelWims(pnu: string): Promise<WimsParcelResult> {
  console.log('[wimsService.loadParcelWims] start', { pnu });
  const meters = await selectMetersInParcel(pnu);
  const pairs = pairsFromMeters(meters);
  console.log('[wimsService.loadParcelWims] meters', { count: meters.length, pairs: pairs.length });
  if (!pairs.length) {
    return { meters, statList: [], dataList: [], totalCount: 0 };
  }
  const listQuery: WimsListQuery = { pairs, page: 1, pageSize: WIMS_PAGE_SIZE };
  const [statList, dataList, totalCount] = await Promise.all([
    selectStat({ pairs }),
    selectHistory(listQuery, 'page'),
    selectHistoryCount(listQuery),
  ]);
  console.log('[wimsService.loadParcelWims] done', {
    stat: statList.length,
    list: dataList.length,
    totalCount,
  });
  return { meters, statList, dataList, totalCount };
}
