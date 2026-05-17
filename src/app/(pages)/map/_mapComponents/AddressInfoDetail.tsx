'use client';

import React from 'react';
import { X, MapPin } from 'lucide-react';
import { useMapContext } from './MapContext';
import { AddressInfoPanel } from './AddressInfoPanel';

function formatPnuDisplay(pnu: string | null | undefined): string | null {
  const digits = String(pnu ?? '').replace(/\D/g, '');
  if (digits.length !== 19) return null;
  return digits;
}

export default function AddressInfoDetail() {
  const mapContext = useMapContext();
  const addressInfoDetail = mapContext?.addressInfoDetail ?? null;
  const setAddressInfoDetail = mapContext?.setAddressInfoDetail;

  if (addressInfoDetail === null || !setAddressInfoDetail) return null;

  const handleClose = () => setAddressInfoDetail(null);
  const pnuDisplay = formatPnuDisplay(addressInfoDetail.pnu);

  return (
    <div
      className="flex flex-col w-[520px] h-full rounded-l-xl border-l border-slate-200 bg-white/95 shadow-2xl backdrop-blur-md overflow-hidden pointer-events-auto"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 10000,
      }}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 shrink-0 bg-slate-50/40">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
          {pnuDisplay ? `필지정보 (${pnuDisplay})` : '필지정보'}
        </span>
        <button
          type="button"
          onClick={handleClose}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="닫기"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
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
    </div>
  );
}
