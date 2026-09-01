/**
 * 접도구역 건축물 대장 DBF → layer.road_frontage_building 적재 (ftr_idn upsert)
 * 사용: npx tsx scripts/import-road-frontage-building-dbf.ts [dbf경로]
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import iconv from 'iconv-lite';
import { loadProjectEnv } from './load-project-env';

loadProjectEnv('build_yy', 'dev');

type DbfField = { name: string; type: string; len: number; dec: number };

function parseDbf(path: string): { fields: DbfField[]; rows: Record<string, string | number | null>[] } {
  const buf = readFileSync(path);
  const n = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const fields: DbfField[] = [];
  let o = 32;
  while (o < headerLen - 1 && buf[o] !== 0x0d) {
    const name = buf.slice(o, o + 11).toString('ascii').replace(/\0/g, '').trim();
    const type = String.fromCharCode(buf[o + 11]);
    const len = buf[o + 16];
    const dec = buf[o + 17];
    fields.push({ name, type, len, dec });
    o += 32;
  }

  const rows: Record<string, string | number | null>[] = [];
  for (let i = 0; i < n; i++) {
    const start = headerLen + i * recLen;
    if (String.fromCharCode(buf[start]) === '*') continue; // deleted
    let p = start + 1;
    const row: Record<string, string | number | null> = {};
    for (const f of fields) {
      const raw = buf.slice(p, p + f.len);
      p += f.len;
      if (f.type === 'N' || f.type === 'F') {
        const s = raw.toString('ascii').trim();
        row[f.name] = s === '' ? null : Number(s);
      } else if (f.type === 'L') {
        const s = raw.toString('ascii').trim().toUpperCase();
        row[f.name] = s === 'T' || s === 'Y' || s === '1' ? 1 : 0;
      } else {
        row[f.name] = iconv.decode(raw, 'cp949').trim();
      }
    }
    rows.push(row);
  }
  return { fields, rows };
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function isDel(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const n = num(v);
  if (n != null) return n !== 0;
  const s = String(v ?? '').trim().toUpperCase();
  return s === '1' || s === 'T' || s === 'Y' || s === 'TRUE';
}

async function main() {
  const dbfPath =
    process.argv[2] ||
    resolve('C:/Users/dggs01/OneDrive/바탕 화면/접도구역건축물/road_frontage_building.dbf');

  const { rows } = parseDbf(dbfPath);
  console.log('dbf rows', rows.length, 'from', dbfPath);

  const { pool } = await import('../src/database/db');
  const { ensureRoadFrontageBuildingTables } = await import('../src/service/ensureLayerAppTables');
  await ensureRoadFrontageBuildingTables();

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let geomSet = 0;

  for (const r of rows) {
    const ftrIdn = str(r.ftr_idn);
    if (!ftrIdn) {
      skipped += 1;
      continue;
    }

    const lon = num(r.lon);
    const lat = num(r.lat);
    const lonOk = lon != null && lat != null && !(lon === 0 && lat === 0);

    const vals = {
      ftr_idn: ftrIdn,
      lon: lonOk ? lon : null,
      lat: lonOk ? lat : null,
      road_type: str(r.road_type),
      route_no: str(r.route_no),
      route_nam: str(r.route_nam),
      serial_no: str(r.serial_no),
      pre_ymd: str(r.pre_ymd),
      loc_adr: str(r.loc_adr),
      resi_nam: str(r.resi_nam),
      resi_num: str(r.resi_num),
      build_onam: str(r.build_onam),
      build_onum: str(r.build_onum),
      build_oadr: str(r.build_oadr),
      land_onam: str(r.land_onam),
      land_onum: str(r.land_onum),
      land_oadr: str(r.land_oadr),
      write_dept: str(r.write_dept),
      write_nam: str(r.write_nam),
      write_ymd: str(r.write_ymd),
      before_ymd: str(r.before_ymd),
      after_ymd: str(r.after_ymd),
      is_del: isDel(r.is_del),
      crea_ymd: str(r.crea_ymd),
      crea_nam: str(r.crea_nam),
      upd_ymd: str(r.upd_ymd),
      upd_nam: str(r.upd_nam),
    };

    const found = await pool.query(
      `SELECT id FROM layer.road_frontage_building WHERE ftr_idn = $1 LIMIT 1`,
      [ftrIdn]
    );

    let id: number;
    if (found.rows[0]?.id != null) {
      id = Number(found.rows[0].id);
      await pool.query(
        `UPDATE layer.road_frontage_building SET
          lon=$2, lat=$3, road_type=$4, route_no=$5, route_nam=$6, serial_no=$7,
          pre_ymd=$8, loc_adr=$9, resi_nam=$10, resi_num=$11,
          build_onam=$12, build_onum=$13, build_oadr=$14,
          land_onam=$15, land_onum=$16, land_oadr=$17,
          write_dept=$18, write_nam=$19, write_ymd=$20,
          before_ymd=$21, after_ymd=$22, is_del=$23,
          crea_ymd=$24, crea_nam=$25, upd_ymd=$26, upd_nam=$27
         WHERE id=$1`,
        [
          id,
          vals.lon,
          vals.lat,
          vals.road_type,
          vals.route_no,
          vals.route_nam,
          vals.serial_no,
          vals.pre_ymd,
          vals.loc_adr,
          vals.resi_nam,
          vals.resi_num,
          vals.build_onam,
          vals.build_onum,
          vals.build_oadr,
          vals.land_onam,
          vals.land_onum,
          vals.land_oadr,
          vals.write_dept,
          vals.write_nam,
          vals.write_ymd,
          vals.before_ymd,
          vals.after_ymd,
          vals.is_del,
          vals.crea_ymd,
          vals.crea_nam,
          vals.upd_ymd,
          vals.upd_nam,
        ]
      );
      updated += 1;
    } else {
      const ins = await pool.query(
        `INSERT INTO layer.road_frontage_building (
          ftr_idn, lon, lat, road_type, route_no, route_nam, serial_no,
          pre_ymd, loc_adr, resi_nam, resi_num,
          build_onam, build_onum, build_oadr,
          land_onam, land_onum, land_oadr,
          write_dept, write_nam, write_ymd,
          before_ymd, after_ymd, is_del,
          crea_ymd, crea_nam, upd_ymd, upd_nam
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,
          $12,$13,$14,
          $15,$16,$17,
          $18,$19,$20,
          $21,$22,$23,
          $24,$25,$26,$27
        ) RETURNING id`,
        [
          vals.ftr_idn,
          vals.lon,
          vals.lat,
          vals.road_type,
          vals.route_no,
          vals.route_nam,
          vals.serial_no,
          vals.pre_ymd,
          vals.loc_adr,
          vals.resi_nam,
          vals.resi_num,
          vals.build_onam,
          vals.build_onum,
          vals.build_oadr,
          vals.land_onam,
          vals.land_onum,
          vals.land_oadr,
          vals.write_dept,
          vals.write_nam,
          vals.write_ymd,
          vals.before_ymd,
          vals.after_ymd,
          vals.is_del,
          vals.crea_ymd,
          vals.crea_nam,
          vals.upd_ymd,
          vals.upd_nam,
        ]
      );
      id = Number(ins.rows[0].id);
      inserted += 1;
    }

    if (lonOk) {
      await pool.query(
        `UPDATE layer.road_frontage_building
         SET geom = ST_Transform(ST_SetSRID(ST_MakePoint($2, $3), 4326), 5181)
         WHERE id = $1`,
        [id, lon, lat]
      );
      geomSet += 1;
    } else {
      await pool.query(`UPDATE layer.road_frontage_building SET geom = NULL WHERE id = $1`, [id]);
    }
  }

  const cnt = await pool.query(
    `SELECT count(*)::int AS n, count(geom)::int AS with_geom
     FROM layer.road_frontage_building WHERE COALESCE(is_del, false) = false`
  );
  console.log({
    inserted,
    updated,
    skipped,
    geomSet,
    active: cnt.rows[0],
  });
  await pool.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
