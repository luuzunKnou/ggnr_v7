'use client';

import { useState } from 'react';
import { FileImage } from 'lucide-react';
import { cn } from '@/lib/utils';
import { serviceFileDataDownloadUrl, type ServiceFileDataSerEng } from './useServiceFileData';

const box = { sm: 'h-8 w-8', md: 'h-9 w-9' } as const;
const iconSz = { sm: 'h-3.5 w-3.5', md: 'h-4 w-4' } as const;

/**
 * 첨부 이미지 미리보기. 동일 출처 다운로드 URL을 img로 로드하고, 실패 시 아이콘으로 대체.
 */
export function ServiceFileAttachmentThumb({
  serEng,
  layerSegment,
  keyValue,
  fileName,
  size = 'sm',
  className,
}: {
  serEng: ServiceFileDataSerEng;
  layerSegment: string;
  keyValue: string | number;
  fileName: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = serviceFileDataDownloadUrl(serEng, layerSegment, keyValue, fileName, {
    thumb: 160,
  });

  if (failed) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded bg-sky-100',
          box[size],
          className
        )}
      >
        <FileImage className={cn('text-sky-600', iconSz[size])} aria-hidden />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded border border-border bg-muted/40',
        box[size],
        className
      )}
    >
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
