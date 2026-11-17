import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { IdentifyPopupState } from './hooks/useFeatureIdentify';
import { getLegendUrl } from './hooks/useFeatureIdentify';

interface Props {
  state: IdentifyPopupState;
  portalTarget: HTMLDivElement;
  onClose: () => void;
  onSelect?: (tableName: string, featureIndex: number, feature: Record<string, unknown>) => void;
  onHover?: (feature: Record<string, unknown> | null) => void;
}

export function FeatureIdentifyPopup({ state, portalTarget, onClose, onSelect, onHover }: Props) {
  const totalCount = state.results.reduce((s, r) => s + r.features.length, 0);

  const content = (
    <div
      className="flex w-72 max-h-80 select-none flex-col overflow-hidden rounded-lg border border-gray-200 bg-background text-[12px] shadow-xl"
      style={{ pointerEvents: 'auto' }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex shrink-0 items-center justify-between rounded-t-lg border-b border-gray-200 bg-gray-50 px-3 py-[7px]">
        <span className="text-[13px] font-medium text-muted-foreground">
          데이터 목록 ({totalCount})
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          className="rounded p-0.5 transition-colors hover:bg-gray-200"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-3.5 w-3.5 text-gray-500" />
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto py-1"
        onMouseLeave={() => onHover?.(null)}
      >
        {state.results.map((layer) =>
          layer.features.map((feat, fi) => (
            <button
              key={`${layer.tableName}-${fi}`}
              type="button"
              onMouseEnter={() => onHover?.(feat.data)}
              onClick={() => onSelect?.(layer.tableName, fi, feat.data)}
              className="flex w-full items-center gap-1 px-3 py-[2px] text-left transition-colors hover:bg-blue-50"
            >
              <img
                src={getLegendUrl(layer.tableName)}
                alt=""
                className="h-5 w-5 shrink-0 object-contain"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              <span className="truncate text-xs text-[#444]">
                <span className="font-normal">{layer.korName}</span>
                {feat.titleValue && (
                  <>
                    <span className="mx-1">|</span>
                    <span>{feat.titleValue}</span>
                  </>
                )}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );

  return createPortal(content, portalTarget);
}
