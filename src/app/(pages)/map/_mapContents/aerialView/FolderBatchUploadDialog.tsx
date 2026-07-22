'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/shadcnComponents/ui/dialog';
import type { AerialKind } from './aerialMediaTypes';
import { buildWorkFolderName } from './parseWorkFolderName';
import { SHOOT_TYPE_LABEL, type ShootingRequestDraft } from '../shootingRequest/shootingRequestMockData';
import { completeMediaRegistration } from '../shootingRequest/shootingRequestMockStore';
import {
  getJobByFolder,
  getUploadJobs,
  getUploadProgressUiVersion,
  setUploadCompleteNotice,
  startSerialUploadMock,
  subscribeUploadProgress,
} from './aerialUploadProgressStore';
import { addWorkUnitFromUploadMock } from './aerialMediaMockData';
import { UploadProgressBanner } from './UploadProgressBanner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 현재 메뉴 종류 — 시스템에서 폴더명·저장 경로 구성에 사용 */
  expectedKind?: AerialKind;
  /** 승인 건으로 올린 경우 */
  linkedRequest?: ShootingRequestDraft | null;
  /** 목업 업로드 완료 후 (목록 갱신 등) */
  onUploadMockComplete?: () => void;
};

function defaultWorkName(linkedRequest?: ShootingRequestDraft | null): string {
  return (linkedRequest?.purpose?.trim() || '').replace(/_/g, ' ');
}

export function FolderBatchUploadDialog({
  open,
  onOpenChange,
  expectedKind,
  linkedRequest,
  onUploadMockComplete,
}: Props) {
  const [workName, setWorkName] = useState('');

  useSyncExternalStore(subscribeUploadProgress, getUploadProgressUiVersion, getUploadProgressUiVersion);

  const uploadingJob =
    expectedKind != null
      ? getUploadJobs().find((j) => j.kind === expectedKind && j.status === 'uploading')
      : undefined;

  const builtFolderName =
    expectedKind && workName.trim()
      ? buildWorkFolderName({ kind: expectedKind, workName })
      : uploadingJob?.folderName ?? '';

  const activeJob =
    expectedKind && builtFolderName
      ? getJobByFolder(expectedKind, builtFolderName)
      : uploadingJob ?? null;
  const isUploading = activeJob?.status === 'uploading';

  useEffect(() => {
    if (!open) return;
    if (uploadingJob) {
      setWorkName(uploadingJob.workName);
      return;
    }
    setWorkName(defaultWorkName(linkedRequest));
  }, [open, expectedKind, linkedRequest?.id, linkedRequest?.purpose, uploadingJob?.id]);

  const canStart = Boolean(expectedKind && workName.trim() && !isUploading);

  const handleStart = () => {
    if (!canStart || !expectedKind) return;
    const name = workName.trim().replace(/_/g, ' ').replace(/\s+/g, ' ');
    const folderName = buildWorkFolderName({ kind: expectedKind, workName: name });

    startSerialUploadMock({
      kind: expectedKind,
      folderName,
      workName: name,
      onComplete: (job) => {
        addWorkUnitFromUploadMock({
          kind: job.kind,
          workName: job.workName,
          folderName: job.folderName,
          fileTotal: job.fileTotal,
        });
        if (linkedRequest) {
          completeMediaRegistration(linkedRequest.id, job.workName);
        }
        onUploadMockComplete?.();
        onOpenChange(false);
        window.setTimeout(() => {
          setUploadCompleteNotice({
            kind: job.kind,
            workName: job.workName,
            folderName: job.folderName,
            progressFilePath: job.progressFilePath,
            fileTotal: job.fileTotal,
            linkedPurpose: linkedRequest?.purpose || undefined,
          });
        }, 200);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-slate-200 px-4 py-3">
          <DialogTitle className="text-sm font-semibold">폴더 일괄 업로드</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 px-4 py-3 text-xs">
          {linkedRequest ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/90 px-3 py-2 text-[11px] leading-relaxed text-emerald-950">
              <div className="font-semibold text-emerald-900">연결된 승인 신청</div>
              <div className="mt-0.5">
                {linkedRequest.purpose || '(목적 없음)'} · {SHOOT_TYPE_LABEL[linkedRequest.shootType]} · 촬영{' '}
                {linkedRequest.shootDate || '—'}
              </div>
              <div className="mt-0.5 text-emerald-800/80">
                {linkedRequest.department} · {linkedRequest.address || '지번 미입력'}
              </div>
            </div>
          ) : null}

          {activeJob && (activeJob.status === 'uploading' || activeJob.status === 'done') ? (
            <UploadProgressBanner
              jobs={[activeJob]}
              title={activeJob.status === 'done' ? '업로드 완료' : '업로드 진행 중'}
            />
          ) : null}

          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-600">작업단위명</label>
            <input
              value={workName}
              onChange={(e) => setWorkName(e.target.value)}
              disabled={Boolean(isUploading)}
              className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-200 disabled:bg-slate-50 disabled:text-slate-500"
              placeholder="예: 안동 시내 촬영"
            />
          </div>

          {isUploading ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-900">
              업로드가 진행 중입니다. 창을 닫아도 목록에서 진행률을 이어 볼 수 있습니다.
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => onOpenChange(false)}>
            <X className="h-3.5 w-3.5" />
            {isUploading ? '창만 닫기' : '닫기'}
          </Button>
          <Button type="button" size="sm" className="h-8 text-xs" disabled={!canStart} onClick={handleStart}>
            {isUploading ? '업로드 중…' : '업로드 시작'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
