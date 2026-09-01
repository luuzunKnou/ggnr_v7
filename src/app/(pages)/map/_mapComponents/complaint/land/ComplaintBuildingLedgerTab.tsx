'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { fetchBuildingRegisterDetail } from '../../landInfo/api';
import { BuildingRegisterPanel } from '../../landInfo/LandInfoBuildingPanels';
import { useComplaintLandContext } from './ComplaintLandContext';
import {
  CompactEmpty,
  CompactLoading,
  ComplaintLandTabShell,
} from './ComplaintLandCompactUi';

export function ComplaintBuildingLedgerTab() {
  const { pnu, jibunFromParcel, lookupLoading, lookupError } = useComplaintLandContext();
  const [fetching, setFetching] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [source, setSource] = useState<'seum' | 'portal' | null>(null);
  const [mode, setMode] = useState<'recap' | 'title' | 'portal' | null>(null);
  const [buildings, setBuildings] = useState<Record<string, unknown>[]>([]);
  const [children, setChildren] = useState<Record<string, unknown>[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!pnu) {
      setFetching(false);
      return;
    }
    setFetching(true);
  }, [pnu, reloadKey]);

  useEffect(() => {
    if (!pnu) return;
    let alive = true;
    const jibunHint = String(jibunFromParcel ?? '').trim() || undefined;
    fetchBuildingRegisterDetail({ pnu, jibun: jibunHint })
      .then((res) => {
        if (!alive) return;
        setSource(res.source);
        setMode(res.mode);
        setBuildings(res.buildings);
        setChildren(res.children);
        setNotice(res.notice ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setSource(null);
        setMode(null);
        setBuildings([]);
        setChildren([]);
        setNotice(null);
      })
      .finally(() => {
        if (alive) setFetching(false);
      });
    return () => {
      alive = false;
      setFetching(false);
    };
  }, [pnu, jibunFromParcel, reloadKey]);

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
      <BuildingRegisterPanel
        pnu={pnu ?? ''}
        fetching={fetching}
        notice={notice}
        source={source}
        mode={mode}
        buildings={buildings}
        childRows={children}
        onResetRoot={() => setReloadKey((k) => k + 1)}
      />
    </ComplaintLandTabShell>
  );
}
