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
import { formatToYmdOrText, tryFormatToYmd } from '@/lib/formatDateYmd';
import { runNextGenFeeSync } from '@/lib/nextGenLinkage/syncRunner';

const UNPAID_DUE_NOTIF_DEFAULT_WITHIN_DAYS = 15;

/** 건설 시스템(build)에서만 노출하는 부서 */
const BUILD_ONLY_DEPT_NM = '건설과';

function normalizeSystemKey(system?: string): string {
  return String(system ?? '').trim().toLowerCase();
}

/** 하천·도로 등 건설 외 시스템에서는 건설과 점사용료 제외 */
function allowsBuildOnlyDept(system?: string): boolean {
  return normalizeSystemKey(system) === 'build';
}

function isBuildOnlyDept(dptNm: string | null | undefined): boolean {
  return String(dptNm ?? '').trim() === BUILD_ONLY_DEPT_NM;
}

/** 시스템별 부서 노출 SQL 조건 (건설 외: 건설과 제외) */
function systemDeptScopeSql(system?: string) {
  if (allowsBuildOnlyDept(system)) return undefined;
  return sql`coalesce(trim(${nglFeeList.dptNm}), '') <> ${BUILD_ONLY_DEPT_NM}`;
}

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

/** 목록 날짜: 수납→수납일자, 그 외→최종납기일(없으면 최초납기) */
function listDateYmd(row: NglFeeList): string | null {
  if (row.feeStatus === '수납') {
    return row.rcvmtYmd ?? null;
  }
  return row.lastPidYmd ?? row.frstPidYmd ?? null;
}

function toYmd(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return tryFormatToYmd(s);
}

function startOfLocalDayMs(raw: string | Date): number | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate()).getTime();
  }
  const ymd = toYmd(String(raw ?? ''));
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

function diffLocalCalendarDays(fromMs: number, toMs: number): number {
  return Math.round((toMs - fromMs) / 86_400_000);
}

export type UseFeeUnpaidDueNotifRow = {
  id: string;
  chargeNo: string;
  payer: string;
  dueDate: string;
  daysRemaining: number;
  /** 알림 systemScope 판별용 */
  dptNm: string;
};

