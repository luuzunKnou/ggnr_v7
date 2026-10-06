'use client';

import { useEffect, useState } from 'react';
import { call } from '@/lib/api';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/shadcnComponents/ui/dialog';

export function DroneDropFolderHint({ kind }: { kind: 'drone' | 'panorama' | 'ortho' }) {
  const [open, setOpen] = useState(false);
  const [absoluteDir, setAbsoluteDir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setCopied(false);
    void call('', 'POST', {
      service: 'aerialUploadService',
      action:
        kind === 'panorama'
          ? 'getPanoramaDropFolderPath'
          : kind === 'ortho'
            ? 'getOrthoDropFolderPath'
            : 'getDroneDropFolderPath',
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const dir = String(res?.data?.absoluteDir ?? '').trim();
        if (!res?.success || !dir) {
          setError('자료 폴더 경로를 불러오지 못했습니다.');
          setAbsoluteDir('');
          return;
        }
        setAbsoluteDir(dir);
      })
      .catch(() => {
        if (!cancelled) setError('자료 폴더 경로를 불러오지 못했습니다.');
      });
    return () => {
      cancelled = true;
    };
  }, [open, kind]);

  const copyPath = async () => {
    if (!absoluteDir) return;
    try {
      await navigator.clipboard.writeText(absoluteDir);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left text-[11px] font-medium text-sky-700 hover:underline dark:text-sky-300"
      >
        다중 업로드 안내
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md gap-0 p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle className="text-sm font-semibold">다중 업로드 안내</DialogTitle>
          </DialogHeader>

          <ol className="list-decimal space-y-3 px-4 py-3 pl-8 text-xs leading-relaxed text-foreground">
            <li>
              자료 폴더 안에 작업 이름과 같은 폴더를 만듭니다.
              {absoluteDir ? (
                <div className="mt-1.5 flex items-start gap-2 rounded-md border border-border bg-muted px-2.5 py-1.5">
                  <p className="min-w-0 flex-1 break-all font-mono text-[10px] text-foreground">{absoluteDir}</p>
                  <button
                    type="button"
                    onClick={() => void copyPath()}
                    className="shrink-0 text-[10px] font-medium text-sky-700 hover:underline dark:text-sky-300"
                  >
                    {copied ? '복사됨' : '경로 복사'}
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {error ?? '경로를 불러오는 중…'}
                </p>
              )}
            </li>
            <li>
              {kind === 'panorama'
                ? '그 폴더 바로 안에 항공뷰 사진을 넣습니다. 폴더 이름이 목록의 작업 이름이 됩니다.'
                : kind === 'ortho'
                  ? '그 폴더 바로 안에 드론영상 TIF를 넣습니다. 폴더 이름이 목록의 작업 이름이 됩니다.'
                  : '그 폴더 바로 안에 사진·동영상을 넣습니다. 폴더 이름이 목록의 작업 이름이 됩니다.'}
            </li>
            <li>
              {kind === 'ortho'
                ? '1~2분 뒤 목록을 새로고침합니다. 등록된 TIF는 이어서 타일로 변환됩니다.'
                : '1~2분 뒤 목록을 새로고침합니다. 촬영 위치가 있는 사진은 지도에 표시됩니다.'}
            </li>
          </ol>

          <div className="flex justify-end border-t border-border px-4 py-3">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setOpen(false)}>
              닫기
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
