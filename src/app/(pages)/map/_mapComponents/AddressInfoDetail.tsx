'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, MapPin } from 'lucide-react';
import { useMapContext } from './MapContext';
import { AddressInfoPanel } from './AddressInfoPanel';

function formatPnuDisplay(pnu: string | null | undefined): string | null {
  const digits = String(pnu ?? '').replace(/\D/g, '');
  if (digits.length !== 19) return null;
  return digits;
}

/** 우클릭 필지정보 — 목록·우측메뉴·주소검색보다 위(최상단) */
const ADDRESS_INFO_DETAIL_Z = 10000;

export default function AddressInfoDetail() {
  const mapContext = useMapContext();
  const addressInfoDetail = mapContext?.addressInfoDetail ?? null;
  const setAddressInfoDetail = mapContext?.setAddressInfoDetail;
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  if (addressInfoDetail === null || !setAddressInfoDetail || !portalReady) return null;

  const handleClose = () => setAddressInfoDetail(null);
  const pnuDisplay = formatPnuDisplay(addressInfoDetail.pnu);

  return createPortal(
    <div
      className="pointer-events-auto flex h-full w-full min-w-0 max-w-[520px] flex-col overflow-hidden rounded-l-xl border-l border-border bg-background/95 text-foreground shadow-2xl backdrop-blur-md"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: ADDRESS_INFO_DETAIL_Z,
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs font-medium text-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {pnuDisplay ? `필지정보 (${pnuDisplay})` : '필지정보'}
        </span>
        <button
          type="button"
          onClick={handleClose}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="닫기"
          title="닫기"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AddressInfoPanel
          coordinate={addressInfoDetail.coordinate}
          viewProjection={addressInfoDetail.viewProjection}
          pnu={addressInfoDetail.pnu ?? null}
          jibun={addressInfoDetail.jibun}
          road={addressInfoDetail.road}
          buildingName={addressInfoDetail.buildingName}
          loading={addressInfoDetail.loading}
        />
      </div>
    </div>,
    document.body
  );
}
