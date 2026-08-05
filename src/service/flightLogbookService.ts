/**
 * 비행기록부(별지 제5호) API
 * — 저장 · 조회 · 목록 (촬영요청/작업단위 연결)
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/database/db';
import { flightLogbook } from '@/database/schema/flight_logbook';
import { shootingRequest } from '@/database/schema/shooting_request';
import { getSessionUsrId, userHasSerAccess } from '@/lib/auth/guard';

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

/** 작성·수정: 승인관리 쓰기 권한 · 해당 신청 본인 · 작업단위만 연결 시 로그인 사용자 */
async function requireWriter(srKey?: number | null, workUnitLabel?: string | null): Promise<string> {
  const usrId = await requireSession();
  const isApprover = await userHasSerAccess(usrId, APPROVAL_SER, 'write');
  if (isApprover) return usrId;

  if (srKey != null && Number.isFinite(srKey)) {
    const [row] = await db
      .select({ usrId: shootingRequest.usrId })
      .from(shootingRequest)
      .where(and(eq(shootingRequest.srKey, srKey), eq(shootingRequest.srIsDel, false)))
      .limit(1);
    if (row?.usrId === usrId) return usrId;
  }

  if (workUnitLabel && emptyToNull(workUnitLabel)) return usrId;

  throwHttp(403, '비행기록부 작성 권한이 없습니다.');
}

export type FlightLogbookValuesPayload = {
  dateFlightTime?: string;
  shootTargetPurpose?: string;
  aircraftModel?: string;
  pilotOrg?: string;
  pilotName?: string;
  gimbalOrg?: string;
  gimbalName?: string;
  flightArea?: string;
  permissionControl?: string;
  aircraftCondition?: string;
  cameraCondition?: string;
  safetyDone?: boolean;
  flightSummary?: string;
  securityDone?: boolean;
  securityDetail?: string;
  etc?: string;
};

function normalizeCondition(v: string | null | undefined): string | null {
  const t = emptyToNull(v);
  if (t === 'good' || t === 'inspect') return t;
  return null;
}

function valuesFromParams(params: FlightLogbookValuesPayload) {
  const securityDetail = emptyToNull(params.securityDetail);
  return {
    dateFlightTime: emptyToNull(params.dateFlightTime),
    shootTargetPurpose: emptyToNull(params.shootTargetPurpose),
    aircraftModel: emptyToNull(params.aircraftModel),
    pilotOrg: emptyToNull(params.pilotOrg),
    pilotName: emptyToNull(params.pilotName),
    gimbalOrg: emptyToNull(params.gimbalOrg),
    gimbalName: emptyToNull(params.gimbalName),
    flightArea: emptyToNull(params.flightArea),
    permissionControl: emptyToNull(params.permissionControl),
    aircraftCondition: normalizeCondition(params.aircraftCondition),
    cameraCondition: normalizeCondition(params.cameraCondition),
    safetyDone: params.safetyDone === true,
    flightSummary: emptyToNull(params.flightSummary),
    securityDetail,
    securityDone: params.securityDone === true || !!securityDetail,
    etc: emptyToNull(params.etc),
  };
}

function toClient(row: typeof flightLogbook.$inferSelect) {
  return {
    flKey: row.flKey,
    srKey: row.srKey,
    workUnitLabel: row.workUnitLabel,
    dateFlightTime: row.dateFlightTime ?? '',
    shootTargetPurpose: row.shootTargetPurpose ?? '',
    aircraftModel: row.aircraftModel ?? '',
    pilotOrg: row.pilotOrg ?? '',
    pilotName: row.pilotName ?? '',
    gimbalOrg: row.gimbalOrg ?? '',
    gimbalName: row.gimbalName ?? '',
    flightArea: row.flightArea ?? '',
    permissionControl: row.permissionControl ?? '',
    aircraftCondition: (row.aircraftCondition as 'good' | 'inspect' | '') || '',
    cameraCondition: (row.cameraCondition as 'good' | 'inspect' | '') || '',
    safetyDone: row.safetyDone === true,
    flightSummary: row.flightSummary ?? '',
    securityDone: row.securityDone === true,
    securityDetail: row.securityDetail ?? '',
    etc: row.etc ?? '',
    createdAt: row.flCreateDate,
    updatedAt: row.flUpdateDate,
  };
}

export type SaveParams = FlightLogbookValuesPayload & {
  flKey?: number;
  srKey?: number;
  workUnitLabel?: string;
};

