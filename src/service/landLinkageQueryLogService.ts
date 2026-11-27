/**
 * 연계 조회·개인정보 열람 이력 — 목록·묶음 상세·적재
 * KRAS·KOREPS(공시지가) 행망 조회를 적재한다.
 */
import { and, desc, eq, gte, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/database/db';
import { llq } from '@/database/schema/land_linkage_query_log';
import { usr } from '@/database/schema/usr';
import { getSessionUsrId } from '@/lib/auth/guard';
import { formatTimestampWallClock } from '@/lib/formatTimestampWallClock';
import { shouldMaskPersonInfoForSession } from '@/service/systemControlService';
import { resolveAuditClientIp } from '@/lib/requestClientMeta';
import { getSystemListAll } from '@/service/configService';
import { headers } from 'next/headers';

type Params = Record<string, unknown>;

/** 이력에 남기는 행망 서비스(KRAS + 공시지가) */
export const LLQ_AUDIT_KRAS_SVC_IDS = [
  'KRAS000002',
  'KRAS000003',
  'KRAS000006',
  'KRAS000007',
  'KRAS000025',
  'KRAS000037',
  'KOREPS00011',
] as const;

export type LlqAuditKrasSvcId = (typeof LLQ_AUDIT_KRAS_SVC_IDS)[number];

/**
 * 개인정보 포함으로 보는 서비스.
 * 이동일자 연혁(006)·이용계획(025)·레이어목록(037)·공시지가(KOREPS)는 제외.
 */
export const LLQ_PII_KRAS_SVC_IDS = new Set<string>([
  'KRAS000002',
  'KRAS000003',
  'KRAS000007',
]);

export function isLlqAuditKrasSvcId(svcId: string): svcId is LlqAuditKrasSvcId {
  return (LLQ_AUDIT_KRAS_SVC_IDS as readonly string[]).includes(svcId);
}

export function llqHasPiiForSvc(svcId: string): boolean {
  return LLQ_PII_KRAS_SVC_IDS.has(svcId);
}

export function llqSystemForSvc(svcId: string): 'kras' | 'koreps' {
  return String(svcId).startsWith('KOREPS') ? 'koreps' : 'kras';
}

/** 목록 집계·필터용 — 현재 PII 서비스 ID SQL in 절 */
function sqlLlqSvcIsPii(): SQL {
  const ids = [...LLQ_PII_KRAS_SVC_IDS];
  return sql`${llq.llqSvcId} in (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  )})`;
}

export type QueryLogStatus = 'ok' | 'empty' | 'skip' | 'fail';

export type QueryLogInsert = {
  groupKey?: string | null;
  channel: string;
  system?: 'kras' | 'koreps';
  svcId: string;
  pnu: string;
  sgg?: string | null;
  status: QueryLogStatus;
  ms?: number | null;
  http?: number | null;
  message?: string | null;
  /** 브라우저가 보낸 사설 IP(선택). 헤더와 함께 감사 IP 해석에 사용 */
  clientIp?: string | null;
  /** 업무 시스템 sys_key (지도 ?system=). 없으면 Referer에서 해석 */
  appSys?: string | null;
  /** 업무 시스템 한글명. 없으면 sys_key로 목록에서 조회 */
  appSysNm?: string | null;
};

export type LandLinkageQueryLogRow = {
  llqKey: number;
  llqGroupKey: string | null;
  llqAt: string | null;
  llqUser: string | null;
  usrName: string | null;
  /** usr 조인 부서(현재 소속) */
  ugName: string | null;
  llqIp: string | null;
  /** 업무 시스템 키 */
  llqAppSys: string | null;
  /** 업무 시스템 한글명 */
  llqAppSysNm: string | null;
  llqChannel: string | null;
  llqSystem: string | null;
  llqSvcId: string | null;
  llqPnu: string | null;
  llqSgg: string | null;
  llqStatus: string | null;
  llqMs: number | null;
  llqHttp: number | null;
  llqMessage: string | null;
  llqHasPii: boolean;
  llqPiiViewedAt: string | null;
  /** 조회 당시 마스킹 on — 개인정보 포함 행에서만 의미 */
  llqPiiMasked: boolean;
  /** 묶음이면 2 이상 — 목록에서 1줄로 합친 건수 */
  groupCount?: number;
  /** 묶음 내 서비스별 건수 — 목록 «조회» 표시용 */
  svcCounts?: Record<string, number>;
};

async function requireLoggedIn(): Promise<string> {
  const id = await getSessionUsrId();
  if (!id) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  return id;
}

function parseDayBound(raw: unknown, endOfDay: boolean): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/-/g, '');
  if (!/^\d{8}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6)) - 1;
  const d = Number(s.slice(6, 8));
  if (endOfDay) return new Date(y, m, d, 23, 59, 59, 999);
  return new Date(y, m, d, 0, 0, 0, 0);
}

