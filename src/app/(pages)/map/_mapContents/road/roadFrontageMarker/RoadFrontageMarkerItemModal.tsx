'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RoadFrontageMarkerItem } from './roadFrontageMarkerMock';

const fieldClass =
  'h-7 w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 text-[11px] outline-none focus:border-primary focus:ring-1 focus:ring-primary/25';
const labelClass = 'mb-0.5 block text-[11px] text-slate-500';
const btnPrimary =
  'inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50';
const btnGhost =
  'inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50';

type Props = {
  draft: RoadFrontageMarkerItem;
  isNew: boolean;
  onChange: (next: RoadFrontageMarkerItem) => void;
  onSubmit: () => void;
  onClose: () => void;
  overlayLeftPx: number;
  overlayWidthPx: number;
};

export function RoadFrontageMarkerItemModal({
  draft,
  isNew,
  onChange,
  onSubmit,
  onClose,
  overlayLeftPx,
  overlayWidthPx,
}: Props) {
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const handleSubmit = () => {
    if (draft.serialNo == null || !Number.isFinite(draft.serialNo)) {
      setError('일련번호를 입력해 주세요.');
      return;
    }
    setError(null);
    onSubmit();
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
      onClick={close}
    >
      <div
        className="relative flex max-h-[calc(100dvh-5rem)] w-full max-w-md flex-col overflow-hidden rounded-[5px] border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
          <h3 id={titleId} className="text-sm font-semibold text-slate-800">
            {isNew ? '표주 추가' : '표주 수정'}
          </h3>
          <button type="button" className={btnGhost} onClick={close}>
            닫기
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2 scrollbar-thin">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className={labelClass}>일련번호</span>
              <input
                type="number"
                className={fieldClass}
                value={draft.serialNo ?? ''}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    serialNo: e.target.value.trim() === '' ? null : Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <span className={labelClass}>지점거리</span>
              <input
                className={fieldClass}
                value={draft.stationDistance}
                onChange={(e) => onChange({ ...draft, stationDistance: e.target.value })}
              />
            </div>
            <div>
              <span className={labelClass}>군</span>
              <input
                className={fieldClass}
                value={draft.county}
                onChange={(e) => onChange({ ...draft, county: e.target.value })}
              />
            </div>
            <div>
              <span className={labelClass}>면</span>
              <input
                className={fieldClass}
                value={draft.myeon}
                onChange={(e) => onChange({ ...draft, myeon: e.target.value })}
              />
            </div>
            <div>
              <span className={labelClass}>리</span>
              <input
                className={fieldClass}
                value={draft.ri}
                onChange={(e) => onChange({ ...draft, ri: e.target.value })}
              />
            </div>
            <div>
              <span className={labelClass}>지목</span>
              <input
                className={fieldClass}
                value={draft.landCategory}
                onChange={(e) => onChange({ ...draft, landCategory: e.target.value })}
              />
            </div>
            <div>
              <span className={labelClass}>지번</span>
              <input
                className={fieldClass}
                value={draft.lotNo}
                onChange={(e) => onChange({ ...draft, lotNo: e.target.value })}
              />
            </div>
            <div>
              <span className={labelClass}>표지</span>
              <input
                className={fieldClass}
                value={draft.sign}
                onChange={(e) => onChange({ ...draft, sign: e.target.value })}
              />
            </div>
            <div>
              <span className={labelClass}>소유자 성명</span>
              <input
                className={fieldClass}
                value={draft.ownerName}
                onChange={(e) => onChange({ ...draft, ownerName: e.target.value })}
              />
            </div>
            <div>
              <span className={labelClass}>비고</span>
              <input
                className={fieldClass}
                value={draft.remark}
                onChange={(e) => onChange({ ...draft, remark: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <span className={labelClass}>소유자 주소</span>
              <input
                className={fieldClass}
                value={draft.ownerAddress}
                onChange={(e) => onChange({ ...draft, ownerAddress: e.target.value })}
              />
            </div>
          </div>
          {error ? (
            <p className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1 border-t border-slate-200 px-3 py-2">
          <button type="button" className={btnGhost} onClick={close}>
            취소
          </button>
          <button type="button" className={btnPrimary} onClick={handleSubmit}>
            담기
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
