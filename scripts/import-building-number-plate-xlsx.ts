/**
 * 건물번호판 보수 요청 엑셀 → layer.building_number_plate 적재 + define/GeoServer 발행
 *
 * 주소 매칭: 도로명(tl_sprd_manage.rn) + 본번/부번(tl_sgco_rnadr_dong)
 * 읍면동이 있으면 emd 교차로 좁힘. geom 은 건물면 PointOnSurface(EPSG:5181).
 *
 * 사용:
 *   npx tsx scripts/import-building-number-plate-xlsx.ts ggnr_ad dev
 *   npx tsx scripts/import-building-number-plate-xlsx.ts ggnr_ad dev --rollback
 *   npx tsx scripts/import-building-number-plate-xlsx.ts ggnr_ad dev --file "\\\\server\\path\\file.xlsx"
 */
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { loadProjectEnv } from './load-project-env';
import { getGeoServerInternalBase } from '../src/lib/geoserverUrl';
import { reorderDefineLayerTableRow, reorderDefineLayerTablesArray } from '../src/lib/defineLayerTableRowOrder';

const LOG = '[building-number-plate]';
const TABLE = 'building_number_plate';
const TABLE_KOR = '건물번호판';
const GROUP = '도로';
const SCHEMA = 'layer' as const;

const DEFAULT_FILE =
  '//192.168.127.11/사업수행_개발/020 사업별 수급자료 v2/안동 공간정보/수급/260915_도로명 관련자료/건물번호판 보수 요청(정비포함 2026. 9. 7.).xlsx';

const MANIFEST_PATH = path.join(
  process.cwd(),
  'docs',
  'reports',
  '_rollback_building_number_plate.json'
);

type ExcelRow = {
  year: number;
  seqNo: number | null;
  emdNm: string;
  roadNm: string;
  bunjiMain: string;
  bunjiSub: string;
  status: string;
  remark: string;
  dupKey: string;
  reqDate: string;
};

type Manifest = {
  project: string;
  env: string;
  table: string;
  schema: string;
  createdAt: string;
  sourceFile: string;
  defineTablesTouched: boolean;
  defineFieldsPath: string;
  geoserverPublished: boolean;
  inserted: number;
  withGeom: number;
  withoutGeom: number;
};

function parseArgs(): {
  project: string;
  type: string;
  file: string;
  rollback: boolean;
} {
  const argv = process.argv.slice(2);
  let file = DEFAULT_FILE;
  let rollback = false;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--rollback') {
      rollback = true;
      continue;
    }
    if (a === '--file') {
      file = argv[++i] ?? file;
      continue;
    }
    if (a.startsWith('--file=')) {
      file = a.slice('--file='.length) || file;
      continue;
    }
    positional.push(a);
  }
  return {
    project: positional[0] || 'ggnr_ad',
    type: positional[1] || 'dev',
    file,
    rollback,
  };
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Number.isInteger(v) ? String(v) : String(v);
  }
  return String(v)
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toIntOrNull(v: unknown): number | null {
  const t = cellText(v);
  if (!t) return null;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function excelDateToIso(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    const parsed = XLSX.SSF.parse_date_code(v);
    if (!parsed) return String(v);
    const mm = String(parsed.m).padStart(2, '0');
    const dd = String(parsed.d).padStart(2, '0');
    return `${parsed.y}-${mm}-${dd}`;
  }
  return cellText(v);
}

function parseSheet(year: number, ws: XLSX.WorkSheet): ExcelRow[] {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
  const headerIdx = rows.findIndex(
    (r) => cellText(r?.[0]) === 'No' && cellText(r?.[1]) === '읍면동'
  );
  if (headerIdx < 0) return [];
  const out: ExcelRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const seqRaw = cellText(r[0]);
    /** «2025년» 같은 구간 제목·요약 행 제외 */
    if (seqRaw && !/^\d+$/.test(seqRaw)) continue;
    const seqNo = toIntOrNull(r[0]);
    const roadNm = cellText(r[2]);
    /** 도로명 없는 빈 번호 행은 제외 (시트 하단 자리만 있는 행) */
    if (!roadNm) continue;
    if (seqNo == null) continue;
    out.push({
      year,
      seqNo,
      emdNm: cellText(r[1]),
      roadNm,
      bunjiMain: cellText(r[3]),
      bunjiSub: cellText(r[4]),
      status: cellText(r[5]),
      remark: cellText(r[6]),
      dupKey: cellText(r[7]),
      reqDate: excelDateToIso(r[8]),
    });
  }
  return out;
}

