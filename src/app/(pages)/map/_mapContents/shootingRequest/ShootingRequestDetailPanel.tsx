'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { FileUp, FileText, Download, X } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { cn } from '@/lib/utils';
import {
  FlightLogbookForm,
  type FlightLogbookFormHandle,
} from '../aerialView/FlightLogbookForm';
import { FolderBatchUploadDialog } from '../aerialView/FolderBatchUploadDialog';
import { shootTypeToAerialKind } from './shootTypeToAerialKind';
import { ShootingRequestForm } from './ShootingRequestForm';
import { ShootingRequestFormModal } from './ShootingRequestFormModal';
import { REQUEST_STATUS_LABEL, canStartMediaRegister } from './shootingRequestMockData';
import {
  addShootingRequest,
  beginMediaRegistration,
  cancelShootingApproval,
  decideShootingRequest,
  findShootingRequest,
  getShootingRequests,
  SHOOTING_REQUEST_NEW_ID,
  subscribeShootingRequests,
} from './shootingRequestMockStore';
import type { ShootingListMode } from './ShootingRequestPanel';

type Props = {
  detailId: string;
  onClose: () => void;
  onCreated?: (newId: string) => void;
  /** 승인관리 탭에서 열면 승인·반려 버튼 표시 */
  listMode?: ShootingListMode;
  /** 레거시: 영상관리로 이동 (승인 후 인라인 등록 UI 우선) */
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
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const flightFormRef = useRef<FlightLogbookFormHandle>(null);

  const isNew = detailId === SHOOTING_REQUEST_NEW_ID;
  const existing = isNew ? null : findShootingRequest(detailId);
  const isAdmin = listMode === 'approval';

  /** 승인관리 · 승인/등록중 → 디테일을 자료등록 화면으로 전환 */
  const showRegisterWorkspace =
    isAdmin &&
    existing != null &&
    (existing.status === 'approved' || existing.status === 'registering');

  if (!isNew && !existing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-white px-4 text-center">
        <p className="text-xs text-slate-400">신청을 찾을 수 없습니다.</p>
        <button type="button" className="text-[11px] text-sky-700 underline" onClick={onClose}>
          닫기
        </button>
      </div>
    );
  }

  const handleApprove = () => {
    if (!existing) return;
    decideShootingRequest(existing.id, 'approved');
    beginMediaRegistration(existing.id);
    setRejectOpen(false);
    setNotice('승인되었습니다. 아래에서 비행기록부·영상 자료를 등록하세요. (목업)');
  };

  const handleReject = () => {
    if (!existing) return;
    if (!rejectReason.trim()) {
      setNotice('반려 사유를 입력하세요.');
      return;
    }
    decideShootingRequest(existing.id, 'rejected', rejectReason);
    setRejectOpen(false);
    setRejectReason('');
    setNotice('반려 처리되었습니다. 신청자(내 신청)에서도 반려 사유를 볼 수 있습니다. (목업)');
  };

  const handleCancelApproval = () => {
    if (!existing) return;
    if (!window.confirm('승인을 취소하고 대기 상태로 되돌릴까요?')) return;
    cancelShootingApproval(existing.id);
    setUploadOpen(false);
    setNotice('승인이 취소되어 대기 상태로 돌아갔습니다. (목업)');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* 상단: 제목 + 닫기 (다른 상세 패널과 동일) */}
      {(isAdmin || showRegisterWorkspace) && existing && !isNew ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-slate-800">
              {showRegisterWorkspace ? '자료 등록' : '신청 상세'}
            </p>
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

      {/* 승인 후: 비행기록부 + 파일업로드 */}
      {showRegisterWorkspace && existing ? (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
          <FlightLogbookForm
            ref={flightFormRef}
            embedded
            hideActions
            workUnitLabel={existing.purpose || existing.address || existing.id}
            headerAction={
              <button
                type="button"
                className="shrink-0 text-[10px] text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
                onClick={() => flightFormRef.current?.reset()}
              >
                초기화
              </button>
            }
          />

          <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileUp className="h-4 w-4 shrink-0 text-sky-600" />
                <h3 className="text-[12px] font-semibold text-slate-800">파일 업로드</h3>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 px-2.5 text-[11px]"
                onClick={() => setUploadOpen(true)}
              >
                <FileUp className="h-3.5 w-3.5" />
                폴더 선택
              </Button>
            </div>
          </section>

          {notice ? (
            <p className="rounded-md border border-sky-100 bg-sky-50 px-2.5 py-1.5 text-[10px] text-sky-900">
              {notice}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <ShootingRequestForm
            key={detailId}
            initial={existing}
            readOnly={!isNew}
            closeLabel="닫기"
            onClose={onClose}
            hideFooterActions={isAdmin && !isNew}
            hideHeaderClose
            onSubmit={
              isNew
                ? (draft) => {
                    const row = addShootingRequest(draft);
                    onCreated?.(row.id);
                  }
                : undefined
            }
          />
        </div>
      )}

      {/* 대기: 승인·반려 */}
      {isAdmin && existing && existing.status === 'pending' ? (
        <div className="shrink-0 space-y-2 border-t border-slate-200 bg-white px-3 py-2.5">
          {rejectOpen ? (
            <div className="space-y-2">
              <label className="block text-[10px] font-medium text-slate-600">
                반려 사유 <span className="text-rose-600">(필수)</span>
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-[11px] outline-none focus:border-sky-400"
                placeholder="신청자에게 안내할 반려 사유를 입력하세요"
              />
              <div className="flex justify-end gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2.5 text-[11px]"
                  onClick={() => {
                    setRejectOpen(false);
                    setRejectReason('');
                  }}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 bg-rose-600 px-3 text-[11px] hover:bg-rose-700"
                  onClick={handleReject}
                >
                  반려 확정
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-rose-200 px-3 text-[11px] text-rose-700 hover:bg-rose-50"
                onClick={() => {
                  setNotice(null);
                  setRejectOpen(true);
                }}
              >
                반려
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 bg-emerald-600 px-3 text-[11px] hover:bg-emerald-700"
                onClick={handleApprove}
              >
                승인
              </Button>
            </div>
          )}
          {notice ? (
            <p className="rounded-md border border-sky-100 bg-sky-50 px-2.5 py-1.5 text-[10px] text-sky-900">
              {notice}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 승인 후: 하단 핵심 액션만 (닫기는 상단) */}
      {showRegisterWorkspace && existing ? (
        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-slate-200 bg-slate-50/80 px-3 py-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1 px-2.5 text-[11px]"
            onClick={() => void flightFormRef.current?.downloadDocument()}
          >
            <Download className="h-3.5 w-3.5" />
            PDF 내려받기
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1 px-2.5 text-[11px]"
            onClick={() => setFormModalOpen(true)}
          >
            <FileText className="h-3.5 w-3.5" />
            신청서
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 border-amber-200 px-2.5 text-[11px] text-amber-800 hover:bg-amber-50"
            onClick={handleCancelApproval}
          >
            승인 취소
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 px-3 text-[11px]"
            onClick={() => flightFormRef.current?.submitMock()}
          >
            기록부 제출
          </Button>
        </div>
      ) : null}

      {isAdmin &&
      existing &&
      existing.status !== 'pending' &&
      !showRegisterWorkspace &&
      notice ? (
        <div className="shrink-0 border-t border-slate-100 px-3 py-2">
          <p className="rounded-md border border-sky-100 bg-sky-50 px-2.5 py-1.5 text-[10px] text-sky-900">
            {notice}
          </p>
        </div>
      ) : null}

      {existing && showRegisterWorkspace ? (
        <FolderBatchUploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          expectedKind={shootTypeToAerialKind(existing.shootType)}
          linkedRequest={existing}
          onUploadMockComplete={() =>
            setNotice('폴더 업로드가 시작·완료 처리되었습니다. (목업)')
          }
        />
      ) : null}

      {existing ? (
        <ShootingRequestFormModal
          open={formModalOpen}
          detailId={existing.id}
          onOpenChange={setFormModalOpen}
        />
      ) : null}
    </div>
  );
}
