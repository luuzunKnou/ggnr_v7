/**
 * 점사용료 — layer.ngl_fee_list 조회 + 차세대 수동 연계
 */
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/database/db';
import { nglFeeList, type NglFeeList } from '@/database/schema/ngl_fee_list';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import { formatToYmdOrText, tryFormatToYmd } from '@/lib/formatDateYmd';
import { runNextGenFeeSync } from '@/lib/nextGenLinkage/syncRunner';
import { labelForUseFeeField } from '@/app/(pages)/map/_mapContents/useFee/useFeeFieldLabels';

const UNPAID_DUE_NOTIF_DEFAULT_WITHIN_DAYS = 15;

export type UseFeeListRow = {
  id: string;
  status: string;
  ledgerNo: string;
  dptNm: string;
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
    try {
      await ensureNglFeeListGeomColumn();
    } catch {
      /* ignore */
    }
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

/** 부서 필터용: 데이터에 있는 부서명 목록 */
export async function getUseFeeDepartments(_params?: {
  system?: string;
}): Promise<{
  departments: string[];
  error?: string;
}> {
  try {
    const rows = await db
      .selectDistinct({ dptNm: nglFeeList.dptNm })
      .from(nglFeeList)
      .where(sql`coalesce(trim(${nglFeeList.dptNm}), '') <> ''`)
      .orderBy(asc(nglFeeList.dptNm));
    return {
      departments: rows.map((r) => String(r.dptNm ?? '').trim()).filter(Boolean),
    };
  } catch (e) {
    return { departments: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export type UseFeeListSortKey =
  | 'status'
  | 'ledgerNo'
  | 'dptNm'
  | 'payer'
  | 'amount'
  | 'dueDate';

export type UseFeeFeeStatusFilter = '' | '미납' | '수납';

const USE_FEE_LIST_SORT_KEYS = new Set<string>([
  'status',
  'ledgerNo',
  'dptNm',
  'payer',
  'amount',
  'dueDate',
]);

type UseFeeSortSpec = { key: UseFeeListSortKey; dir: 'asc' | 'desc' };

function parseUseFeeSortSpecs(params?: {
  sorts?: unknown;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}): UseFeeSortSpec[] {
  const raw = params?.sorts;
  if (Array.isArray(raw) && raw.length > 0) {
    const out: UseFeeSortSpec[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const key = String((item as { key?: unknown }).key ?? '').trim();
      if (!USE_FEE_LIST_SORT_KEYS.has(key) || seen.has(key)) continue;
      seen.add(key);
      const dirRaw = String((item as { dir?: unknown }).dir ?? '').trim().toLowerCase();
      out.push({
        key: key as UseFeeListSortKey,
        dir: dirRaw === 'asc' ? 'asc' : 'desc',
      });
    }
    if (out.length > 0) return out;
  }
  const sortBy = String(params?.sortBy ?? '').trim();
  if (USE_FEE_LIST_SORT_KEYS.has(sortBy)) {
    return [
      {
        key: sortBy as UseFeeListSortKey,
        dir: params?.sortDir === 'asc' ? 'asc' : 'desc',
      },
    ];
  }
  return [];
}

/** 목록: 상태, 대장번호, 부서명, 납부자, 납부금액, 납기일 */
export async function getUseFeeList(params?: {
  keyword?: string;
  /** 부서명 정확 일치. 비우면 전체 */
  dptNm?: string;
  /** 미납 | 수납. 비우면 전체 */
  feeStatus?: string;
  /** URL system= (참고용·필터에 미사용 — 전체 부서 노출) */
  system?: string;
  /** 다중 정렬 [{ key, dir }] — 앞선 항목이 우선 */
  sorts?: Array<{ key?: string; dir?: string }>;
  /** 단일 정렬(호환). sorts 있으면 무시 */
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  /** 페이지 크기. 기본 500 */
  limit?: number;
  /** 건너뛸 건수. 기본 0 */
  offset?: number;
}): Promise<{ rows: UseFeeListRow[]; total: number; error?: string }> {
  const keyword = String(params?.keyword ?? '').trim();
  const dptNm = String(params?.dptNm ?? '').trim();
  const feeStatusRaw = String(params?.feeStatus ?? '').trim();
  const feeStatus: UseFeeFeeStatusFilter =
    feeStatusRaw === '미납' || feeStatusRaw === '수납' ? feeStatusRaw : '';
  const sortSpecs = parseUseFeeSortSpecs(params);
  const limit = Math.min(Math.max(Number(params?.limit) || 500, 1), 2000);
  const offset = Math.max(0, Math.trunc(Number(params?.offset) || 0));

  try {
    if (offset === 0) {
      try {
        await ensureNglFeeListGeomColumn();
      } catch {
        // geom 컬럼 없어도 목록 조회는 계속
      }
    }

    const kw = keyword
      ? or(
          ilike(nglFeeList.ledgerNo, `%${keyword}%`),
          ilike(nglFeeList.lvyNo, `%${keyword}%`),
          ilike(nglFeeList.pyrNm, `%${keyword}%`),
          ilike(nglFeeList.feeStatus, `%${keyword}%`),
          ilike(nglFeeList.fyr, `%${keyword}%`),
          ilike(nglFeeList.lvyKey, `%${keyword}%`),
          ilike(nglFeeList.glNm, `%${keyword}%`),
          ilike(nglFeeList.glAddr, `%${keyword}%`),
          ilike(nglFeeList.dptNm, `%${keyword}%`)
        )
      : undefined;
    const dpt = dptNm ? eq(nglFeeList.dptNm, dptNm) : undefined;
    const statusEq = feeStatus ? eq(nglFeeList.feeStatus, feeStatus) : undefined;
    const where = and(kw, dpt, statusEq);

    const countRes = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(nglFeeList)
      .where(where);
    const total = Number(countRes[0]?.c ?? 0);

    /** 수납=수납일자 / 그 외=최종납기(없으면 최초납기) — 비교용 YYYYMMDD */
    const listDateExpr = sql`case
      when ${nglFeeList.feeStatus} = '수납' then nullif(trim(${nglFeeList.rcvmtYmd}), '')
      else coalesce(
        nullif(trim(${nglFeeList.lastPidYmd}), ''),
        nullif(trim(${nglFeeList.frstPidYmd}), '')
      )
    end`;
    const amountExpr = sql`case
      when ${nglFeeList.feeStatus} = '수납' then ${nglFeeList.rcvmtPctAmt}
      else coalesce(${nglFeeList.lastPctAmt}, ${nglFeeList.frstPctAmt})
    end`;
    const unpaidFirst = sql`case when ${nglFeeList.feeStatus} = '미납' then 0 else 1 end`;

    const orderParts: ReturnType<typeof sql>[] = [];
    for (const { key, dir: sortDir } of sortSpecs) {
      switch (key) {
        case 'status':
          // 오름차순=미납 먼저, 내림차순=수납 먼저
          orderParts.push(
            sortDir === 'asc'
              ? sql`case
                  when ${nglFeeList.feeStatus} = '미납' then 0
                  when ${nglFeeList.feeStatus} = '수납' then 1
                  else 2
                end`
              : sql`case
                  when ${nglFeeList.feeStatus} = '수납' then 0
                  when ${nglFeeList.feeStatus} = '미납' then 1
                  else 2
                end`
          );
          break;
        case 'ledgerNo':
          orderParts.push(
            sortDir === 'asc'
              ? sql`${nglFeeList.ledgerNo} asc nulls last`
              : sql`${nglFeeList.ledgerNo} desc nulls last`
          );
          break;
        case 'dptNm':
          orderParts.push(
            sortDir === 'asc'
              ? sql`${nglFeeList.dptNm} asc nulls last`
              : sql`${nglFeeList.dptNm} desc nulls last`
          );
          break;
        case 'payer':
          orderParts.push(
            sortDir === 'asc'
              ? sql`${nglFeeList.pyrNm} asc nulls last`
              : sql`${nglFeeList.pyrNm} desc nulls last`
          );
          break;
        case 'amount':
          orderParts.push(
            sortDir === 'asc'
              ? sql`${amountExpr} asc nulls last`
              : sql`${amountExpr} desc nulls last`
          );
          break;
        case 'dueDate':
          orderParts.push(
            sortDir === 'asc'
              ? sql`${listDateExpr} asc nulls last`
              : sql`${listDateExpr} desc nulls last`
          );
          break;
        default:
          break;
      }
    }

    const orderBy =
      orderParts.length > 0
        ? [...orderParts, desc(nglFeeList.id)]
        : [
            // 기본: 미납 먼저 → 납기일 최신 → 대장번호 최신
            unpaidFirst,
            sql`${listDateExpr} desc nulls last`,
            desc(nglFeeList.ledgerNo),
            desc(nglFeeList.lvyNo),
            desc(nglFeeList.id),
          ];

    const rows = await db
      .select({
        id: nglFeeList.id,
        feeStatus: nglFeeList.feeStatus,
        ledgerNo: nglFeeList.ledgerNo,
        dptNm: nglFeeList.dptNm,
        pyrNm: nglFeeList.pyrNm,
        rcvmtSn: nglFeeList.rcvmtSn,
        rcvmtPctAmt: nglFeeList.rcvmtPctAmt,
        lastPctAmt: nglFeeList.lastPctAmt,
        frstPctAmt: nglFeeList.frstPctAmt,
        rcvmtYmd: nglFeeList.rcvmtYmd,
        lastPidYmd: nglFeeList.lastPidYmd,
        frstPidYmd: nglFeeList.frstPidYmd,
      })
      .from(nglFeeList)
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    return {
      total,
      rows: rows.map((r) => {
        const amountRaw = listAmount(r as NglFeeList);
        return {
          id: String(r.id),
          status: String(r.feeStatus ?? ''),
          ledgerNo: String(r.ledgerNo ?? ''),
          dptNm: String(r.dptNm ?? ''),
          payer: String(r.pyrNm ?? ''),
          amount: formatAmount(amountRaw),
          amountRaw,
          dueDate: formatYmd(listDateYmd(r as NglFeeList)),
          rcvmtSn: String(r.rcvmtSn ?? ''),
        };
      }),
    };
  } catch (e) {
    return { rows: [], total: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

const DETAIL_FIELD_ORDER: { key: keyof NglFeeList; db: string }[] = [
  { key: 'feeStatus', db: 'fee_status' },
  { key: 'lvyNo', db: 'lvy_no' },
  { key: 'ledgerNo', db: 'ledger_no' },
  { key: 'fyr', db: 'fyr' },
  { key: 'dptNm', db: 'dpt_nm' },
  { key: 'dptCd', db: 'dpt_cd' },
  { key: 'actSeCd', db: 'act_se_cd' },
  { key: 'rprsTxmCd', db: 'rprs_txm_cd' },
  { key: 'rprsTxmNm', db: 'rprs_txm_nm' },
  { key: 'itmSn', db: 'itm_sn' },
  { key: 'sgbCd', db: 'sgb_cd' },
  { key: 'sgbNm', db: 'sgb_nm' },
  { key: 'pyrNo', db: 'pyr_no' },
  { key: 'pyrNm', db: 'pyr_nm' },
  { key: 'pyrAddr', db: 'pyr_addr' },
  { key: 'pyrSeCd', db: 'pyr_se_cd' },
  { key: 'pyrMngNo', db: 'pyr_mng_no' },
  { key: 'pyrSttCd', db: 'pyr_stt_cd' },
  { key: 'pyrSttNm', db: 'pyr_stt_nm' },
  { key: 'zip', db: 'zip' },
  { key: 'pyrCnpcNo', db: 'pyr_cnpc_no' },
  { key: 'pyrMblCnpcNo', db: 'pyr_mbl_cnpc_no' },
  { key: 'pyrEmlAddr', db: 'pyr_eml_addr' },
  { key: 'lvySeCd', db: 'lvy_se_cd' },
  { key: 'lvyYmd', db: 'lvy_ymd' },
  { key: 'frstPidYmd', db: 'frst_pid_ymd' },
  { key: 'lastPidYmd', db: 'last_pid_ymd' },
  { key: 'pidAfYmd', db: 'pid_af_ymd' },
  { key: 'pidAfAmt', db: 'pid_af_amt' },
  { key: 'frstPctAmt', db: 'frst_pct_amt' },
  { key: 'lastPctAmt', db: 'last_pct_amt' },
  { key: 'lastAdtnAmt', db: 'last_adtn_amt' },
  { key: 'lastItmIntrAmt', db: 'last_itm_intr_amt' },
  { key: 'lvySttSeNm', db: 'lvy_stt_se_nm' },
  { key: 'rcvmtSeNm', db: 'rcvmt_se_nm' },
  { key: 'szrSeNm', db: 'szr_se_nm' },
  { key: 'itmSeNm', db: 'itm_se_nm' },
  { key: 'untyLvyDataSeNm', db: 'unty_lvy_data_se_nm' },
  { key: 'rdtSeNm', db: 'rdt_se_nm' },
  { key: 'dftSeNm', db: 'dft_se_nm' },
  { key: 'arrRsnCd', db: 'arr_rsn_cd' },
  { key: 'arrRsnNm', db: 'arr_rsn_nm' },
  { key: 'autoPaySeCd', db: 'auto_pay_se_cd' },
  { key: 'glNm', db: 'gl_nm' },
  { key: 'glMngNo', db: 'gl_mng_no' },
  { key: 'glAddr', db: 'gl_addr' },
  { key: 'glZip', db: 'gl_zip' },
  { key: 'acctItmCd', db: 'acct_itm_cd' },
  { key: 'mngItemSn1', db: 'mng_item_sn1' },
  { key: 'mngItemSn2', db: 'mng_item_sn2' },
  { key: 'mngItemSn3', db: 'mng_item_sn3' },
  { key: 'mngItemSn4', db: 'mng_item_sn4' },
  { key: 'mngItemSn5', db: 'mng_item_sn5' },
  { key: 'mngItemSn6', db: 'mng_item_sn6' },
  { key: 'spacBizCd', db: 'spac_biz_cd' },
  { key: 'rcvmtYmd', db: 'rcvmt_ymd' },
  { key: 'rcvmtPctAmt', db: 'rcvmt_pct_amt' },
  { key: 'rcvmtAdtnAmt', db: 'rcvmt_adtn_amt' },
  { key: 'itmIntrAmt', db: 'itm_intr_amt' },
  { key: 'rcvmtBank', db: 'rcvmt_bank' },
  { key: 'rcvmtTyCd', db: 'rcvmt_ty_cd' },
  { key: 'rcvmtTyNm', db: 'rcvmt_ty_nm' },
  { key: 'actYmd', db: 'act_ymd' },
  { key: 'pmkYmd', db: 'pmk_ymd' },
  { key: 'rcvmtSeCd', db: 'rcvmt_se_cd' },
  { key: 'rcvmtSttSeCd', db: 'rcvmt_stt_se_cd' },
  { key: 'taxnNo', db: 'taxn_no' },
];

for (let i = 1; i <= 20; i++) {
  DETAIL_FIELD_ORDER.push(
    { key: `vtlacBankNm${i}` as keyof NglFeeList, db: `vtlac_bank_nm${i}` },
    { key: `vrActno${i}` as keyof NglFeeList, db: `vr_actno${i}` }
  );
}

const DETAIL_PRIMARY_KEYS: (keyof NglFeeList)[] = [
  'feeStatus',
  'ledgerNo',
  'dptNm',
  'pyrSttNm',
  'pyrNm',
  'pyrAddr',
  'pyrCnpcNo',
  'mngItemSn1',
  'lvyYmd',
  'frstPidYmd',
  'lastPidYmd',
  'glAddr',
  'mngItemSn2',
  'mngItemSn3',
  'pidAfAmt',
  'mngItemSn4',
];

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

const ADDRESS_ATTR_KEYS = new Set(['pyrAddr', 'glAddr']);

function formatAttrValue(key: string, raw: unknown): string {
  if (AMOUNT_KEYS.has(key)) {
    return formatAmount(typeof raw === 'number' ? raw : raw == null ? null : Number(raw));
  }
  if (YMD_KEYS.has(key)) {
    return formatYmd(raw == null ? null : String(raw));
  }
  if (ADDRESS_ATTR_KEYS.has(key)) {
    const s = String(raw ?? '').trim();
    if (!s) return '—';
    return formatAddressStripSidoSigungu(s) || s;
  }
  return displayValue(raw);
}

function buildAttributes(row: NglFeeList): UseFeeDetailAttr[] {
  const byKey = new Map<string, UseFeeDetailAttr>();
  for (const { key } of DETAIL_FIELD_ORDER) {
    const field = String(key);
    const resolvedLabel = labelForUseFeeField(field);
    if (resolvedLabel.includes('코드')) continue;

    const value = formatAttrValue(field, row[key]);
    if (isVirtualAccountField(field) && (value === '—' || value === '')) continue;
    byKey.set(field, { field, label: resolvedLabel, value });
  }

  const attrs: UseFeeDetailAttr[] = [];
  const used = new Set<string>();
  for (const key of DETAIL_PRIMARY_KEYS) {
    const field = String(key);
    const hit = byKey.get(field);
    if (!hit) continue;
    attrs.push(hit);
    used.add(field);
  }
  for (const { key } of DETAIL_FIELD_ORDER) {
    const field = String(key);
    if (used.has(field)) continue;
    const hit = byKey.get(field);
    if (!hit) continue;
    attrs.push(hit);
  }
  return attrs;
}

export async function getUseFeeDetail(params: {
  id?: string | number;
  /** URL system= (참고용) */
  system?: string;
}): Promise<{ row: UseFeeListRow | null; attributes: UseFeeDetailAttr[]; error?: string }> {
  const idNum = Number(params?.id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return { row: null, attributes: [], error: '상세 키가 필요합니다.' };
  }

  try {
    try {
      await ensureNglFeeListGeomColumn();
    } catch {
      // geom 컬럼 없어도 상세 조회는 계속
    }
    const rows = await db.select().from(nglFeeList).where(eq(nglFeeList.id, idNum)).limit(1);
    const r = rows[0];
    if (!r) return { row: null, attributes: [], error: '선택한 점사용료를 찾을 수 없습니다.' };

    const amountRaw = listAmount(r);
    return {
      row: {
        id: String(r.id),
        status: String(r.feeStatus ?? ''),
        ledgerNo: String(r.ledgerNo ?? ''),
        dptNm: String(r.dptNm ?? ''),
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

/** 지도 이동용 extent — geom 없으면 null (알림 없음) */
export async function getUseFeeExtent3857ById(params: {
  id?: string | number;
}): Promise<{ extent3857: [number, number, number, number] | null; error?: string }> {
  const idNum = Number(params?.id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return { extent3857: null };
  }
  try {
    try {
      await ensureNglFeeListGeomColumn();
    } catch {
      /* ignore */
    }
    const res = await db.execute(sql.raw(`
      SELECT
        ST_XMin(ST_Envelope(ST_Transform(geom, 3857)))::float8 AS xmin,
        ST_YMin(ST_Envelope(ST_Transform(geom, 3857)))::float8 AS ymin,
        ST_XMax(ST_Envelope(ST_Transform(geom, 3857)))::float8 AS xmax,
        ST_YMax(ST_Envelope(ST_Transform(geom, 3857)))::float8 AS ymax
      FROM layer.ngl_fee_list
      WHERE id = ${idNum}
        AND geom IS NOT NULL
      LIMIT 1
    `));
    const row = res.rows?.[0] as
      | { xmin?: number; ymin?: number; xmax?: number; ymax?: number }
      | undefined;
    if (!row) return { extent3857: null };
    const coords = [row.xmin, row.ymin, row.xmax, row.ymax].map(Number);
    if (coords.length !== 4 || !coords.every((v) => Number.isFinite(v))) {
      return { extent3857: null };
    }
    return { extent3857: coords as [number, number, number, number] };
  } catch (e) {
    return { extent3857: null, error: e instanceof Error ? e.message : String(e) };
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
  try {
    await ensureNglFeeListGeomColumn();
  } catch {
    /* ignore */
  }
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
        ledgerNo: String(r.ledgerNo ?? ''),
        dptNm: String(r.dptNm ?? ''),
        payer: String(r.pyrNm ?? ''),
        amount: formatAmount(amountRaw),
        amountRaw,
        dueDate: formatYmd(listDateYmd(r)),
        rcvmtSn: String(r.rcvmtSn ?? ''),
      };
    }),
  };
}

/**
 * 물건지주소 필지검색용 정규화.
 * «438번지 1호» → «438-1», «951번지» → «951»
 */
export function normalizeUseFeeGlAddrForParcelSearch(addr: string): string {
  let s = String(addr ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!s) return '';
  s = s.replace(/(\d{1,5})\s*번지\s+(\d{1,5})\s*호/gu, '$1-$2');
  s = s.replace(/(\d{1,5})\s*번지/gu, '$1');
  return s.replace(/\s+/g, ' ').trim();
}

/** 지번(본번/부번·번지)이 없으면 필지 검색 생략 — 예: «평해읍 학곡리» */
export function hasUseFeeGlAddrJibunLot(addr: string): boolean {
  const s = normalizeUseFeeGlAddrForParcelSearch(addr);
  if (!s) return false;
  if (/(?:^|\s)산\s*\d{1,5}(?:\s*-\s*\d{1,5})?(?:\s|$)/u.test(s)) return true;
  return /(?:^|\s)\d{1,5}(?:\s*-\s*\d{1,5})?(?:\s|$)/u.test(s);
}

let nglFeeGeomEnsurePromise: Promise<void> | null = null;

async function ensureNglFeeListGeomColumn(): Promise<void> {
  if (!nglFeeGeomEnsurePromise) {
    nglFeeGeomEnsurePromise = (async () => {
      await db.execute(
        sql.raw(`
    ALTER TABLE layer.ngl_fee_list
      ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 5181);
    CREATE INDEX IF NOT EXISTS ngl_fee_list_geom_gix
      ON layer.ngl_fee_list USING GIST (geom);
  `)
      );
      // geometry_columns srid=0 이면 지도 클릭 식별(ST_Transform)이 실패함
      try {
        await db.execute(
          sql.raw(`
    DO $fix$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM geometry_columns
        WHERE f_table_schema = 'layer'
          AND f_table_name = 'ngl_fee_list'
          AND f_geometry_column = 'geom'
          AND COALESCE(srid, 0) <= 0
      ) THEN
        PERFORM UpdateGeometrySRID('layer', 'ngl_fee_list', 'geom', 5181);
      END IF;
    END
    $fix$;
  `)
        );
      } catch {
        // 메타 보정 실패해도 컬럼/조회는 유지 (identify 쪽 SRID 프로브로 보완)
      }
    })().catch((e) => {
      nglFeeGeomEnsurePromise = null;
      throw e;
    });
  }
  await nglFeeGeomEnsurePromise;
}

/**
 * 물건지주소(gl_addr) → jijuk 필지 폴리곤을 geom에 적재.
 * 지번 없는 주소·검색 실패는 건너뜀. geom이 이미 있는 행은 기본 제외.
 */
export async function backfillUseFeeGlAddrGeom(params?: {
  /** true면 geom 있는 행도 재변환 */
  force?: boolean;
  limit?: number;
}): Promise<{
  scanned: number;
  updated: number;
  skippedNoJibun: number;
  skippedNotFound: number;
  error?: string;
}> {
  const force = params?.force === true;
  const limit = Math.min(Math.max(Number(params?.limit) || 5000, 1), 20000);

  try {
    await ensureNglFeeListGeomColumn();
  } catch (e) {
    return {
      scanned: 0,
      updated: 0,
      skippedNoJibun: 0,
      skippedNotFound: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const { resolveJijukParcelGeomsByAddresses } = await import('@/service/layerRowService');

  const whereGeom = force
    ? sql`true`
    : sql`${nglFeeList.geom} is null`;
  const candidates = await db
    .select({
      id: nglFeeList.id,
      glAddr: nglFeeList.glAddr,
    })
    .from(nglFeeList)
    .where(and(whereGeom, sql`coalesce(trim(${nglFeeList.glAddr}), '') <> ''`))
    .orderBy(desc(nglFeeList.id))
    .limit(limit);

  let updated = 0;
  let skippedNoJibun = 0;
  let skippedNotFound = 0;

  for (const row of candidates) {
    const addrRaw = String(row.glAddr ?? '').trim();
    const addr = normalizeUseFeeGlAddrForParcelSearch(addrRaw);
    if (!hasUseFeeGlAddrJibunLot(addrRaw)) {
      skippedNoJibun += 1;
      continue;
    }

    try {
      const resolved = await resolveJijukParcelGeomsByAddresses({
        items: [{ address: addr }],
      });
      const parcel = resolved.parcels[0];
      const gj = parcel?.geometry3857;
      if (!gj || typeof gj !== 'object') {
        skippedNotFound += 1;
        continue;
      }
      const json = JSON.stringify(gj).replace(/'/g, "''");
      await db.execute(
        sql.raw(`
          UPDATE layer.ngl_fee_list
          SET geom = ST_Multi(
                ST_CollectionExtract(
                  ST_MakeValid(
                    ST_Transform(
                      ST_SetSRID(ST_GeomFromGeoJSON('${json}'), 3857),
                      5181
                    )
                  ),
                  3
                )
              ),
              updated_at = now()
          WHERE id = ${Number(row.id)}
        `)
      );
      updated += 1;
    } catch {
      skippedNotFound += 1;
    }
  }

  return {
    scanned: candidates.length,
    updated,
    skippedNoJibun,
    skippedNotFound,
  };
}
