'use client';

import type { RefObject } from 'react';
import { cn } from '@/lib/utils';
import type { IdentifyFeatureItem, IdentifyLayerResult } from '../hooks/useFeatureIdentify';
import { getLegendUrl } from '../hooks/useFeatureIdentify';

export type IdentifyHitListFlatItem = {
  layer: IdentifyLayerResult;
  feature: IdentifyFeatureItem;
  index: number;
};

function flattenIdentifyResults(results: IdentifyLayerResult[]): IdentifyHitListFlatItem[] {
  const out: IdentifyHitListFlatItem[] = [];
  let index = 0;
  for (const layer of results) {
    for (const feature of layer.features) {
      out.push({ layer: layer as IdentifyLayerResult, feature, index });
      index += 1;
    }
  }
  return out;
}

type Props = {
  results: IdentifyLayerResult[];
  headerLabel: string;
  selectedIndex: number | null;
  selectedRowRef?: RefObject<HTMLButtonElement | null>;
  onItemClick: (item: IdentifyHitListFlatItem) => void;
  onClose: () => void;
  /** false: 하단 닫기 숨김 (데이터조회 상세 열림 시 LayerDataPanel과 동일) */
  showFooterClose?: boolean;
};

export function IdentifyHitListBlock({
  results,
  headerLabel,
  selectedIndex,
  selectedRowRef,
  onItemClick,
  onClose,
  showFooterClose = true,
}: Props) {
  const identifyFlat = flattenIdentifyResults(results);
  const isEmpty = identifyFlat.length === 0;

  return (
    <>
      <div className="flex items-center border-b border-slate-200 bg-slate-100/60 px-4 py-1.5 text-[12px] text-[#666] shrink-0">
        {headerLabel}
        <span className="ml-1.5 text-[11px] text-slate-500">
          ({results.length}개 레이어, {identifyFlat.length}개 데이터)
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isEmpty ? (
          <div className="px-4 py-8 text-center text-[12px] text-slate-500">검색 결과가 없습니다.</div>
        ) : (
        identifyFlat.map(({ layer, feature, index: idx }) => {
          const isHighlighted = selectedIndex === idx;
          return (
            <button
              key={idx}
              type="button"
              ref={isHighlighted ? selectedRowRef : undefined}
              onClick={() => onItemClick({ layer, feature, index: idx })}
              className={cn(
                'flex w-full items-center gap-2 border-b border-slate-100 px-4 py-1 text-left text-[12px] transition-colors hover:bg-primary/5 min-h-0 overflow-hidden',
                isHighlighted && 'bg-primary/10'
              )}
            >
              <img
                src={getLegendUrl(layer.tableName)}
                alt=""
                className="h-5 w-5 shrink-0 object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <span className="min-w-0 flex-1 truncate text-[#666]">
                <span className="text-slate-700">{layer.korName}</span>
                {feature.titleValue && (
                  <>
                    <span className="mx-1 text-slate-400">|</span>
                    <span>{feature.titleValue}</span>
                  </>
                )}
              </span>
              {feature.keywordMatch && (
                <span
                  className="max-w-[min(55%,14rem)] shrink-0 truncate text-right text-[11px] text-slate-500"
                  title={`${feature.keywordMatch.fieldKorName ?? feature.keywordMatch.fieldName}: ${feature.keywordMatch.valuePreview}`}
                >
                  <span className="font-medium text-slate-600">
                    {feature.keywordMatch.fieldKorName ?? feature.keywordMatch.fieldName}
                  </span>
                  <span className="text-slate-400"> · </span>
                  {feature.keywordMatch.valuePreview}
                </span>
              )}
            </button>
          );
        })
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-1.5 bg-slate-50/80 shrink-0">
        <span className="text-[11px] text-[#666]">총 {identifyFlat.length.toLocaleString()}건</span>
        {showFooterClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] text-[#666] transition-colors hover:bg-slate-100"
          >
            닫기
          </button>
        )}
      </div>
    </>
  );
}