/** 미납 · 납기일(최종→최초)이 N일 이내인 알림 목록 */
export async function getUseFeeUnpaidDueNotifications(params?: {
  withinDays?: number;
}): Promise<{ items: UseFeeUnpaidDueNotifRow[]; error?: string }> {
  const withinDays = Math.max(
    1,
    Math.min(365, Math.trunc(Number(params?.withinDays ?? UNPAID_DUE_NOTIF_DEFAULT_WITHIN_DAYS)))
  );

  try {
    const rows = await db
      .select()
      .from(nglFeeList)
      .where(eq(nglFeeList.feeStatus, '미납'))
      .limit(10000);

    const todayMs = startOfLocalDayMs(new Date());
    if (todayMs == null) return { items: [] };

    const items: UseFeeUnpaidDueNotifRow[] = [];
    for (const row of rows) {
      const dueYmd = toYmd(listDateYmd(row));
      if (!dueYmd) continue;
      const dueMs = startOfLocalDayMs(dueYmd);
      if (dueMs == null) continue;
      const daysRemaining = diffLocalCalendarDays(todayMs, dueMs);
      if (daysRemaining < 0 || daysRemaining > withinDays) continue;
      items.push({
        id: String(row.id),
        chargeNo: String(row.lvyNo ?? '').trim() || String(row.id),
        payer: String(row.pyrNm ?? '').trim() || '—',
        dueDate: dueYmd,
        daysRemaining,
        dptNm: String(row.dptNm ?? '').trim(),
      });
    }

    items.sort((a, b) => {
      if (a.daysRemaining !== b.daysRemaining) return a.daysRemaining - b.daysRemaining;
      if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      return a.chargeNo.localeCompare(b.chargeNo);
    });

    return { items };
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 부서 필터용: 데이터에 있는 부서명 목록 (system=build 외에는 건설과 제외) */
export async function getUseFeeDepartments(params?: {
  system?: string;
}): Promise<{
  departments: string[];
  error?: string;
}> {
  const system = params?.system;
  try {
    const rows = await db
      .selectDistinct({ dptNm: nglFeeList.dptNm })
      .from(nglFeeList)
      .where(
        and(
          sql`coalesce(trim(${nglFeeList.dptNm}), '') <> ''`,
          systemDeptScopeSql(system)
        )
      )
      .orderBy(asc(nglFeeList.dptNm));
    return {
      departments: rows.map((r) => String(r.dptNm ?? '').trim()).filter(Boolean),
    };
  } catch (e) {
    return { departments: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 목록: 상태, 부과번호, 회계연도, 납부자, 납부금액, 납기일 */
export async function getUseFeeList(params?: {
  keyword?: string;
  /** 부서명 정확 일치. 비우면 전체 */
  dptNm?: string;
  /** URL system= (build 외에는 건설과 행 제외) */
  system?: string;
  limit?: number;
}): Promise<{ rows: UseFeeListRow[]; total: number; error?: string }> {
  const keyword = String(params?.keyword ?? '').trim();
  const dptNm = String(params?.dptNm ?? '').trim();
  const system = params?.system;
  const limit = Math.min(Math.max(Number(params?.limit) || 5000, 1), 10000);

  try {
    if (dptNm && isBuildOnlyDept(dptNm) && !allowsBuildOnlyDept(system)) {
      return { rows: [], total: 0 };
    }

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
    const dpt = dptNm ? eq(nglFeeList.dptNm, dptNm) : undefined;
    const where = and(kw, dpt, systemDeptScopeSql(system));

    const countRes = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(nglFeeList)
      .where(where);
    const total = Number(countRes[0]?.c ?? 0);

    // 1) 수납=수납일자 / 그 외=최종납기일 최신순 2) 부과번호 큰 순
    const listDateExpr = sql`case
      when ${nglFeeList.feeStatus} = '수납' then nullif(trim(${nglFeeList.rcvmtYmd}), '')
      else coalesce(
        nullif(trim(${nglFeeList.lastPidYmd}), ''),
        nullif(trim(${nglFeeList.frstPidYmd}), '')
      )
    end`;
    const rows = await db
      .select()
      .from(nglFeeList)
      .where(where)
      .orderBy(
        sql`${listDateExpr} desc nulls last`,
        desc(nglFeeList.lvyNo),
        desc(nglFeeList.id)
      )
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
          dueDate: formatYmd(listDateYmd(r)),
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
  { key: 'lvyNo', db: 'lvy_no' },
  { key: 'ledgerNo', db: 'ledger_no' },
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
  { key: 'pyrSttCd', db: 'pyr_stt_cd', label: '납부자상태코드' },
  { key: 'pyrSttNm', db: 'pyr_stt_nm', label: '납부자상태' },
  { key: 'zip', db: 'zip', label: '우편번호' },
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
  { key: 'glNm', db: 'gl_nm' },
  { key: 'glMngNo', db: 'gl_mng_no' },
  { key: 'glAddr', db: 'gl_addr' },
  { key: 'glZip', db: 'gl_zip', label: '물건지우편번호' },
  { key: 'acctItmCd', db: 'acct_itm_cd' },
  { key: 'mngItemSn1', db: 'mng_item_sn1', label: '점용기간' },
  { key: 'mngItemSn2', db: 'mng_item_sn2', label: '점용면적' },
  { key: 'mngItemSn3', db: 'mng_item_sn3', label: '공시지가' },
  { key: 'mngItemSn4', db: 'mng_item_sn4', label: '점용면적' },
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

function isVirtualAccountField(key: string): boolean {
  return /^vtlacBankNm\d+$/.test(key) || /^vrActno\d+$/.test(key);
}

function buildAttributes(row: NglFeeList): UseFeeDetailAttr[] {
  const attrs: UseFeeDetailAttr[] = [];
  for (const { key, db, label } of DETAIL_FIELD_ORDER) {
    const resolvedLabel = label ?? nglFeeListColumnComments[db] ?? db;
    // 코드성 필드는 상세 화면에서 숨김
    if (resolvedLabel.includes('코드')) continue;

    const raw = row[key];
    let value: string;
    if (AMOUNT_KEYS.has(String(key))) {
      value = formatAmount(typeof raw === 'number' ? raw : raw == null ? null : Number(raw));
    } else if (YMD_KEYS.has(String(key))) {
      value = formatYmd(raw == null ? null : String(raw));
    } else {
      value = displayValue(raw);
    }
    // 가상계좌 은행·번호 1~20: 값 있는 것만 표시
    if (isVirtualAccountField(String(key)) && (value === '—' || value === '')) continue;
    attrs.push({
      field: String(key),
      label: resolvedLabel,
      value,
    });
  }
  return attrs;
}

export async function getUseFeeDetail(params: {
  id?: string | number;
  /** URL system= (build 외에는 건설과 상세 차단) */
  system?: string;
}): Promise<{ row: UseFeeListRow | null; attributes: UseFeeDetailAttr[]; error?: string }> {
  const idNum = Number(params?.id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return { row: null, attributes: [], error: '상세 키가 필요합니다.' };
  }

  try {
    const rows = await db.select().from(nglFeeList).where(eq(nglFeeList.id, idNum)).limit(1);
    const r = rows[0];
    if (!r) return { row: null, attributes: [], error: '선택한 점사용료를 찾을 수 없습니다.' };

    if (isBuildOnlyDept(r.dptNm) && !allowsBuildOnlyDept(params?.system)) {
      return {
        row: null,
        attributes: [],
        error: '선택한 점사용료를 찾을 수 없습니다.',
      };
    }

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
        dueDate: formatYmd(listDateYmd(r)),
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
        dueDate: formatYmd(listDateYmd(r)),
        rcvmtSn: String(r.rcvmtSn ?? ''),
      };
    }),
  };
}
