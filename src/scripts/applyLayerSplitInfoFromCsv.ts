import fs from "node:fs";
import path from "node:path";

type CsvRow = string[];
type TableRow = Record<string, unknown>;

function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let cell = "";
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

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      // ignore
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function main() {
  const projectRoot = process.cwd();
  const csvPath = process.argv[2] ?? "C:/Users/user/layer_202602112337.csv";
  const tablesPath = path.join(projectRoot, "src", "config", "defineLayer", "tables.json");

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }
  if (!fs.existsSync(tablesPath)) {
    throw new Error(`tables.json not found: ${tablesPath}`);
  }

  const csvText = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error("CSV has no data rows");

  const headers = rows[0].map((h) => String(h ?? "").trim().replace(/^\uFEFF/, ""));
  const idxKey = headers.indexOf("layer_key");
  const idxParent = headers.indexOf("layer_parents_layer");
  const idxDiv = headers.indexOf("layer_div_query");
  if (idxKey < 0 || idxParent < 0 || idxDiv < 0) {
    throw new Error("CSV headers missing required columns: layer_key, layer_parents_layer, layer_div_query");
  }

  const splitMap = new Map<string, { parent: string; divQuery: string }>();
  for (const row of rows.slice(1)) {
    const key = String(row[idxKey] ?? "").trim();
    const parent = String(row[idxParent] ?? "").trim();
    const divQuery = String(row[idxDiv] ?? "").trim();
    if (!key || !parent || !divQuery) continue;
    splitMap.set(key, { parent, divQuery });
  }

  const tableRows = JSON.parse(fs.readFileSync(tablesPath, "utf8")) as TableRow[];
  if (!Array.isArray(tableRows)) throw new Error("tables.json is not an array");

  let matched = 0;
  for (const row of tableRows) {
    const name = String(row.define_table_name ?? "").trim();
    if (!name) continue;
    const info = splitMap.get(name);
    if (!info) continue;
    row.define_table_parents_layer = info.parent;
    row.define_table_div_query = info.divQuery;
    matched++;
  }

  fs.writeFileSync(tablesPath, `${JSON.stringify(tableRows, null, 2)}\n`, "utf8");

  console.log("[applyLayerSplitInfoFromCsv] done");
  console.log(`- csv rows: ${rows.length - 1}`);
  console.log(`- csv candidates: ${splitMap.size}`);
  console.log(`- matched tables: ${matched}`);
  console.log(`- total tables: ${tableRows.length}`);
}

main();