function bunjiMainNum(raw: string): number | null {
  const digits = String(raw ?? '')
    .replace(/,/g, '')
    .replace(/번지.*$/u, '')
    .replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function bunjiSubNum(raw: string): number {
  const t = String(raw ?? '').trim();
  if (!t) return 0;
  const digits = t.replace(/,/g, '').replace(/[^\d]/g, '');
  if (!digits) return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

async function ensureTable(pool: {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await pool.query(`
CREATE TABLE IF NOT EXISTS layer.${TABLE} (
  id serial PRIMARY KEY,
  year integer,
  seq_no integer,
  emd_nm text,
  road_nm text,
  bunji_main text,
  bunji_sub text,
  status text,
  remark text,
  dup_key text,
  req_date text,
  match_gid integer,
  match_cnt integer,
  match_src text,
  geom geometry(Point, 5181)
);
CREATE INDEX IF NOT EXISTS ${TABLE}_geom_gix ON layer.${TABLE} USING GIST (geom);
CREATE INDEX IF NOT EXISTS ${TABLE}_road_idx ON layer.${TABLE} (road_nm, bunji_main, bunji_sub);
CREATE INDEX IF NOT EXISTS ${TABLE}_year_idx ON layer.${TABLE} (year);
COMMENT ON TABLE layer.${TABLE} IS '건물번호판 보수 요청(엑셀 적재)';
`);
  await pool.query(`ALTER TABLE layer.${TABLE} ADD COLUMN IF NOT EXISTS match_src text`);
}

async function lookupGeom(
  pool: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  row: ExcelRow
): Promise<{ wkt: string | null; matchGid: number | null; matchCnt: number; matchSrc: string | null }> {
  if (!row.roadNm || !row.bunjiMain) {
    return { wkt: null, matchGid: null, matchCnt: 0, matchSrc: null };
  }
  const main = bunjiMainNum(row.bunjiMain);
  if (main == null) return { wkt: null, matchGid: null, matchCnt: 0, matchSrc: null };
  const sub = bunjiSubNum(row.bunjiSub);
  const emd = row.emdNm;

  /** 건물(dong) 우선, 없으면 건물군(mst). 둘 다 본번·부번 정확 일치 */
  const res = await pool.query(
    `
    WITH roads AS (
      SELECT DISTINCT rn_cd
      FROM public_layer.tl_sprd_manage
      WHERE rn = $1
    ),
    cand AS (
      SELECT
        'dong'::text AS src,
        d.gid,
        ST_SetSRID(d.geom, 5181) AS g
      FROM public_layer.tl_sgco_rnadr_dong d
      JOIN roads r ON r.rn_cd = d.rn_cd
      WHERE d.buld_mnnm = $2
        AND COALESCE(d.buld_slno, 0) = $3
        AND d.geom IS NOT NULL
      UNION ALL
      SELECT
        'mst'::text AS src,
        m.gid,
        ST_SetSRID(m.geom, 5181) AS g
      FROM public_layer.tl_sgco_rnadr_mst m
      JOIN roads r ON r.rn_cd = m.rn_cd
      WHERE m.buld_mnnm = $2
        AND COALESCE(m.buld_slno, 0) = $3
        AND m.geom IS NOT NULL
    ),
    filtered AS (
      SELECT c.src, c.gid, c.g
      FROM cand c
      WHERE (
        $4::text = ''
        OR EXISTS (
          SELECT 1
          FROM public_layer.emd e
          WHERE e.emd_nm = $4
            AND ST_Intersects(ST_SetSRID(e.geom, 5181), c.g)
        )
      )
    ),
    preferred AS (
      SELECT *
      FROM filtered
      WHERE src = CASE
        WHEN EXISTS (SELECT 1 FROM filtered WHERE src = 'dong') THEN 'dong'
        ELSE 'mst'
      END
    )
    SELECT
      COUNT(*)::int AS cnt,
      MIN(gid)::int AS gid,
      MIN(src) AS src,
      CASE
        WHEN COUNT(*) = 0 THEN NULL
        ELSE ST_AsText(ST_PointOnSurface(ST_UnaryUnion(ST_Collect(g))))
      END AS wkt
    FROM preferred
    `,
    [row.roadNm, main, sub, emd]
  );
  const hit = res.rows[0] ?? {};
  const cnt = Number(hit.cnt ?? 0) || 0;
  const wkt = String(hit.wkt ?? '').trim() || null;
  const gid = hit.gid != null && Number.isFinite(Number(hit.gid)) ? Number(hit.gid) : null;
  const matchSrc = String(hit.src ?? '').trim() || null;
  return { wkt, matchGid: gid, matchCnt: cnt, matchSrc };
}

function buildDefineFields(): Record<string, unknown>[] {
  const defs: Array<{ name: string; kor: string; type: string; list?: boolean; detail?: boolean; key?: boolean }> = [
    { name: 'id', kor: '번호', type: 'NUMBER', key: true },
    { name: 'year', kor: '연도', type: 'NUMBER' },
    { name: 'seq_no', kor: '연번', type: 'NUMBER' },
    { name: 'emd_nm', kor: '읍면동', type: 'TEXT' },
    { name: 'road_nm', kor: '도로명', type: 'TEXT' },
    { name: 'bunji_main', kor: '본번', type: 'TEXT' },
    { name: 'bunji_sub', kor: '부번', type: 'TEXT' },
    { name: 'status', kor: '진행상황', type: 'TEXT' },
    { name: 'remark', kor: '비고', type: 'TEXT' },
    { name: 'dup_key', kor: '중복', type: 'TEXT', list: false },
    { name: 'req_date', kor: '요청일', type: 'TEXT' },
    { name: 'match_gid', kor: '매칭건물', type: 'NUMBER', list: false, detail: false },
    { name: 'match_cnt', kor: '매칭수', type: 'NUMBER', list: false, detail: false },
    { name: 'match_src', kor: '매칭출처', type: 'TEXT', list: false, detail: false },
  ];
  return defs.map((d, i) => ({
    define_field_name: d.name,
    define_field_kor_name: d.kor,
    define_field_type: d.type,
    define_field_idx: i + 1,
    define_field_is_required: false,
    define_field_show_search: d.name === 'road_nm' || d.name === 'emd_nm' || d.name === 'status',
    define_field_show_list: d.list !== false,
    define_field_show_detail: d.detail !== false,
    define_field_read_only: false,
    define_field_is_key: d.key === true ? 'true' : false,
    define_field_show_search_detail: false,
    define_field_max_length: '',
    define_field_sort_idx: d.name === 'year' ? '1' : d.name === 'seq_no' ? '2' : '',
    define_field_sort_type: d.name === 'year' || d.name === 'seq_no' ? 'ASC' : '',
    define_field_sel_list: '',
    define_field_sel_table: '',
    define_field_sel_query: '',
    define_field_sel_url: '',
    define_field_show_detail_list: false,
    define_field_sel_key_field: '',
    define_field_sel_label_field: '',
    define_field_default_value: '',
    define_field_show_title: d.name === 'road_nm',
  }));
}

async function upsertDefine(): Promise<{ fieldsPath: string }> {
  const tablesPath = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'tables.json');
  const fieldsPath = path.join(
    process.cwd(),
    'src',
    'config',
    'defineLayer',
    'fields',
    `table_${TABLE}.json`
  );
  let tables: Record<string, unknown>[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(tablesPath, 'utf-8'));
    if (Array.isArray(parsed)) tables = parsed;
  } catch {
    tables = [];
  }
  const idx = tables.findIndex(
    (r) => String(r.define_table_name ?? '').trim().toLowerCase() === TABLE
  );
  const row = reorderDefineLayerTableRow({
    define_table_name: TABLE,
    define_table_kor_name: TABLE_KOR,
    define_table_shp_type: 'POINT',
    define_table_read_share: 'P',
    define_table_write_share: 'P',
    define_table_group: GROUP,
    define_table_idx: '0',
    define_table_etc: '',
    define_table_schema: SCHEMA,
    define_table_source: 'excel',
  });
  if (idx >= 0) tables[idx] = { ...tables[idx], ...row };
  else tables.push(row);
  fs.writeFileSync(tablesPath, `${JSON.stringify(reorderDefineLayerTablesArray(tables), null, 2)}\n`, 'utf-8');
  fs.mkdirSync(path.dirname(fieldsPath), { recursive: true });
  fs.writeFileSync(fieldsPath, `${JSON.stringify(buildDefineFields(), null, 2)}\n`, 'utf-8');
  return { fieldsPath };
}

async function removeDefine(): Promise<void> {
  const tablesPath = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'tables.json');
  const fieldsPath = path.join(
    process.cwd(),
    'src',
    'config',
    'defineLayer',
    'fields',
    `table_${TABLE}.json`
  );
  try {
    const parsed = JSON.parse(fs.readFileSync(tablesPath, 'utf-8'));
    if (Array.isArray(parsed)) {
      const next = parsed.filter(
        (r) => String((r as Record<string, unknown>).define_table_name ?? '').trim().toLowerCase() !== TABLE
      );
      fs.writeFileSync(
        tablesPath,
        `${JSON.stringify(reorderDefineLayerTablesArray(next as Record<string, unknown>[]), null, 2)}\n`,
        'utf-8'
      );
    }
  } catch {
    // ignore
  }
  if (fs.existsSync(fieldsPath)) fs.unlinkSync(fieldsPath);
}

