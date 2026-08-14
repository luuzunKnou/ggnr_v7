'use client';

import { useEffect, useRef } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import {
  clearUploadCompleteNotice,
  type UploadCompleteNotice,
} from './aerialUploadProgressStore';

type Props = {
  notice: UploadCompleteNotice | null;
};

/** 폴더 업로드 완료 — alert 대신 영상관리 톤의 확인 창 */
export function UploadCompleteDialog({ notice }: Props) {
  const open = notice != null;
  /** 다른 Dialog가 닫히며 넘어오는 가짜 onOpenChange(false) 무시 */
  const ignoreCloseUntilRef = useRef(0);

  useEffect(() => {
    if (open) {
      ignoreCloseUntilRef.current = Date.now() + 350;
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          if (Date.now() < ignoreCloseUntilRef.current) return;
          clearUploadCompleteNotice();
        }
      }}
    >
      <DialogContent
        className="max-w-sm gap-0 overflow-hidden p-0 sm:max-w-md"
        onPointerDownOutside={(e) => {
          if (Date.now() < ignoreCloseUntilRef.current) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (Date.now() < ignoreCloseUntilRef.current) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (Date.now() < ignoreCloseUntilRef.current) e.preventDefault();
        }}
      >
        <DialogHeader className="border-b border-emerald-100 bg-emerald-50/90 px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            {notice && notice.fileTotal > 0 ? '업로드 완료' : '폴더 생성 완료'}
          </DialogTitle>
        </DialogHeader>

        {notice ? (
          <div className="space-y-3 px-4 py-3">
            <p className="text-[12px] leading-relaxed text-slate-700">
              {notice.fileTotal > 0
                ? '사진·동영상 업로드가 끝났습니다. 작업단위 상세에서 파일을 확인하고 지도에서 위치를 볼 수 있습니다.'
                : '작업단위 폴더가 생성되었습니다. 목록에서 상세를 열어 사진·동영상 등 파일을 추가하세요.'}
            </p>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50/80">
              <dl className="divide-y divide-slate-100 text-[11px]">
                <Row label="작업명" value={notice.workName} />
                {notice.fileTotal > 0 ? <Row label="파일" value={`${notice.fileTotal}개`} /> : null}
                {notice.linkedPurpose ? (
                  <Row label="연결 신청" value={notice.linkedPurpose} />
                ) : null}
              </dl>
            </div>

            {notice.linkedPurpose ? (
              <p
                className={
                  notice.fileTotal > 0
                    ? 'rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[10px] leading-relaxed text-emerald-900'
                    : 'rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] leading-relaxed text-amber-900'
                }
              >
                {notice.fileTotal > 0 ? (
                  <>
                    촬영신청 «{notice.linkedPurpose}» 상태가{' '}
                    <span className="font-semibold">등록완료</span>로 변경되었습니다.
                  </>
                ) : (
                  <>
                    촬영신청 «{notice.linkedPurpose}» 상태가 <span className="font-semibold">등록중</span>
                    입니다. 파일 업로드가 끝나면 등록완료로 바뀝니다.
                  </>
                )}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end border-t border-slate-200 bg-white px-4 py-3">
          <Button
            type="button"
            size="sm"
            className="h-8 bg-emerald-600 px-4 text-[11px] hover:bg-emerald-700"
            onClick={() => clearUploadCompleteNotice()}
          >
            확인
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 px-3 py-2">
      <dt className="w-14 shrink-0 font-medium text-slate-500">{label}</dt>
      <dd className="min-w-0 flex-1 break-all text-slate-800">{value}</dd>
    </div>
  );
}
