'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { FlightLogbookForm } from '../aerialView/FlightLogbookForm';
import {
  FolderBatchUploadDialog,
  type FolderCreatedInfo,
} from '../aerialView/FolderBatchUploadDialog';
import { WorkUnitMediaUploadDialog } from '../aerialView/WorkUnitMediaUploadDialog';
import {
  applyWorkUnitMediaFiles,
  replaceOrthoUnitsFromServer,
} from '../aerialView/aerialMediaMockData';
import { setUploadCompleteNotice } from '../aerialView/aerialUploadProgressStore';
import { subscribeAerialMediaUploadComplete } from '../aerialView/aerialMediaUploadRunner';
import { ShootingRequestForm } from './ShootingRequestForm';
import { REQUEST_STATUS_LABEL, canStartMediaRegister } from './shootingRequestMockData';
import {
  addShootingRequest,
  beginMediaRegistration,
  cancelShootingApproval,
  completeMediaRegistration,
  decideShootingRequest,
  findShootingRequest,
  getShootingRequests,
  loadShootingRequestDetail,
  SHOOTING_REQUEST_NEW_ID,
  subscribeShootingRequests,
} from './shootingRequestMockStore';
import { shootTypeToAerialKind } from './shootTypeToAerialKind';
import type { ShootingListMode } from './ShootingRequestPanel';
import { call } from '@/lib/api';

/** 작업단위 상세 하단과 동일 — 색 강조·아이콘 버튼 쓰지 않음 */
const footerBtnClass =
  'rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-[#666] transition-colors hover:bg-slate-50';
const footerBarClass =
  'shrink-0 border-t border-slate-200 bg-slate-50/80 px-3 py-2';

type Props = {
  detailId: string;
  onClose: () => void;
  onCreated?: (newId: string) => void;
  /** 승인관리 탭에서 열면 승인·반려 버튼 표시 */
  listMode?: ShootingListMode;
  /** 레거시 — 승인 후 영상관리 이동 (모달 등록으로 대체) */
  onStartMediaRegister?: (requestId: string) => void;
};

