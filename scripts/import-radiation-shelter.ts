/**
 * 방사선 대피소 엑셀 → layer.radiation_shelter 적재
 * 사용: npx tsx scripts/import-radiation-shelter.ts [xlsx경로]
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as XLSX from 'xlsx';
import { loadProjectEnv } from './load-project-env';
import { pool } from '../src/database/db';
import { ensureRadiationShelterTable } from '../src/service/ensureLayerAppTables';
import { resolveGeomWkt5181FromAddress } from '../src/lib/geomWkt5181';

loadProjectEnv('build_yy', 'dev');

type ExcelRow = {
  ftn_nm?: string;
  addr?: string;
  ACTC_TNOP?: number | string;
  remark?: string;
};

function tx(v: unknown): string {
  return String(v ?? '').trim();
}

function toInt(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? Math.floor(n) : null;
}

async function main() {
  const fileArg = process.argv[2];
  const filePath = resolve(fileArg ?? 'C:\\Users\\user\\Downloads\\방사선_대피소.xlsx');
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('시트가 없습니다.');
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(sheet, { defval: '' });

  await ensureRadiationShelterTable();

  let success = 0;
  let fail = 0;
  let skip = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const ftnNm = tx(row.ftn_nm);
    const addr = tx(row.addr);
    const actcTnop = toInt(row.ACTC_TNOP);
    const remark = tx(row.remark);

    if (!ftnNm && !addr) {
      skip += 1;
      console.log(`[${i + 1}] SKIP — 빈 행`);
      continue;
    }

    let geomWkt: string | null = null;

    if (addr) {
      const resolved = await resolveGeomWkt5181FromAddress(addr);
      geomWkt = resolved.wkt;
      if (!geomWkt) {
        fail += 1;
        console.log(`[${i + 1}] FAIL — 지오코딩 실패: ${addr}`);
      }
    }

    try {
      await pool.query(
        `INSERT INTO layer.radiation_shelter (ftn_nm, addr, actc_tnop, remark, geom)
         VALUES ($1, $2, $3, $4,
           CASE WHEN $5::text IS NOT NULL THEN ST_GeomFromText($5, 5181) ELSE NULL END)`,
        [ftnNm || null, addr || null, actcTnop, remark || null, geomWkt]
      );
      success += 1;
      console.log(`[${i + 1}] OK — ${ftnNm} | ${addr}${geomWkt ? '' : ' (geom 없음)'}`);
      if (!geomWkt && addr) fail += 1;
    } catch (e) {
      fail += 1;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[${i + 1}] FAIL — ${ftnNm} | ${msg}`);
    }
  }

  console.log(`\n완료: 성공 ${success}, 실패 ${fail}, 스킵 ${skip}, 전체 ${rows.length}`);
  await pool.end();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
