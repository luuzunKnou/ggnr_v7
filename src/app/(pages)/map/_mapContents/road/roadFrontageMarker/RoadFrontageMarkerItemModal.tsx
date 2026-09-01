'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AddressSearchPanel } from '../../../_mapComponents/addressSearch/AddressSearchPanel';
import type { VWorldAddressItem } from '../../../_mapComponents/addressSearch/vworldAddressSearch';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import {
  normalizeMarkerInstallLocation,
  type RoadFrontageMarkerItem,
} from './roadFrontageMarkerMock';
import { fetchInstallPlacePreview } from './fetchInstallPlacePreview';

const fieldClass =
  'h-7 w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/25';
const fieldSearchClass =
  'relative z-20 flex h-7 w-full min-w-0 items-center overflow-visible rounded border border-border bg-background px-1';
const fieldViewClass =
  'flex min-h-7 w-full min-w-0 items-center rounded border border-border bg-background px-1.5 text-[11px] text-foreground';
const labelClass = 'mb-0.5 block text-[11px] text-muted-foreground';
const btnPrimary =
  'inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50';
const btnGhost =
  'inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50';
const btnDanger =
  'inline-flex h-7 items-center gap-1 rounded border border-red-200 bg-background px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40';

type Props = {
  draft: RoadFrontageMarkerItem;
  isNew: boolean;
  readOnly?: boolean;
  vworldApiKey: string;
  onChange: (
    next: RoadFrontageMarkerItem | ((prev: RoadFrontageMarkerItem) => RoadFrontageMarkerItem)
  ) => void;
  onSubmit: () => void;
  onClose: () => void;
  onDelete?: () => void;
  overlayLeftPx: number;
  overlayWidthPx: number;
};

function displayText(value: string | number | null | undefined) {
  if (value == null) return '—';
  const s = String(value).trim();
  return s || '—';
}

/** 지점거리 — 숫자·소수점만 */
function sanitizeStationDistance(raw: string): string {
  const cleaned = String(raw ?? '').replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot < 0) return cleaned;
  return `${cleaned.slice(0, dot + 1)}${cleaned.slice(dot + 1).replace(/\./g, '')}`;
}

function addressFromSearch(item: VWorldAddressItem): string {
  const raw =
    (item.jibunAddress ?? '').trim() ||
    (item.roadAddress ?? '').trim() ||
    (item.address ?? '').trim();
  return formatAddressStripSidoSigungu(raw) || raw;
}

function lonLatFromSearch(item: VWorldAddressItem): { lon: number; lat: number } | null {
  const lon = Number(item.point?.x);
  const lat = Number(item.point?.y);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || (lon === 0 && lat === 0)) return null;
  return { lon, lat };
}

