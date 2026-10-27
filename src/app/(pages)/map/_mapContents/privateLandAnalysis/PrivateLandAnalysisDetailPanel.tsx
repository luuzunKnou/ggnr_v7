'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchLandInfoConfig } from '@/lib/vworldParcelLandClient';
import { LandInfoParcelPanel } from '../../_mapComponents/landInfo/LandInfoParcelPanel';
import { usePrivateLandAnalysis } from './PrivateLandAnalysisContext';
import { PrivateLandBuildingLedgers } from './PrivateLandBuildingLedgers';
import {
  BUILDING_KIND_LABEL,
  buildingBadgeStyle,
  formatSqm,
  jimokFullName,
  ownGbnBadgeStyle,
} from './privateLandAnalysisFormat';

const LABEL = 'bg-muted px-2 py-1.5 text-[11px] text-muted-foreground break-keep';
const VALUE = 'min-w-0 px-2.5 py-1.5 text-[11px] text-foreground break-all';
const BADGE = 'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none';
/** 분석 정보에 이미 있는 항목 */
const HIDE_BASIC_FIELDS = ['지목', '면적'];

export function PrivateLandAnalysisDetailPanel() {
  const { selectedParcel, selectParcel, layer } = usePrivateLandAnalysis();
  const [config, setConfig] = useState<{ vworldKey: string; dataPortalKey: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchLandInfoConfig()
      .then((cfg) => {
        if (alive) setConfig({ vworldKey: cfg.vworldKey ?? '', dataPortalKey: cfg.dataPortalKey ?? '' });
      })
      .catch(() => {
        if (alive) setConfig({ vworldKey: '', dataPortalKey: '' });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!selectedParcel) return null;
  const p = selectedParcel;
  const isBuilding = p.kind !== 'parcel';
  const rows: { label: string; value: ReactNode }[] =
    p.kind === 'parcel'
      ? [
          { label: '주소', value: p.address || '—' },
          { label: 'PNU', value: p.pnu || '—' },
          { label: '지목', value: jimokFullName(p.jimok) || '—' },
          { label: '필지면적', value: formatSqm(p.areaSqm) },
          { label: '편입면적', value: formatSqm(p.intersectAreaSqm) },
          {
            label: '소유구분',
            value: (
              <span className={BADGE} style={ownGbnBadgeStyle(p.ownGbn)}>
                {p.ownGbn}
              </span>
            ),
          },
          { label: '분석레이어', value: layer?.label ?? '—' },
        ]
      : [
          { label: '주소', value: p.address || '—' },
          { label: 'PNU', value: p.pnu || '—' },
          { label: '지목', value: jimokFullName(p.jimok) || '—' },
          {
            label: '구분',
            value: (
              <span className={BADGE} style={buildingBadgeStyle()}>
                {BUILDING_KIND_LABEL[p.kind]}
              </span>
            ),
          },
          ...(p.name ? [{ label: '건물명', value: p.name }] : []),
          { label: '건물면적', value: formatSqm(p.areaSqm) },
          { label: '편입면적', value: formatSqm(p.intersectAreaSqm) },
          { label: '분석레이어', value: layer?.label ?? '—' },
        ];

  return (
    <div className="flex min-h-0 h-full flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="min-w-0 truncate text-sm font-semibold text-foreground" title={p.address}>
          {isBuilding ? '건물 상세' : '사유지 상세'}
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
          <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] overflow-hidden rounded border border-border">
            {rows.map((row, idx) => (
              <div key={row.label} className="contents">
                <div className={cn(LABEL, idx !== rows.length - 1 && 'border-b border-border')}>{row.label}</div>
                <div className={cn(VALUE, idx !== rows.length - 1 && 'border-b border-border')}>{row.value}</div>
              </div>
            ))}
          </div>
        </section>
        {isBuilding ? (
          p.pnu && config ? (
            <PrivateLandBuildingLedgers key={p.key} pnu={p.pnu} dataPortalKey={config.dataPortalKey} />
          ) : !p.pnu ? (
            <p className="text-[11px] text-muted-foreground">건물이 놓인 필지를 찾지 못해 대장을 조회할 수 없습니다.</p>
          ) : null
        ) : p.pnu && config ? (
          <LandInfoParcelPanel key={p.pnu} pnu={p.pnu} vworldKey={config.vworldKey} narrow hideBasicFields={HIDE_BASIC_FIELDS} />
        ) : null}
      </div>
    </div>
  );
}
