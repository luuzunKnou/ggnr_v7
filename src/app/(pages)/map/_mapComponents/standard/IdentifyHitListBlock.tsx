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
      <div className="flex items-center border-b border-border bg-muted/40 px-4 py-1.5 text-[12px] text-muted-foreground shrink-0">
        {headerLabel}
        <span className="ml-1.5 text-[11px] text-muted-foreground">
          ({results.length}개 레이어, {identifyFlat.length}개 데이터)
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isEmpty ? (
          <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">검색 결과가 없습니다.</div>
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
                'flex w-full items-center gap-2 border-b border-border px-4 py-1 text-left text-[12px] transition-colors hover:bg-primary/5 min-h-0 overflow-hidden',
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
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                <span className="text-foreground">{layer.korName}</span>
                {feature.titleValue && (
                  <>
                    <span className="mx-1 text-muted-foreground">|</span>
                    <span>{feature.titleValue}</span>
                  </>
                )}
              </span>
              {feature.keywordMatch && (
                <span
                  className="max-w-[min(55%,14rem)] shrink-0 truncate text-right text-[11px] text-muted-foreground"
                  title={`${feature.keywordMatch.fieldKorName ?? feature.keywordMatch.fieldName}: ${feature.keywordMatch.valuePreview}`}
                >
                  <span className="font-medium text-muted-foreground">
                    {feature.keywordMatch.fieldKorName ?? feature.keywordMatch.fieldName}
                  </span>
                  <span className="text-muted-foreground"> · </span>
                  {feature.keywordMatch.valuePreview}
                </span>
              )}
            </button>
          );
        })
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-1.5 bg-muted/30 shrink-0">
        <span className="text-[11px] text-muted-foreground">총 {identifyFlat.length.toLocaleString()}건</span>
        {showFooterClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50"
          >
            닫기
          </button>
        )}
      </div>
    </>
  );
}
