'use client';

import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { getLegendUrl } from '../../map/_mapComponents/hooks/useFeatureIdentify';
import type { ShapeEditorHitCandidate } from '../_lib/hitCandidates';

type Props = {
  tableName: string;
  candidates: ShapeEditorHitCandidate[];
  portalTarget: HTMLDivElement;
  onSelect: (item: ShapeEditorHitCandidate) => void;
  onClose: () => void;
};

export function ShapeEditorHitPicker({
  tableName,
  candidates,
  portalTarget,
  onSelect,
  onClose,
}: Props) {
  return createPortal(
    <div
      className="flex max-h-80 w-80 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl select-none"
      style={{ pointerEvents: 'auto' }}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/30 px-3 py-[7px]">
        <span className="text-[13px] font-medium text-muted-foreground">
          선택 ({candidates.length})
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 transition-colors hover:bg-muted"
          title="닫기"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {candidates.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            className="flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-blue-50"
          >
            <img
              src={getLegendUrl(tableName)}
              alt=""
              className="mt-0.5 h-5 w-5 shrink-0 object-contain"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">
                {item.primaryLabel}
              </span>
              {item.secondaryLabel ? (
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {item.secondaryLabel}
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </div>,
    portalTarget
  );
}