/** 표주 속성 시트 — 설치 위치·소유자 주소 검색, 설치 위치↔지도 점 연동 */
export function RoadFrontageMarkerItemModal({
  draft,
  isNew,
  readOnly = false,
  vworldApiKey,
  onChange,
  onSubmit,
  onClose,
  onDelete,
  overlayLeftPx,
  overlayWidthPx,
}: Props) {
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);
  /** 배경에서 pointerdown → click 일 때만 닫기 (모달 안 드래그 후 밖 release로 닫히는 것 방지) */
  const closeOnBackdropRef = useRef(false);
  const close = useCallback(() => onClose(), [onClose]);
  const title = isNew ? '표주 추가' : readOnly ? '표주 상세' : '표주 정보';
  const canDelete = !readOnly && !isNew && typeof onDelete === 'function';

  useEffect(() => {
    if (overlayWidthPx <= 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlayWidthPx, close]);

  const handleSubmit = () => {
    if (!draft.installLocation.trim()) {
      setError('설치 위치를 입력해 주세요.');
      return;
    }
    setError(null);
    onSubmit();
  };

  const applyInstallFromSearch = (item: VWorldAddressItem) => {
    const loc = normalizeMarkerInstallLocation(addressFromSearch(item));
    const pt = lonLatFromSearch(item);
    onChange((prev) => ({
      ...prev,
      installLocation: loc,
      lon: pt?.lon ?? prev.lon ?? null,
      lat: pt?.lat ?? prev.lat ?? null,
    }));
    void fetchInstallPlacePreview({
      installLocation: loc,
      lon: pt?.lon ?? null,
      lat: pt?.lat ?? null,
    }).then((place) => {
      if (!place.landCategory && place.lon == null && place.lat == null) return;
      onChange((prev) => ({
        ...prev,
        installLocation: place.installLocation || prev.installLocation,
        landCategory: place.landCategory || prev.landCategory,
        lon: place.lon ?? prev.lon ?? null,
        lat: place.lat ?? prev.lat ?? null,
      }));
    });
  };

  const applyOwnerAddressFromSearch = (item: VWorldAddressItem) => {
    onChange({
      ...draft,
      ownerAddress: addressFromSearch(item) || draft.ownerAddress,
    });
  };

  if (overlayWidthPx <= 0 || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[80] box-border flex min-h-0 items-center justify-center overflow-y-auto bg-black/50 p-10"
      style={{
        left: overlayLeftPx,
        top: 0,
        width: overlayWidthPx,
        height: '100dvh',
        maxHeight: '100dvh',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onPointerDown={(e) => {
        closeOnBackdropRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && closeOnBackdropRef.current) close();
        closeOnBackdropRef.current = false;
      }}
    >
      <div
        className="relative flex max-h-[calc(100dvh-5rem)] w-full max-w-lg flex-col overflow-visible rounded-[5px] border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center border-b border-border px-3 py-2">
          <h3 id={titleId} className="text-sm font-semibold text-foreground">
            {title}
          </h3>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-visible px-3 py-2 scrollbar-thin">
          <div className="space-y-1.5 overflow-visible">
            <div className="grid grid-cols-2 gap-1.5 overflow-visible">
              {readOnly ? (
                <>
                  <div>
                    <span className={labelClass}>설치 위치</span>
                    <div className={fieldViewClass}>
                      {displayText(normalizeMarkerInstallLocation(draft.installLocation))}
                    </div>
                  </div>
                  <div>
                    <span className={labelClass}>지목</span>
                    <div className={fieldViewClass}>{displayText(draft.landCategory)}</div>
                  </div>
                  <div>
                    <span className={labelClass}>지점거리</span>
                    <div className={fieldViewClass}>{displayText(draft.stationDistance)}</div>
                  </div>
                  <div>
                    <span className={labelClass}>표지</span>
                    <div className={fieldViewClass}>{displayText(draft.sign)}</div>
                  </div>
                  <div>
                    <span className={labelClass}>소유자 성명</span>
                    <div className={fieldViewClass}>{displayText(draft.ownerName)}</div>
                  </div>
                  <div>
                    <span className={labelClass}>소유자 주소</span>
                    <div className={fieldViewClass}>{displayText(draft.ownerAddress)}</div>
                  </div>
                  <div className="col-span-2">
                    <span className={labelClass}>비고</span>
                    <div className={fieldViewClass}>{displayText(draft.remark)}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="relative z-20 min-w-0">
                    <span className={labelClass}>설치 위치</span>
                    <div className={fieldSearchClass}>
                      <AddressSearchPanel
                        vworldApiKey={vworldApiKey}
                        layout="field"
                        compact
                        fieldDropdown="wide"
                        fieldDropdownAlign="start"
                        placeholder="주소 검색 (지번/도로명)"
                        initialQuery={draft.installLocation}
                        onClear={() =>
                          onChange((prev) => ({
                            ...prev,
                            installLocation: '',
                            landCategory: '',
                            lon: null,
                            lat: null,
                          }))
                        }
                        onQueryChange={(q) =>
                          onChange((prev) => ({
                            ...prev,
                            installLocation: normalizeMarkerInstallLocation(q),
                          }))
                        }
                        onSelect={applyInstallFromSearch}
                      />
                    </div>
                  </div>
                  <label className="block min-w-0">
                    <span className={labelClass}>지목</span>
                    <input
                      className={fieldClass}
                      value={draft.landCategory}
                      placeholder="예: 대"
                      onChange={(e) => onChange({ ...draft, landCategory: e.target.value })}
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className={labelClass}>지점거리</span>
                    <input
                      className={fieldClass}
                      inputMode="decimal"
                      value={draft.stationDistance}
                      onChange={(e) =>
                        onChange((prev) => ({
                          ...prev,
                          stationDistance: sanitizeStationDistance(e.target.value),
                        }))
                      }
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className={labelClass}>표지</span>
                    <input
                      className={fieldClass}
                      value={draft.sign}
                      onChange={(e) => onChange({ ...draft, sign: e.target.value })}
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className={labelClass}>소유자 성명</span>
                    <input
                      className={fieldClass}
                      value={draft.ownerName}
                      onChange={(e) => onChange({ ...draft, ownerName: e.target.value })}
                    />
                  </label>
                  <div className="relative z-10 min-w-0">
                    <span className={labelClass}>소유자 주소</span>
                    <div className={fieldSearchClass}>
                      <AddressSearchPanel
                        vworldApiKey={vworldApiKey}
                        layout="field"
                        compact
                        fieldDropdown="wide"
                        fieldDropdownAlign="end"
                        placeholder="주소 검색 (도로명/지번)"
                        initialQuery={draft.ownerAddress}
                        onClear={() => onChange({ ...draft, ownerAddress: '' })}
                        onQueryChange={(q) => onChange({ ...draft, ownerAddress: q })}
                        onSelect={applyOwnerAddressFromSearch}
                      />
                    </div>
                  </div>
                  <label className="col-span-2 block">
                    <span className={labelClass}>비고</span>
                    <input
                      className={fieldClass}
                      value={draft.remark}
                      onChange={(e) => onChange({ ...draft, remark: e.target.value })}
                    />
                  </label>
                </>
              )}
            </div>
            {error ? (
              <p className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border px-3 py-1.5">
          {!readOnly ? (
            <button type="button" className={btnPrimary} onClick={handleSubmit}>
              저장
            </button>
          ) : null}
          {canDelete ? (
            <button type="button" className={btnDanger} onClick={onDelete}>
              삭제
            </button>
          ) : null}
          <button type="button" className={btnGhost} onClick={close}>
            닫기
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
