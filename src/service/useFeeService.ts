/**
 * 점사용료 — next_gen_linkage.ngl_fee_list 조회 + 차세대 수동 연계
 */
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/database/db';
import {
  nglFeeList,
  nglFeeListColumnComments,
  type NglFeeList,
} from '@/database/schema/ngl_fee_list';
import { formatToYmdOrText } from '@/lib/formatDateYmd';
import { runNextGenFeeSync } from '@/lib/nextGenLinkage/syncRunner';

export type UseFeeListRow = {
  id: string;
  status: string;
  chargeNo: string;
  year: string;
  payer: string;
  amount: string;
  amountRaw: number | null;
  dueDate: string;
  rcvmtSn: string;
};

export type UseFeeDetailAttr = {
  field: string;
  label: string;
  value: string;
};

function formatAmount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Math.trunc(Number(n)).toLocaleString('ko-KR')}원`;
}

function formatYmd(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return '—';
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return formatToYmdOrText(s) || s;
}

function displayValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '—';
    return String(v);
  }
  const s = String(v).trim();
  return s === '' ? '—' : s;
}

function listAmount(row: NglFeeList): number | null {
  if (row.feeStatus === '수납') {
    return row.rcvmtPctAmt ?? null;
  }
  return row.lastPctAmt ?? row.frstPctAmt ?? null;
}

/** 목록: 상태, 부과번호, 회계연도, 납부자, 납부금액, 납기일 */
export async function getUseFeeList(params?: {
  keyword?: string;
  limit?: number;
}): Promise<{ rows: UseFeeListRow[]; total: number; error?: string }> {
  const keyword = String(params?.keyword ?? '').trim();
  const limit = Math.min(Math.max(Number(params?.limit) || 5000, 1), 10000);

  try {
    const kw = keyword
      ? or(
          ilike(nglFeeList.lvyNo, `%${keyword}%`),
          ilike(nglFeeList.pyrNm, `%${keyword}%`),
          ilike(nglFeeList.feeStatus, `%${keyword}%`),
          ilike(nglFeeList.fyr, `%${keyword}%`),
          ilike(nglFeeList.lvyKey, `%${keyword}%`),
          ilike(nglFeeList.glNm, `%${keyword}%`),
          ilike(nglFeeList.dptNm, `%${keyword}%`)
        )
      : undefined;

    const countRes = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(nglFeeList)
      .where(kw);
    const total = Number(countRes[0]?.c ?? 0);

    const rows = await db
      .select()
      .from(nglFeeList)
      .where(kw)
      .orderBy(desc(nglFeeList.fyr), asc(nglFeeList.lvyNo), asc(nglFeeList.rcvmtSn), desc(nglFeeList.id))
      .limit(limit);

    return {
      total,
      rows: rows.map((r) => {
        const amountRaw = listAmount(r);
        return {
          id: String(r.id),
          status: String(r.feeStatus ?? ''),
          chargeNo: String(r.lvyNo ?? ''),
          year: String(r.fyr ?? ''),
          payer: String(r.pyrNm ?? ''),
          amount: formatAmount(amountRaw),
          amountRaw,
          dueDate: formatYmd(r.frstPidYmd ?? r.lastPidYmd),
          rcvmtSn: String(r.rcvmtSn ?? ''),
        };
      }),
    };
  } catch (e) {
    return { rows: [], total: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

const DETAIL_FIELD_ORDER: { key: keyof NglFeeList; db: string; label?: string }[] = [
  { key: 'feeStatus', db: 'fee_status', label: '상태' },
  { key: 'lvyKey', db: 'lvy_key' },
  { key: 'lvyNo', db: 'lvy_no' },
  { key: 'rcvmtSn', db: 'rcvmt_sn' },
  { key: 'fyr', db: 'fyr' },
  { key: 'dptNm', db: 'dpt_nm' },
  { key: 'dptCd', db: 'dpt_cd' },
  { key: 'actSeCd', db: 'act_se_cd', label: '회계구분코드' },
  { key: 'rprsTxmCd', db: 'rprs_txm_cd' },
  { key: 'rprsTxmNm', db: 'rprs_txm_nm' },
  { key: 'itmSn', db: 'itm_sn' },
  { key: 'sgbCd', db: 'sgb_cd' },
  { key: 'sgbNm', db: 'sgb_nm' },
  { key: 'pyrNo', db: 'pyr_no' },
  { key: 'pyrNm', db: 'pyr_nm' },
  { key: 'pyrAddr', db: 'pyr_addr' },
  { key: 'pyrSeCd', db: 'pyr_se_cd', label: '납부자구분코드' },
  { key: 'pyrMngNo', db: 'pyr_mng_no', label: '납부자관리번호' },
  { key: 'pyrAddrSn', db: 'pyr_addr_sn', label: '납부자주소일련' },
  { key: 'pyrSttCd', db: 'pyr_stt_cd', label: '납부자상태코드' },
  { key: 'pyrSttNm', db: 'pyr_stt_nm', label: '납부자상태' },
  { key: 'zip', db: 'zip', label: '우편번호' },
  { key: 'lotnoRoadAddrSeCd', db: 'lotno_road_addr_se_cd', label: '지번도로주소구분' },
  { key: 'pyrCnpcNo', db: 'pyr_cnpc_no', label: '전화번호' },
  { key: 'pyrMblCnpcNo', db: 'pyr_mbl_cnpc_no', label: '휴대폰번호' },
  { key: 'pyrEmlAddr', db: 'pyr_eml_addr', label: '이메일' },
  { key: 'lvySeCd', db: 'lvy_se_cd', label: '부과구분코드' },
  { key: 'lvyYmd', db: 'lvy_ymd' },
  { key: 'frstPidYmd', db: 'frst_pid_ymd' },
  { key: 'lastPidYmd', db: 'last_pid_ymd', label: '최종납기일자' },
  { key: 'pidAfYmd', db: 'pid_af_ymd', label: '납기후일자' },
  { key: 'pidAfAmt', db: 'pid_af_amt', label: '납기후금액' },
  { key: 'frstPctAmt', db: 'frst_pct_amt', label: '최초본세' },
  { key: 'lastPctAmt', db: 'last_pct_amt', label: '최종본세' },
  { key: 'lastAdtnAmt', db: 'last_adtn_amt', label: '가산금' },
  { key: 'lastItmIntrAmt', db: 'last_itm_intr_amt', label: '분납이자' },
  { key: 'lvySttSeNm', db: 'lvy_stt_se_nm', label: '부과상태' },
  { key: 'rcvmtSeNm', db: 'rcvmt_se_nm', label: '수납구분명' },
  { key: 'szrSeNm', db: 'szr_se_nm', label: '압류구분명' },
  { key: 'itmSeNm', db: 'itm_se_nm', label: '분납구분명' },
  { key: 'untyLvyDataSeNm', db: 'unty_lvy_data_se_nm', label: '통합부과구분' },
  { key: 'rdtSeNm', db: 'rdt_se_nm', label: '감경구분명' },
  { key: 'dftSeNm', db: 'dft_se_nm', label: '결손구분명' },
  { key: 'arrRsnCd', db: 'arr_rsn_cd', label: '체납사유코드' },
  { key: 'arrRsnNm', db: 'arr_rsn_nm', label: '체납사유' },
  { key: 'autoPaySeCd', db: 'auto_pay_se_cd', label: '자동납부구분' },
  { key: 'rpmSzrVhrno', db: 'rpm_szr_vhrno', label: '압류차량번호' },
  { key: 'untyRprsKey', db: 'unty_rprs_key', label: '통합대표키' },
  { key: 'glNm', db: 'gl_nm' },
  { key: 'glMngNo', db: 'gl_mng_no' },
  { key: 'glAddr', db: 'gl_addr' },
  { key: 'glZip', db: 'gl_zip', label: '물건지우편번호' },
  { key: 'glLotnoRoadAddrSeCd', db: 'gl_lotno_road_addr_se_cd', label: '물건지지번도로구분' },
  { key: 'epayNo', db: 'epay_no' },
  { key: 'ledgerNo', db: 'ledger_no' },
  { key: 'acctItmCd', db: 'acct_itm_cd' },
  { key: 'mngItemSn1', db: 'mng_item_sn1', label: '관리항목1' },
  { key: 'mngItemSn2', db: 'mng_item_sn2', label: '관리항목2' },
  { key: 'mngItemSn3', db: 'mng_item_sn3', label: '관리항목3' },
  { key: 'mngItemSn4', db: 'mng_item_sn4', label: '관리항목4' },
  { key: 'mngItemSn5', db: 'mng_item_sn5' },
  { key: 'mngItemSn6', db: 'mng_item_sn6' },
  { key: 'spacBizCd', db: 'spac_biz_cd' },
  { key: 'rcvmtYmd', db: 'rcvmt_ymd' },
  { key: 'rcvmtPctAmt', db: 'rcvmt_pct_amt', label: '수납본세' },
  { key: 'rcvmtAdtnAmt', db: 'rcvmt_adtn_amt', label: '수납가산금' },
  { key: 'itmIntrAmt', db: 'itm_intr_amt', label: '수납분납이자' },
  { key: 'rcvmtBank', db: 'rcvmt_bank', label: '수납은행' },
  { key: 'rcvmtTyCd', db: 'rcvmt_ty_cd', label: '수납유형코드' },
  { key: 'rcvmtTyNm', db: 'rcvmt_ty_nm', label: '수납유형' },
  { key: 'actYmd', db: 'act_ymd', label: '회계일자' },
  { key: 'pmkYmd', db: 'pmk_ymd', label: '납부일자' },
  { key: 'rcvmtSeCd', db: 'rcvmt_se_cd', label: '수납구분코드' },
  { key: 'rcvmtSttSeCd', db: 'rcvmt_stt_se_cd', label: '수납상태코드' },
  { key: 'taxnNo', db: 'taxn_no', label: '과세번호' },
  { key: 'syncStatus', db: 'sync_status' },
  { key: 'syncedAt', db: 'synced_at' },
  { key: 'createdAt', db: 'created_at' },
  { key: 'updatedAt', db: 'updated_at' },
];

for (let i = 1; i <= 20; i++) {
  DETAIL_FIELD_ORDER.push(
    { key: `vtlacBankNm${i}` as keyof NglFeeList, db: `vtlac_bank_nm${i}`, label: `가상계좌은행${i}` },
    { key: `vrActno${i}` as keyof NglFeeList, db: `vr_actno${i}`, label: `가상계좌번호${i}` }
  );
}

const AMOUNT_KEYS = new Set([
  'pidAfAmt',
  'frstPctAmt',
  'lastPctAmt',
  'lastAdtnAmt',
  'lastItmIntrAmt',
  'rcvmtPctAmt',
  'rcvmtAdtnAmt',
  'itmIntrAmt',
]);

const YMD_KEYS = new Set([
  'lvyYmd',
  'frstPidYmd',
  'lastPidYmd',
  'pidAfYmd',
  'rcvmtYmd',
  'actYmd',
  'pmkYmd',
]);

function buildAttributes(row: NglFeeList): UseFeeDetailAttr[] {
  return DETAIL_FIELD_ORDER.map(({ key, db, label }) => {
    const raw = row[key];
    let value: string;
    if (AMOUNT_KEYS.has(String(key))) {
      value = formatAmount(typeof raw === 'number' ? raw : raw == null ? null : Number(raw));
    } else if (YMD_KEYS.has(String(key))) {
      value = formatYmd(raw == null ? null : String(raw));
    } else {
      value = displayValue(raw);
    }
    return {
      field: String(key),
      label: label ?? nglFeeListColumnComments[db] ?? db,
      value,
    };
  });
}

export async function getUseFeeDetail(params: {
  id?: string | number;
}): Promise<{ row: UseFeeListRow | null; attributes: UseFeeDetailAttr[]; error?: string }> {
  const idNum = Number(params?.id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return { row: null, attributes: [], error: '상세 키가 필요합니다.' };
  }

  try {
    const rows = await db.select().from(nglFeeList).where(eq(nglFeeList.id, idNum)).limit(1);
    const r = rows[0];
    if (!r) return { row: null, attributes: [], error: '선택한 점사용료를 찾을 수 없습니다.' };

    const amountRaw = listAmount(r);
    return {
      row: {
        id: String(r.id),
        status: String(r.feeStatus ?? ''),
        chargeNo: String(r.lvyNo ?? ''),
        year: String(r.fyr ?? ''),
        payer: String(r.pyrNm ?? ''),
        amount: formatAmount(amountRaw),
        amountRaw,
        dueDate: formatYmd(r.frstPidYmd ?? r.lastPidYmd),
        rcvmtSn: String(r.rcvmtSn ?? ''),
      },
      attributes: buildAttributes(r),
    };
  } catch (e) {
    return { row: null, attributes: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 수동 연계 (운영/점검용). fyr 미입력 시 2000~현재연도 */
export async function runNextGenSync(params?: { fyr?: string }) {
  return runNextGenFeeSync({ fyr: params?.fyr });
}

/** 동일 부과키의 수납 행 목록 (선택 행 맥락용) */
export async function getUseFeeReceiptsByLvyKey(params: { lvyKey?: string }) {
  const key = String(params?.lvyKey ?? '').trim();
  if (!key) return { rows: [] as UseFeeListRow[] };
  const rows = await db
    .select()
    .from(nglFeeList)
    .where(and(eq(nglFeeList.lvyKey, key), eq(nglFeeList.feeStatus, '수납')))
    .orderBy(asc(nglFeeList.rcvmtSn));
  return {
    rows: rows.map((r) => {
      const amountRaw = listAmount(r);
      return {
        id: String(r.id),
        status: String(r.feeStatus ?? ''),
        chargeNo: String(r.lvyNo ?? ''),
        year: String(r.fyr ?? ''),
        payer: String(r.pyrNm ?? ''),
        amount: formatAmount(amountRaw),
        amountRaw,
        dueDate: formatYmd(r.frstPidYmd ?? r.lastPidYmd),
        rcvmtSn: String(r.rcvmtSn ?? ''),
      };
    }),
  };
}
