'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { call } from '@/lib/api';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/shadcnComponents/ui/dialog';
import type { AerialKind } from './aerialMediaTypes';
import { buildWorkFolderName } from './parseWorkFolderName';
import type { ShootingRequestDraft } from '../shootingRequest/shootingRequestMockData';
import { beginMediaRegistration } from '../shootingRequest/shootingRequestMockStore';
import { setUploadCompleteNotice } from './aerialUploadProgressStore';
import { addWorkUnitFromFolderCreate } from './aerialMediaMockData';

export type FolderCreatedInfo = {
  kind: AerialKind;
  folderName: string;
  workName: string;
  wuKey?: number;
  linkedRequestId?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 현재 메뉴 종류 — 시스템에서 폴더명·저장 경로 구성에 사용 */
  expectedKind?: AerialKind;
  /** 승인 건으로 올린 경우 (화면 카드 없음 · 완료 시 조인만) */
  linkedRequest?: ShootingRequestDraft | null;
  /** 폴더 생성 후 (목록 갱신 · 사진동영상은 파일 선택 창) */
  onFolderCreated?: (info: FolderCreatedInfo) => void;
};

function defaultWorkName(linkedRequest?: ShootingRequestDraft | null): string {
  return (linkedRequest?.purpose?.trim() || '').replace(/_/g, ' ');
}

function isLinkableRequest(req?: ShootingRequestDraft | null): req is ShootingRequestDraft {
  return req != null && (req.status === 'approved' || req.status === 'registering');
}

export function FolderBatchUploadDialog({
  open,
  onOpenChange,
  expectedKind,
  linkedRequest,
  onFolderCreated,
}: Props) {
  const [workName, setWorkName] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const linkable = isLinkableRequest(linkedRequest);

  useEffect(() => {
    if (!open) return;
    setStartError(null);
    setStarting(false);
    setWorkName(linkable ? defaultWorkName(linkedRequest) : '');
  }, [open, expectedKind, linkedRequest?.id, linkedRequest?.purpose, linkable]);

  const canStart = Boolean(expectedKind && workName.trim() && !starting);

  const handleStart = async () => {
    if (!canStart || !expectedKind) return;
    const name = workName.trim().replace(/_/g, ' ').replace(/\s+/g, ' ');
    const folderName = buildWorkFolderName({ kind: expectedKind, workName: name });
    const linkId = linkable ? linkedRequest.id : undefined;
    const srKey = linkId != null ? Number(linkId) : undefined;

    setStarting(true);
    setStartError(null);
    try {
      const res = await call('', 'POST', {
        service: 'aerialUploadService',
        action: 'createWorkUnitFolder',
        params: {
          kind: expectedKind,
          folderName,
          workName: name,
          ...(srKey != null && Number.isFinite(srKey) ? { srKey } : {}),
        },
      });
      if (!res?.success) {
        throw new Error(
          typeof res?.error === 'string'
            ? res.error
            : (res?.error as { message?: string } | undefined)?.message || '폴더 생성에 실패했습니다.'
        );
      }

      const data = (res.data ?? res) as { wuKey?: number };
      const wuKey = data.wuKey != null && Number.isFinite(Number(data.wuKey)) ? Number(data.wuKey) : undefined;

      if (linkId) {
        beginMediaRegistration(linkId, name);
      }

      addWorkUnitFromFolderCreate({
        kind: expectedKind,
        workName: name,
        folderName,
        linkedRequestId: linkId,
        wuKey,
      });

      const info: FolderCreatedInfo = {
        kind: expectedKind,
        folderName,
        workName: name,
        wuKey,
        linkedRequestId: linkId,
      };
      onFolderCreated?.(info);
      onOpenChange(false);

      // 사진·동영상·파노라마는 파일 선택 창으로 이어지므로 완료 안내 생략
      if (expectedKind !== 'drone' && expectedKind !== 'panorama') {
        window.setTimeout(() => {
          setUploadCompleteNotice({
            kind: expectedKind,
            workName: name,
            folderName,
            progressFilePath: '',
            fileTotal: 0,
            linkedPurpose: linkable ? linkedRequest.purpose || undefined : undefined,
          });
        }, 200);
      }
    } catch (err) {
      setStartError(err instanceof Error ? err.message : '폴더 생성에 실패했습니다.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-slate-200 px-4 py-3">
          <DialogTitle className="text-sm font-semibold">작업단위 폴더 생성</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 px-4 py-3 text-xs">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-600">작업단위명</label>
            <input
              value={workName}
              onChange={(e) => setWorkName(e.target.value)}
              disabled={starting}
              className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-200 disabled:bg-slate-50 disabled:text-slate-500"
              placeholder="예: 울산 동구 촬영"
            />
          </div>

          <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-600">
            {expectedKind === 'drone'
              ? '폴더 생성 후 사진·동영상 파일을 바로 선택할 수 있습니다.'
              : expectedKind === 'panorama'
                ? '폴더 생성 후 파노라마 이미지를 바로 선택할 수 있습니다.'
                : '폴더만 생성합니다. 파일 업로드는 종류별로 이어집니다.'}
          </p>

          {startError ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] text-rose-800">
              {startError}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => onOpenChange(false)}>
            <X className="h-3.5 w-3.5" />
            닫기
          </Button>
          <Button type="button" size="sm" className="h-8 text-xs" disabled={!canStart} onClick={() => void handleStart()}>
            {starting
              ? '생성 중…'
              : expectedKind === 'drone' || expectedKind === 'panorama'
                ? '폴더 생성 후 파일 선택'
                : '폴더 생성'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
