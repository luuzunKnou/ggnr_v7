/**
 * 유지보수 내역 엑셀 → layer.road_sign_maintenance 적재 + define/GeoServer 발행
 *
 * 시트:
 *  - 도로명판(산불피해지역한거)
 *  - 기초번호판(산불피해지역한거)
 *  - 건물번호판(이재민임시주택)
 *
 * 사용:
 *   npx tsx scripts/import-road-sign-maintenance-xlsx.ts ggnr_ad dev
 *   npx tsx scripts/import-road-sign-maintenance-xlsx.ts ggnr_ad dev --rollback
 */
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { loadProjectEnv } from './load-project-env';
import { getGeoServerInternalBase } from '../src/lib/geoserverUrl';
import { reorderDefineLayerTableRow, reorderDefineLayerTablesArray } from '../src/lib/defineLayerTableRowOrder';

const LOG = '[road-sign-maintenance]';
const TABLE = 'road_sign_maintenance';
const TABLE_KOR = '유지보수내역';
const GROUP = '도로';
const SCHEMA = 'layer' as const;

const DEFAULT_FILE =
  '//192.168.127.11/사업수행_개발/020 사업별 수급자료 v2/안동 공간정보/수급/260915_도로명 관련자료/유지보수 내역.xlsx';

const MANIFEST_PATH = path.join(
  process.cwd(),
  'docs',
  'reports',
  '_rollback_road_sign_maintenance.json'
);

type ExcelRow = {
  kind: string;
  seqNo: number | null;
  emdNm: string;
  roadNm: string;
  bunjiMain: string;
  bunjiSub: string;
  bunjiMainEnd: string;
  bunjiSubEnd: string;
  facility: string;
  plateType: string;
  category: string;
  installState: string;
  houseCnt: string;
  remark: string;
  extraJson: string;
};

type Manifest = {
  project: string;
  env: string;
  table: string;
  schema: string;
  createdAt: string;
  sourceFile: string;
  inserted: number;
  withGeom: number;
  withoutGeom: number;
  byKind: Record<string, number>;
  geoserverPublished: boolean;
};

type PgPool = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
};

function parseArgs(): { project: string; type: string; file: string; rollback: boolean } {
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
  if (!t || !/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.floor(n) : null;
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
  const digits = String(raw ?? '')
    .replace(/,/g, '')
    .replace(/[^\d]/g, '');
  if (!digits) return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

function parseRoadNamePlate(ws: XLSX.WorkSheet): ExcelRow[] {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
  const headerIdx = rows.findIndex(
    (r) => cellText(r?.[0]) === 'No' && cellText(r?.[4]) === '도로명'
  );
  if (headerIdx < 0) return [];
  const out: ExcelRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const seqNo = toIntOrNull(r[0]);
    const roadNm = cellText(r[4]);
    if (seqNo == null || !roadNm) continue;
    out.push({
      kind: '도로명판',
      seqNo,
      emdNm: cellText(r[1]),
      roadNm,
      bunjiMain: cellText(r[5]),
      bunjiSub: cellText(r[6]),
      bunjiMainEnd: cellText(r[7]),
      bunjiSubEnd: cellText(r[8]),
      facility: cellText(r[2]),
      plateType: cellText(r[3]),
      category: '',
      installState: '',
      houseCnt: '',
      remark: '',
      extraJson: '',
    });
  }
  return out;
}

function parseBaseNumberPlate(ws: XLSX.WorkSheet): ExcelRow[] {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
  /** row2=상위헤더, row3=하위헤더, data from row4 */
  const out: ExcelRow[] = [];
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const seqNo = toIntOrNull(r[0]);
    if (seqNo == null) continue;
    const roadNm = cellText(r[15]);
    const bunjiMain = cellText(r[17]);
    const bunjiSub = cellText(r[18]);
    const emdNm = cellText(r[3]);
    const facility = cellText(r[8]) || cellText(r[12]);
    const plateType = cellText(r[11]);
    const installState = cellText(r[27]);
    const remark = [cellText(r[5]), cellText(r[52]), cellText(r[56])].filter(Boolean).join(' / ');
    out.push({
      kind: '기초번호판',
      seqNo,
      emdNm,
      roadNm,
      bunjiMain,
      bunjiSub,
      bunjiMainEnd: '',
      bunjiSubEnd: '',
      facility,
      plateType,
      category: cellText(r[5]),
      installState,
      houseCnt: '',
      remark,
      extraJson: JSON.stringify({
        facilitySn: cellText(r[4]),
        manageNo: cellText(r[6]),
        locSn: cellText(r[7]),
        checkYear: cellText(r[48]),
        checkResult: cellText(r[52]),
      }),
    });
  }
  return out;
}

