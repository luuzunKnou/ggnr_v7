'use client';

import { AerialMediaShell } from './AerialMediaShell';
import type { AerialKind } from './aerialMediaTypes';

type Props = {
  onClose: () => void;
  /** 사이드바에서 종류별로 열 때 지정. 없으면 내부 탭 네비 사용 */
  kind?: AerialKind;
  /** 조회 시스템 — 업로드·변환·비행기록부 편집 숨김 */
  viewOnly?: boolean;
  onContentWidthChange?: (widthPx: number) => void;
  /** 알림에서 연 사진·동영상 파일 */
  geomFocus?: { unitId: string; fileId: string; token: number } | null;
};

/** UAV «드론영상/사진동영상/항공뷰/항공» — 종류별 등록·변환 (비행기록부는 항공 제외). viewOnly면 조회만 */
export function AerialManagePanel({
  onClose,
  kind,
  viewOnly = false,
  onContentWidthChange,
  geomFocus = null,
}: Props) {
  if (kind) {
    return (
      <AerialMediaShell
        useRealMap
        hideKindNav
        viewOnly={viewOnly}
        initialKind={kind}
        onClose={onClose}
        onContentWidthChange={onContentWidthChange}
        geomFocus={kind === 'drone' ? geomFocus : null}
      />
    );
  }
  return (
    <AerialMediaShell
      useRealMap
      viewOnly={viewOnly}
      onClose={onClose}
      onContentWidthChange={onContentWidthChange}
    />
  );
}
