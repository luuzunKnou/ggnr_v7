'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchLandInfoConfig } from '@/lib/vworldParcelLandClient';
import { LandInfoParcelPanel } from '../../_mapComponents/landInfo/LandInfoParcelPanel';
import { usePrivateLandAnalysis } from './PrivateLandAnalysisContext';
import { formatSqm, ownGbnBadgeStyle } from './privateLandAnalysisFormat';

const LABEL = 'bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap';
const VALUE = 'min-w-0 px-2.5 py-1.5 text-[11px] text-foreground break-all';
/** 분석 정보에 이미 있는 항목 */
const HIDE_BASIC_FIELDS = ['지목', '면적'];

export function PrivateLandAnalysisDetailPanel() {
  const { selectedParcel, selectParcel, layer } = usePrivateLandAnalysis();
  const [vworldKey, setVworldKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchLandInfoConfig()
      .then((cfg) => {
        if (alive) setVworldKey(cfg.vworldKey ?? '');
      })
      .catch(() => {
        if (alive) setVworldKey('');
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!selectedParcel) return null;
  const p = selectedParcel;
  const rows: { label: string; value: ReactNode }[] = [
    { label: '주소', value: p.address || '—' },
    { label: 'PNU', value: p.pnu || '—' },
    { label: '지목', value: p.jimok || '—' },
    { label: '필지면적', value: formatSqm(p.areaSqm) },
    { label: '편입면적', value: formatSqm(p.intersectAreaSqm) },
    {
      label: '소유구분',
      value: (
        <span
          className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none"
          style={ownGbnBadgeStyle(p.ownGbn)}
        >
          {p.ownGbn}
        </span>
      ),
    },
    { label: '분석레이어', value: layer?.label ?? '—' },
  ];

  return (
    <div className="flex min-h-0 h-full flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="min-w-0 truncate text-sm font-semibold text-foreground" title={p.address}>
          사유지 상세
        </span>
        <button
          type="button"
          onClick={() => selectParcel(null)}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden p-3 scrollbar-thin">
        <section className="space-y-1.5">
          <p className="text-xs font-semibold text-foreground">분석 정보</p>
          <div className="grid grid-cols-[max-content_minmax(0,1fr)] overflow-hidden rounded border border-border">
            {rows.map((row, idx) => (
              <div key={row.label} className="contents">
                <div className={cn(LABEL, idx !== rows.length - 1 && 'border-b border-border')}>{row.label}</div>
                <div className={cn(VALUE, idx !== rows.length - 1 && 'border-b border-border')}>{row.value}</div>
              </div>
            ))}
          </div>
        </section>
        {p.pnu && vworldKey != null ? (
          <LandInfoParcelPanel key={p.pnu} pnu={p.pnu} vworldKey={vworldKey} narrow hideBasicFields={HIDE_BASIC_FIELDS} />
        ) : null}
      </div>
    </div>
  );
}
