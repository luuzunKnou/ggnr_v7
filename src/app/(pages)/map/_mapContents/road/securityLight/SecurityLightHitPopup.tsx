'use client';

import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SecurityLightMapHit } from './useSecurityLightMapHighlight';

type Props = {
  hits: SecurityLightMapHit[];
  selectedKey: string | null;
  portalTarget: HTMLDivElement;
  onSelect: (key: string) => void;
  onClose: () => void;
};

/** 지도 Overlay용 — FeatureIdentifyPopup(데이터 목록)과 동일 패턴 */
export function SecurityLightHitPopup({
  hits,
  selectedKey,
  portalTarget,
  onSelect,
  onClose,
}: Props) {
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
          데이터 목록 ({hits.length})
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
      <div className="flex-1 overflow-y-auto py-1">
        {hits.map((hit) => {
          const active = hit.key === selectedKey;
          return (
            <button
              key={hit.key}
              type="button"
              onClick={() => onSelect(hit.key)}
              className={cn(
                'flex w-full items-center gap-1 px-3 py-[3px] text-left transition-colors hover:bg-blue-50',
                active && 'bg-primary/10'
              )}
              title={hit.label}
            >
              <span className="truncate text-xs text-[#444]">{hit.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return createPortal(content, portalTarget);
}