function parseTempHousePlate(ws: XLSX.WorkSheet): ExcelRow[] {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
  const headerIdx = rows.findIndex(
    (r) => cellText(r?.[0]) === 'No' && cellText(r?.[3]) === '도로명'
  );
  if (headerIdx < 0) return [];
  const out: ExcelRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const seqNo = toIntOrNull(r[0]);
    const roadNm = cellText(r[3]);
    if (seqNo == null || !roadNm) continue;
    out.push({
      kind: '임시주택건물번호판',
      seqNo,
      emdNm: cellText(r[1]),
      roadNm,
      bunjiMain: cellText(r[4]),
      bunjiSub: cellText(r[5]),
      bunjiMainEnd: '',
      bunjiSubEnd: '',
      facility: '',
      plateType: '',
      category: cellText(r[2]),
      installState: cellText(r[6]),
      houseCnt: cellText(r[7]),
      remark: cellText(r[8]),
      extraJson: '',
    });
  }
  return out;
}

async function ensureTable(pool: PgPool): Promise<void> {
  await pool.query(`
CREATE TABLE IF NOT EXISTS layer.${TABLE} (
  id serial PRIMARY KEY,
  kind text,
  seq_no integer,
  emd_nm text,
  road_nm text,
  bunji_main text,
  bunji_sub text,
  bunji_main_end text,
  bunji_sub_end text,
  facility text,
  plate_type text,
  category text,
  install_state text,
  house_cnt text,
  remark text,
  extra_json text,
  match_gid integer,
  match_cnt integer,
  match_src text,
  geom geometry(Point, 5181)
);
CREATE INDEX IF NOT EXISTS ${TABLE}_geom_gix ON layer.${TABLE} USING GIST (geom);
CREATE INDEX IF NOT EXISTS ${TABLE}_kind_idx ON layer.${TABLE} (kind);
CREATE INDEX IF NOT EXISTS ${TABLE}_road_idx ON layer.${TABLE} (road_nm, bunji_main, bunji_sub);
COMMENT ON TABLE layer.${TABLE} IS '도로명 관련 유지보수 내역(엑셀 적재)';
`);
}

async function lookupGeom(
  pool: PgPool,
  row: ExcelRow
): Promise<{ wkt: string | null; matchGid: number | null; matchCnt: number; matchSrc: string | null }> {
  const empty = { wkt: null, matchGid: null, matchCnt: 0, matchSrc: null };
  if (!row.roadNm) return empty;

  const main = bunjiMainNum(row.bunjiMain);
  const sub = bunjiSubNum(row.bunjiSub);
  const emd = row.emdNm.trim();

  if (main != null) {
    const res = await pool.query(
      `
      WITH roads AS (
        SELECT DISTINCT rn_cd
        FROM public_layer.tl_sprd_manage
        WHERE rn = $1
      ),
      cand AS (
        SELECT 'dong'::text AS src, d.gid, ST_SetSRID(d.geom, 5181) AS g
        FROM public_layer.tl_sgco_rnadr_dong d
        JOIN roads r ON r.rn_cd = d.rn_cd
        WHERE d.buld_mnnm = $2 AND COALESCE(d.buld_slno, 0) = $3 AND d.geom IS NOT NULL
        UNION ALL
        SELECT 'mst'::text AS src, m.gid, ST_SetSRID(m.geom, 5181) AS g
        FROM public_layer.tl_sgco_rnadr_mst m
        JOIN roads r ON r.rn_cd = m.rn_cd
        WHERE m.buld_mnnm = $2 AND COALESCE(m.buld_slno, 0) = $3 AND m.geom IS NOT NULL
      ),
      filtered AS (
        SELECT c.*
        FROM cand c
        WHERE (
          $4::text = ''
          OR EXISTS (
            SELECT 1 FROM public_layer.emd e
            WHERE e.emd_nm = $4 AND ST_Intersects(ST_SetSRID(e.geom, 5181), c.g)
          )
        )
      ),
      preferred AS (
        SELECT * FROM filtered
        WHERE src = CASE
          WHEN EXISTS (SELECT 1 FROM filtered WHERE src = 'dong') THEN 'dong'
          ELSE 'mst'
        END
      )
      SELECT COUNT(*)::int AS cnt, MIN(gid)::int AS gid, MIN(src) AS src,
        CASE WHEN COUNT(*) = 0 THEN NULL
             ELSE ST_AsText(ST_PointOnSurface(ST_UnaryUnion(ST_Collect(g)))) END AS wkt
      FROM preferred
      `,
      [row.roadNm, main, sub, emd]
    );
    const hit = res.rows[0] ?? {};
    const cnt = Number(hit.cnt ?? 0) || 0;
    if (cnt > 0) {
      return {
        wkt: String(hit.wkt ?? '').trim() || null,
        matchGid: hit.gid != null ? Number(hit.gid) : null,
        matchCnt: cnt,
        matchSrc: String(hit.src ?? '').trim() || null,
      };
    }
  }

  /** 도로명만 있을 때 — 도로 중심점 */
  const roadRes = await pool.query(
    `
    WITH roads AS (
      SELECT ST_SetSRID(geom, 5181) AS g
      FROM public_layer.tl_sprd_manage
      WHERE rn = $1 AND geom IS NOT NULL
    ),
    filtered AS (
      SELECT r.g
      FROM roads r
      WHERE (
        $2::text = ''
        OR EXISTS (
          SELECT 1 FROM public_layer.emd e
          WHERE e.emd_nm = $2 AND ST_Intersects(ST_SetSRID(e.geom, 5181), r.g)
        )
      )
    )
    SELECT COUNT(*)::int AS cnt,
      CASE WHEN COUNT(*) = 0 THEN NULL
           ELSE ST_AsText(ST_PointOnSurface(ST_UnaryUnion(ST_Collect(g)))) END AS wkt
    FROM filtered
    `,
    [row.roadNm, emd]
  );
  const hit = roadRes.rows[0] ?? {};
  const cnt = Number(hit.cnt ?? 0) || 0;
  if (cnt === 0) return empty;
  return {
    wkt: String(hit.wkt ?? '').trim() || null,
    matchGid: null,
    matchCnt: cnt,
    matchSrc: 'road',
  };
}

