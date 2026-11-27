'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { call } from '@/lib/api';
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll';
import type { SecurityLightSupplyDetail } from './securityLightTypes';

function AttrRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start">
      <div className="standard-detail-attr-label flex min-w-0 w-[72px] shrink-0 items-center self-stretch">
        <span className="min-w-0 w-full whitespace-normal break-keep text-left leading-snug">
          {label}
        </span>
      </div>
      <div className="standard-detail-attr-value min-w-0 flex-1 text-foreground">
        <span className="block truncate leading-snug" title={typeof value === 'string' ? value : undefined}>
          {value}
        </span>
      </div>
    </div>
  );
}

type Props = {
  id: string;
  onClose: () => void;
};

export function SecurityLightSupplyDetailPanel({ id, onClose }: Props) {
  const [item, setItem] = useState<SecurityLightSupplyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void call('', 'POST', {
      service: 'securityLightService',
      action: 'getSupply',
      params: { id },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setItem((data?.item as SecurityLightSupplyDetail | null) ?? null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setItem(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">
            보안등 상세 · 도로과
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            목록으로
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <MapSideDetailScroll className="min-h-0 flex-1 px-2.5 py-2">
        {loading && (
          <div className="py-6 text-center text-[11px] text-muted-foreground">불러오는 중…</div>
        )}
        {!loading && error && (
          <div className="py-6 text-center text-[11px] text-destructive">{error}</div>
        )}
        {!loading && !error && !item && (
          <div className="py-6 text-center text-[11px] text-muted-foreground">
            항목을 찾을 수 없습니다.
          </div>
        )}
        {!loading && item && (
          <div className="space-y-0.5">
            <AttrRow label="관리번호" value={item.manageNo} />
            <AttrRow label="행정동" value={item.manageOrg} />
            <AttrRow label="세부지역" value={item.bjd} />
            <AttrRow label="주소" value={item.hjd} />
            <AttrRow label="램프종류" value={item.lightKind} />
            <AttrRow label="등기구종류" value={item.fixtureModel} />
            <AttrRow label="램프용량" value={item.lightCapacity} />
            <AttrRow label="최초설치일자" value={item.installYmd} />
            <AttrRow label="전주번호" value={item.workNo} />
            <AttrRow label="한전고객번호" value={item.roadSectionNo} />
          </div>
        )}
      </MapSideDetailScroll>
    </div>
  );
}
