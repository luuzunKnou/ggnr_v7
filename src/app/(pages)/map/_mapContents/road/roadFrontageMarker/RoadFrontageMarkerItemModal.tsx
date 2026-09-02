'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { AddressSearchPanel } from '../../../_mapComponents/addressSearch/AddressSearchPanel';
import type { VWorldAddressItem } from '../../../_mapComponents/addressSearch/vworldAddressSearch';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import {
  normalizeMarkerInstallLocation,
  type RoadFrontageMarkerItem,
} from './roadFrontageMarkerMock';
import { fetchInstallPlacePreview } from './fetchInstallPlacePreview';

const fieldClass =
  'h-7 w-full min-w-0 border-0 bg-transparent px-0.5 text-[11px] text-foreground outline-none focus:bg-muted/40';
const fieldViewClass =
  'flex min-h-7 w-full min-w-0 items-center text-[11px] text-foreground';
const modalTableClass = 'w-full table-fixed border-collapse text-[11px]';
const modalThClass =
  'border border-border bg-muted px-2 py-1.5 text-left align-middle font-medium text-muted-foreground break-keep';
const modalTdClass = 'border border-border bg-background px-1.5 py-0.5 align-middle';
const modalSearchWrapClass = 'relative z-20 min-w-0 overflow-visible';
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

function ModalFormTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded border border-border">
      <table className={modalTableClass}>
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[28%]" />
          <col className="w-[22%]" />
          <col className="w-[28%]" />
        </colgroup>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

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
          <ModalFormTable>
            <tr>
              <th className={modalThClass}>설치 위치</th>
              {readOnly ? (
                <td className={modalTdClass}>
                  <div className={fieldViewClass}>
                    {displayText(normalizeMarkerInstallLocation(draft.installLocation))}
                  </div>
                </td>
              ) : (
                <td className={cn(modalTdClass, modalSearchWrapClass, 'z-20')}>
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
                </td>
              )}
              <th className={modalThClass}>지목</th>
              <td className={modalTdClass}>
                {readOnly ? (
                  <div className={fieldViewClass}>{displayText(draft.landCategory)}</div>
                ) : (
                  <input
                    className={fieldClass}
                    value={draft.landCategory}
                    placeholder="예: 대"
                    onChange={(e) => onChange({ ...draft, landCategory: e.target.value })}
                  />
                )}
              </td>
            </tr>
            <tr>
              <th className={modalThClass}>지점거리</th>
              <td className={modalTdClass}>
                {readOnly ? (
                  <div className={fieldViewClass}>{displayText(draft.stationDistance)}</div>
                ) : (
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
                )}
              </td>
              <th className={modalThClass}>표지</th>
              <td className={modalTdClass}>
                {readOnly ? (
                  <div className={fieldViewClass}>{displayText(draft.sign)}</div>
                ) : (
                  <input
                    className={fieldClass}
                    value={draft.sign}
                    onChange={(e) => onChange({ ...draft, sign: e.target.value })}
                  />
                )}
              </td>
            </tr>
            <tr>
              <th className={modalThClass}>소유자 성명</th>
              <td className={modalTdClass}>
                {readOnly ? (
                  <div className={fieldViewClass}>{displayText(draft.ownerName)}</div>
                ) : (
                  <input
                    className={fieldClass}
                    value={draft.ownerName}
                    onChange={(e) => onChange({ ...draft, ownerName: e.target.value })}
                  />
                )}
              </td>
              <th className={modalThClass}>소유자 주소</th>
              {readOnly ? (
                <td className={modalTdClass}>
                  <div className={fieldViewClass}>{displayText(draft.ownerAddress)}</div>
                </td>
              ) : (
                <td className={cn(modalTdClass, modalSearchWrapClass, 'z-10')}>
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
                </td>
              )}
            </tr>
            <tr>
              <th className={modalThClass}>비고</th>
              <td colSpan={3} className={modalTdClass}>
                {readOnly ? (
                  <div className={fieldViewClass}>{displayText(draft.remark)}</div>
                ) : (
                  <input
                    className={fieldClass}
                    value={draft.remark}
                    onChange={(e) => onChange({ ...draft, remark: e.target.value })}
                  />
                )}
              </td>
            </tr>
          </ModalFormTable>
          {error ? (
            <p className="mt-1.5 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          ) : null}
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
