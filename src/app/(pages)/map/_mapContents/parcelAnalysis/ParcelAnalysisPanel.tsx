'use client';

import { Button } from '@/app/shadcnComponents/ui/button';
import type { ParcelAnalysisArea } from './parcelAnalysisTypes';
import { ParcelAnalysisAreaSummary } from './ParcelAnalysisAreaSummary';
import { ParcelAnalysisItemSelector } from './ParcelAnalysisItemSelector';

export const PARCEL_ANALYSIS_PANEL_DEFAULT_WIDTH = 280;
export const PARCEL_ANALYSIS_PANEL_MIN_WIDTH = 260;
export const PARCEL_ANALYSIS_PANEL_MAX_WIDTH = 400;

type Props = {
  area: ParcelAnalysisArea | null;
  areaCleared?: boolean;
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  onChangeArea: () => void;
  onClearArea: () => void;
  onSpecifyArea: () => void;
  onAnalyze: () => void;
  analyzing?: boolean;
};

export function ParcelAnalysisPanel({
  area,
  areaCleared,
  selectedIds,
  onSelectedIdsChange,
  onChangeArea,
  onClearArea,
  onSpecifyArea,
  onAnalyze,
  analyzing,
}: Props) {
  const hasArea = area != null;
  const hasItems = selectedIds.size > 0;
  const canAnalyze = hasArea && hasItems && !analyzing;

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-white">
      <header className="border-b border-slate-200 px-3 py-2.5">
        <h1 className="text-sm font-bold text-slate-900">필지분석</h1>
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

      <ParcelAnalysisItemSelector
        selectedIds={selectedIds}
        onSelectedIdsChange={onSelectedIdsChange}
        disabled={!hasArea}
      />

      <div className="border-t border-slate-200 p-3">
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
