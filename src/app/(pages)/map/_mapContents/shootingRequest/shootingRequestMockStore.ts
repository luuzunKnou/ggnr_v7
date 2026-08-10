/**
 * 촬영요청 클라이언트 스토어 — shootingRequestService API 연동
 * (파일명 유지: 기존 import 경로 호환. map-layout 등 호출부 시그니처 유지)
 */

import { call } from '@/lib/api';
import {
  canStartMediaRegister,
  normalizeShootType,
  type RequestStatus,
  type ShootingRequestDraft,
} from './shootingRequestMockData';

export const SHOOTING_REQUEST_NEW_ID = '__new__';

type Listener = () => void;
export type ShootingListSource = 'mine' | 'approval';

let items: ShootingRequestDraft[] = [];
let listSource: ShootingListSource = 'mine';
let summary = { pending: 0, approved: 0, rejected: 0 };
let loading = false;
let lastError: string | null = null;
/** 영상관리에 넘겨 둔 «지금 등록 중인» 신청 id */
let activeRegistrationRequestId: string | null = null;

const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function apiErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const o = err as { error?: unknown; message?: unknown };
    if (typeof o.error === 'string' && o.error.trim()) return o.error;
    if (typeof o.message === 'string' && o.message.trim()) return o.message;
  }
  return '요청 처리에 실패했습니다.';
}

function sliceDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

function mapDetail(row: Record<string, unknown>): ShootingRequestDraft {
  const status = String(row.status ?? 'pending') as RequestStatus;
  return {
    id: String(row.srKey),
    department: String(row.department ?? ''),
    applicantRankName: String(row.applicantRankName ?? ''),
    phone: String(row.phone ?? ''),
    manager: String(row.manager ?? ''),
    purpose: String(row.purpose ?? ''),
    address: String(row.address ?? ''),
    hasScope: Boolean(row.hasScope),
    scopeLabel: String(row.scopeLabel ?? ''),
    scopeWkt: row.scopeWkt != null ? String(row.scopeWkt) : undefined,
    shootDate: String(row.shootDate ?? ''),
    useDate: String(row.useDate ?? ''),
    shootType: normalizeShootType(row.shootType),
    detailRequest: String(row.detailRequest ?? ''),
    submittedAt: sliceDate((row.srCreateDate as string) ?? (row.submittedAt as string)),
    status,
    rejectReason: row.rejectReason != null ? String(row.rejectReason) : undefined,
    decidedAt: row.decidedAt ? sliceDate(String(row.decidedAt)) : undefined,
    linkedWorkUnitLabel:
      row.linkedWorkUnitLabel != null ? String(row.linkedWorkUnitLabel) : undefined,
    registeredAt: row.registeredAt ? sliceDate(String(row.registeredAt)) : undefined,
  };
}

function mapListItem(row: Record<string, unknown>): ShootingRequestDraft {
  return mapDetail({
    ...row,
    srCreateDate: row.submittedAt ?? row.srCreateDate,
    phone: row.phone ?? '',
    manager: row.manager ?? '',
    detailRequest: row.detailRequest ?? '',
    scopeWkt: row.scopeWkt,
  });
}

function upsertLocal(draft: ShootingRequestDraft) {
  const idx = items.findIndex((r) => r.id === draft.id);
  if (idx < 0) items = [draft, ...items];
  else items = [...items.slice(0, idx), draft, ...items.slice(idx + 1)];
}

function patchLocal(id: string, patch: Partial<ShootingRequestDraft>): ShootingRequestDraft | null {
  const idx = items.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const next = { ...items[idx], ...patch };
  items = [...items.slice(0, idx), next, ...items.slice(idx + 1)];
  return next;
}

async function srCall<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await call('', 'POST', {
    service: 'shootingRequestService',
    action,
    params,
  });
  if (!res?.success) throw res ?? new Error('요청 실패');
  return res.data as T;
}

export function getShootingRequests(): ShootingRequestDraft[] {
  return items;
}

export function getShootingListSource(): ShootingListSource {
  return listSource;
}

export function getShootingRequestSummary() {
  return summary;
}

export function isShootingRequestsLoading(): boolean {
  return loading;
}

export function getShootingRequestLastError(): string | null {
  return lastError;
}