/** drizzle Failed query + PG cause 메시지 합쳐 검사 */
function errorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e ?? '');
  const cause = (e as { cause?: unknown }).cause;
  const causeMsg =
    cause instanceof Error
      ? cause.message
      : cause && typeof cause === 'object' && 'message' in cause
        ? String((cause as { message: unknown }).message)
        : cause != null
          ? String(cause)
          : '';
  return `${e.message}\n${causeMsg}`;
}

/** 테이블·대상 컬럼이 없을 때만 true. SQL 본문에 테이블명이 있어도 일반 오류는 삼키지 않음 */
function isMissingRelationError(e: unknown): boolean {
  const msg = errorText(e);
  if (/relation ["`]?[\w.]*land_linkage_query_log["`]? does not exist/i.test(msg)) return true;
  if (/column ["`]?llq_pii_masked["`]? .* does not exist/i.test(msg)) return true;
  if (/column ["`]?llq_pii_masked["`]? does not exist/i.test(msg)) return true;
  return false;
}

function isMissingLlqIpColumn(e: unknown): boolean {
  const msg = errorText(e);
  // EN: column "llq_ip" … does not exist / KO: "llq_ip" 칼럼은 … 없음
  if (!/["`]?llq_ip["`]?/i.test(msg)) return false;
  return /does not exist|존재하지 않|칼럼은 .* 없음|column .* 없음/i.test(msg);
}

function isMissingLlqAppSysColumn(e: unknown): boolean {
  const msg = errorText(e);
  if (!/["`]?llq_app_sys(_nm)?["`]?/i.test(msg)) return false;
  return /does not exist|존재하지 않|칼럼은 .* 없음|column .* 없음/i.test(msg);
}

/** Referer ?system= + systemList → 업무 시스템 키·한글명 */
async function resolveAppSysFromRequest(): Promise<{ key: string; name: string } | null> {
  try {
    const h = await headers();
    const ref = h.get('referer') || h.get('referrer') || '';
    if (!ref.trim()) return null;
    let key = '';
    try {
      key = new URL(ref).searchParams.get('system')?.trim() || '';
    } catch {
      return null;
    }
    if (!key) return null;
    const found = getSystemListAll().systems.find((s) => String(s.sys_key ?? '').trim() === key);
    const name = String(found?.sys_kor ?? '').trim() || key;
    return { key, name };
  } catch {
    return null;
  }
}

function resolveAppSysName(key: string, nameHint?: string | null): string {
  const hint = String(nameHint ?? '').trim();
  if (hint) return hint;
  const found = getSystemListAll().systems.find((s) => String(s.sys_key ?? '').trim() === key);
  return String(found?.sys_kor ?? '').trim() || key;
}

/** usr 조인 이름. su는 테이블에 없어도 «슈퍼관리자»로 표시 */
function resolveUsrDisplayName(usrId: string | null | undefined, usrName: string | null | undefined): string | null {
  const name = String(usrName ?? '').trim();
  if (name) return name;
  if (String(usrId ?? '').trim() === 'su') return '슈퍼관리자';
  return null;
}

function mapRow(r: {
  llqKey: number;
  llqGroupKey: string | null;
  llqAt: string | null;
  llqUser: string | null;
  usrName: string | null;
  ugName?: string | null;
  llqIp?: string | null;
  llqAppSys?: string | null;
  llqAppSysNm?: string | null;
  llqChannel: string | null;
  llqSystem: string | null;
  llqSvcId: string | null;
  llqPnu: string | null;
  llqSgg: string | null;
  llqStatus: string | null;
  llqMs: number | null;
  llqHttp: number | null;
  llqMessage: string | null;
  llqHasPii: boolean | null;
  llqPiiViewedAt: string | null;
  llqPiiMasked?: boolean | null;
  groupCount?: number | null;
  svcCounts?: unknown;
}): LandLinkageQueryLogRow {
  const svcCounts = normalizeSvcCounts(r.svcCounts);
  const appSys = String(r.llqAppSys ?? '').trim() || null;
  const appSysNm = appSys
    ? resolveAppSysName(appSys, r.llqAppSysNm)
    : String(r.llqAppSysNm ?? '').trim() || null;
  return {
    llqKey: r.llqKey,
    llqGroupKey: r.llqGroupKey,
    llqAt: r.llqAt ? formatTimestampWallClock(r.llqAt) || r.llqAt : null,
    llqUser: r.llqUser,
    usrName: resolveUsrDisplayName(r.llqUser, r.usrName),
    ugName: String(r.ugName ?? '').trim() || null,
    llqIp: r.llqIp?.trim() || null,
    llqAppSys: appSys,
    llqAppSysNm: appSysNm,
    llqChannel: r.llqChannel,
    llqSystem: r.llqSystem,
    llqSvcId: r.llqSvcId,
    llqPnu: r.llqPnu,
    llqSgg: r.llqSgg,
    llqStatus: r.llqStatus,
    llqMs: r.llqMs,
    llqHttp: r.llqHttp,
    llqMessage: r.llqMessage,
    llqHasPii: r.llqSvcId ? llqHasPiiForSvc(String(r.llqSvcId)) : !!r.llqHasPii,
    llqPiiViewedAt: r.llqPiiViewedAt
      ? formatTimestampWallClock(r.llqPiiViewedAt) || r.llqPiiViewedAt
      : null,
    llqPiiMasked: !!r.llqPiiMasked,
    groupCount: Math.max(1, Number(r.groupCount ?? 1) || 1),
    svcCounts,
  };
}

function normalizeSvcCounts(raw: unknown): Record<string, number> | undefined {
  let obj: Record<string, unknown> | null = null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
  }
  if (!obj) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    const svc = String(k ?? '').trim();
    const n = Number(v);
    if (!svc || !Number.isFinite(n) || n <= 0) continue;
    out[svc] = Math.floor(n);
  }
  return Object.keys(out).length ? out : undefined;
}

const EXPORT_ROW_LIMIT = 10000;

function buildListWhere(p: Params): SQL | undefined {
  const start = parseDayBound(p.startDate, false);
  const end = parseDayBound(p.endDate, true);
  const pnu = p.pnu != null ? String(p.pnu).trim() : '';
  const svcId = p.svcId != null ? String(p.svcId).trim() : '';
  const channel = p.channel != null ? String(p.channel).trim() : '';
  const appSys = p.appSys != null ? String(p.appSys).trim() : '';
  const status = p.status != null ? String(p.status).trim() : '';
  const userId = p.userId != null ? String(p.userId).trim() : '';
  const hasPiiRaw = p.hasPii != null ? String(p.hasPii).trim() : '';

  const conds: SQL[] = [];
  if (start) conds.push(gte(llq.llqAt, start.toISOString()));
  if (end) conds.push(lte(llq.llqAt, end.toISOString()));
  if (pnu) conds.push(eq(llq.llqPnu, pnu));
  if (svcId) conds.push(eq(llq.llqSvcId, svcId));
  if (appSys) conds.push(eq(llq.llqAppSys, appSys));
  if (channel === 'parcelAnalysis') {
    // 과거 landUse 채널 적재분 포함
    conds.push(
      or(eq(llq.llqChannel, 'parcelAnalysis'), eq(llq.llqChannel, 'landUse'))!
    );
  } else if (channel) {
    conds.push(eq(llq.llqChannel, channel));
  }
  // queried = 실제 호출(ok|empty), skip = 조회 안 함, fail = 실패
  if (status === 'queried' || status === 'ok' || status === 'empty') {
    conds.push(sql`${llq.llqStatus} in ('ok', 'empty')`);
  } else if (status === 'skip' || status === 'fail') {
    conds.push(eq(llq.llqStatus, status));
  } else if (status) {
    conds.push(eq(llq.llqStatus, status));
  }
  if (userId) conds.push(eq(llq.llqUser, userId));
  // plain | masked | none (legacy: true=개인정보 전체, false=해당 없음)
  if (hasPiiRaw === 'plain') {
    conds.push(and(sqlLlqSvcIsPii(), eq(llq.llqPiiMasked, false))!);
  } else if (hasPiiRaw === 'masked') {
    conds.push(and(sqlLlqSvcIsPii(), eq(llq.llqPiiMasked, true))!);
  } else if (hasPiiRaw === 'none' || hasPiiRaw === 'false' || hasPiiRaw === '0' || hasPiiRaw === 'N') {
    conds.push(sql`not (${sqlLlqSvcIsPii()})`);
  } else if (hasPiiRaw === 'true' || hasPiiRaw === '1' || hasPiiRaw === 'Y') {
    conds.push(sqlLlqSvcIsPii());
  }
  return conds.length ? and(...conds) : undefined;
}

/** 연계 조회 이력 목록 */
export async function listQueryLog(p: Params = {}) {
  await requireLoggedIn();
  const page = Math.max(1, Number(p.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(p.pageSize) || 20));
  const where = buildListWhere(p);
  /** 같은 묶음키는 목록 1줄. 키 없으면 행 단독 */
  const groupPart = sql`coalesce(${llq.llqGroupKey}, concat('id:', ${llq.llqKey}::text))`;

  try {
    const grouped = db
      .select({
        groupPart: sql<string>`${groupPart}`.as('group_part'),
        llqKey: sql<number>`(array_agg(${llq.llqKey} order by ${llq.llqAt} desc, ${llq.llqKey} desc))[1]`.as(
          'llq_key'
        ),
        llqGroupKey: sql<string | null>`max(${llq.llqGroupKey})`.as('llq_group_key'),
        llqAt: sql<string>`max(${llq.llqAt})`.as('llq_at'),
        llqUser: sql<string | null>`(array_agg(${llq.llqUser} order by ${llq.llqAt} desc, ${llq.llqKey} desc))[1]`.as(
          'llq_user'
        ),
        llqIp: sql<string | null>`(array_agg(${llq.llqIp} order by ${llq.llqAt} desc, ${llq.llqKey} desc))[1]`.as(
          'llq_ip'
        ),
        llqAppSys: sql<string | null>`(array_agg(${llq.llqAppSys} order by ${llq.llqAt} desc, ${llq.llqKey} desc))[1]`.as(
          'llq_app_sys'
        ),
        llqAppSysNm: sql<string | null>`(array_agg(${llq.llqAppSysNm} order by ${llq.llqAt} desc, ${llq.llqKey} desc))[1]`.as(
          'llq_app_sys_nm'
        ),
        llqChannel: sql<string | null>`(array_agg(${llq.llqChannel} order by ${llq.llqAt} desc, ${llq.llqKey} desc))[1]`.as(
          'llq_channel'
        ),
        llqSystem: sql<string | null>`(array_agg(${llq.llqSystem} order by ${llq.llqAt} desc, ${llq.llqKey} desc))[1]`.as(
          'llq_system'
        ),
        llqSvcId: sql<string | null>`(array_agg(${llq.llqSvcId} order by ${llq.llqAt} desc, ${llq.llqKey} desc))[1]`.as(
          'llq_svc_id'
        ),
        llqPnu: sql<string | null>`(array_agg(${llq.llqPnu} order by ${llq.llqAt} desc, ${llq.llqKey} desc))[1]`.as(
          'llq_pnu'
        ),
        llqSgg: sql<string | null>`(array_agg(${llq.llqSgg} order by ${llq.llqAt} desc, ${llq.llqKey} desc))[1]`.as(
          'llq_sgg'
        ),
        /** 목록용 집계: 실패 > 조회됨(ok|empty) > 조회 안 함(skip) */
        llqStatus: sql<string | null>`case
          when bool_or(${llq.llqStatus} = 'fail') then 'fail'
          when bool_or(${llq.llqStatus} in ('ok', 'empty')) then 'queried'
          else 'skip'
        end`.as('llq_status'),
        llqMs: sql<number | null>`max(${llq.llqMs})`.as('llq_ms'),
        llqHttp: sql<number | null>`(array_agg(${llq.llqHttp} order by ${llq.llqAt} desc, ${llq.llqKey} desc))[1]`.as(
          'llq_http'
        ),
        messageDistinct: sql<number>`count(distinct coalesce(${llq.llqMessage}, ''))::int`.as(
          'message_distinct'
        ),
        llqMessage: sql<string | null>`(array_agg(${llq.llqMessage} order by ${llq.llqAt} desc, ${llq.llqKey} desc))[1]`.as(
          'llq_message'
        ),
        llqHasPii: sql<boolean>`bool_or(${sqlLlqSvcIsPii()})`.as('llq_has_pii'),
        llqPiiViewedAt: sql<string | null>`max(${llq.llqPiiViewedAt})`.as('llq_pii_viewed_at'),
        llqPiiMasked: sql<boolean>`bool_or(${llq.llqPiiMasked})`.as('llq_pii_masked'),
        groupCount: sql<number>`count(*)::int`.as('group_count'),
        svcCounts: sql<Record<string, number>>`(
          select coalesce(jsonb_object_agg(x.svc, x.cnt), '{}'::jsonb)
          from (
            select svc_id as svc, count(*)::int as cnt
            from unnest(array_agg(${llq.llqSvcId})) as svc_id
            where svc_id is not null and btrim(svc_id) <> ''
            group by svc_id
          ) x
        )`.as('svc_counts'),
        usrName: sql<string | null>`(array_agg(${usr.usrName} order by ${llq.llqAt} desc, ${llq.llqKey} desc))[1]`.as(
          'usr_name'
        ),
        ugName: sql<string | null>`(array_agg(${usr.ugName} order by ${llq.llqAt} desc, ${llq.llqKey} desc))[1]`.as(
          'ug_name'
        ),
      })
      .from(llq)
      .leftJoin(usr, eq(llq.llqUser, usr.usrId))
      .where(where)
      .groupBy(groupPart)
      .as('llq_grouped');

    const [countRow] = await db.select({ c: sql<number>`count(*)::int` }).from(grouped);
    const total = Number(countRow?.c ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;

    const rows = await db
      .select()
      .from(grouped)
      .orderBy(desc(grouped.llqAt), desc(grouped.llqKey))
      .limit(pageSize)
      .offset(offset);

    return {
      rows: rows.map((r) =>
        mapRow({
          llqKey: Number(r.llqKey),
          llqGroupKey: r.llqGroupKey,
          llqAt: r.llqAt,
          llqUser: r.llqUser,
          usrName: r.usrName,
          ugName: r.ugName,
          llqIp: r.llqIp,
          llqAppSys: r.llqAppSys,
          llqAppSysNm: r.llqAppSysNm,
          llqChannel: r.llqChannel,
          llqSystem: r.llqSystem,
          llqSvcId: Number(r.groupCount) > 1 ? null : r.llqSvcId,
          llqPnu: r.llqPnu,
          llqSgg: r.llqSgg,
          llqStatus: r.llqStatus,
          llqMs: r.llqMs,
          llqHttp: r.llqHttp,
          llqMessage: Number(r.messageDistinct) > 1 ? null : r.llqMessage,
          llqHasPii: r.llqHasPii,
          llqPiiViewedAt: r.llqPiiViewedAt,
          llqPiiMasked: r.llqPiiMasked,
          groupCount: r.groupCount,
          svcCounts: r.svcCounts,
        })
      ),
      total,
      page,
      pageSize,
      totalPages,
    };
  } catch (e: unknown) {
    if (isMissingRelationError(e)) {
      return {
        rows: [] as LandLinkageQueryLogRow[],
        total: 0,
        page: 1,
        pageSize,
        totalPages: 1,
        message: '이력 테이블이 아직 없습니다. 스키마 적용 후 조회됩니다.',
      };
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** 묶음 키로 같은 화면 동작의 호출 목록 */
export async function listByGroupKey(p: Params = {}) {
  await requireLoggedIn();
  const groupKey = p.groupKey != null ? String(p.groupKey).trim() : '';
  if (!groupKey) {
    throw Object.assign(new Error('묶음 키가 필요합니다.'), { status: 400 });
  }

  try {
    const rows = await db
      .select({
        llqKey: llq.llqKey,
        llqGroupKey: llq.llqGroupKey,
        llqAt: llq.llqAt,
        llqUser: llq.llqUser,
        usrName: usr.usrName,
        ugName: usr.ugName,
        llqIp: llq.llqIp,
        llqAppSys: llq.llqAppSys,
        llqAppSysNm: llq.llqAppSysNm,
        llqChannel: llq.llqChannel,
        llqSystem: llq.llqSystem,
        llqSvcId: llq.llqSvcId,
        llqPnu: llq.llqPnu,
        llqSgg: llq.llqSgg,
        llqStatus: llq.llqStatus,
        llqMs: llq.llqMs,
        llqHttp: llq.llqHttp,
        llqMessage: llq.llqMessage,
        llqHasPii: llq.llqHasPii,
        llqPiiViewedAt: llq.llqPiiViewedAt,
        llqPiiMasked: llq.llqPiiMasked,
      })
      .from(llq)
      .leftJoin(usr, eq(llq.llqUser, usr.usrId))
      .where(eq(llq.llqGroupKey, groupKey))
      .orderBy(llq.llqAt, llq.llqKey);

    return { rows: rows.map(mapRow) };
  } catch (e: unknown) {
    if (isMissingRelationError(e)) {
      return {
        rows: [] as LandLinkageQueryLogRow[],
        message: '이력 테이블이 아직 없습니다.',
      };
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/**
 * 보고서용 상세 행 내보내기(묶음 해제).
 * 양식 확정 전 임시 — 현재 검색 조건, 최대 1만 건.
 */
export async function exportQueryLog(p: Params = {}) {
  await requireLoggedIn();
  const where = buildListWhere(p);
  const limit = EXPORT_ROW_LIMIT;

  try {
    const rows = await db
      .select({
        llqKey: llq.llqKey,
        llqGroupKey: llq.llqGroupKey,
        llqAt: llq.llqAt,
        llqUser: llq.llqUser,
        usrName: usr.usrName,
        ugName: usr.ugName,
        llqIp: llq.llqIp,
        llqAppSys: llq.llqAppSys,
        llqAppSysNm: llq.llqAppSysNm,
        llqChannel: llq.llqChannel,
        llqSystem: llq.llqSystem,
        llqSvcId: llq.llqSvcId,
        llqPnu: llq.llqPnu,
        llqSgg: llq.llqSgg,
        llqStatus: llq.llqStatus,
        llqMs: llq.llqMs,
        llqHttp: llq.llqHttp,
        llqMessage: llq.llqMessage,
        llqHasPii: llq.llqHasPii,
        llqPiiViewedAt: llq.llqPiiViewedAt,
        llqPiiMasked: llq.llqPiiMasked,
      })
      .from(llq)
      .leftJoin(usr, eq(llq.llqUser, usr.usrId))
      .where(where)
      .orderBy(desc(llq.llqAt), desc(llq.llqKey))
      .limit(limit + 1);

    const truncated = rows.length > limit;
    const sliced = truncated ? rows.slice(0, limit) : rows;
    return {
      rows: sliced.map(mapRow),
      limit,
      truncated,
      message: truncated
        ? `최대 ${limit.toLocaleString('ko-KR')}건까지 내려받습니다. 조건을 좁혀 다시 받아 주세요.`
        : undefined,
    };
  } catch (e: unknown) {
    if (isMissingRelationError(e)) {
      return {
        rows: [] as LandLinkageQueryLogRow[],
        limit,
        truncated: false,
        message: '이력 테이블이 아직 없습니다. 스키마 적용 후 내려받을 수 있습니다.',
      };
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/**
 * 행망 조회 이력 일괄 적재. 실패해도 호출측을 막지 않음.
 * 허용 목록 밖 서비스 ID는 건너뛴다.
 */
export async function appendQueryLogs(entries: QueryLogInsert[]): Promise<{ ok: boolean; inserted: number }> {
  const rows = (entries ?? []).filter(
    (e) => e?.svcId && isLlqAuditKrasSvcId(String(e.svcId).trim()) && /^\d{19}$/.test(String(e.pnu ?? '').trim())
  );
  if (!rows.length) return { ok: true, inserted: 0 };

  try {
    const userId = (await getSessionUsrId())?.trim() || null;
    const at = new Date().toISOString();
    // 실제 세션 마스킹(통합제어 ON 또는 KRAS 원문 회수)과 동일하게 스냅샷
    let piiMasked = false;
    try {
      piiMasked = await shouldMaskPersonInfoForSession();
    } catch {
      piiMasked = false;
    }
    const hintIp = rows.map((e) => e.clientIp).find((v) => String(v ?? '').trim()) ?? null;
    let clientIp: string | null = null;
    try {
      clientIp = (await resolveAuditClientIp(hintIp)) ?? null;
    } catch {
      clientIp = String(hintIp ?? '').trim() || null;
    }

    let reqApp: { key: string; name: string } | null = null;
    try {
      reqApp = await resolveAppSysFromRequest();
    } catch {
      reqApp = null;
    }

    const buildValues = (opts: { withIp: boolean; withAppSys: boolean }) =>
      rows.map((e) => {
        const svcId = String(e.svcId).trim();
        const hasPii = llqHasPiiForSvc(svcId);
        const appKey = String(e.appSys ?? reqApp?.key ?? '').trim() || null;
        const appNm = appKey
          ? resolveAppSysName(appKey, e.appSysNm ?? reqApp?.name)
          : null;
        return {
          llqGroupKey: e.groupKey?.trim() || null,
          llqAt: at,
          llqUser: userId,
          ...(opts.withIp ? { llqIp: clientIp } : {}),
          llqChannel: String(e.channel ?? '').trim() || null,
          llqSystem: e.system ?? llqSystemForSvc(svcId),
          ...(opts.withAppSys
            ? { llqAppSys: appKey, llqAppSysNm: appNm }
            : {}),
          llqSvcId: svcId,
          llqPnu: String(e.pnu).trim(),
          llqSgg: e.sgg?.trim() || null,
          llqStatus: e.status,
          llqMs: e.ms ?? null,
          llqHttp: e.http ?? null,
          llqMessage: e.message?.trim() || null,
          llqHasPii: hasPii,
          llqPiiViewedAt: hasPii ? at : null,
          llqPiiMasked: piiMasked,
        };
      });

    try {
      await db.insert(llq).values(buildValues({ withIp: true, withAppSys: true }));
    } catch (e: unknown) {
      if (isMissingLlqAppSysColumn(e)) {
        try {
          await db.insert(llq).values(buildValues({ withIp: true, withAppSys: false }));
        } catch (e2: unknown) {
          if (isMissingLlqIpColumn(e2)) {
            await db.insert(llq).values(buildValues({ withIp: false, withAppSys: false }));
          } else {
            throw e2;
          }
        }
      } else if (isMissingLlqIpColumn(e)) {
        try {
          await db.insert(llq).values(buildValues({ withIp: false, withAppSys: true }));
        } catch (e2: unknown) {
          if (isMissingLlqAppSysColumn(e2)) {
            await db.insert(llq).values(buildValues({ withIp: false, withAppSys: false }));
          } else {
            throw e2;
          }
        }
      } else {
        throw e;
      }
    }
    return { ok: true, inserted: rows.length };
  } catch (e: unknown) {
    if (isMissingRelationError(e)) {
      console.warn('[llq] land_linkage_query_log 테이블 없음 — 이력 적재 건너뜀');
      return { ok: false, inserted: 0 };
    }
    console.warn('[llq] appendQueryLogs', e instanceof Error ? e.message : e);
    return { ok: false, inserted: 0 };
  }
}

/** fire-and-forget 적재 — 요청 컨텍스트에서 IP·업무 시스템을 먼저 캡처 */
export function scheduleAppendQueryLogs(entries: QueryLogInsert[]): void {
  if (!entries?.length) return;
  const hintIp = entries.map((e) => e.clientIp).find((v) => String(v ?? '').trim()) ?? null;
  const ipPromise = resolveAuditClientIp(hintIp);
  const appSysPromise = resolveAppSysFromRequest();
  void (async () => {
    let clientIp: string | undefined;
    try {
      clientIp = await ipPromise;
    } catch {
      clientIp = String(hintIp ?? '').trim() || undefined;
    }
    let appSys: { key: string; name: string } | null = null;
    try {
      appSys = await appSysPromise;
    } catch {
      appSys = null;
    }
    const enriched = entries.map((e) => ({
      ...e,
      clientIp: e.clientIp ?? clientIp,
      appSys: e.appSys ?? appSys?.key ?? null,
      appSysNm: e.appSysNm ?? appSys?.name ?? null,
    }));
    await appendQueryLogs(enriched);
  })();
}
