'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Maximize2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatStatBucketLabel,
  inputStepForTime,
  inputTypeForTime,
  isNotFuture,
  isStatsRangeValid,
  maxInputValue,
  maxRangeNotice,
  availableQuickPresets,
  quickStatsRange,
  STATS_QUICK_PRESET_LABEL,
  type StatsQuickPreset,
} from './safetyWaterTimeRange';
import type { FloodTimeType, SafetyWaterStatPoint, SafetyWaterStationKind } from './safetyWaterTypes';

export type StatsKindBlock = {
  kind: SafetyWaterStationKind;
  kindLabel: string;
  items: SafetyWaterStatPoint[];
  loading: boolean;
};

type Props = {
  blocks: StatsKindBlock[];
  timeType: FloodTimeType;
  startValue: string;
  endValue: string;
  rangeNotice: string;
  onChangeStart: (value: string) => void;
  onChangeEnd: (value: string) => void;
  onApplyRange: (start: string, end: string) => void;
};

type MergedRow = {
  date: string;
  rain: SafetyWaterStatPoint | null;
  water: SafetyWaterStatPoint | null;
};

const RAIN_COLOR = '#16a34a';
const WATER_COLOR = '#de7979';

function seriesRange(items: SafetyWaterStatPoint[]) {
  const values = items.map((item) => item.value).filter((value): value is number => value != null);
  if (values.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

function polylinePoints(
  dates: string[],
  byDate: Map<string, SafetyWaterStatPoint>,
  chartWidth: number,
  chartHeight: number,
  padX: number,
  min: number,
  max: number
) {
  const range = Math.max(1e-6, max - min);
  const innerW = Math.max(1, chartWidth - padX * 2);
  return dates
    .map((date, index) => {
      const value = byDate.get(date)?.value;
      if (value == null) return null;
      const x = dates.length <= 1 ? padX : padX + (index * innerW) / (dates.length - 1);
      const y = 12 + ((max - value) / range) * (chartHeight - 28);
      return `${x},${y}`;
    })
    .filter(Boolean)
    .join(' ');
}

function useMergedSeries(blocks: StatsKindBlock[]) {
  return useMemo(() => {
    const rainBlock = blocks.find((b) => b.kind === 'rain') ?? null;
    const waterBlock = blocks.find((b) => b.kind === 'water') ?? null;
    const rainMap = new Map((rainBlock?.items ?? []).map((item) => [item.date, item]));
    const waterMap = new Map((waterBlock?.items ?? []).map((item) => [item.date, item]));
    const dateSet = new Set<string>([...rainMap.keys(), ...waterMap.keys()]);
    const dates = [...dateSet].sort();
    const rows: MergedRow[] = dates.map((date) => ({
      date,
      rain: rainMap.get(date) ?? null,
      water: waterMap.get(date) ?? null,
    }));
    return {
      rainBlock,
      waterBlock,
      dates,
      rows,
      rainByDate: rainMap,
      waterByDate: waterMap,
      loading: blocks.some((b) => b.loading),
      rainRange: seriesRange(rainBlock?.items ?? []),
      waterRange: seriesRange(waterBlock?.items ?? []),
    };
  }, [blocks]);
}

function StatsChartSvg({
  width,
  height,
  dates,
  rainByDate,
  waterByDate,
  rainRange,
  waterRange,
  showRain,
  showWater,
}: {
  width: number;
  height: number;
  dates: string[];
  rainByDate: Map<string, SafetyWaterStatPoint>;
  waterByDate: Map<string, SafetyWaterStatPoint>;
  rainRange: { min: number; max: number };
  waterRange: { min: number; max: number };
  showRain: boolean;
  showWater: boolean;
}) {
  const padX = 40;
  const rainPoints = showRain
    ? polylinePoints(dates, rainByDate, width, height, padX, rainRange.min, rainRange.max)
    : '';
  const waterPoints = showWater
    ? polylinePoints(dates, waterByDate, width, height, padX, waterRange.min, waterRange.max)
    : '';
  const maxLabels = Math.max(2, Math.min(6, Math.floor(width / 90)));
  const labelEvery = Math.max(1, Math.ceil(dates.length / maxLabels));

  return (
    <svg width={width} height={height} className="block max-w-full" viewBox={`0 0 ${width} ${height}`}>
      <line x1={padX} y1={height - 16} x2={width - padX} y2={height - 16} stroke="#cbd5e1" />
      {showRain ? <line x1={padX} y1="12" x2={padX} y2={height - 16} stroke="#cbd5e1" /> : null}
      {showWater ? (
        <line x1={width - padX} y1="12" x2={width - padX} y2={height - 16} stroke="#cbd5e1" />
      ) : null}
      {rainPoints ? <polyline fill="none" stroke={RAIN_COLOR} strokeWidth="2" points={rainPoints} /> : null}
      {waterPoints ? <polyline fill="none" stroke={WATER_COLOR} strokeWidth="2" points={waterPoints} /> : null}
      {dates.map((date, index) => {
        const isEdge = index === 0 || index === dates.length - 1;
        const show = isEdge || index % labelEvery === 0;
        if (!show) return null;
        // 마지막 라벨이 직전과 너무 가까우면 생략
        if (!isEdge && index > labelEvery && dates.length - 1 - index < labelEvery / 2) return null;
        const x =
          dates.length <= 1 ? padX : padX + (index * (width - padX * 2)) / Math.max(1, dates.length - 1);
        return (
          <text key={`${date}-x`} x={x} y={height - 2} fontSize="9" textAnchor="middle" fill="#64748b">
            {formatStatBucketLabel(date)}
          </text>
        );
      })}
      {showRain ? (
        <>
          <text x="4" y="18" fontSize="9" fill={RAIN_COLOR}>
            {rainRange.max.toFixed(1)}
          </text>
          <text x="4" y={height - 18} fontSize="9" fill={RAIN_COLOR}>
            {rainRange.min.toFixed(1)}
          </text>
        </>
      ) : null}
      {showWater ? (
        <>
          <text x={width - 4} y="18" fontSize="9" textAnchor="end" fill={WATER_COLOR}>
            {waterRange.max.toFixed(2)}
          </text>
          <text x={width - 4} y={height - 18} fontSize="9" textAnchor="end" fill={WATER_COLOR}>
            {waterRange.min.toFixed(2)}
          </text>
        </>
      ) : null}
    </svg>
  );
}

function ChartLegend({ showRain, showWater }: { showRain: boolean; showWater: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
      {showRain ? (
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 rounded" style={{ background: RAIN_COLOR }} />
          강수량(mm)
        </span>
      ) : null}
      {showWater ? (
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 rounded" style={{ background: WATER_COLOR }} />
          수위(m)
        </span>
      ) : null}
    </div>
  );
}

function ChartExpandFloatingModal({
  open,
  onClose,
  title,
  legend,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  legend: ReactNode;
  children: (size: { width: number; height: number }) => ReactNode;
}) {
  const [pos, setPos] = useState({ x: 120, y: 80 });
  const [size, setSize] = useState({ width: 720, height: 460 });
  const dragRef = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);
  const resizeRef = useRef<{ ox: number; oy: number; w: number; h: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const d = dragRef.current;
        setPos({
          x: Math.max(0, d.px + e.clientX - d.ox),
          y: Math.max(0, d.py + e.clientY - d.oy),
        });
      }
      if (resizeRef.current) {
        const r = resizeRef.current;
        setSize({
          width: Math.max(420, r.w + e.clientX - r.ox),
          height: Math.max(280, r.h + e.clientY - r.oy),
        });
      }
    };
    const onUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const chartW = Math.max(320, size.width - 32);
  const chartH = Math.max(160, size.height - 108);

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[80] flex flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl"
      style={{ left: pos.x, top: pos.y, width: size.width, height: size.height }}
      role="dialog"
      aria-label={title}
    >
      <div
        className="flex h-10 shrink-0 cursor-move items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          dragRef.current = { ox: e.clientX, oy: e.clientY, px: pos.x, py: pos.y };
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'move';
        }}
      >
        <span className="truncate text-[13px] font-semibold text-slate-800">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="shrink-0 border-b border-slate-100 px-4 py-2">{legend}</div>
      <div className="min-h-0 flex-1 p-4">{children({ width: chartW, height: chartH })}</div>
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          resizeRef.current = { ox: e.clientX, oy: e.clientY, w: size.width, h: size.height };
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'se-resize';
        }}
        title="크기 조절"
        aria-label="크기 조절"
      />
    </div>,
    document.body
  );
}

