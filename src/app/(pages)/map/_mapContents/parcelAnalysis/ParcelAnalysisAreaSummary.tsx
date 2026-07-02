'use client';

import { MapPin, Pencil } from 'lucide-react';
import type { ParcelAnalysisArea } from './parcelAnalysisTypes';

type Props = {
  area: ParcelAnalysisArea | null;
  /** 영역 확정 후 초기화 등으로 area만 비운 상태 */
  areaCleared?: boolean;
  onChangeClick: () => void;
  onClearClick: () => void;
  onSpecifyClick: () => void;
};

export function ParcelAnalysisAreaSummary({
  area,
  areaCleared = false,
  onChangeClick,
  onClearClick,
  onSpecifyClick,
}: Props) {
  return (
    <div className="border-b border-slate-200 px-3 py-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-800">분석 영역</span>
        {area ? (
          <div className="flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              onClick={onChangeClick}
              className="cursor-pointer text-[11px] font-medium text-blue-600 hover:underline"
            >
              변경
            </button>
            <button
              type="button"
              onClick={onClearClick}
              className="cursor-pointer text-[11px] font-medium text-slate-500 hover:text-slate-800 hover:underline"
            >
              초기화
            </button>
          </div>
        ) : areaCleared ? (
          <button
            type="button"
            onClick={onSpecifyClick}
            className="cursor-pointer text-[11px] font-medium text-blue-600 hover:underline"
          >
            영역 지정
          </button>
        ) : null}
      </div>
      {area ? (
        <div className="flex items-start gap-2 text-xs text-slate-700">
          {area.method === 'boundary' ? (
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-slate-500" />
          ) : (
            <Pencil className="mt-0.5 size-3.5 shrink-0 text-slate-500" />
          )}
          <div className="min-w-0">
            <span className="block">{area.summaryLabel}</span>
            {area.summaryDetail && (
              <span className="mt-0.5 block truncate text-[11px] text-slate-500">{area.summaryDetail}</span>
            )}
          </div>
        </div>
      ) : areaCleared ? (
        <p className="text-xs text-slate-500">분석 영역이 초기화되었습니다. 다시 지정해 주세요.</p>
      ) : (
        <p className="text-xs text-amber-700">분석 영역을 먼저 지정하세요.</p>
      )}
    </div>
  );
}
