'use client';

import { useComplaintLandContext } from './ComplaintLandContext';
import { LandInfoParcelPanel } from '../../landInfo/LandInfoParcelPanel';
import {
  CompactEmpty,
  CompactLoading,
  ComplaintLandTabShell,
} from './ComplaintLandCompactUi';

export function ComplaintParcelTab() {
  const { pnu, vworldKey, lookupLoading, lookupError } = useComplaintLandContext();

  if (lookupLoading) {
    return (
      <ComplaintLandTabShell>
        <CompactLoading label="필지 위치 확인 중…" />
      </ComplaintLandTabShell>
    );
  }

  if (lookupError === 'no_location') {
    return (
      <ComplaintLandTabShell>
        <CompactEmpty
          title="위치 정보가 없습니다."
          description="접수정보에서 주소를 입력하거나 지도에서 위치를 지정하세요."
        />
      </ComplaintLandTabShell>
    );
  }

  if (lookupError === 'no_coordinate' || lookupError === 'no_parcel') {
    return (
      <ComplaintLandTabShell>
        <CompactEmpty
          title="필지를 찾을 수 없습니다."
          description="주소를 확인하거나 지도에서 위치를 지정하세요."
        />
      </ComplaintLandTabShell>
    );
  }

  return (
    <ComplaintLandTabShell>
      <LandInfoParcelPanel pnu={pnu ?? ''} vworldKey={vworldKey} />
    </ComplaintLandTabShell>
  );
}
