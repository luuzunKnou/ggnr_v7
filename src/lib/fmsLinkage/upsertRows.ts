import { pool } from '@/database/db';
import {
  FMS_FACILITY_TABLE,
  getFmsLayerTableName,
  getFmsDataKindForIdentifier,
  isFmsGroupAllowedBySystems,
  type FmsDataKind,
  type FmsFacilGroup,
} from '@/lib/fmsLinkage/fmsBinding';
import { facilGroupForFacilGbn } from '@/lib/fmsLinkage/prefixRouting';
import {
  FMS_FACILITY_COLUMNS,
  FMS_INSPECTION_COLUMNS,
  type FmsParsedRow,
} from '@/lib/fmsLinkage/parseDelimited';

const LOG = '[fms-upsert]';
const BATCH_SIZE = 100;

function sqlLiteral(value: string | null | undefined): string {
  if (value == null) return "''";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function pickColumns(kind: FmsDataKind): readonly string[] {
  return kind === 'facility' ? FMS_FACILITY_COLUMNS : FMS_INSPECTION_COLUMNS;
}

function rowToInsertValues(row: FmsParsedRow, cols: readonly string[]): string[] {
  return cols.map((c) => row[c] ?? '');
}

export type FmsUpsertStats = {
  inserted: number;
  updated: number;
  skipped: number;
};

async function findExistingKeys(
  tableName: string,
  kind: FmsDataKind,
  batch: FmsParsedRow[]
): Promise<Set<string>> {
  const keys = new Set<string>();
  if (!batch.length) return keys;

  if (kind === 'inspection') {
    const pairs: Array<[string, string]> = [];
    for (const row of batch) {
      const facilNo = (row.facil_no ?? '').trim();
      const dignSeq = (row.dign_seq ?? '').trim();
      if (facilNo && dignSeq) pairs.push([facilNo, dignSeq]);
    }
    if (!pairs.length) return keys;

    const inList = pairs
      .map(([f, d]) => `(${sqlLiteral(f)}, ${sqlLiteral(d)})`)
      .join(', ');
    const sql = `SELECT facil_no, dign_seq FROM layer.${tableName} WHERE (facil_no, dign_seq) IN (${inList})`;
    const r = await pool.query<{ facil_no: string; dign_seq: string }>(sql);
    for (const row of r.rows) {
      keys.add(`${row.facil_no}\u0000${row.dign_seq}`);
    }
    return keys;
  }

  const facilNos = batch.map((r) => (r.facil_no ?? '').trim()).filter(Boolean);
  if (!facilNos.length) return keys;

  const inList = facilNos.map((f) => sqlLiteral(f)).join(', ');
  const sql = `SELECT facil_no FROM layer.${tableName} WHERE facil_no IN (${inList})`;
  const r = await pool.query<{ facil_no: string }>(sql);
  for (const row of r.rows) {
    keys.add(String(row.facil_no).trim());
  }
  return keys;
}

function rowKey(kind: FmsDataKind, row: FmsParsedRow): string | null {
  const facilNo = (row.facil_no ?? '').trim();
  if (!facilNo) return null;
  if (kind === 'inspection') {
    const dignSeq = (row.dign_seq ?? '').trim();
    if (!dignSeq) return null;
    return `${facilNo}\u0000${dignSeq}`;
  }
  return facilNo;
}

async function insertBatch(
  tableName: string,
  cols: readonly string[],
  rows: FmsParsedRow[]
): Promise<void> {
  if (!rows.length) return;
  const colList = [...cols, 'sync_status', 'synced_at', 'created_at', 'updated_at'].join(', ');
  const values: string[] = [];
  for (const row of rows) {
    const vals = rowToInsertValues(row, cols)
      .map((v) => sqlLiteral(v))
      .concat(["'synced'", 'now()', 'now()', 'now()']);
    values.push(`(${vals.join(', ')})`);
  }
  const sql = `INSERT INTO layer.${tableName} (${colList}) VALUES ${values.join(', ')}`;
  await pool.query(sql);
}

async function updateRow(
  tableName: string,
  kind: FmsDataKind,
  cols: readonly string[],
  row: FmsParsedRow
): Promise<void> {
  const facilNo = (row.facil_no ?? '').trim();
  if (!facilNo) return;

  const setParts: string[] = [];
  for (const col of cols) {
    if (col === 'facil_no') continue;
    if (kind === 'inspection' && col === 'dign_seq') continue;
    setParts.push(`${col} = ${sqlLiteral(row[col] ?? '')}`);
  }
  setParts.push("sync_status = 'synced'", 'synced_at = now()', 'updated_at = now()');

  let sql = `UPDATE layer.${tableName} SET ${setParts.join(', ')} WHERE facil_no = ${sqlLiteral(facilNo)}`;
  if (kind === 'inspection') {
    const dignSeq = (row.dign_seq ?? '').trim();
    if (!dignSeq) return;
    sql += ` AND dign_seq = ${sqlLiteral(dignSeq)}`;
  }
  await pool.query(sql);
}

async function upsertBatchToTable(
  tableName: string,
  kind: FmsDataKind,
  batch: FmsParsedRow[]
): Promise<{ inserted: number; updated: number }> {
  const cols = pickColumns(kind);
  const existing = await findExistingKeys(tableName, kind, batch);
  const insertRows: FmsParsedRow[] = [];
  const updateRows: FmsParsedRow[] = [];

  for (const row of batch) {
    const key = rowKey(kind, row);
    if (!key) {
      insertRows.push(row);
      continue;
    }
    if (existing.has(key)) updateRows.push(row);
    else insertRows.push(row);
  }

  if (insertRows.length) {
    for (let i = 0; i < insertRows.length; i += BATCH_SIZE) {
      await insertBatch(tableName, cols, insertRows.slice(i, i + BATCH_SIZE));
    }
  }
  for (const row of updateRows) {
    await updateRow(tableName, kind, cols, row);
  }

  return { inserted: insertRows.length, updated: updateRows.length };
}

/** 적재된 시설물 → 시설물구분 묶음(모르는 구분은 null). 점검진단실적을 시스템별로 거를 때 씀 */
export type FmsFacilGroupMap = Map<string, FmsFacilGroup | null>;

export async function buildFacilGroupMap(): Promise<FmsFacilGroupMap> {
  const map: FmsFacilGroupMap = new Map();
  const r = await pool.query<{ facil_no: string; facil_gbn: string | null }>(
    `SELECT facil_no, facil_gbn FROM layer.${FMS_FACILITY_TABLE} WHERE facil_no IS NOT NULL AND facil_no <> ''`
  );
  for (const row of r.rows) {
    const no = String(row.facil_no).trim();
    if (no) map.set(no, facilGroupForFacilGbn(row.facil_gbn));
  }
  return map;
}

/** 시스템이 다 켜져 있으면 시설물구분을 모르는 행도 받고, 일부만 켜져 있으면 켜진 시스템 묶음만 받음 */
function isGroupAccepted(group: FmsFacilGroup | null, enabledSystems: string[] | null): boolean {
  if (group == null) return !enabledSystems?.length;
  return isFmsGroupAllowedBySystems(group, enabledSystems);
}

/**
 * identifier 종류별 layer 테이블 UPSERT — 시설물·점검진단실적 모두 도로 테이블 한 쌍.
 * 점검진단실적은 먼저 적재된 시설물(facil_no)에 딸린 것만 받는다.
 */
export async function upsertFmsRowsToLayer(
  identifier: string,
  rows: FmsParsedRow[],
  enabledSystems: string[] | null,
  facilGroupMap: FmsFacilGroupMap
): Promise<FmsUpsertStats> {
  const kind = getFmsDataKindForIdentifier(identifier);
  if (!kind || !rows.length) {
    return { inserted: 0, updated: 0, skipped: rows.length };
  }

  const accepted: FmsParsedRow[] = [];
  for (const row of rows) {
    const facilNo = (row.facil_no ?? '').trim();
    let group: FmsFacilGroup | null;
    if (kind === 'facility') {
      group = facilGroupForFacilGbn(row.facil_gbn);
    } else {
      if (!facilNo || !facilGroupMap.has(facilNo)) continue;
      group = facilGroupMap.get(facilNo) ?? null;
    }
    if (!isGroupAccepted(group, enabledSystems)) continue;
    accepted.push(row);
    if (kind === 'facility' && facilNo) facilGroupMap.set(facilNo, group);
  }

  const tableName = getFmsLayerTableName(kind);
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < accepted.length; i += BATCH_SIZE) {
    const r = await upsertBatchToTable(tableName, kind, accepted.slice(i, i + BATCH_SIZE));
    inserted += r.inserted;
    updated += r.updated;
  }
  const skipped = rows.length - accepted.length;
  if (accepted.length) {
    console.info(
      `${LOG} ${identifier} → layer.${tableName} rows=${accepted.length} ins=${inserted} upd=${updated}`
    );
  }
  if (skipped > 0) {
    console.info(`${LOG} ${identifier} skipped=${skipped} (꺼진 시스템 시설물·미적재 시설물의 실적)`);
  }

  return { inserted, updated, skipped };
}
