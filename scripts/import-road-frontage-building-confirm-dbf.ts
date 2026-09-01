/**
 * 접도구역 건축물 확인결과 DBF → layer.road_frontage_building_confirm 적재
 * 대장 ftr_idn으로 연결. 기존 확인결과는 비우고 다시 넣음.
 * 사용: npx tsx scripts/import-road-frontage-building-confirm-dbf.ts [dbf경로]
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import iconv from 'iconv-lite';
import { loadProjectEnv } from './load-project-env';

loadProjectEnv('build_yy', 'dev');

type DbfField = { name: string; type: string; len: number };

function parseDbf(path: string): Record<string, string | number | null>[] {
  const buf = readFileSync(path);
  const n = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const fields: DbfField[] = [];
  let o = 32;
  while (o < headerLen - 1 && buf[o] !== 0x0d) {
    fields.push({
      name: buf.slice(o, o + 11).toString('ascii').replace(/\0/g, '').trim(),
      type: String.fromCharCode(buf[o + 11]),
      len: buf[o + 16],
    });
    o += 32;
  }
  const rows: Record<string, string | number | null>[] = [];
  for (let i = 0; i < n; i++) {
    if (String.fromCharCode(buf[headerLen + i * recLen]) === '*') continue;
    let p = headerLen + i * recLen + 1;
    const row: Record<string, string | number | null> = {};
    for (const f of fields) {
      const raw = buf.slice(p, p + f.len);
      p += f.len;
      if (f.type === 'N' || f.type === 'F') {
        const s = raw.toString('ascii').trim();
        row[f.name] = s === '' ? null : Number(s);
      } else {
        row[f.name] = iconv.decode(raw, 'cp949').trim();
      }
    }
    rows.push(row);
  }
  return rows;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

async function main() {
  const dbfPath =
    process.argv[2] ||
    resolve('C:/Users/dggs01/OneDrive/바탕 화면/접도구역건축물/road_frontage_building_confirm.dbf');

  const rows = parseDbf(dbfPath);
  console.log('dbf rows', rows.length);

  const { pool } = await import('../src/database/db');
  const { ensureRoadFrontageBuildingTables } = await import('../src/service/ensureLayerAppTables');
  await ensureRoadFrontageBuildingTables();

  const parents = await pool.query<{ ftr_idn: string }>(
    `SELECT ftr_idn FROM layer.road_frontage_building
     WHERE ftr_idn IS NOT NULL AND btrim(ftr_idn) <> ''`
  );
  const knownFtr = new Set(parents.rows.map((r) => String(r.ftr_idn).trim()));

  await pool.query(`DELETE FROM layer.road_frontage_building_confirm`);

  let inserted = 0;
  let skippedNoParent = 0;
  let skippedEmpty = 0;
  const sortByFtr = new Map<string, number>();

  for (const r of rows) {
    const ftrIdn = str(r.ftr_idn);
    const checkYmd = str(r.check_ymd);
    const checkNam = str(r.check_nam);
    const appNam = str(r.app_nam);
    if (!ftrIdn) {
      skippedEmpty++;
      continue;
    }
    if (!checkYmd && !checkNam && !appNam) {
      skippedEmpty++;
      continue;
    }
    if (!knownFtr.has(ftrIdn)) {
      skippedNoParent++;
      continue;
    }
    const sortNo = sortByFtr.get(ftrIdn) ?? 0;
    sortByFtr.set(ftrIdn, sortNo + 1);

    await pool.query(
      `INSERT INTO layer.road_frontage_building_confirm
        (ftr_idn, check_ymd, check_nam, app_nam, sort_no)
       VALUES ($1,$2,$3,$4,$5)`,
      [ftrIdn, checkYmd, checkNam, appNam, sortNo]
    );
    inserted++;
  }

  const cnt = await pool.query(
    `SELECT count(*)::int AS n, count(DISTINCT ftr_idn)::int AS keys
     FROM layer.road_frontage_building_confirm`
  );
  console.log({
    inserted,
    skippedEmpty,
    skippedNoParent,
    table: cnt.rows[0],
  });
  await pool.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
