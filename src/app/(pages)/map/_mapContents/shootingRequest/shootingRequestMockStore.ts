/** 촬영요청 목업 목록 — 목록·상세 패널이 공유 (서버 없음) */

import {
  MOCK_MY_REQUESTS,
  canStartMediaRegister,
  type RequestStatus,
  type ShootingRequestDraft,
} from './shootingRequestMockData';

export const SHOOTING_REQUEST_NEW_ID = '__new__';

type Listener = () => void;

let items: ShootingRequestDraft[] = [...MOCK_MY_REQUESTS];
/** 영상관리에 넘겨 둔 «지금 등록 중인» 신청 id */
let activeRegistrationRequestId: string | null = null;

const listeners = new Set<Listener>();

function todayIso(): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function emit() {
  for (const l of listeners) l();
}

export function getShootingRequests(): ShootingRequestDraft[] {
  return items;
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

export function addShootingRequest(
  draft: Omit<
    ShootingRequestDraft,
    'id' | 'submittedAt' | 'status' | 'rejectReason' | 'decidedAt' | 'linkedWorkUnitLabel' | 'registeredAt'
  >
): ShootingRequestDraft {
  const row: ShootingRequestDraft = {
    ...draft,
    id: `req-${Date.now()}`,
    submittedAt: todayIso(),
    status: 'pending',
  };
  items = [row, ...items];
  emit();
  return row;
}

/** 승인·거부 처리 (목업) */
export function decideShootingRequest(
  id: string,
  status: Extract<RequestStatus, 'approved' | 'rejected'>,
  rejectReason?: string
): ShootingRequestDraft | null {
  const idx = items.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const prev = items[idx];
  if (prev.status !== 'pending') return prev;

  const next: ShootingRequestDraft = {
    ...prev,
    status,
    decidedAt: todayIso(),
    rejectReason: status === 'rejected' ? (rejectReason?.trim() || '사유 미입력') : undefined,
  };
  items = [...items.slice(0, idx), next, ...items.slice(idx + 1)];
  emit();
  return next;
}

/** 승인 취소 — 승인·등록중 → 대기 (목업) */
export function cancelShootingApproval(id: string): ShootingRequestDraft | null {
  const idx = items.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const prev = items[idx];
  if (prev.status !== 'approved' && prev.status !== 'registering') return prev;

  const next: ShootingRequestDraft = {
    ...prev,
    status: 'pending',
    decidedAt: undefined,
    rejectReason: undefined,
    linkedWorkUnitLabel: undefined,
    registeredAt: undefined,
  };
  items = [...items.slice(0, idx), next, ...items.slice(idx + 1)];
  if (activeRegistrationRequestId === id) activeRegistrationRequestId = null;
  emit();
  return next;
}

/**
 * 자료 등록 시작 — 승인 → 등록중, 활성 신청으로 지정.
 * 이미 등록중·등록완료면 활성만 맞춘다.
 */
export function beginMediaRegistration(id: string): ShootingRequestDraft | null {
  const idx = items.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const prev = items[idx];
  if (!canStartMediaRegister(prev.status)) return null;

  let next = prev;
  if (prev.status === 'approved') {
    next = { ...prev, status: 'registering' };
    items = [...items.slice(0, idx), next, ...items.slice(idx + 1)];
  }
  activeRegistrationRequestId = id;
  emit();
  return next;
}

/** 폴더 업로드 목업 완료 → 등록완료 + 작업단위 라벨 */
export function completeMediaRegistration(
  id: string,
  workUnitLabel: string
): ShootingRequestDraft | null {
  const idx = items.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const prev = items[idx];
  if (!canStartMediaRegister(prev.status)) return null;

  const next: ShootingRequestDraft = {
    ...prev,
    status: 'registered',
    linkedWorkUnitLabel: workUnitLabel,
    registeredAt: todayIso(),
  };
  items = [...items.slice(0, idx), next, ...items.slice(idx + 1)];
  activeRegistrationRequestId = id;
  emit();
  return next;
}

export function countByStatus(status?: RequestStatus): number {
  if (!status) return items.length;
  if (status === 'approved') {
    return items.filter((r) => canStartMediaRegister(r.status)).length;
  }
  return items.filter((r) => r.status === status).length;
}
