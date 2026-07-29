/**
 * CSV(미납/수납) → next_gen_linkage.ngl_fee_list 적재
 * 사용: node scripts/import-ngl-fee-csv.js
 */
const fs = require('fs');
const { Client } = require('pg');

const ARREARS_CSV = 'C:/Users/PC/Desktop/ngl_arrears_list_202607241714.csv';
const RECEIPT_CSV = 'C:/Users/PC/Desktop/ngl_receipt_list_202607241714.csv';

const AMT_COLS = new Set([
  'pid_af_amt', 'frst_pct_amt', 'last_pct_amt', 'last_adtn_amt', 'last_itm_intr_amt',
  'rcvmt_pct_amt', 'rcvmt_adtn_amt', 'itm_intr_amt',
]);
const TS_COLS = new Set(['synced_at', 'created_at', 'updated_at']);

const COMMON = [
  'sgb_cd', 'lvy_key', 'dpt_nm', 'dpt_cd', 'fyr', 'act_se_cd', 'rprs_txm_cd', 'rprs_txm_nm',
  'lvy_no', 'itm_sn', 'pyr_no', 'pyr_nm', 'pyr_addr', 'lvy_ymd', 'frst_pid_ymd', 'gl_nm',
  'gl_mng_no', 'gl_addr',
  'vtlac_bank_nm1', 'vr_actno1', 'vtlac_bank_nm2', 'vr_actno2', 'vtlac_bank_nm3', 'vr_actno3',
  'vtlac_bank_nm4', 'vr_actno4', 'vtlac_bank_nm5', 'vr_actno5', 'vtlac_bank_nm6', 'vr_actno6',
  'vtlac_bank_nm7', 'vr_actno7', 'vtlac_bank_nm8', 'vr_actno8', 'vtlac_bank_nm9', 'vr_actno9',
  'vtlac_bank_nm10', 'vr_actno10', 'vtlac_bank_nm11', 'vr_actno11', 'vtlac_bank_nm12', 'vr_actno12',
  'vtlac_bank_nm13', 'vr_actno13', 'vtlac_bank_nm14', 'vr_actno14', 'vtlac_bank_nm15', 'vr_actno15',
  'vtlac_bank_nm16', 'vr_actno16', 'vtlac_bank_nm17', 'vr_actno17', 'vtlac_bank_nm18', 'vr_actno18',
  'vtlac_bank_nm19', 'vr_actno19', 'vtlac_bank_nm20', 'vr_actno20',
  'epay_no', 'ledger_no', 'acct_itm_cd',
];
const ONLY_A = [
  'sgb_nm', 'rcvmt_se_nm', 'szr_se_nm', 'pyr_se_cd', 'pyr_mng_no', 'pyr_addr_sn', 'pyr_stt_cd',
  'pyr_stt_nm', 'zip', 'lotno_road_addr_se_cd', 'pyr_cnpc_no', 'pyr_mbl_cnpc_no', 'lvy_se_cd',
  'last_pid_ymd', 'pid_af_ymd', 'pid_af_amt', 'frst_pct_amt', 'lvy_stt_se_nm', 'last_pct_amt',
  'last_adtn_amt', 'last_itm_intr_amt', 'itm_se_nm', 'unty_lvy_data_se_nm', 'gl_lotno_road_addr_se_cd',
  'gl_zip', 'mng_item_sn1', 'mng_item_sn2', 'mng_item_sn3', 'mng_item_sn4', 'mng_item_sn5',
  'mng_item_sn6', 'arr_rsn_cd', 'arr_rsn_nm', 'dft_se_nm', 'pyr_eml_addr', 'auto_pay_se_cd',
  'rdt_se_nm', 'rpm_szr_vhrno', 'unty_rprs_key',
];
const ONLY_R = [
  'spac_biz_cd', 'rcvmt_sn', 'rcvmt_ymd', 'rcvmt_pct_amt', 'rcvmt_adtn_amt', 'itm_intr_amt',
  'rcvmt_bank', 'rcvmt_ty_cd', 'rcvmt_ty_nm', 'act_ymd', 'pmk_ymd', 'rcvmt_se_cd',
  'rcvmt_stt_se_cd', 'taxn_no',
];
const SYNC = ['sync_status', 'synced_at', 'created_at', 'updated_at'];

