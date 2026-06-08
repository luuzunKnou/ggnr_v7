'use client';

import { useCallback, useState } from 'react';
import { Droplets, Gauge, MapPin, RefreshCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';

function formatTime(d: Date) {
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

type Props = {
  onClose: () => void;
};

/**
 * 침수·홍수 현황 — 강수량 / 수위 / 피해 예상 지역만 표시 (데이터는 추후 API 연동).
 */
export function SafetyWaterPanel({ onClose }: Props) {
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    window.setTimeout(() => {
      setLastRefresh(new Date());
      setRefreshing(false);
    }, 350);
  }, []);

  return (
    <div
      className="flex flex-1 min-h-0 flex-col overflow-hidden opacity-[0.98]"
      aria-label="침수 홍수 현황"
    >
      <div className="shrink-0 border-b border-slate-200 bg-gradient-to-b from-[#f0f9fc] to-white px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-[15px] font-semibold leading-tight text-slate-800">침수·홍수 현황</h2>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              강수량·수위·피해 예상 지역을 한 화면에서 확인합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2 border-t border-slate-200/80 pt-3">
          <span className="text-[11px] text-slate-500">마지막 갱신</span>
          <span className="text-[11px] font-medium tabular-nums text-slate-700">
            {lastRefresh ? formatTime(lastRefresh) : '—'}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              refreshing ? 'cursor-wait text-slate-400' : 'text-primary hover:bg-primary/10'
            )}
            aria-label="현황 새로고침"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            새로고침
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-slate-50/90 p-3">
        <section
          className="rounded-[5px] border border-slate-200/90 bg-white p-3 shadow-sm"
          aria-labelledby="safety-water-rain-heading"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
            <Droplets className="h-4 w-4 shrink-0 text-sky-600" strokeWidth={1.75} aria-hidden />
            <h3 id="safety-water-rain-heading" className="text-[12px] font-semibold text-slate-800">
              강수량
            </h3>
          </div>
          <dl className="mt-2 space-y-1.5 text-[11px]">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">누적(1h)</dt>
              <dd className="font-medium tabular-nums text-slate-800">— mm</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">기준 시각</dt>
              <dd className="tabular-nums text-slate-600">{lastRefresh ? formatTime(lastRefresh) : '—'}</dd>
            </div>
          </dl>
          <p className="mt-2 border-t border-slate-100 pt-2 text-[10px] leading-snug text-slate-500">
            기상청 API 연동 후 표시됩니다.
          </p>
        </section>

        <section
          className="rounded-[5px] border border-slate-200/90 bg-white p-3 shadow-sm"
          aria-labelledby="safety-water-level-heading"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
            <Gauge className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
            <h3 id="safety-water-level-heading" className="text-[12px] font-semibold text-slate-800">
              수위
            </h3>
          </div>
          <dl className="mt-2 space-y-2 text-[11px]">
            <div className="flex justify-between gap-2">
              <dt className="min-w-0 truncate text-slate-500">대표 지점</dt>
              <dd className="shrink-0 font-medium tabular-nums text-slate-800">— m</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">상태</dt>
              <dd className="text-slate-600">—</dd>
            </div>
          </dl>
          <p className="mt-2 border-t border-slate-100 pt-2 text-[10px] leading-snug text-slate-500">
            하천·수위 관측 연동 후 표시됩니다.
          </p>
        </section>

        <section
          className="rounded-[5px] border border-slate-200/90 bg-white p-3 shadow-sm"
          aria-labelledby="safety-water-risk-heading"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
            <MapPin className="h-4 w-4 shrink-0 text-amber-600" strokeWidth={1.75} aria-hidden />
            <h3 id="safety-water-risk-heading" className="text-[12px] font-semibold text-slate-800">
              피해 예상 지역
            </h3>
          </div>
          <p className="mt-2 text-[13px] font-semibold tabular-nums text-slate-900">
            예상 <span className="text-primary">—</span> 건
            <span className="ml-1 text-[11px] font-normal text-slate-500">(필지·블록)</span>
          </p>
          <button
            type="button"
            disabled
            className="mt-3 w-full rounded-[5px] border border-dashed border-slate-200 bg-slate-50 py-2 text-[11px] font-medium text-slate-400"
            title="데이터 연동 후 지도에 표시됩니다"
          >
            지도에서 보기
          </button>
          <p className="mt-2 text-[10px] leading-snug text-slate-500">
            분석 결과가 준비되면 지도 하이라이트와 목록이 연결됩니다.
          </p>
        </section>

        <p className="px-0.5 text-[10px] leading-snug text-slate-500">
          본 정보는 참고용이며, 실제 대피·통제는 담당 기관 안내를 따르세요.
        </p>
      </div>
    </div>
  );
}
