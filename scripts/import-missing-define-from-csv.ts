/**
 * Desktop layer/define CSV → tables.json에 없는 분할(및 부모) 정의 추가
 * 사용:
 *   npx tsx scripts/import-missing-define-from-csv.ts build_uj dev \
 *     "C:/Users/PC/Desktop/layer_202608031805.csv" \
 *     "C:/Users/PC/Desktop/define_table_202608031806.csv"
 */
import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';
import { loadProjectEnv } from './load-project-env';
import { reorderDefineLayerTablesArray } from '../src/lib/defineLayerTableRowOrder';

type CsvRow = string[];
type TableRow = Record<string, unknown>;

function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function readCsvCp949(filePath: string): CsvRow[] {
  const buf = fs.readFileSync(filePath);
  const text = iconv.decode(buf, 'cp949');
  return parseCsv(text);
}

function headerIndex(headers: string[]): Record<string, number> {
  return Object.fromEntries(headers.map((h, i) => [h.trim().replace(/^\uFEFF/, ''), i]));
}

function cell(row: CsvRow, idx: Record<string, number>, key: string): string {
  const i = idx[key];
  if (i == null) return '';
  return String(row[i] ?? '').trim();
}

async function main() {
  const project = process.argv[2] || 'build_uj';
  const type = process.argv[3] || 'dev';
  const layerCsv =
    process.argv[4] || 'C:/Users/PC/Desktop/layer_202608031805.csv';
  const defineCsv =
    process.argv[5] || 'C:/Users/PC/Desktop/define_table_202608031806.csv';
  const doGeoserver = !process.argv.includes('--no-geoserver');

  loadProjectEnv(project, type);
  process.env.GGNR_PROJECT = project;
  process.env.GGNR_ENV = type;

  const tablesPath = path.join(process.cwd(), 'src/config/defineLayer/tables.json');
  const tableRows = JSON.parse(fs.readFileSync(tablesPath, 'utf8')) as TableRow[];
  if (!Array.isArray(tableRows)) throw new Error('tables.json is not an array');

  const existing = new Map<string, TableRow>();
  for (const row of tableRows) {
    const name = String(row.define_table_name ?? '').trim();
    if (name) existing.set(name.toLowerCase(), row);
  }

  const layerRows = readCsvCp949(layerCsv);
  const defRows = readCsvCp949(defineCsv);
  const li = headerIndex(layerRows[0] ?? []);
  const di = headerIndex(defRows[0] ?? []);

  const layerByKey = new Map<
    string,
    { key: string; parent: string; div: string; group: string; geom: string; name: string }
  >();
  for (const row of layerRows.slice(1)) {
    const key = cell(row, li, 'layer_key');
    if (!key) continue;
    layerByKey.set(key.toLowerCase(), {
      key,
      parent: cell(row, li, 'layer_parents_layer'),
      div: cell(row, li, 'layer_div_query'),
      group: cell(row, li, 'layer_group'),
      geom: cell(row, li, 'layer_geom_type'),
      name: cell(row, li, 'layer_name'),
    });
  }

  const addedChildren: TableRow[] = [];
  const addedParents: TableRow[] = [];
  const skippedExisting: string[] = [];

  for (const row of defRows.slice(1)) {
    const name = cell(row, di, 'define_table_name');
    if (!name) continue;
    if (existing.has(name.toLowerCase())) {
      skippedExisting.push(name);
      continue;
    }
    const layer = layerByKey.get(name.toLowerCase());
    const entry: TableRow = {
      define_table_name: name,
      define_table_kor_name: cell(row, di, 'define_table_kor_name'),
      define_table_shp_type: cell(row, di, 'define_table_shp_type') || 'POLYGON',
      define_table_read_share: cell(row, di, 'define_table_read_share') || 'P',
      define_table_write_share: cell(row, di, 'define_table_write_share') || 'P',
      define_table_group: cell(row, di, 'define_table_group') || layer?.group || '',
      define_table_idx: cell(row, di, 'define_table_idx'),
      define_table_etc: '',
      define_table_schema: 'public_layer',
      define_table_source: 'shp',
    };
    if (layer?.parent && layer?.div) {
      entry.define_table_div_query = layer.div;
      entry.define_table_parents_layer = layer.parent;
    }
    tableRows.push(entry);
    existing.set(name.toLowerCase(), entry);
    addedChildren.push(entry);
  }

  // layer CSV의 베이스(연속주제, parents 없음) 전부 — 그룹(용도지역/용도지구 등) 포함해 정의 추가
  for (const layer of layerByKey.values()) {
    if (layer.parent) continue; // 분할 자식은 define CSV에서 처리
    if (existing.has(layer.key.toLowerCase())) continue;
    const entry: TableRow = {
      define_table_name: layer.key,
      define_table_kor_name: layer.name || layer.key,
      define_table_shp_type: layer.geom || 'POLYGON',
      define_table_read_share: 'P',
      define_table_write_share: 'P',
      define_table_group: layer.group || '',
      define_table_idx: '',
      define_table_etc: '',
      define_table_schema: 'public_layer',
      define_table_source: 'shp',
    };
    tableRows.push(entry);
    existing.set(layer.key.toLowerCase(), entry);
    addedParents.push(entry);
  }

  const reordered = reorderDefineLayerTablesArray(tableRows);
  fs.writeFileSync(tablesPath, `${JSON.stringify(reordered, null, 2)}\n`, 'utf8');

  console.log('[import-missing-define] tables.json updated');
  console.log(`  skipped existing: ${skippedExisting.length}`);
  console.log(`  added children: ${addedChildren.length}`);
  console.log(`  added parents: ${addedParents.length}`);
  if (addedChildren.length) {
    console.log(
      '  child sample:',
      addedChildren.slice(0, 5).map((c) => ({
        name: c.define_table_name,
        kor: c.define_table_kor_name,
        parent: c.define_table_parents_layer,
        div: c.define_table_div_query,
        group: c.define_table_group,
      }))
    );
  }

  if (!doGeoserver) {
    console.log('[import-missing-define] skipped GeoServer (--no-geoserver)');
    return;
  }

  const { createOrUpdateGeoServerLayer, syncGeoServerCqlFiltersFromDefine } = await import(
    '../src/service/devTestService'
  );

  const geoUrl = process.env.GEOSERVER_URL || 'http://localhost:8080/geoserver';
  const created: string[] = [];
  const failed: Array<{ layer: string; error: string }> = [];

  for (const child of addedChildren) {
    const layerName = String(child.define_table_name ?? '').trim();
    if (!layerName) continue;
    const res = await createOrUpdateGeoServerLayer({ layerName, url: geoUrl });
    if (res.success) created.push(layerName);
    else failed.push({ layer: layerName, error: String(res.error ?? 'unknown') });
  }

  console.log(`[import-missing-define] GeoServer create: ok=${created.length} fail=${failed.length}`);
  if (failed.length) {
    console.log('  fail sample:', failed.slice(0, 15));
  }

  const sync = await syncGeoServerCqlFiltersFromDefine({ url: geoUrl });
  console.log('[import-missing-define] CQL sync summary:', sync.summary ?? {
    updated: sync.updated?.length ?? 0,
    skipped: sync.skipped?.length ?? 0,
    failed: sync.failed?.length ?? 0,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