function gsAuthHeaders(): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from('admin:geoserver', 'utf8').toString('base64')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/** 공유 GeoServer의 postgres_layer(다른 프로젝트 DB)를 건드리지 않고, 안동 전용 스토어에 발행 */
async function publishGeoServer(project: string): Promise<{ ok: boolean; datastore: string; error?: string }> {
  const base = getGeoServerInternalBase().replace(/\/$/, '');
  const headers = gsAuthHeaders();
  const dsName = `postgres_layer_${project}`;
  const layerName = TABLE.toLowerCase();
  const db = {
    host: process.env.DATABASE_HOST || 'localhost',
    port: process.env.DATABASE_PORT || '5432',
    database: process.env.DATABASE_NAME || '',
    user: process.env.DATABASE_USER || '',
    password: process.env.DATABASE_PASSWORD || '',
  };

  try {
    const probe = await fetch(`${base}/rest/about/version.json`, { headers });
    if (!probe.ok) {
      return { ok: false, datastore: dsName, error: `GeoServer 연결 실패 HTTP ${probe.status}` };
    }

    const dsGet = await fetch(`${base}/rest/workspaces/ggnr/datastores/${dsName}.json`, { headers });
    if (dsGet.status === 404) {
      const body = {
        dataStore: {
          name: dsName,
          type: 'PostGIS',
          enabled: true,
          connectionParameters: {
            entry: [
              { '@key': 'host', $: db.host },
              { '@key': 'port', $: String(db.port) },
              { '@key': 'database', $: db.database },
              { '@key': 'schema', $: SCHEMA },
              { '@key': 'user', $: db.user },
              { '@key': 'passwd', $: db.password },
              { '@key': 'dbtype', $: 'postgis' },
              { '@key': 'Expose primary keys', $: 'true' },
              { '@key': 'namespace', $: 'http://ggnr' },
            ],
          },
        },
      };
      const created = await fetch(`${base}/rest/workspaces/ggnr/datastores.json`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!created.ok) {
        return {
          ok: false,
          datastore: dsName,
          error: `datastore 생성 실패: ${created.status} ${await created.text()}`,
        };
      }
      console.log(`${LOG} created datastore ${dsName} → ${db.database}`);
    } else if (!dsGet.ok) {
      return {
        ok: false,
        datastore: dsName,
        error: `datastore 조회 실패: ${dsGet.status} ${await dsGet.text()}`,
      };
    }

    await fetch(`${base}/rest/workspaces/ggnr/layers/${encodeURIComponent(layerName)}`, {
      method: 'DELETE',
      headers,
    });
    await fetch(
      `${base}/rest/workspaces/ggnr/datastores/${dsName}/featuretypes/${encodeURIComponent(layerName)}`,
      { method: 'DELETE', headers }
    );

    const ftRes = await fetch(
      `${base}/rest/workspaces/ggnr/datastores/${dsName}/featuretypes.json`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          featureType: {
            name: layerName,
            nativeName: TABLE,
            enabled: true,
            srs: 'EPSG:5181',
            title: TABLE_KOR,
          },
        }),
      }
    );
    if (!ftRes.ok) {
      return {
        ok: false,
        datastore: dsName,
        error: `FeatureType 생성 실패: ${ftRes.status} ${await ftRes.text()}`,
      };
    }

    const { applyDefaultStyleToLayer } = await import('../src/service/devTestService');
    const styleRes = await applyDefaultStyleToLayer({ layerName: TABLE, url: base });
    if (!styleRes.success) {
      console.warn(`${LOG} style warn:`, styleRes.error);
    }
    return { ok: true, datastore: dsName };
  } catch (e) {
    return {
      ok: false,
      datastore: dsName,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function unpublishGeoServer(project: string): Promise<void> {
  const base = getGeoServerInternalBase().replace(/\/$/, '');
  const headers = gsAuthHeaders();
  const name = TABLE.toLowerCase();
  const dsName = `postgres_layer_${project}`;
  const urls = [
    `${base}/rest/workspaces/ggnr/layers/${encodeURIComponent(name)}`,
    `${base}/rest/workspaces/ggnr/datastores/${dsName}/featuretypes/${encodeURIComponent(name)}`,
    `${base}/rest/workspaces/ggnr/datastores/postgres_layer/featuretypes/${encodeURIComponent(name)}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'DELETE', headers });
      console.log(`${LOG} DELETE ${url} → ${res.status}`);
    } catch (e) {
      console.warn(`${LOG} DELETE fail ${url}`, e instanceof Error ? e.message : e);
    }
  }
}

async function runRollback(project: string, type: string): Promise<void> {
  loadProjectEnv(project, type);
  const { pool } = await import('../src/database/db');
  console.log(`${LOG} rollback start`);
  let projectName = project;
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as Manifest;
      if (m.project) projectName = m.project;
    }
  } catch {
    // ignore
  }
  await unpublishGeoServer(projectName);
  await pool.query(`DROP TABLE IF EXISTS layer.${TABLE} CASCADE`);
  await removeDefine();
  if (fs.existsSync(MANIFEST_PATH)) fs.unlinkSync(MANIFEST_PATH);
  console.log(`${LOG} rollback done (table/define/geoserver)`);
  await pool.end();
}

async function importMain(project: string, type: string, file: string): Promise<void> {
  loadProjectEnv(project, type);
  if (!fs.existsSync(file)) {
    console.error(`${LOG} 파일 없음: ${file}`);
    process.exit(1);
  }

  const { pool } = await import('../src/database/db');
  await ensureTable(pool);
  await pool.query(`TRUNCATE layer.${TABLE} RESTART IDENTITY`);

  const wb = XLSX.readFile(file);
  const rows: ExcelRow[] = [];
  /** 기본은 2025·2026 모두. 한 해만 넣으려면 --year=2026 */
  const yearOnlyArg = process.argv.find((a) => a.startsWith('--year='));
  const yearOnly = yearOnlyArg ? Number(yearOnlyArg.slice('--year='.length)) : null;
  for (const sheetName of wb.SheetNames) {
    const year = Number(sheetName);
    if (!Number.isFinite(year)) continue;
    if (yearOnly != null && Number.isFinite(yearOnly) && year !== yearOnly) {
      console.log(`${LOG} skip sheet ${sheetName} (--year=${yearOnly})`);
      continue;
    }
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const parsed = parseSheet(year, ws);
    console.log(`${LOG} sheet ${sheetName}: ${parsed.length} rows`);
    rows.push(...parsed);
  }

  let inserted = 0;
  let withGeom = 0;
  let withoutGeom = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const matched = await lookupGeom(pool, row);
    if (matched.wkt) withGeom += 1;
    else withoutGeom += 1;

    await pool.query(
      `INSERT INTO layer.${TABLE}
        (year, seq_no, emd_nm, road_nm, bunji_main, bunji_sub, status, remark, dup_key, req_date, match_gid, match_cnt, match_src, geom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
         CASE WHEN $14::text IS NOT NULL THEN ST_GeomFromText($14, 5181) ELSE NULL END)`,
      [
        row.year,
        row.seqNo,
        row.emdNm || null,
        row.roadNm || null,
        row.bunjiMain || null,
        row.bunjiSub || null,
        row.status || null,
        row.remark || null,
        row.dupKey || null,
        row.reqDate || null,
        matched.matchGid,
        matched.matchCnt,
        matched.matchSrc,
        matched.wkt,
      ]
    );
    inserted += 1;
    if ((i + 1) % 50 === 0 || i === rows.length - 1) {
      console.log(
        `${LOG} progress ${i + 1}/${rows.length} geom=${withGeom} miss=${withoutGeom}`
      );
    }
  }

  const { fieldsPath } = await upsertDefine();
  const published = await publishGeoServer(project);
  if (!published.ok) {
    console.warn(`${LOG} GeoServer publish skipped/failed:`, published.error);
  } else {
    console.log(`${LOG} GeoServer published via ${published.datastore}`);
  }

  const manifest: Manifest = {
    project,
    env: type,
    table: TABLE,
    schema: SCHEMA,
    createdAt: new Date().toISOString(),
    sourceFile: file,
    defineTablesTouched: true,
    defineFieldsPath: fieldsPath.replace(/\\/g, '/'),
    geoserverPublished: published.ok,
    inserted,
    withGeom,
    withoutGeom,
  };
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  console.log(`${LOG} done inserted=${inserted} withGeom=${withGeom} withoutGeom=${withoutGeom}`);
  console.log(`${LOG} rollback: npx tsx scripts/import-building-number-plate-xlsx.ts ${project} ${type} --rollback`);
  console.log(`${LOG} manifest: ${MANIFEST_PATH}`);
  await pool.end();
}

function resolveLocalGeoServerUrl(): string {
  if (process.env.GEOSERVER_URL?.trim()) {
    return process.env.GEOSERVER_URL.trim().replace(/\/$/, '');
  }
  try {
    const ini = fs.readFileSync(
      path.join(process.cwd(), 'geoserver_modules', 'geoserver', 'start.ini'),
      'utf-8'
    );
    const m = ini.match(/jetty\.http\.port\s*=\s*(\d+)/);
    if (m?.[1]) return `http://127.0.0.1:${m[1]}/geoserver`;
  } catch {
    // ignore
  }
  return getGeoServerInternalBase();
}

async function main() {
  const { project, type, file, rollback } = parseArgs();
  process.env.GEOSERVER_URL = resolveLocalGeoServerUrl();
  console.log(`${LOG} GEOSERVER_URL=${process.env.GEOSERVER_URL}`);
  if (rollback) await runRollback(project, type);
  else await importMain(project, type, file);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
