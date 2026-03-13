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
}

export function FeatureIdentifyPopup({ state, portalTarget, onClose, onSelect }: Props) {
  const totalCount = state.results.reduce((s, r) => s + r.features.length, 0);

  const content = (
    <div
      className="bg-white rounded-lg shadow-xl border border-gray-200 font-size-[12px]w-72 max-h-80 flex flex-col select-none"
      style={{ pointerEvents: 'auto' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-[7px] border-b border-gray-200 bg-gray-50 rounded-t-lg shrink-0">
        <span className="font-medium text-[#666] text-[13px]">
          데이터 목록 ({totalCount})
        </span>
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 rounded hover:bg-gray-200 transition-colors"
        >
          <X className="w-3.5 h-3.5 text-gray-500" />
        </button>
      </div>

      {/* List */}
      <div className="overflow-y-auto flex-1 py-1">
        {state.results.map((layer) =>
          layer.features.map((feat, fi) => (
            <button
              key={`${layer.tableName}-${fi}`}
              type="button"
              onClick={() => onSelect?.(layer.tableName, fi, feat.data)}
              className="w-[265px] text-left px-3 py-[2px] hover:bg-blue-50 flex items-center gap-1 transition-colors"
            >
              <img
                src={getLegendUrl(layer.tableName)}
                alt=""
                className="w-5 h-5 shrink-0 object-contain"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              <span className="text-[#444] text-xs truncate">
                <span className="font-normal">{layer.korName}</span>
                {feat.titleValue && (
                  <>
                    <span className="mx-1">|</span>
                    <span className="">{feat.titleValue}</span>
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