export function subscribeShootingRequests(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function findShootingRequest(id: string): ShootingRequestDraft | null {
  return items.find((r) => r.id === id) ?? null;
}

export function getActiveRegistrationRequestId(): string | null {
  return activeRegistrationRequestId;
}

export function getActiveRegistrationRequest(): ShootingRequestDraft | null {
  if (!activeRegistrationRequestId) return null;
  return findShootingRequest(activeRegistrationRequestId);
}

export function clearActiveRegistrationRequest(): void {
  if (activeRegistrationRequestId == null) return;
  activeRegistrationRequestId = null;
  emit();
}

export function setActiveRegistrationRequest(id: string | null): void {
  activeRegistrationRequestId = id;
  emit();
}

/** 목록 소스(내 신청 / 승인관리)에 맞춰 서버에서 다시 불러온다 */
export async function refreshShootingRequests(
  mode: ShootingListSource = listSource,
  opts?: { keyword?: string; status?: string | string[] }
): Promise<void> {
  listSource = mode;
  loading = true;
  lastError = null;
  emit();
  try {
    const action = mode === 'approval' ? 'listAdmin' : 'listMine';
    const params: Record<string, unknown> = { limit: 200, offset: 0 };
    if (opts?.keyword?.trim()) params.keyword = opts.keyword.trim();
    if (opts?.status != null) params.status = opts.status;

    const data = await srCall<{
      items: Record<string, unknown>[];
      summary?: { pending: number; approved: number; rejected: number };
    }>(action, params);

    // 목록 API에는 scopeWkt 등 상세 필드가 없음 → 이미 불러둔 상세는 유지
    const prevById = new Map(items.map((r) => [r.id, r]));
    items = (data.items ?? []).map(mapListItem).map((row) => {
      const prev = prevById.get(row.id);
      if (!prev) return row;
      return {
        ...row,
        scopeWkt: row.scopeWkt || prev.scopeWkt,
        phone: row.phone || prev.phone,
        manager: row.manager || prev.manager,
        detailRequest: row.detailRequest || prev.detailRequest,
      };
    });
    if (data.summary) {
      summary = data.summary;
    } else {
      summary = {
        pending: items.filter((r) => r.status === 'pending').length,
        approved: items.filter((r) => canStartMediaRegister(r.status)).length,
        rejected: items.filter((r) => r.status === 'rejected').length,
      };
    }
  } catch (err) {
    lastError = apiErrorMessage(err);
    items = [];
    summary = { pending: 0, approved: 0, rejected: 0 };
    throw err;
  } finally {
    loading = false;
    emit();
  }
}

/** 상세 필드(범위 WKT 등) 보강 */
export async function loadShootingRequestDetail(id: string): Promise<ShootingRequestDraft | null> {
  if (!id || id === SHOOTING_REQUEST_NEW_ID) return null;
  const srKey = Number(id);
  if (!Number.isFinite(srKey)) return null;
  try {
    const data = await srCall<{ detail: Record<string, unknown> }>('get', { srKey });
    const draft = mapDetail(data.detail);
    upsertLocal(draft);
    emit();
    return draft;
  } catch (err) {
    lastError = apiErrorMessage(err);
    emit();
    throw err;
  }
}

export async function addShootingRequest(
  draft: Omit<
    ShootingRequestDraft,
    'id' | 'submittedAt' | 'status' | 'rejectReason' | 'decidedAt' | 'linkedWorkUnitLabel' | 'registeredAt'
  >
): Promise<ShootingRequestDraft> {
  lastError = null;
  try {
    const data = await srCall<{ detail: Record<string, unknown> }>('create', {
      department: draft.department,
      applicantRankName: draft.applicantRankName,
      phone: draft.phone,
      manager: draft.manager,
      purpose: draft.purpose,
      address: draft.address,
      hasScope: draft.hasScope,
      scopeLabel: draft.scopeLabel,
      scopeWkt: draft.scopeWkt,
      shootDate: draft.shootDate,
      useDate: draft.useDate,
      shootType: draft.shootType,
      detailRequest: draft.detailRequest,
    });
    const row = mapDetail(data.detail);
    upsertLocal(row);
    emit();
    // 목록 정합
    void refreshShootingRequests(listSource).catch(() => undefined);
    return row;
  } catch (err) {
    lastError = apiErrorMessage(err);
    emit();
    throw new Error(lastError);
  }
}

/** 승인·반려 */
export async function decideShootingRequest(
  id: string,
  status: Extract<RequestStatus, 'approved' | 'rejected'>,
  rejectReason?: string
): Promise<ShootingRequestDraft | null> {
  const srKey = Number(id);
  if (!Number.isFinite(srKey)) return null;
  lastError = null;
  try {
    const action = status === 'approved' ? 'approve' : 'reject';
    const data = await srCall<{ detail: Record<string, unknown> }>(action, {
      srKey,
      ...(status === 'rejected' ? { rejectReason } : {}),
    });
    const row = mapDetail(data.detail);
    upsertLocal(row);
    emit();
    void refreshShootingRequests(listSource).catch(() => undefined);
    return row;
  } catch (err) {
    lastError = apiErrorMessage(err);
    emit();
    throw new Error(lastError);
  }
}

/** 승인 취소 — 승인·등록중 → 대기 */
export async function cancelShootingApproval(id: string): Promise<ShootingRequestDraft | null> {
  const srKey = Number(id);
  if (!Number.isFinite(srKey)) return null;
  lastError = null;
  try {
    const data = await srCall<{ detail: Record<string, unknown> }>('cancelApproval', { srKey });
    const row = mapDetail(data.detail);
    upsertLocal(row);
    emit();
    void refreshShootingRequests(listSource).catch(() => undefined);
    return row;
  } catch (err) {
    lastError = apiErrorMessage(err);
    emit();
    throw new Error(lastError);
  }
}

/**
 * 자료 등록 시작 — 로컬 즉시 반영 + 서버 startRegister (map-layout 동기 시그니처 유지)
 */
export function beginMediaRegistration(
  id: string,
  linkedWorkUnitLabel?: string
): ShootingRequestDraft | null {
  const prev = findShootingRequest(id);
  if (!prev || !canStartMediaRegister(prev.status)) return null;

  const label = linkedWorkUnitLabel?.trim() || undefined;
  let next = prev;
  if (prev.status === 'approved' || label) {
    next =
      patchLocal(id, {
        ...(prev.status === 'approved' ? { status: 'registering' as const } : {}),
        ...(label ? { linkedWorkUnitLabel: label } : {}),
      }) ?? prev;
  }
  activeRegistrationRequestId = id;
  emit();

  const srKey = Number(id);
  if (Number.isFinite(srKey)) {
    void srCall<{ detail?: Record<string, unknown> }>('startRegister', {
      srKey,
      ...(label ? { linkedWorkUnitLabel: label } : {}),
    })
      .then((data) => {
        if (data?.detail) {
          upsertLocal(mapDetail(data.detail));
          emit();
        }
      })
      .catch((err) => {
        lastError = apiErrorMessage(err);
        emit();
      });
  }
  return next;
}

/** 폴더 업로드 완료 → 등록완료 (동기 시그니처 유지) */
export function completeMediaRegistration(
  id: string,
  workUnitLabel: string
): ShootingRequestDraft | null {
  const prev = findShootingRequest(id);
  if (!prev || !canStartMediaRegister(prev.status)) return null;

  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const next =
    patchLocal(id, {
      status: 'registered',
      linkedWorkUnitLabel: workUnitLabel,
      registeredAt: ymd,
    }) ?? prev;
  activeRegistrationRequestId = id;
  emit();

  const srKey = Number(id);
  if (Number.isFinite(srKey)) {
    void srCall<{ detail?: Record<string, unknown> }>('completeRegister', {
      srKey,
      linkedWorkUnitLabel: workUnitLabel,
    })
      .then((data) => {
        if (data?.detail) {
          upsertLocal(mapDetail(data.detail));
          emit();
        }
      })
      .catch((err) => {
        lastError = apiErrorMessage(err);
        emit();
      });
  }
  return next;
}

export function countByStatus(status?: RequestStatus): number {
  if (!status) return items.length;
  if (status === 'approved') return summary.approved || items.filter((r) => canStartMediaRegister(r.status)).length;
  if (status === 'pending') return summary.pending || items.filter((r) => r.status === 'pending').length;
  if (status === 'rejected') return summary.rejected || items.filter((r) => r.status === 'rejected').length;
  return items.filter((r) => r.status === status).length;
}
