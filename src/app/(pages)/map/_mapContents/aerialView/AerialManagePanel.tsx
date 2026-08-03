'use client';

import { AerialMediaShell } from './AerialMediaShell';
import type { AerialKind } from './aerialMediaTypes';

type Props = {
  onClose: () => void;
  /** 사이드바에서 종류별로 열 때 지정. 없으면 내부 탭 네비 사용 */
  kind?: AerialKind;
  onContentWidthChange?: (widthPx: number) => void;
};

/** UAV «드론영상/사진동영상/파노라마/항공» — 종류별 등록·변환 (비행기록부는 항공 제외) */
export function AerialManagePanel({ onClose, kind, onContentWidthChange }: Props) {
  if (kind) {
    return (
      <AerialMediaShell
        useRealMap
        hideKindNav
        initialKind={kind}
        onClose={onClose}
        onContentWidthChange={onContentWidthChange}
      />
    );
  }
  return (
    <AerialMediaShell
      useRealMap
      onClose={onClose}
      onContentWidthChange={onContentWidthChange}
    />
  );
}