function parseCsv(text) {
  const rows = [];
  let i = 0;
  let field = '';
  let row = [];
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function rowsToObjects(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf8');
  const matrix = parseCsv(text);
  const header = matrix[0].map((h) => h.trim());
  return matrix.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== '')).map((r) => {
    const o = {};
    for (let i = 0; i < header.length; i++) o[header[i]] = r[i] ?? '';
    return o;
  });
}

function norm(col, raw) {
  const s = raw == null ? '' : String(raw).trim();
  if (s === '') return null;
  if (AMT_COLS.has(col)) {
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (TS_COLS.has(col)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return s;
}

async function main() {
  const client = new Client({
    host: 'localhost',
    port: 5433,
    database: 'build_uj',
    user: 'build_uj',
    password: 'build_uj',
  });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE next_gen_linkage.ngl_fee_list RESTART IDENTITY');

    const arrearsCols = [...COMMON, ...ONLY_A, ...SYNC];
    const arrears = rowsToObjects(ARREARS_CSV);
    let aOk = 0;
    for (const row of arrears) {
      const key = String(row.lvy_key ?? '').trim();
      if (!key) continue;
      // 미납: 수납일련 '' + 공통·미납전용
      const colsWithSn = ['rcvmt_sn', ...arrearsCols];
      const valsWithSn = ['', ...arrearsCols.map((c) => norm(c, row[c]))];
      const placeholders = valsWithSn.map((_, i) => `$${i + 2}`).join(',');
      await client.query(
        `INSERT INTO next_gen_linkage.ngl_fee_list (fee_status, ${colsWithSn.join(',')})
         VALUES ($1, ${placeholders})
         ON CONFLICT (lvy_key, rcvmt_sn) DO NOTHING`,
        ['미납', ...valsWithSn]
      );
      aOk++;
    }
    console.log(`arrears inserted(attempted): ${aOk}`);

    const receiptCols = [...COMMON, ...ONLY_R, ...SYNC];
    const receipts = rowsToObjects(RECEIPT_CSV);
    // 수납 1차·2차(동일 부과키·다른 수납일련) 모두 유지
    const updateCommon = COMMON.filter((c) => c !== 'lvy_key')
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(', ');
    const updateReceipt = ONLY_R.map((c) => `${c} = EXCLUDED.${c}`).join(', ');

    let rOk = 0;
    let rSkip = 0;
    for (const row of receipts) {
      const key = String(row.lvy_key ?? '').trim();
      if (!key) {
        rSkip++;
        continue;
      }
      if (!String(row.rcvmt_sn ?? '').trim()) row.rcvmt_sn = '';
      const vals = receiptCols.map((c) => {
        if (c === 'rcvmt_sn') return String(row.rcvmt_sn ?? '').trim();
        return norm(c, row[c]);
      });
      const placeholders = vals.map((_, i) => `$${i + 2}`).join(',');
      await client.query(
        `INSERT INTO next_gen_linkage.ngl_fee_list (fee_status, ${receiptCols.join(',')})
         VALUES ($1, ${placeholders})
         ON CONFLICT (lvy_key, rcvmt_sn) DO UPDATE SET
           fee_status = '수납',
           ${updateCommon},
           ${updateReceipt},
           sync_status = EXCLUDED.sync_status,
           synced_at = EXCLUDED.synced_at,
           updated_at = now()`,
        ['수납', ...vals]
      );
      rOk++;
    }
    console.log(`receipt upserted(all rows): ${rOk}, skipped(no key): ${rSkip}`);

    // 수납이 있는 부과키의 미납(수납일련='') 행은 제거 — 수납 1·2차는 유지
    const del = await client.query(`
      DELETE FROM next_gen_linkage.ngl_fee_list a
      WHERE a.fee_status = '미납'
        AND a.rcvmt_sn = ''
        AND EXISTS (
          SELECT 1 FROM next_gen_linkage.ngl_fee_list r
          WHERE r.lvy_key = a.lvy_key AND r.fee_status = '수납'
        )`);
    console.log(`removed unpaid rows superseded by receipt: ${del.rowCount}`);

    const counts = await client.query(`
      SELECT fee_status, count(*)::int AS cnt
      FROM next_gen_linkage.ngl_fee_list
      GROUP BY fee_status
      ORDER BY fee_status`);
    console.log('counts:', counts.rows);

    await client.query('COMMIT');
    console.log('done');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
