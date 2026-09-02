/**
 * 물놀이 표지판 CSV → layer.water_play_sign 적재
 * 사용: npx tsx scripts/import-water-play-sign.ts [csv경로]
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { loadProjectEnv } from './load-project-env';
import { pool } from '../src/database/db';
import { ensureWaterPlaySignTable } from '../src/service/ensureLayerAppTables';
import { resolveGeomWkt5181FromAddress } from '../src/lib/geomWkt5181';

loadProjectEnv('build_yy', 'dev');

type CsvRow = {
  sido?: string;
  sgg?: string;
  addr?: string;
  addr_detail?: string;
  gubun?: string;
  is_warnig?: string;
  safebox_cnt?: string;
  sign_cnt?: string;
  remark?: string;
};

function tx(v: unknown): string {
  return String(v ?? '').trim();
}

function parseOptionalInt(v: unknown): number | null {
  const n = Number(tx(v));
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

/** 간단 CSV 파서 — 따옴표 필드 지원 */
function parseCsv(text: string): CsvRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? '';
    });
    rows.push(row as CsvRow);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function fullAddr(row: CsvRow): string {
  const sido = tx(row.sido).replace(/\s+/g, '');
  const sgg = tx(row.sgg);
  const addr = tx(row.addr);
  return [sido, sgg, addr].filter(Boolean).join(' ');
}

async function main() {
  const fileArg = process.argv[2];
  const filePath = resolve(fileArg ?? 'C:\\Users\\user\\Downloads\\물놀이표지판.csv');
  const text = readFileSync(filePath, 'utf-8');
  const rows = parseCsv(text);

  await ensureWaterPlaySignTable();
  await pool.query('TRUNCATE layer.water_play_sign RESTART IDENTITY');

  let success = 0;
  let geocodeFail = 0;
  let skip = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sido = tx(row.sido);
    const sgg = tx(row.sgg);
    const addr = fullAddr(row);
    const addrDetail = tx(row.addr_detail);
    const gubun = tx(row.gubun);
    const isWarnig = tx(row.is_warnig);
    const safeboxCnt = parseOptionalInt(row.safebox_cnt);
    const signCnt = parseOptionalInt(row.sign_cnt);
    const remark = tx(row.remark);

    if (!addr && !remark && !addrDetail) {
      skip += 1;
      console.log(`[${i + 1}] SKIP — 빈 행`);
      continue;
    }

    let geomWkt: string | null = null;
    if (addr) {
      const resolved = await resolveGeomWkt5181FromAddress(addr);
      geomWkt = resolved.wkt;
      if (!geomWkt) {
        geocodeFail += 1;
        console.log(`[${i + 1}] WARN — 지오코딩 실패: ${addr}`);
      }
    }

    try {
      await pool.query(
        `INSERT INTO layer.water_play_sign (
          sido, sgg, addr, addr_detail, gubun, is_warnig, safebox_cnt, sign_cnt, remark, geom
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
          CASE WHEN $10::text IS NOT NULL THEN ST_GeomFromText($10, 5181) ELSE NULL END)`,
        [
          sido || null,
          sgg || null,
          addr || null,
          addrDetail || null,
          gubun || null,
          isWarnig || null,
          safeboxCnt,
          signCnt,
          remark || null,
          geomWkt,
        ]
      );
      success += 1;
      console.log(`[${i + 1}] OK — ${addr}${geomWkt ? '' : ' (geom 없음)'}`);
    } catch (e) {
      geocodeFail += 1;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[${i + 1}] FAIL — ${addr} | ${msg}`);
    }
  }

  const geomRes = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM layer.water_play_sign WHERE geom IS NOT NULL`
  );
  const geomCnt = Number(geomRes.rows[0]?.c ?? 0);
  console.log(
    `\n완료: 적재 ${success}, 지오코딩 실패/geom없음 ${geocodeFail}, 스킵 ${skip}, 전체 ${rows.length}, geom ${geomCnt}건`
  );
  await pool.end();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
