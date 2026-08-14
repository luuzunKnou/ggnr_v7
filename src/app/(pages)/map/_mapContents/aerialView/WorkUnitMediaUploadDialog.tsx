'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Upload, X } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/shadcnComponents/ui/dialog';
import type { AerialKind } from './aerialMediaTypes';
import {
  isAerialMediaUploading,
  startAerialMediaUpload,
} from './aerialMediaUploadRunner';
import {
  getJobByFolder,
  getUploadProgressUiVersion,
  subscribeUploadProgress,
} from './aerialUploadProgressStore';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: AerialKind;
  folderName: string;
  workName: string;
  wuKey?: number;
  srKey?: number;
  linkedRequestId?: string;
};

const ACCEPT_MEDIA =
  'image/jpeg,image/png,image/webp,image/heic,image/tiff,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.heic,.tif,.tiff,.mp4,.mov,.webm';
const ACCEPT_PANO = 'image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic';
const ACCEPT_ORTHO = 'image/tiff,.tif,.tiff';

export function WorkUnitMediaUploadDialog({
  open,
  onOpenChange,
  kind,
  folderName,
  workName,
  wuKey,
  srKey,
  linkedRequestId,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useSyncExternalStore(subscribeUploadProgress, getUploadProgressUiVersion, getUploadProgressUiVersion);
  const job = getJobByFolder(kind, folderName);
  const uploading =
    starting ||
    isAerialMediaUploading(kind, folderName) ||
    job?.status === 'uploading';

  useEffect(() => {
    if (!open) return;
    // 업로드 중이면 선택 파일을 비우지 않음(재오픈 시 진행만 표시)
    if (isAerialMediaUploading(kind, folderName)) {
      setError(null);
      setStarting(false);
      return;
    }
    setFiles([]);
    setError(null);
    setStarting(false);
  }, [open, folderName, wuKey, kind]);

  const handlePick = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setFiles(Array.from(list));
    setError(null);
  };

  const handleUpload = () => {
    if (files.length === 0 || uploading) return;
    if (isAerialMediaUploading(kind, folderName)) {
      setError('이 작업단위는 이미 업로드 중입니다. 닫아도 목록에서 진행률을 확인할 수 있습니다.');
      return;
    }
    setStarting(true);
    setError(null);
    const picked = files;
    void startAerialMediaUpload({
      kind,
      folderName,
      workName,
      files: picked,
      srKey,
      wuKey,
      linkedRequestId,
    }).then((res) => {
      setStarting(false);
      if (res.aborted) return;
      if (res.error && res.fileCount === 0) {
        setError(res.error);
        return;
      }
      if (!res.error) {
        setFiles([]);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-slate-200 px-4 py-3">
          <DialogTitle className="text-sm font-semibold">
            {kind === 'ortho'
              ? '드론영상(TIF) 업로드'
              : kind === 'panorama'
                ? '파노라마 업로드'
                : '사진·동영상 업로드'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 px-4 py-3 text-xs">
          <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-600">
            작업단위 «{workName || folderName}» 폴더에 저장합니다. 업로드 중 창을 닫아도 중단되지
            않으며, 목록 상단에서 진행률을 볼 수 있습니다.
            {kind === 'panorama' ? ' 파노라마는 이미지 파일만 올릴 수 있습니다.' : ''}
          </p>

          <div>
            <input
              ref={inputRef}
              type="file"
              accept={
                kind === 'ortho' ? ACCEPT_ORTHO : kind === 'panorama' ? ACCEPT_PANO : ACCEPT_MEDIA
              }
              multiple
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                handlePick(e.target.files);
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              파일 선택
            </Button>
            <p className="mt-1.5 text-[10px] text-slate-500">
              {files.length > 0 ? `${files.length}개 선택됨` : 'jpg·png·mp4 등 · 여러 개 선택 가능'}
            </p>
          </div>

          {files.length > 0 ? (
            <ul className="max-h-28 overflow-y-auto rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[10px] text-slate-700">
              {files.map((f) => (
                <li key={`${f.name}-${f.size}-${f.lastModified}`} className="truncate py-0.5">
                  {f.name}
                </li>
              ))}
            </ul>
          ) : null}

          {job && (job.status === 'uploading' || job.status === 'done' || job.status === 'failed') ? (
            <div
              className={
                job.status === 'failed'
                  ? 'rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-[10px] text-rose-900'
                  : job.status === 'done'
                    ? 'rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[10px] text-emerald-900'
                    : 'rounded-md border border-sky-200 bg-sky-50 px-2.5 py-2 text-[10px] text-sky-900'
              }
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">
                  {job.status === 'done'
                    ? '업로드 완료'
                    : job.status === 'failed'
                      ? '업로드 실패'
                      : `업로드 중 ${job.fileIndex}/${job.fileTotal}`}
                </p>
                <span className="tabular-nums">{job.percent}%</span>
              </div>
              {job.currentFileName ? (
                <p className="mt-0.5 truncate opacity-80">{job.currentFileName}</p>
              ) : null}
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/70">
                <div
                  className={
                    job.status === 'failed'
                      ? 'h-full rounded-full bg-rose-500 transition-all'
                      : job.status === 'done'
                        ? 'h-full rounded-full bg-emerald-500 transition-all'
                        : 'h-full rounded-full bg-sky-500 transition-all'
                  }
                  style={{ width: `${job.percent}%` }}
                />
              </div>
              {job.status === 'uploading' ? (
                <p className="mt-1.5 text-[10px] text-sky-800/80">
                  닫기를 눌러도 업로드는 계속됩니다.
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] text-rose-800">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-3.5 w-3.5" />
            {uploading ? '닫기 (계속 업로드)' : '닫기'}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            disabled={files.length === 0 || uploading}
            onClick={handleUpload}
          >
            {uploading ? '업로드 중…' : '업로드'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