function MergedChart({ blocks }: { blocks: StatsKindBlock[] }) {
  const series = useMergedSeries(blocks);
  const {
    dates,
    rows,
    rainByDate,
    waterByDate,
    rainRange,
    waterRange,
    loading,
    rainBlock,
    waterBlock,
  } = series;
  const showRain = !!rainBlock;
  const showWater = !!waterBlock;
  const colSpan = 1 + (showRain ? 1 : 0) + (showWater ? 1 : 0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(320);
  const [expanded, setExpanded] = useState(false);
  const chartHeight = 160;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => setChartWidth(Math.max(240, Math.floor(el.clientWidth)));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chartProps = {
    dates,
    rainByDate,
    waterByDate,
    rainRange,
    waterRange,
    showRain,
    showWater,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-[5px] border border-slate-200/90 bg-white p-3 shadow-sm">
      <div className="flex shrink-0 items-center justify-between gap-2 text-[11px] text-slate-500">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="font-medium text-slate-700">그래프</span>
          <ChartLegend showRain={showRain} showWater={showWater} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span>{loading ? '불러오는 중…' : `${dates.length}건`}</span>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="cursor-pointer rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            title="그래프 확장"
            aria-label="그래프 확장"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="w-full shrink-0 overflow-hidden">
        <StatsChartSvg width={chartWidth} height={chartHeight} {...chartProps} />
      </div>

      <ChartExpandFloatingModal
        open={expanded}
        onClose={() => setExpanded(false)}
        title="통계 그래프"
        legend={<ChartLegend showRain={showRain} showWater={showWater} />}
      >
        {({ width, height }) => <StatsChartSvg width={width} height={height} {...chartProps} />}
      </ChartExpandFloatingModal>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mb-1 flex shrink-0 items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="font-medium text-slate-700">테이블</span>
          <span className="tabular-nums text-slate-600" title="테이블 행 수">
            총 {rows.length}건
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-100">
          <table className="min-w-full text-[11px]">
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">시각</th>
                {showRain ? <th className="px-3 py-2 text-right font-medium">강수량(mm)</th> : null}
                {showWater ? <th className="px-3 py-2 text-right font-medium">수위(m)</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-700">{formatStatBucketLabel(row.date)}</td>
                  {showRain ? (
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-medium',
                        row.rain?.value == null ? 'text-slate-400' : 'text-slate-800'
                      )}
                    >
                      {row.rain?.value == null ? '—' : row.rain.value.toFixed(1)}
                    </td>
                  ) : null}
                  {showWater ? (
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-medium',
                        row.water?.value == null ? 'text-slate-400' : 'text-slate-800'
                      )}
                    >
                      {row.water?.value == null ? '—' : row.water.value.toFixed(2)}
                    </td>
                  ) : null}
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-3 py-6 text-center text-slate-400">
                    {loading ? '불러오는 중…' : '기간 통계가 없습니다.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function SafetyWaterStatsPanel({
  blocks,
  timeType,
  startValue,
  endValue,
  rangeNotice,
  onChangeStart,
  onChangeEnd,
  onApplyRange,
}: Props) {
  const inputType = inputTypeForTime(timeType);
  const step = inputStepForTime(timeType);
  const maxValue = maxInputValue(timeType);
  const startFuture = !isNotFuture(startValue, timeType);
  const endFuture = !isNotFuture(endValue, timeType);
  const rangeTooLong =
    !startFuture && !endFuture && startValue && endValue && !isStatsRangeValid(timeType, startValue, endValue);
  const startError = startFuture ? '미래 시각은 선택할 수 없습니다.' : null;
  const endError = endFuture
    ? '미래 시각은 선택할 수 없습니다.'
    : rangeTooLong
      ? maxRangeNotice(timeType)
      : null;
  const quickPresets = availableQuickPresets(timeType);

  const applyQuick = (preset: StatsQuickPreset) => {
    const next = quickStatsRange(preset, timeType);
    onApplyRange(next.start, next.end);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="shrink-0 rounded-[5px] border border-slate-200/90 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-1.5 text-[11px]">
          <span className="font-medium text-slate-700">기간 선택</span>
          <p className="text-[10px] leading-snug text-slate-500">{rangeNotice}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="shrink-0 text-[10px] text-slate-500">빠른 선택</span>
            {quickPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                title={STATS_QUICK_PRESET_LABEL[preset]}
                onClick={() => applyQuick(preset)}
                className="cursor-pointer rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-700 transition-colors hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800"
              >
                {STATS_QUICK_PRESET_LABEL[preset]}
              </button>
            ))}
          </div>
          <div className="flex flex-nowrap items-center gap-1.5">
            <label
              className={cn(
                'inline-flex min-w-0 flex-1 items-center gap-1 rounded border px-1.5 py-1',
                startError ? 'border-red-400 bg-red-50/60' : 'border-slate-200'
              )}
            >
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <input
                type={inputType}
                step={step}
                max={maxValue}
                value={startValue}
                onChange={(e) => onChangeStart(e.target.value)}
                className="min-w-0 flex-1 cursor-pointer bg-transparent text-[10px] outline-none"
                title="시작"
              />
            </label>
            <span className="shrink-0 text-slate-400">-</span>
            <label
              className={cn(
                'inline-flex min-w-0 flex-1 items-center gap-1 rounded border px-1.5 py-1',
                endError ? 'border-red-400 bg-red-50/60' : 'border-slate-200'
              )}
            >
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <input
                type={inputType}
                step={step}
                max={maxValue}
                value={endValue}
                onChange={(e) => onChangeEnd(e.target.value)}
                className="min-w-0 flex-1 cursor-pointer bg-transparent text-[10px] outline-none"
                title="종료"
              />
            </label>
          </div>
          {startError || endError ? (
            <div className="space-y-0.5 text-[10px] leading-snug text-red-600">
              {startError ? <p>시작: {startError}</p> : null}
              {endError ? <p>종료: {endError}</p> : null}
            </div>
          ) : null}
        </div>
      </div>

      <MergedChart blocks={blocks} />
    </div>
  );
}
