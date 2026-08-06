'use client';

import { AerialMediaShell } from './AerialMediaShell';

type Props = {
  onClose: () => void;
  onContentWidthChange?: (widthPx: number) => void;
};

/** 지도 «영상조회» — 드론영상·파노라마·사진동영상·항공 조회전용 (관리 기능 없음) */
export function AerialViewPanel({ onClose, onContentWidthChange }: Props) {
  return (
    <AerialMediaShell
      useRealMap
      viewOnly
      onClose={onClose}
      onContentWidthChange={onContentWidthChange}
    />
  );
}