export function ShootingRequestDetailPanel({
  detailId,
  onClose,
  onCreated,
  listMode = 'mine',
}: Props) {
  useSyncExternalStore(subscribeShootingRequests, getShootingRequests, getShootingRequests);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [flightOpen, setFlightOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [mediaTarget, setMediaTarget] = useState<FolderCreatedInfo | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const isNew = detailId === SHOOTING_REQUEST_NEW_ID;
  const existing = isNew ? null : findShootingRequest(detailId);
  const isAdmin = listMode === 'approval';
  const canRegisterMedia =
    existing != null &&
    (existing.status === 'approved' || existing.status === 'registering');

  useEffect(() => {
    if (isNew || !detailId) return;
    setDetailLoading(true);
    void loadShootingRequestDetail(detailId)
      .catch(() => undefined)
      .finally(() => setDetailLoading(false));
  }, [detailId, isNew]);

  useEffect(() => {
    return subscribeAerialMediaUploadComplete((event) => {
      if (event.aborted || (event.error && event.fileCount === 0)) return;
      if (!event.linkedRequestId || event.linkedRequestId !== detailId) return;
      if (event.kind === 'drone' || event.kind === 'panorama') {
        void call('', 'POST', {
          service: 'aerialUploadService',
          action: 'listWorkUnitMedia',
          params: {
            kind: event.kind,
            folderName: event.folderName,
            ...(event.wuKey != null ? { wuKey: event.wuKey } : {}),
          },
        }).then((res) => {
          if (!res?.success) return;
          const data = (res.data ?? res) as {
            items?: Array<{
              fuKey: number;
              wuKey: number;
              fileName: string;
              sizeLabel: string;
              format: string;
              previewKind: 'image' | 'video' | 'panorama';
              locationLabel: string | null;
              relativePath?: string;
            }>;
          };
          applyWorkUnitMediaFiles(event.kind, event.folderName, data.items ?? []);
        });
      } else if (event.kind === 'ortho') {
        void call('', 'POST', {
          service: 'aerialUploadService',
          action: 'listWorkUnits',
          params: { kind: 'ortho' },
        }).then((res) => {
          if (!res?.success) return;
          const data = (res.data ?? res) as {
            units?: Parameters<typeof replaceOrthoUnitsFromServer>[0];
          };
          replaceOrthoUnitsFromServer(data.units ?? []);
        });
      }
      completeMediaRegistration(event.linkedRequestId, event.workName);
      setUploadCompleteNotice({
        kind: event.kind,
        workName: event.workName,
        folderName: event.folderName,
        progressFilePath: '',
        fileTotal: event.fileCount,
      });
      setNotice(
        event.kind === 'ortho'
          ? `TIF ${event.fileCount}개 업로드·변환을 진행했습니다.`
          : `파일 ${event.fileCount}개를 올렸습니다.`
      );
      setMediaTarget(null);
    });
  }, [detailId]);

  if (!isNew && !existing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-white px-4 text-center">
        <p className="text-xs text-slate-400">
          {detailLoading ? '불러오는 중…' : '신청을 찾을 수 없습니다.'}
        </p>
        <button type="button" className="text-[11px] text-sky-700 underline" onClick={onClose}>
          닫기
        </button>
      </div>
    );
  }

  const handleApprove = async () => {
    if (!existing || busy) return;
    setBusy(true);
    try {
      await decideShootingRequest(existing.id, 'approved');
      setRejectOpen(false);
      setNotice('승인되었습니다. 아래에서 파일 업로드·비행기록부를 진행할 수 있습니다.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '승인에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!existing || busy) return;
    if (!rejectReason.trim()) {
      setNotice('반려 사유를 입력하세요.');
      return;
    }
    setBusy(true);
    try {
      await decideShootingRequest(existing.id, 'rejected', rejectReason);
      setRejectOpen(false);
      setRejectReason('');
      setNotice('반려 처리되었습니다. 신청자(내 신청)에서도 반려 사유를 볼 수 있습니다.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '반려에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const openCancelConfirm = () => {
    if (!existing || busy) return;
    setCancelConfirmOpen(true);
  };

  const handleCancelApproval = async () => {
    if (!existing || busy) return;
    setBusy(true);
    setCancelConfirmOpen(false);
    setFlightOpen(false);
    setUploadOpen(false);
    try {
      await cancelShootingApproval(existing.id);
      setNotice('승인이 취소되어 대기로 돌아갔습니다.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '승인 취소에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const openUpload = () => {
    if (!existing) return;
    beginMediaRegistration(existing.id);
    setUploadOpen(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {isAdmin && existing && !isNew ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-slate-800">신청 상세</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 font-medium ring-1 ring-inset',
                  existing.status === 'approved' || existing.status === 'registering'
                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                    : existing.status === 'registered'
                      ? 'bg-slate-100 text-slate-700 ring-slate-300'
                      : existing.status === 'rejected'
                        ? 'bg-rose-50 text-rose-700 ring-rose-200'
                        : 'bg-amber-50 text-amber-800 ring-amber-200'
                )}
              >
                {REQUEST_STATUS_LABEL[existing.status]}
              </span>
              {existing.decidedAt ? <span>처리일 {existing.decidedAt}</span> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {existing && !isNew && existing.status === 'rejected' ? (
        <div className="shrink-0 border-b border-rose-100 bg-rose-50/80 px-3 py-2">
          <p className="text-[10px] font-semibold text-rose-800">반려 사유</p>
          <p className="mt-1 text-[11px] leading-relaxed text-rose-900">
            {existing.rejectReason?.trim() || '사유가 등록되지 않았습니다.'}
          </p>
        </div>
      ) : null}

      {existing && !isNew && existing.status === 'registered' ? (
        <p className="shrink-0 border-b border-emerald-100 bg-emerald-50/80 px-3 py-2 text-[10px] leading-relaxed text-emerald-800">
          등록이 완료되었습니다.
          {existing.linkedWorkUnitLabel ? ` 연결 작업단위: ${existing.linkedWorkUnitLabel}` : ''}
        </p>
      ) : null}

      {!isAdmin &&
      existing &&
      !isNew &&
      canStartMediaRegister(existing.status) &&
      existing.status !== 'registered' ? (
        <p className="shrink-0 border-b border-emerald-100 bg-emerald-50/80 px-3 py-2 text-[10px] leading-relaxed text-emerald-800">
          승인되었습니다. 담당자가 영상·비행기록부를 등록합니다.
        </p>
      ) : null}

      <div className="min-h-0 flex-1">
        <ShootingRequestForm
          key={detailId}
          initial={existing}
          readOnly={!isNew}
          closeLabel="닫기"
          hideHeaderClose={isAdmin}
          hideFooterActions={isAdmin && !isNew}
          onClose={onClose}
          onSubmit={async (draft) => {
            const row = await addShootingRequest(draft);
            onCreated?.(row.id);
            onClose();
          }}
        />
      </div>

      {/* 대기: 승인·반려 */}
      {isAdmin && existing && existing.status === 'pending' ? (
        <div className={cn(footerBarClass, 'space-y-2')}>
          {rejectOpen ? (
            <div className="space-y-2">
              <label className="block text-[10px] font-medium text-slate-600">반려 사유</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] outline-none focus:border-sky-400"
                placeholder="반려 사유를 입력하세요"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  className={footerBtnClass}
                  onClick={() => {
                    setRejectOpen(false);
                    setRejectReason('');
                  }}
                >
                  취소
                </button>
                <button
                  type="button"
                  className={footerBtnClass}
                  disabled={busy}
                  onClick={() => void handleReject()}
                >
                  반려 확정
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                className={footerBtnClass}
                disabled={busy}
                onClick={() => {
                  setNotice(null);
                  setRejectOpen(true);
                }}
              >
                반려
              </button>
              <button
                type="button"
                className={footerBtnClass}
                disabled={busy}
                onClick={() => void handleApprove()}
              >
                승인
              </button>
            </div>
          )}
          {notice ? (
            <p className="rounded-md border border-sky-100 bg-sky-50 px-2.5 py-1.5 text-[10px] text-sky-900">
              {notice}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 승인·등록중: 신청서와 동일 화면 + 파일업로드·비행기록부 모달 */}
      {isAdmin && existing && canRegisterMedia ? (
        <div className={cn(footerBarClass, 'space-y-2')}>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              className={footerBtnClass}
              disabled={busy}
              onClick={openCancelConfirm}
            >
              승인 취소
            </button>
            <button type="button" className={footerBtnClass} onClick={openUpload}>
              파일 업로드
            </button>
            <button type="button" className={footerBtnClass} onClick={() => setFlightOpen(true)}>
              비행기록부 작성
            </button>
          </div>
          {notice ? (
            <p className="rounded-md border border-sky-100 bg-sky-50 px-2.5 py-1.5 text-[10px] text-sky-900">
              {notice}
            </p>
          ) : null}
        </div>
      ) : null}

      {isAdmin && existing && existing.status === 'registered' && notice ? (
        <div className="shrink-0 border-t border-slate-100 px-3 py-2">
          <p className="rounded-md border border-sky-100 bg-sky-50 px-2.5 py-1.5 text-[10px] text-sky-900">
            {notice}
          </p>
        </div>
      ) : null}

      <Dialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <DialogContent
          showCloseButton={false}
          className="w-[min(100vw-2rem,22rem)] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
        >
          <DialogHeader className="space-y-0 border-b border-slate-200 px-4 py-3 text-left">
            <DialogTitle className="text-[13px] font-semibold text-slate-800">
              승인 취소
            </DialogTitle>
          </DialogHeader>
          <div className="px-4 py-4">
            <p className="text-[12px] leading-relaxed text-slate-600">
              승인 취소하시겠습니까?
              <br />
              <span className="text-[11px] text-slate-400">취소하면 상태가 대기로 돌아갑니다.</span>
            </p>
          </div>
          <div className="flex items-center justify-end gap-1.5 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5">
            <button
              type="button"
              className={cn(footerBtnClass, 'border-slate-300')}
              disabled={busy}
              onClick={() => void handleCancelApproval()}
            >
              {busy ? '처리 중…' : '승인 취소'}
            </button>
            <button
              type="button"
              className={footerBtnClass}
              disabled={busy}
              onClick={() => setCancelConfirmOpen(false)}
            >
              닫기
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {existing && canRegisterMedia ? (
        <>
          <Dialog open={flightOpen} onOpenChange={setFlightOpen}>
            <DialogContent
              showCloseButton={false}
              className="flex h-[min(62vh,480px)] w-[min(100vw-2rem,40rem)] max-w-none flex-col gap-0 overflow-hidden p-0"
            >
              <DialogHeader className="sr-only">
                <DialogTitle>무인비행장치 비행기록부</DialogTitle>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-hidden">
                <FlightLogbookForm
                  srKey={Number(existing.id)}
                  workUnitLabel={existing.purpose || existing.address || existing.id}
                  onClose={() => setFlightOpen(false)}
                />
              </div>
            </DialogContent>
          </Dialog>

          <FolderBatchUploadDialog
            open={uploadOpen}
            onOpenChange={setUploadOpen}
            expectedKind={shootTypeToAerialKind(existing.shootType)}
            linkedRequest={existing}
            onFolderCreated={(info) => {
              setNotice('작업단위 폴더가 생성되었습니다.');
              if (info.kind === 'drone' || info.kind === 'ortho' || info.kind === 'panorama') {
                setMediaTarget(info);
              }
            }}
          />
          {mediaTarget ? (
            <WorkUnitMediaUploadDialog
              open
              onOpenChange={(open) => {
                if (!open) setMediaTarget(null);
              }}
              kind={mediaTarget.kind}
              folderName={mediaTarget.folderName}
              workName={mediaTarget.workName}
              wuKey={mediaTarget.wuKey}
              srKey={Number(existing.id)}
              linkedRequestId={existing.id}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