/** 저장(신규 또는 수정). srKey가 있으면 해당 신청의 최신 건을 갱신 */
export async function save(params: SaveParams = {}) {
  const srKeyRaw = params.srKey != null ? Number(params.srKey) : null;
  const srKey = srKeyRaw != null && Number.isFinite(srKeyRaw) ? srKeyRaw : null;
  const workUnitLabel = emptyToNull(params.workUnitLabel);
  const operator = await requireWriter(srKey, workUnitLabel);
  const vals = valuesFromParams(params);
  const now = nowIso();

  const flKeyRaw = params.flKey != null ? Number(params.flKey) : null;
  let targetKey =
    flKeyRaw != null && Number.isFinite(flKeyRaw) ? flKeyRaw : null;

  if (targetKey == null && srKey != null) {
    const [latest] = await db
      .select({ flKey: flightLogbook.flKey })
      .from(flightLogbook)
      .where(and(eq(flightLogbook.srKey, srKey), eq(flightLogbook.flIsDel, false)))
      .orderBy(desc(flightLogbook.flUpdateDate), desc(flightLogbook.flKey))
      .limit(1);
    if (latest) targetKey = latest.flKey;
  }

  if (targetKey != null) {
    const [row] = await db
      .update(flightLogbook)
      .set({
        ...vals,
        ...(srKey != null ? { srKey } : {}),
        ...(workUnitLabel != null ? { workUnitLabel } : {}),
        flUpdateDate: now,
        flUpdateUser: operator,
      })
      .where(and(eq(flightLogbook.flKey, targetKey), eq(flightLogbook.flIsDel, false)))
      .returning();
    if (!row) throwHttp(404, '비행기록부를 찾을 수 없습니다.');
    return { item: toClient(row) };
  }

  if (srKey == null && !workUnitLabel) {
    throwHttp(400, '촬영요청 또는 작업단위가 필요합니다.');
  }

  const [row] = await db
    .insert(flightLogbook)
    .values({
      srKey,
      workUnitLabel,
      ...vals,
      flIsDel: false,
      flCreateDate: now,
      flCreateUser: operator,
      flUpdateDate: now,
      flUpdateUser: operator,
    })
    .returning();

  return { item: toClient(row) };
}

/** 단건 조회 */
export async function get(params: { flKey?: number } = {}) {
  await requireSession();
  const flKey = Number(params.flKey);
  if (!Number.isFinite(flKey)) throwHttp(400, 'flKey가 필요합니다.');

  const [row] = await db
    .select()
    .from(flightLogbook)
    .where(and(eq(flightLogbook.flKey, flKey), eq(flightLogbook.flIsDel, false)))
    .limit(1);
  if (!row) throwHttp(404, '비행기록부를 찾을 수 없습니다.');
  return { item: toClient(row) };
}

/** 촬영요청 기준 최신 1건 */
export async function getBySrKey(params: { srKey?: number } = {}) {
  await requireSession();
  const srKey = Number(params.srKey);
  if (!Number.isFinite(srKey)) throwHttp(400, 'srKey가 필요합니다.');

  const [row] = await db
    .select()
    .from(flightLogbook)
    .where(and(eq(flightLogbook.srKey, srKey), eq(flightLogbook.flIsDel, false)))
    .orderBy(desc(flightLogbook.flUpdateDate), desc(flightLogbook.flKey))
    .limit(1);

  return { item: row ? toClient(row) : null };
}

/** 목록 */
export async function list(
  params: { srKey?: number; workUnitLabel?: string; limit?: number; offset?: number } = {}
) {
  await requireSession();
  const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
  const offset = Math.max(Number(params.offset) || 0, 0);
  const srKey = params.srKey != null ? Number(params.srKey) : null;
  const workUnitLabel = emptyToNull(params.workUnitLabel);

  const conditions = [eq(flightLogbook.flIsDel, false)];
  if (srKey != null && Number.isFinite(srKey)) {
    conditions.push(eq(flightLogbook.srKey, srKey));
  }
  if (workUnitLabel) {
    conditions.push(eq(flightLogbook.workUnitLabel, workUnitLabel));
  }

  const where = and(...conditions);
  const rows = await db
    .select()
    .from(flightLogbook)
    .where(where)
    .orderBy(desc(flightLogbook.flUpdateDate), desc(flightLogbook.flKey))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(flightLogbook)
    .where(where);

  return { items: rows.map(toClient), total: count, limit, offset };
}
