'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { cn } from '@/lib/utils';
import { ShootingRequestForm } from './ShootingRequestForm';
import { REQUEST_STATUS_LABEL, canStartMediaRegister } from './shootingRequestMockData';
import {
  addShootingRequest,
  findShootingRequest,
  getShootingRequests,
  loadShootingRequestDetail,
  SHOOTING_REQUEST_NEW_ID,
  subscribeShootingRequests,
} from './shootingRequestMockStore';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * `__new__` 또는 미지정 → 신규 작성
   * 기존 id → 신청서 조회(읽기 전용 모달)
   */
  detailId?: string | null;
  /** 신청 접수 후 생성된 id */
  onCreated?: (newId: string) => void;
};

/** 촬영요청 신청서 — 신규 작성·내 정보 조회 공용 모달 */
export function ShootingRequestFormModal({
  open,
  onOpenChange,
  detailId = SHOOTING_REQUEST_NEW_ID,
  onCreated,
}: Props) {
  useSyncExternalStore(subscribeShootingRequests, getShootingRequests, getShootingRequests);

  const isNew = !detailId || detailId === SHOOTING_REQUEST_NEW_ID;
  const existing = isNew ? null : findShootingRequest(detailId);

  useEffect(() => {
    if (!open || isNew || !detailId) return;
    void loadShootingRequestDetail(detailId).catch(() => undefined);
  }, [open, isNew, detailId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(62vh,500px)] w-[min(100vw-2rem,46rem)] max-w-none flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{isNew ? '촬영요청 신청서' : '촬영요청 신청서 조회'}</DialogTitle>
        </DialogHeader>

        {!isNew && existing ? (
          <div
            className={cn(
              'shrink-0 border-b px-3 py-2.5',
              existing.status === 'rejected'
                ? 'border-rose-200 bg-rose-50'
                : canStartMediaRegister(existing.status)
                  ? 'border-emerald-100 bg-emerald-50/80'
                  : 'border-slate-100 bg-slate-50/80'
            )}
          >
            <div className="flex flex-wrap items-center gap-2 text-[10px]">
              <span className="font-medium text-slate-600">처리 상태</span>
              <span
                className={cn(
                  'rounded-full bg-white px-2 py-0.5 font-medium ring-1',
                  existing.status === 'approved' || existing.status === 'registering'
                    ? 'text-emerald-700 ring-emerald-200'
                    : existing.status === 'registered'
                      ? 'text-slate-700 ring-slate-300'
                      : existing.status === 'rejected'
                        ? 'text-rose-700 ring-rose-200'
                        : 'text-amber-800 ring-amber-200'
                )}
              >
                {REQUEST_STATUS_LABEL[existing.status]}
              </span>
              {existing.decidedAt ? (
                <span className="text-slate-500">처리일 {existing.decidedAt}</span>
              ) : null}
            </div>
            {existing.status === 'rejected' ? (
              <div className="mt-2 rounded-md border border-rose-200 bg-white px-2.5 py-2">
                <p className="text-[10px] font-semibold text-rose-800">반려 사유</p>
                <p className="mt-1 text-[11px] leading-relaxed text-rose-900">
                  {existing.rejectReason?.trim() || '사유가 등록되지 않았습니다.'}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {!isNew && !existing ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-xs text-slate-400">신청을 찾을 수 없습니다.</p>
            <button
              type="button"
              className="text-[11px] text-sky-700 underline"
              onClick={() => onOpenChange(false)}
            >
              닫기
            </button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <ShootingRequestForm
              key={isNew ? 'new' : existing!.id}
              initial={isNew ? null : existing}
              readOnly={!isNew}
              closeLabel="닫기"
              onClose={() => onOpenChange(false)}
              onSubmit={
                isNew
                  ? async (draft) => {
                      const row = await addShootingRequest(draft);
                      onCreated?.(row.id);
                    }
                  : undefined
              }
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
