/**
 * 수급 보안등 엑셀(geom EPSG:5181) → layer.security_light_supply
 * 사용: GGNR_PROJECT=road_gs GGNR_ENV=dev npx tsx scripts/import-security-light-supply-xlsx.ts [xlsx경로]
 */
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import * as XLSX from 'xlsx';
import { getProjectEnvVars, loadProjectEnv } from './load-project-env';

const TABLE = 'security_light_supply';
const DEFAULT_XLSX = 'c:/Users/dggs01/Downloads/보안등1_geom_EPSG5181.xlsx';
const BATCH = 400;

function tx(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function toNum(v: unknown): number | null {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

function makePool(): Pool {
  const project = (process.env.GGNR_PROJECT ?? 'road_gs').trim() || 'road_gs';
  const env = (process.env.GGNR_ENV ?? 'dev').trim() || 'dev';
  loadProjectEnv(project, env);
  const vars = getProjectEnvVars(project, env);
  return new Pool({
    host: vars.DATABASE_HOST || process.env.DATABASE_HOST,
    port: Number(vars.DATABASE_PORT || process.env.DATABASE_PORT || 5432),
    database: vars.DATABASE_NAME || process.env.DATABASE_NAME,
    user: vars.DATABASE_USER || process.env.DATABASE_USER,
    password: vars.DATABASE_PASSWORD || process.env.DATABASE_PASSWORD,
    max: 2,
  });
}

async function ensureTable(pool: Pool): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS layer`);
  await pool.query(`DROP TABLE IF EXISTS layer.${TABLE}`);
  await pool.query(`
    CREATE TABLE layer.${TABLE} (
      id serial PRIMARY KEY,
      manage_no text,
      fclt_type text,
      hangdong text,
      detail_area text,
      addr text,
      lamp_seq text,
      fixture_type text,
      fixture_vendor text,
      lamp_type text,
      lamp_watt text,
      lamp_qty text,
      fixture_install_ymd text,
      warranty_ymd text,
      pole_type text,
      pole_height_m text,
      pole_no text,
      usage_amt text,
      kepco_cust_no text,
      kepco_apply_ymd text,
      flasher_type text,
      flasher_vendor text,
      first_install_ymd text,
      remove_ymd text,
      lat double precision,
      lon double precision,
      memo text,
      geom geometry(Point, 5181)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_geom_gix ON layer.${TABLE} USING GIST (geom)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_manage_no_idx ON layer.${TABLE} (manage_no)`
  );
}

type MappedRow = {
  manage_no: string;
  fclt_type: string;
  hangdong: string;
  detail_area: string;
  addr: string;
  lamp_seq: string;
  fixture_type: string;
  fixture_vendor: string;
  lamp_type: string;
  lamp_watt: string;
  lamp_qty: string;
  fixture_install_ymd: string;
  warranty_ymd: string;
  pole_type: string;
  pole_height_m: string;
  pole_no: string;
  usage_amt: string;
  kepco_cust_no: string;
  kepco_apply_ymd: string;
  flasher_type: string;
  flasher_vendor: string;
  first_install_ymd: string;
  remove_ymd: string;
  lat: number | null;
  lon: number | null;
  memo: string;
  geom_wkt: string | null;
};

function mapRow(raw: Record<string, unknown>): MappedRow {
  const geom = tx(raw['geom']);
  const geomWkt = /^POINT\s*\(/i.test(geom) ? geom : null;
  return {
    manage_no: tx(raw['관리번호']),
    fclt_type: tx(raw['시설종류']),
    hangdong: tx(raw['행정동']),
    detail_area: tx(raw['세부지역']),
    addr: tx(raw['주소']),
    lamp_seq: tx(raw['램프순번']),
    fixture_type: tx(raw['등기구종류']),
    fixture_vendor: tx(raw['등기구업체']),
    lamp_type: tx(raw['램프종류']),
    lamp_watt: tx(raw['램프용량(W)']),
    lamp_qty: tx(raw['램프수량']),
    fixture_install_ymd: tx(raw['등기구설치일자']),
    warranty_ymd: tx(raw['보증일자']),
    pole_type: tx(raw['등주종류']),
    pole_height_m: tx(raw['등주높이(m)']),
    pole_no: tx(raw['전주번호']),
    usage_amt: tx(raw['사용량']),
    kepco_cust_no: tx(raw['한전고객번호']),
    kepco_apply_ymd: tx(raw['한전신청일자']),
    flasher_type: tx(raw['점멸기종류']),
    flasher_vendor: tx(raw['점멸기업체']),
    first_install_ymd: tx(raw['최초설치일자']),
    remove_ymd: tx(raw['철거일자']),
    lat: toNum(raw['위도']),
    lon: toNum(raw['경도']),
    memo: tx(raw['메모']),
    geom_wkt: geomWkt,
  };
}

async function insertBatch(pool: Pool, rows: MappedRow[]): Promise<void> {
  if (rows.length === 0) return;
  const cols = [
    'manage_no',
    'fclt_type',
    'hangdong',
    'detail_area',
    'addr',
    'lamp_seq',
    'fixture_type',
    'fixture_vendor',
    'lamp_type',
    'lamp_watt',
    'lamp_qty',
    'fixture_install_ymd',
    'warranty_ymd',
    'pole_type',
    'pole_height_m',
    'pole_no',
    'usage_amt',
    'kepco_cust_no',
    'kepco_apply_ymd',
    'flasher_type',
    'flasher_vendor',
    'first_install_ymd',
    'remove_ymd',
    'lat',
    'lon',
    'memo',
    'geom',
  ];
  const params: unknown[] = [];
  const valueSql: string[] = [];
  let p = 1;
  for (const r of rows) {
    const placeholders: string[] = [];
    for (let i = 0; i < cols.length - 1; i++) {
      placeholders.push(`$${p++}`);
    }
    // geom last
    if (r.geom_wkt) {
      placeholders.push(`ST_SetSRID(ST_GeomFromText($${p++}), 5181)`);
      params.push(
        r.manage_no || null,
        r.fclt_type || null,
        r.hangdong || null,
        r.detail_area || null,
        r.addr || null,
        r.lamp_seq || null,
        r.fixture_type || null,
        r.fixture_vendor || null,
        r.lamp_type || null,
        r.lamp_watt || null,
        r.lamp_qty || null,
        r.fixture_install_ymd || null,
        r.warranty_ymd || null,
        r.pole_type || null,
        r.pole_height_m || null,
        r.pole_no || null,
        r.usage_amt || null,
        r.kepco_cust_no || null,
        r.kepco_apply_ymd || null,
        r.flasher_type || null,
        r.flasher_vendor || null,
        r.first_install_ymd || null,
        r.remove_ymd || null,
        r.lat,
        r.lon,
        r.memo || null,
        r.geom_wkt
      );
    } else {
      placeholders.push(`NULL`);
      params.push(
        r.manage_no || null,
        r.fclt_type || null,
        r.hangdong || null,
        r.detail_area || null,
        r.addr || null,
        r.lamp_seq || null,
        r.fixture_type || null,
        r.fixture_vendor || null,
        r.lamp_type || null,
        r.lamp_watt || null,
        r.lamp_qty || null,
        r.fixture_install_ymd || null,
        r.warranty_ymd || null,
        r.pole_type || null,
        r.pole_height_m || null,
        r.pole_no || null,
        r.usage_amt || null,
        r.kepco_cust_no || null,
        r.kepco_apply_ymd || null,
        r.flasher_type || null,
        r.flasher_vendor || null,
        r.first_install_ymd || null,
        r.remove_ymd || null,
        r.lat,
        r.lon,
        r.memo || null
      );
    }
    valueSql.push(`(${placeholders.join(',')})`);
  }
  await pool.query(
    `INSERT INTO layer.${TABLE} (${cols.join(',')}) VALUES ${valueSql.join(',')}`,
    params
  );
}

async function main() {
  const xlsxPath = path.resolve(process.argv[2] ?? DEFAULT_XLSX);
  if (!fs.existsSync(xlsxPath)) throw new Error(`파일 없음: ${xlsxPath}`);

  const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('시트 없음');
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]!, {
    defval: null,
    raw: false,
  });
  console.log(`[import] rows=${rawRows.length} file=${xlsxPath}`);

  const mapped = rawRows.map(mapRow);
  const withGeom = mapped.filter((r) => r.geom_wkt).length;
  console.log(`[import] withGeom=${withGeom}`);

  const pool = makePool();
  try {
    await ensureTable(pool);
    console.log(`[import] table layer.${TABLE} recreated`);

    for (let i = 0; i < mapped.length; i += BATCH) {
      const chunk = mapped.slice(i, i + BATCH);
      await insertBatch(pool, chunk);
      if ((i / BATCH) % 5 === 0 || i + BATCH >= mapped.length) {
        console.log(`[import] inserted ${Math.min(i + BATCH, mapped.length)}/${mapped.length}`);
      }
    }

    const cnt = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM layer.${TABLE}`
    );
    const geomCnt = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM layer.${TABLE} WHERE geom IS NOT NULL`
    );
    console.log(`[import] done count=${cnt.rows[0]?.c} geom=${geomCnt.rows[0]?.c}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
