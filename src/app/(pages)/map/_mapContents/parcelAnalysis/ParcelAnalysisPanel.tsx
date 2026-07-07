'use client';

import { X } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import type { ParcelAnalysisArea } from './parcelAnalysisTypes';
import type { ParcelAnalysisGroupDef } from './parcelAnalysisItems';
import { ParcelAnalysisAreaSummary } from './ParcelAnalysisAreaSummary';
import { ParcelAnalysisItemSelector } from './ParcelAnalysisItemSelector';
import { isLargeParcelAnalysisArea } from './parcelAnalysisAnalyzeLimits';

export const PARCEL_ANALYSIS_PANEL_DEFAULT_WIDTH = 280;
export const PARCEL_ANALYSIS_PANEL_MIN_WIDTH = 260;
export const PARCEL_ANALYSIS_PANEL_MAX_WIDTH = 400;

type Props = {
  area: ParcelAnalysisArea | null;
  areaCleared?: boolean;
  groups: ParcelAnalysisGroupDef[];
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  /** 시설 카탈로그·클라이언트 마운트 완료 후 true — 수화 불일치 방지 */
  itemsReady?: boolean;
  onChangeArea: () => void;
  onClearArea: () => void;
  onSpecifyArea: () => void;
  onAnalyze: () => void;
  analyzing?: boolean;
  onClose: () => void;
};

export function ParcelAnalysisPanel({
  area,
  areaCleared,
  groups,
  selectedIds,
  onSelectedIdsChange,
  itemsReady = true,
  onChangeArea,
  onClearArea,
  onSpecifyArea,
  onAnalyze,
  analyzing,
  onClose,
}: Props) {
  const hasArea = area != null;
  const hasItems = selectedIds.size > 0;
  const canAnalyze = hasArea && hasItems && !analyzing;
  const largeAreaWarning = area != null && isLargeParcelAnalysisArea(area);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-white">
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">필지분석</h3>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <span className="text-[11px] text-slate-500">분석 영역·항목 선택</span>
      </header>

      <ParcelAnalysisAreaSummary
        area={area}
        areaCleared={areaCleared}
        onChangeClick={onChangeArea}
        onClearClick={onClearArea}
        onSpecifyClick={onSpecifyArea}
      />

      {!hasArea && !areaCleared && (
        <div className="mx-3 mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] text-amber-900">
          분석 영역을 지정해야 분석 항목을 선택할 수 있습니다.
        </div>
      )}

      {largeAreaWarning ? (
        <div className="mx-3 mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-2 text-[11px] leading-snug text-orange-900">
          분석 영역이 넓습니다. 필지가 많으면 수 분 이상 걸리거나 조회가 중단될 수 있으니, 가능하면
          영역을 나누어 분석하세요.
        </div>
      ) : null}

      <ParcelAnalysisItemSelector
        groups={groups}
        selectedIds={selectedIds}
        onSelectedIdsChange={onSelectedIdsChange}
        disabled={!hasArea}
        itemsReady={itemsReady}
      />

      <div className="shrink-0 border-t border-slate-200 bg-slate-50/80 px-3 py-2">
        <Button
          type="button"
          className="w-full"
          size="sm"
          disabled={!canAnalyze}
          onClick={onAnalyze}
        >
          {analyzing ? '분석 중…' : '분석'}
        </Button>
      </div>
    </aside>
  );
}
