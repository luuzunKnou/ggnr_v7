/**
 * 촬영요청(무인비행장치 촬영신청) API
 * — 신청 제출 · 내 목록 · 승인관리(목록·승인·반려)
 */
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/database/db';
import {
  SR_SHOOT_TYPES,
  SR_STATUS_APPROVED,
  SR_STATUS_PENDING,
  SR_STATUS_REGISTERED,
  SR_STATUS_REGISTERING,
  SR_STATUS_REJECTED,
  shootingRequest,
  type SrShootType,
} from '@/database/schema/shooting_request';
import { getSessionUsrId, userHasSerAccess } from '@/lib/auth/guard';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const APPROVAL_SER = 'shootingApproval';

function emptyToNull(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

function nowIso(): string {
  return new Date().toISOString();
}

function throwHttp(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

async function requireSession(): Promise<string> {
  const usrId = await getSessionUsrId();
  if (!usrId) throwHttp(401, '로그인이 필요합니다.');
  return usrId;
}

/** 승인관리(목록·승인·반려·자료등록 상태) */
async function requireApprover(): Promise<string> {
  const usrId = await requireSession();
  const ok = await userHasSerAccess(usrId, APPROVAL_SER, 'write');
  if (!ok) throwHttp(403, '승인관리 권한이 없습니다.');
  return usrId;
}

function isShootType(v: string): v is SrShootType {
  return (SR_SHOOT_TYPES as readonly string[]).includes(v);
}

export type ShootingRequestRow = typeof shootingRequest.$inferSelect;

export type ShootingRequestListItem = {
  srKey: number;
  department: string;
  applicantRankName: string;
  purpose: string;
  address: string | null;
  shootType: string;
  shootDate: string | null;
  useDate: string | null;
  status: string;
  rejectReason: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  hasScope: boolean;
  scopeLabel: string | null;
};

function toListItem(row: ShootingRequestRow): ShootingRequestListItem {
  return {
    srKey: row.srKey,
    department: row.department,
    applicantRankName: row.applicantRankName,
    purpose: row.purpose,
    address: row.address,
    shootType: row.shootType,
    shootDate: row.shootDate,
    useDate: row.useDate,
    status: row.status,
    rejectReason: row.rejectReason,
    submittedAt: row.srCreateDate,
    decidedAt: row.decidedAt,
    hasScope: row.hasScope,
    scopeLabel: row.scopeLabel,
  };
}

export type CreateParams = {
  department?: string;
  applicantRankName?: string;
  phone?: string;
  manager?: string;
  purpose?: string;
  address?: string;
  hasScope?: boolean;
  scopeLabel?: string;
  scopeWkt?: string;
  shootDate?: string;
  useDate?: string;
  shootType?: string;
  detailRequest?: string;
};

/** 신청 제출 → 대기 */
export async function create(params: CreateParams = {}) {
  const usrId = await requireSession();
  const department = emptyToNull(params.department);
  const applicantRankName = emptyToNull(params.applicantRankName);
  const purpose = emptyToNull(params.purpose);
  const shootTypeRaw = emptyToNull(params.shootType);
  const scopeWkt = emptyToNull(params.scopeWkt);
  const hasScope = params.hasScope === true || !!scopeWkt;

  if (!department) throwHttp(400, '부서명을 입력하세요.');
  if (!applicantRankName) throwHttp(400, '신청자(직급/성명)를 입력하세요.');
  if (!purpose) throwHttp(400, '신청목적을 입력하세요.');
  if (!shootTypeRaw || !isShootType(shootTypeRaw)) throwHttp(400, '촬영형태를 선택하세요.');
  if (!hasScope || !scopeWkt) throwHttp(400, '촬영 범위를 지도에서 지정하세요.');

  const now = nowIso();
  const [row] = await db
    .insert(shootingRequest)
    .values({
      usrId,
      department,
      applicantRankName,
      phone: emptyToNull(params.phone),
      manager: emptyToNull(params.manager),
      purpose,
      address: emptyToNull(params.address),
      hasScope: true,
      scopeLabel: emptyToNull(params.scopeLabel) ?? '범위 지정됨',
      scopeWkt,
      shootDate: emptyToNull(params.shootDate),
      useDate: emptyToNull(params.useDate),
      shootType: shootTypeRaw,
      detailRequest: emptyToNull(params.detailRequest),
      status: SR_STATUS_PENDING,
      srIsDel: false,
      srCreateDate: now,
      srCreateUser: usrId,
      srUpdateDate: now,
      srUpdateUser: usrId,
    })
    .returning();

  return { item: toListItem(row), detail: row };
}

export type ListParams = {
  limit?: number;
  offset?: number;
  /** 목적·지번·부서 검색 */
  keyword?: string;
  status?: string | string[];
  purpose?: string;
  address?: string;
  department?: string;
};

function normalizeStatuses(status: ListParams['status']): string[] | null {
  if (status == null) return null;
  const arr = Array.isArray(status) ? status : [status];
  const cleaned = arr.map((s) => String(s).trim()).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

function clampLimit(n: unknown): number {
  let limit = typeof n === 'number' && n > 0 ? n : DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  return limit;
}

/** 내 촬영요청 목록 */
export async function listMine(params: ListParams = {}) {
  const usrId = await requireSession();
  const limit = clampLimit(params.limit);
  const offset = typeof params.offset === 'number' && params.offset >= 0 ? params.offset : 0;
  const keyword = emptyToNull(params.keyword);
  const statuses = normalizeStatuses(params.status);

  const conditions = [eq(shootingRequest.srIsDel, false), eq(shootingRequest.usrId, usrId)];

  if (statuses) conditions.push(inArray(shootingRequest.status, statuses));
  const purpose = emptyToNull(params.purpose);
  const address = emptyToNull(params.address);
  const department = emptyToNull(params.department);
  if (purpose) conditions.push(ilike(shootingRequest.purpose, `%${purpose}%`));
  if (address) conditions.push(ilike(shootingRequest.address, `%${address}%`));
  if (department) conditions.push(ilike(shootingRequest.department, `%${department}%`));
  if (keyword) {
    conditions.push(
      or(
        ilike(shootingRequest.purpose, `%${keyword}%`),
        ilike(shootingRequest.address, `%${keyword}%`),
        ilike(shootingRequest.department, `%${keyword}%`)
      )!
    );
  }

  const where = and(...conditions);
  const rows = await db
    .select()
    .from(shootingRequest)
    .where(where)
    .orderBy(desc(shootingRequest.srCreateDate), desc(shootingRequest.srKey))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shootingRequest)
    .where(where);

  return { items: rows.map(toListItem), total: count, limit, offset };
}

/** 승인관리 목록 (전체 신청) */
export async function listAdmin(params: ListParams = {}) {
  await requireApprover();
  const limit = clampLimit(params.limit);
  const offset = typeof params.offset === 'number' && params.offset >= 0 ? params.offset : 0;
  const keyword = emptyToNull(params.keyword);
  const statuses = normalizeStatuses(params.status);

  const conditions = [eq(shootingRequest.srIsDel, false)];
  if (statuses) conditions.push(inArray(shootingRequest.status, statuses));
  if (keyword) {
    conditions.push(
      or(
        ilike(shootingRequest.purpose, `%${keyword}%`),
        ilike(shootingRequest.address, `%${keyword}%`),
        ilike(shootingRequest.department, `%${keyword}%`),
        ilike(shootingRequest.applicantRankName, `%${keyword}%`)
      )!
    );
  }

  const where = and(...conditions);
  const rows = await db
    .select()
    .from(shootingRequest)
    .where(where)
    .orderBy(desc(shootingRequest.srCreateDate), desc(shootingRequest.srKey))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shootingRequest)
    .where(where);

  const [{ pending }, { approved }, { rejected }] = await Promise.all([
    db
      .select({ pending: sql<number>`count(*)::int` })
      .from(shootingRequest)
      .where(and(eq(shootingRequest.srIsDel, false), eq(shootingRequest.status, SR_STATUS_PENDING)))
      .then((r) => r[0]),
    db
      .select({ approved: sql<number>`count(*)::int` })
      .from(shootingRequest)
      .where(
        and(
          eq(shootingRequest.srIsDel, false),
          inArray(shootingRequest.status, [
            SR_STATUS_APPROVED,
            SR_STATUS_REGISTERING,
            SR_STATUS_REGISTERED,
          ])
        )
      )
      .then((r) => r[0]),
    db
      .select({ rejected: sql<number>`count(*)::int` })
      .from(shootingRequest)
      .where(and(eq(shootingRequest.srIsDel, false), eq(shootingRequest.status, SR_STATUS_REJECTED)))
      .then((r) => r[0]),
  ]);

  return {
    items: rows.map(toListItem),
    total: count,
    limit,
    offset,
    summary: { pending, approved, rejected },
  };
}

/** 상세 (본인 또는 승인자) */
export async function get(params: { srKey?: number } = {}) {
  const usrId = await requireSession();
  const srKey = Number(params.srKey);
  if (!Number.isFinite(srKey)) throwHttp(400, 'srKey가 필요합니다.');

  const [row] = await db
    .select()
    .from(shootingRequest)
    .where(and(eq(shootingRequest.srKey, srKey), eq(shootingRequest.srIsDel, false)))
    .limit(1);
  if (!row) throwHttp(404, '신청을 찾을 수 없습니다.');

  if (row.usrId !== usrId) {
    const ok = await userHasSerAccess(usrId, APPROVAL_SER, 'read');
    if (!ok) throwHttp(403, '조회 권한이 없습니다.');
  }

  return { item: toListItem(row), detail: row };
}

/** 대기 → 승인 */
export async function approve(params: { srKey?: number } = {}) {
  const operator = await requireApprover();
  const srKey = Number(params.srKey);
  if (!Number.isFinite(srKey)) throwHttp(400, 'srKey가 필요합니다.');

  const now = nowIso();
  const [row] = await db
    .update(shootingRequest)
    .set({
      status: SR_STATUS_APPROVED,
      decidedAt: now,
      decidedBy: operator,
      rejectReason: null,
      srUpdateDate: now,
      srUpdateUser: operator,
    })
    .where(
      and(
        eq(shootingRequest.srKey, srKey),
        eq(shootingRequest.srIsDel, false),
        eq(shootingRequest.status, SR_STATUS_PENDING)
      )
    )
    .returning();

  if (!row) throwHttp(400, '대기 상태의 신청만 승인할 수 있습니다.');
  return { item: toListItem(row), detail: row };
}

/** 대기 → 반려 (사유 필수) */
export async function reject(params: { srKey?: number; rejectReason?: string } = {}) {
  const operator = await requireApprover();
  const srKey = Number(params.srKey);
  const reason = emptyToNull(params.rejectReason);
  if (!Number.isFinite(srKey)) throwHttp(400, 'srKey가 필요합니다.');
  if (!reason) throwHttp(400, '반려 사유를 입력하세요.');

  const now = nowIso();
  const [row] = await db
    .update(shootingRequest)
    .set({
      status: SR_STATUS_REJECTED,
      rejectReason: reason,
      decidedAt: now,
      decidedBy: operator,
      srUpdateDate: now,
      srUpdateUser: operator,
    })
    .where(
      and(
        eq(shootingRequest.srKey, srKey),
        eq(shootingRequest.srIsDel, false),
        eq(shootingRequest.status, SR_STATUS_PENDING)
      )
    )
    .returning();

  if (!row) throwHttp(400, '대기 상태의 신청만 반려할 수 있습니다.');
  return { item: toListItem(row), detail: row };
}

/** 승인 계열 → 등록중 (자료 등록 시작, 후속 UI 연동용) */
export async function startRegister(params: { srKey?: number; linkedWorkUnitLabel?: string } = {}) {
  const operator = await requireApprover();
  const srKey = Number(params.srKey);
  if (!Number.isFinite(srKey)) throwHttp(400, 'srKey가 필요합니다.');

  const now = nowIso();
  const [row] = await db
    .update(shootingRequest)
    .set({
      status: SR_STATUS_REGISTERING,
      linkedWorkUnitLabel: emptyToNull(params.linkedWorkUnitLabel),
      srUpdateDate: now,
      srUpdateUser: operator,
    })
    .where(
      and(
        eq(shootingRequest.srKey, srKey),
        eq(shootingRequest.srIsDel, false),
        inArray(shootingRequest.status, [SR_STATUS_APPROVED, SR_STATUS_REGISTERING])
      )
    )
    .returning();

  if (!row) throwHttp(400, '승인된 신청만 자료 등록을 시작할 수 있습니다.');
  return { item: toListItem(row), detail: row };
}

/** 등록중 → 등록완료 */
export async function completeRegister(params: { srKey?: number; linkedWorkUnitLabel?: string } = {}) {
  const operator = await requireApprover();
  const srKey = Number(params.srKey);
  if (!Number.isFinite(srKey)) throwHttp(400, 'srKey가 필요합니다.');

  const label = emptyToNull(params.linkedWorkUnitLabel);
  const now = nowIso();
  const [row] = await db
    .update(shootingRequest)
    .set({
      status: SR_STATUS_REGISTERED,
      registeredAt: now,
      ...(label ? { linkedWorkUnitLabel: label } : {}),
      srUpdateDate: now,
      srUpdateUser: operator,
    })
    .where(
      and(
        eq(shootingRequest.srKey, srKey),
        eq(shootingRequest.srIsDel, false),
        inArray(shootingRequest.status, [
          SR_STATUS_APPROVED,
          SR_STATUS_REGISTERING,
          SR_STATUS_REGISTERED,
        ])
      )
    )
    .returning();

  if (!row) throwHttp(400, '승인 계열 신청만 등록완료 처리할 수 있습니다.');
  return { item: toListItem(row), detail: row };
}

/** 승인·등록중 → 대기 (등록완료는 취소 불가) */
export async function cancelApproval(params: { srKey?: number } = {}) {
  const operator = await requireApprover();
  const srKey = Number(params.srKey);
  if (!Number.isFinite(srKey)) throwHttp(400, 'srKey가 필요합니다.');

  const now = nowIso();
  const [row] = await db
    .update(shootingRequest)
    .set({
      status: SR_STATUS_PENDING,
      decidedAt: null,
      decidedBy: null,
      rejectReason: null,
      linkedWorkUnitLabel: null,
      registeredAt: null,
      srUpdateDate: now,
      srUpdateUser: operator,
    })
    .where(
      and(
        eq(shootingRequest.srKey, srKey),
        eq(shootingRequest.srIsDel, false),
        inArray(shootingRequest.status, [SR_STATUS_APPROVED, SR_STATUS_REGISTERING])
      )
    )
    .returning();

  if (!row) throwHttp(400, '승인 또는 등록중 신청만 취소할 수 있습니다.');
  return { item: toListItem(row), detail: row };
}