function buildDefineFields(): Record<string, unknown>[] {
  const defs: Array<{ name: string; kor: string; type: string; list?: boolean; detail?: boolean; key?: boolean; search?: boolean }> = [
    { name: 'id', kor: '번호', type: 'NUMBER', key: true },
    { name: 'kind', kor: '유형', type: 'TEXT', search: true },
    { name: 'seq_no', kor: '연번', type: 'NUMBER' },
    { name: 'emd_nm', kor: '행정동', type: 'TEXT', search: true },
    { name: 'road_nm', kor: '도로명', type: 'TEXT', search: true },
    { name: 'bunji_main', kor: '본번', type: 'TEXT' },
    { name: 'bunji_sub', kor: '부번', type: 'TEXT' },
    { name: 'bunji_main_end', kor: '종료본번', type: 'TEXT', list: false },
    { name: 'bunji_sub_end', kor: '종료부번', type: 'TEXT', list: false },
    { name: 'facility', kor: '설치시설물', type: 'TEXT' },
    { name: 'plate_type', kor: '종류', type: 'TEXT' },
    { name: 'category', kor: '구분', type: 'TEXT' },
    { name: 'install_state', kor: '설치상태', type: 'TEXT' },
    { name: 'house_cnt', kor: '동수', type: 'TEXT', list: false },
    { name: 'remark', kor: '비고', type: 'TEXT', list: false },
    { name: 'extra_json', kor: '부가정보', type: 'TEXT', list: false, detail: false },
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
    define_field_show_search: !!d.search,
    define_field_show_list: d.list !== false,
    define_field_show_detail: d.detail !== false,
    define_field_read_only: false,
    define_field_is_key: d.key === true ? 'true' : false,
    define_field_show_search_detail: false,
    define_field_max_length: '',
    define_field_sort_idx: d.name === 'kind' ? '1' : d.name === 'seq_no' ? '2' : '',
    define_field_sort_type: d.name === 'kind' || d.name === 'seq_no' ? 'ASC' : '',
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

async function upsertDefine(): Promise<void> {
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
        (r) =>
          String((r as Record<string, unknown>).define_table_name ?? '').trim().toLowerCase() !== TABLE
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

async function publishGeoServer(
  project: string
): Promise<{ ok: boolean; datastore: string; error?: string }> {
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
    if (!styleRes.success) console.warn(`${LOG} style warn:`, styleRes.error);
    return { ok: true, datastore: dsName };
  } catch (e) {
    return { ok: false, datastore: dsName, error: e instanceof Error ? e.message : String(e) };
  }
}

async function unpublishGeoServer(project: string): Promise<void> {
  const base = getGeoServerInternalBase().replace(/\/$/, '');
  const headers = gsAuthHeaders();
  const name = TABLE.toLowerCase();
  const dsName = `postgres_layer_${project}`;
  for (const url of [
    `${base}/rest/workspaces/ggnr/layers/${encodeURIComponent(name)}`,
    `${base}/rest/workspaces/ggnr/datastores/${dsName}/featuretypes/${encodeURIComponent(name)}`,
    `${base}/rest/workspaces/ggnr/datastores/postgres_layer/featuretypes/${encodeURIComponent(name)}`,
  ]) {
    try {
      const res = await fetch(url, { method: 'DELETE', headers });
      console.log(`${LOG} DELETE ${url} → ${res.status}`);
    } catch (e) {
      console.warn(`${LOG} DELETE fail`, e instanceof Error ? e.message : e);
    }
  }
}

async function runRollback(project: string, type: string): Promise<void> {
  loadProjectEnv(project, type);
  process.env.GEOSERVER_URL = resolveLocalGeoServerUrl();
  const { pool } = (await import('../src/database/db')) as unknown as { pool: PgPool };
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
  console.log(`${LOG} rollback done`);
  await pool.end();
}

async function importMain(project: string, type: string, file: string): Promise<void> {
  loadProjectEnv(project, type);
  process.env.GEOSERVER_URL = resolveLocalGeoServerUrl();
  console.log(`${LOG} GEOSERVER_URL=${process.env.GEOSERVER_URL}`);
  if (!fs.existsSync(file)) {
    console.error(`${LOG} 파일 없음: ${file}`);
    process.exit(1);
  }

  const { pool } = (await import('../src/database/db')) as unknown as { pool: PgPool };
  await ensureTable(pool);
  await pool.query(`TRUNCATE layer.${TABLE} RESTART IDENTITY`);

  const wb = XLSX.readFile(file);
  const rows: ExcelRow[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const name = sheetName.trim();
    if (name.startsWith('도로명판')) {
      const parsed = parseRoadNamePlate(ws);
      console.log(`${LOG} sheet ${sheetName}: ${parsed.length}`);
      rows.push(...parsed);
    } else if (name.startsWith('기초번호판')) {
      const parsed = parseBaseNumberPlate(ws);
      console.log(`${LOG} sheet ${sheetName}: ${parsed.length}`);
      rows.push(...parsed);
    } else if (name.startsWith('건물번호판')) {
      const parsed = parseTempHousePlate(ws);
      console.log(`${LOG} sheet ${sheetName}: ${parsed.length}`);
      rows.push(...parsed);
    } else {
      console.log(`${LOG} skip sheet ${sheetName}`);
    }
  }

  let inserted = 0;
  let withGeom = 0;
  let withoutGeom = 0;
  const byKind: Record<string, number> = {};

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
    const matched = await lookupGeom(pool, row);
    if (matched.wkt) withGeom += 1;
    else withoutGeom += 1;

    await pool.query(
      `INSERT INTO layer.${TABLE}
        (kind, seq_no, emd_nm, road_nm, bunji_main, bunji_sub, bunji_main_end, bunji_sub_end,
         facility, plate_type, category, install_state, house_cnt, remark, extra_json,
         match_gid, match_cnt, match_src, geom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
         CASE WHEN $19::text IS NOT NULL THEN ST_GeomFromText($19, 5181) ELSE NULL END)`,
      [
        row.kind,
        row.seqNo,
        row.emdNm || null,
        row.roadNm || null,
        row.bunjiMain || null,
        row.bunjiSub || null,
        row.bunjiMainEnd || null,
        row.bunjiSubEnd || null,
        row.facility || null,
        row.plateType || null,
        row.category || null,
        row.installState || null,
        row.houseCnt || null,
        row.remark || null,
        row.extraJson || null,
        matched.matchGid,
        matched.matchCnt,
        matched.matchSrc,
        matched.wkt,
      ]
    );
    inserted += 1;
    if ((i + 1) % 50 === 0 || i === rows.length - 1) {
      console.log(`${LOG} progress ${i + 1}/${rows.length} geom=${withGeom} miss=${withoutGeom}`);
    }
  }

  await upsertDefine();
  const published = await publishGeoServer(project);
  if (!published.ok) console.warn(`${LOG} GeoServer fail:`, published.error);
  else console.log(`${LOG} GeoServer published via ${published.datastore}`);

  const manifest: Manifest = {
    project,
    env: type,
    table: TABLE,
    schema: SCHEMA,
    createdAt: new Date().toISOString(),
    sourceFile: file,
    inserted,
    withGeom,
    withoutGeom,
    byKind,
    geoserverPublished: published.ok,
  };
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  console.log(`${LOG} done inserted=${inserted} withGeom=${withGeom} withoutGeom=${withoutGeom}`, byKind);
  console.log(
    `${LOG} rollback: npx tsx scripts/import-road-sign-maintenance-xlsx.ts ${project} ${type} --rollback`
  );
  await pool.end();
}

async function main() {
  const { project, type, file, rollback } = parseArgs();
  if (rollback) await runRollback(project, type);
  else await importMain(project, type, file);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
