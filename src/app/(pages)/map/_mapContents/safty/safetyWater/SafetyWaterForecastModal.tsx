'use client';

import { createPortal } from 'react-dom';
import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, X } from 'lucide-react';
import { MapFloatingPanel } from '@/app/(pages)/map/_mapComponents/MapFloatingPanel';
import {
  FLOAT_PANEL_BELOW_SEARCH_TOP_EXTRA,
  useSearchBarOffset,
} from '@/app/(pages)/map/searchBarOffsetContext';
import { cn } from '@/lib/utils';
import { useSafetyWater } from './safetyWaterContext';
import type { SafetyWaterForecast } from './safetyWaterTypes';

type ForecastChip = '주의보' | '경보';

const FORECAST_CHIPS: { id: ForecastChip; label: string }[] = [
  { id: '주의보', label: '홍수주의보' },
  { id: '경보', label: '홍수경보' },
];

function formatForecastDt(raw: string) {
  const s = raw.replace(/\D/g, '');
  if (s.length >= 12) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
  }
  if (s.length >= 8) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return '—';
}

function displayOrDash(v: string) {
  return v.trim() ? v : '—';
}

function matchesChip(kind: string, chip: ForecastChip) {
  return kind.includes(chip);
}

function ForecastDetailRows({ f }: { f: SafetyWaterForecast }) {
  const rows: { label: string; value: string }[] = [
    { label: '발표자', value: displayOrDash(f.ancnm) },
    { label: '수위 도달 예상일시', value: formatForecastDt(f.fctdt) },
    { label: '홍수예보 번호', value: displayOrDash(f.no) },
    { label: '현재 일시', value: formatForecastDt(f.sttcurdt) },
    { label: '현재 수위표수위', value: f.sttcurhgt.trim() ? `${f.sttcurhgt} m` : '—' },
    { label: '현재 해발수위', value: f.sttcursealvl.trim() ? `${f.sttcursealvl} m` : '—' },
  ];
  return (
    <dl className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-2 text-[12px]">
          <dt className="shrink-0 text-slate-500">{row.label}</dt>
          <dd className="min-w-0 text-right tabular-nums text-slate-700">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SafetyWaterForecastModal() {
  const { forecastOpen, setForecastOpen, forecasts, forecastLoading } = useSafetyWater();
  const { leftPx, topPx } = useSearchBarOffset();
  const [selectedChips, setSelectedChips] = useState<ForecastChip[]>(['주의보', '경보']);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      forecasts.filter((f) =>
        selectedChips.some((chip) => matchesChip(f.kind || '', chip))
      ),
    [forecasts, selectedChips]
  );

  const toggleChip = (chip: ForecastChip) => {
    setSelectedChips((prev) => {
      if (prev.includes(chip)) {
        const next = prev.filter((c) => c !== chip);
        return next.length === 0 ? prev : next;
      }
      return [...prev, chip];
    });
  };

  const anchorPosition = useMemo(
    () => ({ top: topPx + FLOAT_PANEL_BELOW_SEARCH_TOP_EXTRA + 48, left: leftPx }),
    [leftPx, topPx]
  );

  if (!forecastOpen || typeof document === 'undefined') return null;

  return createPortal(
    <MapFloatingPanel
      className="rounded-[5px]"
      width="360px"
      maxHeight="55vh"
      defaultPosition={anchorPosition}
      style={{ position: 'fixed', zIndex: 210 }}
      header={
        <>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" aria-hidden />
            <span className="truncate text-[13px] font-medium text-slate-800">홍수 예보 발령</span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
              (더미)
            </span>
          </div>
          <button
            type="button"
            title="닫기"
            aria-label="닫기"
            onClick={() => setForecastOpen(false)}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3">
        <p className="text-[11px] text-slate-500">현재 시간 기준 최근 24시간 자료 제공</p>
        <div className="flex flex-wrap gap-1.5">
          {FORECAST_CHIPS.map(({ id, label }) => {
            const on = selectedChips.includes(id);
            const isWatch = id === '주의보';
            return (
              <button
                key={id}
                type="button"
                title={label}
                onClick={() => toggleChip(id)}
                className={cn(
                  'cursor-pointer rounded-full px-3 py-1 text-[12px] font-medium transition-colors',
                  !on && 'bg-slate-100 text-slate-500',
                  on && isWatch && 'bg-amber-100 text-amber-800',
                  on && !isWatch && 'bg-rose-100 text-rose-800'
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="min-h-0 max-h-[min(40vh,280px)] flex-1 overflow-y-auto">
          {forecastLoading ? (
            <p className="py-4 text-center text-[12px] text-slate-400">불러오는 중…</p>
          ) : filtered.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-slate-400">해당 없음</p>
          ) : (
            <ul className="space-y-1.5">
              {filtered.map((f, i) => {
                const key = `${f.sttnm}-${f.ancdt}-${f.no}-${i}`;
                const open = expandedKey === key;
                return (
                  <li key={key} className="rounded border border-slate-100 bg-slate-50/80">
                    <button
                      type="button"
                      title={open ? '접기' : '펼치기'}
                      aria-expanded={open}
                      onClick={() => setExpandedKey(open ? null : key)}
                      className="flex w-full cursor-pointer items-start gap-1.5 px-2.5 py-2 text-left"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5 text-[12px]">
                        <div className="font-medium text-slate-800">
                          {displayOrDash(f.kind)}
                          {f.obsnm ? ` · ${f.obsnm}` : ''}
                        </div>
                        <div className="tabular-nums text-slate-500">
                          {formatForecastDt(f.ancdt)}
                          {f.rvrnm ? ` · ${f.rvrnm}` : ''}
                        </div>
                        {f.wrnaranm ? (
                          <div className="truncate text-slate-500">주의 지역 · {f.wrnaranm}</div>
                        ) : null}
                      </div>
                      <ChevronDown
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform',
                          open && 'rotate-180'
                        )}
                        aria-hidden
                      />
                    </button>
                    {open ? (
                      <div className="px-2.5 pb-2">
                        <ForecastDetailRows f={f} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </MapFloatingPanel>,
    document.body
  );
}
