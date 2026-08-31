/**
 * 접도구역 표주 엑셀 → layer.road_frontage_marker / _item 적재
 *
 * 사용:
 *   npx tsx scripts/seed-road-frontage-marker-xlsx.ts build_yy dev
 */
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { loadProjectEnv } from './load-project-env';
import {
  formatMarkerInstallLocation,
  normalizeMarkerInstallLocation,
} from '../src/app/(pages)/map/_mapContents/road/roadFrontageMarker/roadFrontageMarkerAddress';

const LOG = '[seed-road-frontage-marker]';

const DEFAULT_FILE = path.join(
  process.cwd(),
  'docs',
  '도로 접도구역 관리대장 한글파일 변환본.xlsx'
);

function parseArgs(): { project: string; type: string; file: string } {
  const argv = process.argv.slice(2);
  let file = DEFAULT_FILE;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
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
    project: positional[0] || 'build_yy',
    type: positional[1] || 'dev',
    file,
  };
}

function cellText(v: unknown): string {
  return String(v ?? '')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRoadType(sheetName: string): string {
  const name = sheetName.trim();
  if (name.startsWith('국도')) return '국도';
  if (name.startsWith('지방도')) return '지방도';
  if (name.startsWith('군도')) return '군도';
  return '';
}

type MarkerRow = {
  serialNo: number | null;
  stationDistance: string;
  county: string;
  myeon: string;
  ri: string;
  landCategory: string;
  lotNo: string;
  ownerName: string;
  ownerAddress: string;
  sign: string;
  remark: string;
};

function parseSheet(ws: XLSX.WorkSheet): MarkerRow[] {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];
  const out: MarkerRow[] = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const serialRaw = cellText(r[0]);
    if (!serialRaw) continue;
    const serialNo = Number(serialRaw);
    out.push({
      serialNo: Number.isFinite(serialNo) ? Math.floor(serialNo) : null,
      stationDistance: cellText(r[1]),
      county: cellText(r[2]),
      myeon: cellText(r[3]),
      ri: cellText(r[4]),
      landCategory: cellText(r[5]),
      lotNo: cellText(r[6]),
      ownerName: cellText(r[7]),
      ownerAddress: cellText(r[8]),
      sign: cellText(r[9]),
      remark: cellText(r[10]),
    });
  }
  return out;
}

function buildInstallLocation(m: MarkerRow): string {
  return normalizeMarkerInstallLocation(
    formatMarkerInstallLocation({
      county: m.county,
      myeon: m.myeon,
      ri: m.ri,
      lotNo: m.lotNo,
    })
  );
}

function buildLandCategory(m: MarkerRow): string {
  return String(m.landCategory ?? '')
    .replace(/\s+/g, '')
    .trim();
}

async function main() {
  const { project, type, file } = parseArgs();
  loadProjectEnv(project, type);

  if (!fs.existsSync(file)) {
    console.error(`${LOG} 파일 없음: ${file}`);
    process.exit(1);
  }

  const { ensureRoadFrontageMarkerTables } = await import('../src/service/ensureLayerAppTables');
  const ensured = await ensureRoadFrontageMarkerTables();
  if (ensured.errors.length) console.warn(`${LOG} ensure warnings:`, ensured.errors);

  const { pool } = await import('../src/database/db');
  // 이전 적재분 정리
  await pool.query(`DELETE FROM layer.road_frontage_marker_item`);
  await pool.query(`DELETE FROM layer.road_frontage_marker`);
  console.log(`${LOG} cleared previous ledgers/items`);

  const wb = XLSX.readFile(file);
  let ledgerCount = 0;
  let markerCount = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const markers = parseSheet(ws);
    if (markers.length === 0) {
      console.log(`${LOG} skip empty sheet: ${sheetName}`);
      continue;
    }
    const roadType = parseRoadType(sheetName);
    const routeName = sheetName.trim();
    const ins = await pool.query(
      `INSERT INTO layer.road_frontage_marker
        (road_type, route_name)
       VALUES ($1, $2)
       RETURNING id`,
      [roadType || null, routeName]
    );
    const parentId = Number(ins.rows[0]?.id);
    if (!Number.isFinite(parentId)) {
      throw new Error(`insert ledger failed: ${sheetName}`);
    }
    ledgerCount += 1;

    for (const m of markers) {
      const installLocation = buildInstallLocation(m);
      const landCategory = buildLandCategory(m);
      await pool.query(
        `INSERT INTO layer.road_frontage_marker_item
          (parent_id, serial_no, station_distance, install_location, land_category,
           owner_name, owner_address, sign, remark)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          parentId,
          m.serialNo,
          m.stationDistance || null,
          installLocation || null,
          landCategory || null,
          m.ownerName || null,
          m.ownerAddress || null,
          m.sign || null,
          m.remark || null,
        ]
      );
      markerCount += 1;
    }
    console.log(`${LOG} ${routeName}: markers=${markers.length}`);
  }

  console.log(`${LOG} done ledgers=${ledgerCount} markers=${markerCount}`);

  const { fillMissingInstallLocationAndGeom } = await import(
    '../src/service/roadFrontageMarkerService'
  );
  const filled = await fillMissingInstallLocationAndGeom({ refreshAll: true, limit: 10000 });
  console.log(
    `${LOG} geom fill updated=${filled.updated} withGeom=${filled.withGeom} failed=${filled.failed}`
  );

  await pool.end();
}

main().catch((e) => {
  console.error(LOG, e);
  process.exit(1);
});
