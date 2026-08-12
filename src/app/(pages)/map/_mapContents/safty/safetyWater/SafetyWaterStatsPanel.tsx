'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Maximize2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatStatAxisLabel,
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
  yearFromStatBucket,
  type StatsQuickPreset,
} from './safetyWaterTimeRange';
import type {
  FloodTimeType,
  SafetyWaterLevelThresholds,
  SafetyWaterStatPoint,
  SafetyWaterStationKind,
} from './safetyWaterTypes';
import {
  WATER_STATUS_BAND_FILL,
  WATER_STATUS_HEX,
  WATER_STATUS_ICON,
  type ThresholdStageKey,
  type WaterStatusLevel,
} from './safetyWaterStatus';

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
  /** 단건 수위 관측소 제원 — 있으면 밴드·설명 표 표시 */
  waterThresholds?: SafetyWaterLevelThresholds | null;
};

type MergedRow = {
  date: string;
  rain: SafetyWaterStatPoint | null;
  water: SafetyWaterStatPoint | null;
};

const RAIN_COLOR = '#E65100';
const WATER_COLOR = '#0B65C6';
/** 통계 선 그래프 등장(그리기) 애니메이션 */
const CHART_LINE_DRAW_MS = 750;

function AnimatedChartPolyline({
  points,
  stroke,
  animKey,
}: {
  points: string;
  stroke: string;
  /** 데이터·크기 변경 시 재생 */
  animKey: string;
}) {
  const ref = useRef<SVGPolylineElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !points) return;
    const len = el.getTotalLength();
    if (!Number.isFinite(len) || len <= 0) {
      el.style.strokeDasharray = '';
      el.style.strokeDashoffset = '';
      el.style.transition = '';
      return;
    }
    el.style.transition = 'none';
    el.style.strokeDasharray = `${len}`;
    el.style.strokeDashoffset = `${len}`;
    // reflow 후 offset → 0
    void el.getBoundingClientRect();
    el.style.transition = `stroke-dashoffset ${CHART_LINE_DRAW_MS}ms ease-out`;
    el.style.strokeDashoffset = '0';
  }, [points, animKey]);

  return (
    <polyline
      ref={ref}
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      points={points}
    />
  );
}

/** 관심~심각 구간만 (계획홍수위는 그래프 색·선에 미사용) */
const THRESHOLD_BANDS: {
  lo: ThresholdStageKey;
  hi: ThresholdStageKey | null;
  level: WaterStatusLevel;
  fill: string;
}[] = [
  { lo: 'attwl', hi: 'wrnwl', level: '관심', fill: WATER_STATUS_BAND_FILL.관심 },
  { lo: 'wrnwl', hi: 'almwl', level: '주의보', fill: WATER_STATUS_BAND_FILL.주의보 },
  { lo: 'almwl', hi: 'srswl', level: '경보', fill: WATER_STATUS_BAND_FILL.경보 },
  /** 심각: 상한 없음 → 차트 상단까지 */
  { lo: 'srswl', hi: null, level: '심각', fill: WATER_STATUS_BAND_FILL.심각 },
];

const THRESHOLD_ROWS: {
  key: keyof SafetyWaterLevelThresholds;
  code: string;
  label: string;
  unit: string;
  /** null이면 영점표고·계획홍수위처럼 구분색 없음 */
  level: WaterStatusLevel | null;
}[] = [
  { key: 'gdt', code: 'GDT', label: '영점표고', unit: 'EL.m', level: null },
  { key: 'attwl', code: 'ATTWL', label: '관심 수위', unit: 'm', level: '관심' },
  { key: 'wrnwl', code: 'WRNWL', label: '주의보 수위', unit: 'm', level: '주의보' },
  { key: 'almwl', code: 'ALMWL', label: '경보 수위', unit: 'm', level: '경보' },
  { key: 'srswl', code: 'SRSWL', label: '심각 수위', unit: 'm', level: '심각' },
  { key: 'pfh', code: 'PFH', label: '계획홍수위', unit: 'm', level: null },
];

function seriesRange(items: SafetyWaterStatPoint[]) {
  const values = items.map((item) => item.value).filter((value): value is number => value != null);
  if (values.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

function expandWaterRange(
  base: { min: number; max: number },
  thresholds: SafetyWaterLevelThresholds | null | undefined
) {
  if (!thresholds) return base;
  const extras = [thresholds.attwl, thresholds.wrnwl, thresholds.almwl, thresholds.srswl].filter(
    (v): v is number => v != null && Number.isFinite(v) && v > 0
  );
  if (!extras.length) return base;
  const min = Math.min(base.min, ...extras);
  const max = Math.max(base.max, ...extras);
  if (min === max) return { min: min - 1, max: max + 1 };
  const pad = (max - min) * 0.05;
  return { min: min - pad, max: max + pad };
}

function pointX(
  dates: string[],
  index: number,
  chartWidth: number,
  padLeft: number,
  padRight: number = padLeft
) {
  const innerW = Math.max(1, chartWidth - padLeft - padRight);
  return dates.length <= 1 ? padLeft : padLeft + (index * innerW) / (dates.length - 1);
}

function pointY(value: number, chartHeight: number, min: number, max: number) {
  const range = Math.max(1e-6, max - min);
  /** 상단 12 · 하단 축/라벨용 여백 36 */
  return 12 + ((max - value) / range) * (chartHeight - 48);
}

function polylinePoints(
  dates: string[],
  byDate: Map<string, SafetyWaterStatPoint>,
  chartWidth: number,
  chartHeight: number,
  padLeft: number,
  min: number,
  max: number,
  padRight: number = padLeft
) {
  return dates
    .map((date, index) => {
      const value = byDate.get(date)?.value;
      if (value == null) return null;
      const x = pointX(dates, index, chartWidth, padLeft, padRight);
      const y = pointY(value, chartHeight, min, max);
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
  waterThresholds,
  timeType,
  padRight = 10,
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
  waterThresholds?: SafetyWaterLevelThresholds | null;
  timeType: FloodTimeType;
  /** 우측 여백(기준수위 수치 라벨용). 좌측과 달리 플롯을 넓게 쓰기 위해 최소치만 둠 */
  padRight?: number;
}) {
  const padX = 40;
  const padR = Math.max(8, padRight);
  const axisY = height - 28;
  const labelY = height - 8;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const rainPoints = showRain
    ? polylinePoints(dates, rainByDate, width, height, padX, rainRange.min, rainRange.max, padR)
    : '';
  const waterPoints = showWater
    ? polylinePoints(dates, waterByDate, width, height, padX, waterRange.min, waterRange.max, padR)
    : '';
  const lineAnimKey = `${dates.length}:${dates[0] ?? ''}:${dates[dates.length - 1] ?? ''}:${width}x${height}:${showRain}:${showWater}`;
  const maxLabels = Math.max(2, Math.min(6, Math.floor(width / 90)));
  const labelEvery = Math.max(1, Math.ceil(dates.length / maxLabels));

  /** 각 연도 첫 버킷 인덱스 (x축 연도 표기·구분선) */
  const firstIndexOfYear = useMemo(() => {
    const map = new Map<string, number>();
    dates.forEach((date, index) => {
      const y = yearFromStatBucket(date);
      if (!y || map.has(y)) return;
      map.set(y, index);
    });
    return map;
  }, [dates]);

  const yearBoundaryIndexes = useMemo(() => {
    const out: number[] = [];
    firstIndexOfYear.forEach((idx) => {
      if (idx > 0) out.push(idx);
    });
    return out.sort((a, b) => a - b);
  }, [firstIndexOfYear]);

  /** x축 라벨: 연도 표기(긴 문자열)와 짧은 표기가 겹치지 않도록 픽셀 간격으로 선별 */
  const xAxisLabels = useMemo(() => {
    if (dates.length === 0) {
      return [] as {
        index: number;
        date: string;
        includeYear: boolean;
        x: number;
        anchor: 'start' | 'middle' | 'end';
      }[];
    }

    const estimateWidth = (includeYear: boolean) => {
      // fontSize 9 기준 대략치. 연도 포함·시분 포함 시 더 넓음
      if (timeType === '1D') return includeYear ? 58 : 32;
      return includeYear ? 88 : 58;
    };

    type Cand = {
      index: number;
      date: string;
      includeYear: boolean;
      priority: number; // 높을수록 우선 (연도시작·양끝)
    };
    const candidates: Cand[] = [];
    for (let index = 0; index < dates.length; index++) {
      const date = dates[index];
      const year = yearFromStatBucket(date);
      const includeYear = year != null && firstIndexOfYear.get(year) === index;
      const isEdge = index === 0 || index === dates.length - 1;
      const onStride = index % labelEvery === 0;
      if (!isEdge && !includeYear && !onStride) continue;
      if (
        !isEdge &&
        !includeYear &&
        index > labelEvery &&
        dates.length - 1 - index < labelEvery / 2
      ) {
        continue;
      }
      const priority = includeYear ? 3 : isEdge ? 2 : 1;
      candidates.push({ index, date, includeYear, priority });
    }

    const boundsFor = (index: number, x: number, w: number) => {
      if (index === 0) return { left: x, right: x + w };
      if (index === dates.length - 1) return { left: x - w, right: x };
      return { left: x - w / 2, right: x + w / 2 };
    };

    // 우선순위 높은 것부터 배치, 겹치면 낮은 우선순위 버림
    candidates.sort((a, b) => b.priority - a.priority || a.index - b.index);
    const placed: { index: number; date: string; includeYear: boolean; x: number; left: number; right: number }[] =
      [];
    const minGap = 8;

    for (const c of candidates) {
      const x = pointX(dates, c.index, width, padX, padR);
      const w = estimateWidth(c.includeYear);
      const { left, right } = boundsFor(c.index, x, w);
      const overlaps = placed.some((p) => left < p.right + minGap && right > p.left - minGap);
      if (overlaps) continue;
      placed.push({ index: c.index, date: c.date, includeYear: c.includeYear, x, left, right });
    }

    placed.sort((a, b) => a.index - b.index);
    return placed.map((p) => ({
      index: p.index,
      date: p.date,
      includeYear: p.includeYear,
      x: p.x,
      anchor:
        p.index === 0 ? ('start' as const) : p.index === dates.length - 1 ? ('end' as const) : ('middle' as const),
    }));
  }, [dates, firstIndexOfYear, labelEvery, width, padX, padR, timeType]);

  const hoverDate = hoverIndex != null ? dates[hoverIndex] : null;
  const hoverRain = hoverDate && showRain ? rainByDate.get(hoverDate)?.value : null;
  const hoverWater = hoverDate && showWater ? waterByDate.get(hoverDate)?.value : null;
  const hoverX = hoverIndex != null ? pointX(dates, hoverIndex, width, padX, padR) : 0;
  const hoverRainY =
    hoverRain != null ? pointY(hoverRain, height, rainRange.min, rainRange.max) : null;
  const hoverWaterY =
    hoverWater != null ? pointY(hoverWater, height, waterRange.min, waterRange.max) : null;

  const handleMouseMove = (e: MouseEvent<SVGSVGElement>) => {
    if (dates.length === 0) {
      setHoverIndex(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = width / Math.max(1, rect.width);
    const x = (e.clientX - rect.left) * scaleX;
    const innerW = Math.max(1, width - padX - padR);
    if (dates.length <= 1) {
      setHoverIndex(0);
      return;
    }
    const raw = Math.round(((x - padX) / innerW) * (dates.length - 1));
    setHoverIndex(Math.max(0, Math.min(dates.length - 1, raw)));
  };

  const tipLeft = Math.min(Math.max(8, hoverX + 10), Math.max(8, width - 140));
  const tipTop = 8;
  const plotLeft = padX;
  const plotRight = width - padR;
  const plotW = Math.max(1, plotRight - plotLeft);

  // 수위 데이터 실제 최대·최소 (축 확장값과 별개)
  const waterDataExtremes = (() => {
    if (!showWater) return null;
    const values: number[] = [];
    for (const d of dates) {
      const v = waterByDate.get(d)?.value;
      if (v != null && Number.isFinite(v)) values.push(v);
    }
    if (values.length === 0) return null;
    return { min: Math.min(...values), max: Math.max(...values) };
  })();

  const thresholdBands =
    showWater && waterThresholds
      ? THRESHOLD_BANDS.map((band) => {
          const lo = waterThresholds[band.lo];
          if (lo == null || !Number.isFinite(lo) || lo <= 0) return null;
          const hiRaw = band.hi ? waterThresholds[band.hi] : waterRange.max;
          const hi =
            band.hi == null
              ? waterRange.max
              : hiRaw != null && Number.isFinite(hiRaw) && hiRaw > 0
                ? hiRaw
                : null;
          if (hi == null || hi <= lo) return null;
          const yTop = pointY(hi, height, waterRange.min, waterRange.max);
          const yBot = pointY(lo, height, waterRange.min, waterRange.max);
          return {
            key: `${band.lo}-${band.hi ?? 'top'}`,
            y: yTop,
            h: Math.max(1, yBot - yTop),
            fill: band.fill,
          };
        }).filter(Boolean)
      : [];

  const thresholdLines =
    showWater && waterThresholds
      ? (['attwl', 'wrnwl', 'almwl', 'srswl'] as const)
          .map((key) => {
            const v = waterThresholds[key];
            if (v == null || !Number.isFinite(v) || v <= 0) return null;
            return {
              key,
              value: v,
              y: pointY(v, height, waterRange.min, waterRange.max),
            };
          })
          .filter(Boolean)
      : [];

  // 우측 라벨: 기준수위 + 수위 데이터 최대·최소 (겹치면 세로로 살짝 밀어 표시)
  const rightSideLabelYs = (() => {
    const items: { key: string; y: number; value: number; color: string }[] = [];
    const labelColor = (key: string) => {
      if (key === 'attwl') return WATER_STATUS_HEX.관심;
      if (key === 'wrnwl') return WATER_STATUS_HEX.주의보;
      if (key === 'almwl') return WATER_STATUS_HEX.경보;
      if (key === 'srswl') return WATER_STATUS_HEX.심각;
      return WATER_COLOR;
    };
    for (const line of thresholdLines) {
      if (!line) continue;
      items.push({
        key: line.key,
        y: line.y,
        value: line.value,
        color: labelColor(line.key),
      });
    }
    if (waterDataExtremes) {
      items.push({
        key: 'water-max',
        y: pointY(waterDataExtremes.max, height, waterRange.min, waterRange.max),
        value: waterDataExtremes.max,
        color: WATER_COLOR,
      });
      if (waterDataExtremes.min !== waterDataExtremes.max) {
        items.push({
          key: 'water-min',
          y: pointY(waterDataExtremes.min, height, waterRange.min, waterRange.max),
          value: waterDataExtremes.min,
          color: WATER_COLOR,
        });
      }
    }
    items.sort((a, b) => a.y - b.y);

    // 같은 값(소수 둘째 자리)이 여러 단계에 반복될 때 라벨이 아래로 밀리며 잘림.
    // 선들은 그대로 표시하되, 라벨은 값 기준으로 1개만 보여 준다.
    const uniqItems: typeof items = (() => {
      const seen = new Set<string>();
      const out: typeof items = [];
      for (const it of items) {
        const k = it.value.toFixed(2);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(it);
      }
      return out;
    })();

    const placed: { key: string; y: number; value: number; color: string }[] = [];
    const minGap = 11;
    for (const item of uniqItems) {
      let y = item.y;
      const prev = placed[placed.length - 1];
      if (prev && y - prev.y < minGap) y = prev.y + minGap;
      placed.push({ ...item, y });
    }
    return placed;
  })();

  return (
    <div className="relative" onMouseLeave={() => setHoverIndex(null)}>
      <svg
        width={width}
        height={height}
        className="block max-w-full cursor-crosshair"
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={handleMouseMove}
      >
        {thresholdBands.map((b) =>
          b ? (
            <rect
              key={b.key}
              x={plotLeft}
              y={b.y}
              width={plotW}
              height={b.h}
              fill={b.fill}
            />
          ) : null
        )}
        {thresholdLines.map((line) => {
          if (!line) return null;
          const stroke =
            line.key === 'attwl'
              ? WATER_STATUS_HEX.관심
              : line.key === 'wrnwl'
                ? WATER_STATUS_HEX.주의보
                : line.key === 'almwl'
                  ? WATER_STATUS_HEX.경보
                  : line.key === 'srswl'
                    ? WATER_STATUS_HEX.심각
                    : '#94a3b8';
          return (
            <line
              key={line.key}
              x1={plotLeft}
              y1={line.y}
              x2={plotRight}
              y2={line.y}
              stroke={stroke}
              strokeWidth="1"
              strokeDasharray="2 2"
              strokeOpacity="0.7"
            />
          );
        })}
        {rightSideLabelYs.map((lab) => (
          <text
            key={`lab-${lab.key}`}
            x={plotRight + 3}
            y={lab.y + 3}
            fontSize="8"
            textAnchor="start"
            fill={lab.color}
            fontWeight="600"
          >
            {lab.value.toFixed(2)}
          </text>
        ))}
        <line x1={padX} y1={axisY} x2={width - padR} y2={axisY} stroke="#cbd5e1" />
        {showRain ? <line x1={padX} y1="12" x2={padX} y2={axisY} stroke="#cbd5e1" /> : null}
        {showWater ? (
          <line x1={width - padR} y1="12" x2={width - padR} y2={axisY} stroke="#cbd5e1" />
        ) : null}
        {yearBoundaryIndexes.map((idx) => {
          const x = pointX(dates, idx, width, padX, padR);
          return (
            <line
              key={`year-${dates[idx]}`}
              x1={x}
              y1={12}
              x2={x}
              y2={axisY}
              stroke="#94a3b8"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
          );
        })}
        {rainPoints ? (
          <AnimatedChartPolyline points={rainPoints} stroke={RAIN_COLOR} animKey={`rain:${lineAnimKey}`} />
        ) : null}
        {waterPoints ? (
          <AnimatedChartPolyline points={waterPoints} stroke={WATER_COLOR} animKey={`water:${lineAnimKey}`} />
        ) : null}
        {hoverDate ? (
          <>
            <line
              x1={hoverX}
              y1={12}
              x2={hoverX}
              y2={axisY}
              stroke="#94a3b8"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {hoverRainY != null ? (
              <circle cx={hoverX} cy={hoverRainY} r="4" fill="#fff" stroke={RAIN_COLOR} strokeWidth="2" />
            ) : null}
            {hoverWaterY != null ? (
              <circle cx={hoverX} cy={hoverWaterY} r="4" fill="#fff" stroke={WATER_COLOR} strokeWidth="2" />
            ) : null}
          </>
        ) : null}
        {xAxisLabels.map((lab) => (
          <text
            key={`${lab.date}-x`}
            x={lab.x}
            y={labelY}
            fontSize="9"
            textAnchor={lab.anchor}
            fill="#64748b"
          >
            {formatStatAxisLabel(lab.date, timeType, lab.includeYear)}
          </text>
        ))}
        {showRain ? (
          <>
            <text x="4" y="18" fontSize="9" fill={RAIN_COLOR}>
              {rainRange.max.toFixed(1)}
            </text>
            <text x="4" y={axisY - 2} fontSize="9" fill={RAIN_COLOR}>
              {rainRange.min.toFixed(1)}
            </text>
          </>
        ) : null}
      </svg>
      {hoverDate ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[120px] rounded border border-border bg-card/95 px-2 py-1.5 text-[11px] shadow-md"
          style={{ left: tipLeft, top: tipTop }}
        >
          <div className="mb-0.5 font-medium text-foreground/90">{formatStatBucketLabel(hoverDate, timeType)}</div>
          {showRain ? (
            <div style={{ color: RAIN_COLOR }}>
              강수량 {hoverRain != null ? `${hoverRain.toFixed(1)} mm` : '—'}
            </div>
          ) : null}
          {showWater ? (
            <div style={{ color: WATER_COLOR }}>
              수위 {hoverWater != null ? `${hoverWater.toFixed(2)} m` : '—'}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WaterThresholdLegendTable({ thresholds }: { thresholds: SafetyWaterLevelThresholds }) {
  const pairs: [typeof THRESHOLD_ROWS[number], typeof THRESHOLD_ROWS[number] | null][] = [];
  for (let i = 0; i < THRESHOLD_ROWS.length; i += 2) {
    pairs.push([THRESHOLD_ROWS[i], THRESHOLD_ROWS[i + 1] ?? null]);
  }

  const cell = (row: (typeof THRESHOLD_ROWS)[number] | null, splitLeft?: boolean) => {
    const edge = splitLeft ? 'border-l border-border ' : '';
    if (!row) {
      return (
        <>
          <td className={`${edge}relative overflow-hidden p-0`} />
          <td className="max-w-0 px-2 py-1" />
          <td className="px-2 py-1" />
        </>
      );
    }
    const raw = thresholds[row.key];
    const missing = raw == null || !Number.isFinite(raw) || raw <= 0;
    const display = missing ? '—' : `${raw.toFixed(2)} ${row.unit}`;
    const Icon = row.level ? WATER_STATUS_ICON[row.level] : null;
    const iconColor = row.level ? WATER_STATUS_HEX[row.level] : null;
    return (
      <>
        <td className={`${edge}relative overflow-hidden p-0`}>
          {Icon && iconColor ? (
            <span
              title={row.label}
              className="absolute inset-0 flex items-center justify-center"
            >
              <Icon className="h-[18px] w-[18px] shrink-0" style={{ color: iconColor }} strokeWidth={2} aria-hidden />
            </span>
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/70">
              —
            </span>
          )}
        </td>
        <td className="max-w-0 px-2 py-1 text-foreground/90">
          <span className="block break-keep leading-snug" title={row.label}>
            {row.label}
          </span>
        </td>
        <td
          className={cn(
            'whitespace-nowrap px-2 py-1 text-right tabular-nums',
            missing ? 'text-muted-foreground/70' : 'text-foreground'
          )}
        >
          {display}
        </td>
      </>
    );
  };

  return (
    <div className="shrink-0 overflow-hidden rounded border border-border/60">
      <div className="border-b border-border/60 bg-muted/40 px-2 py-1 text-[11px] font-medium text-foreground/90">
        기준 수위
      </div>
      <table className="min-w-full table-fixed text-[11px]">
        <colgroup>
          <col className="w-9" />
          <col />
          <col className="w-[4.75rem]" />
          <col className="w-9" />
          <col />
          <col className="w-[4.75rem]" />
        </colgroup>
        <thead>
          <tr className="text-muted-foreground">
            <th className="relative overflow-hidden p-0 font-medium">
              <span className="absolute inset-0 flex items-center justify-center">구분</span>
            </th>
            <th className="overflow-hidden px-2 py-1 text-left font-medium">
              <span className="block break-keep">항목</span>
            </th>
            <th className="whitespace-nowrap px-2 py-1 text-right font-medium">값</th>
            <th className="relative overflow-hidden border-l border-border p-0 font-medium">
              <span className="absolute inset-0 flex items-center justify-center">구분</span>
            </th>
            <th className="overflow-hidden px-2 py-1 text-left font-medium">
              <span className="block break-keep">항목</span>
            </th>
            <th className="whitespace-nowrap px-2 py-1 text-right font-medium">값</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map(([left, right]) => (
            <tr key={left.key} className="border-t border-border/60">
              {cell(left)}
              {cell(right, true)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartLegend({ showRain, showWater }: { showRain: boolean; showWater: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
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
    const onMove = (e: globalThis.MouseEvent) => {
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
    const onUp = (_e: globalThis.MouseEvent) => {
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
      className="pointer-events-auto fixed z-[80] flex flex-col overflow-hidden rounded-md border border-border bg-card shadow-xl"
      style={{ left: pos.x, top: pos.y, width: size.width, height: size.height }}
      role="dialog"
      aria-label={title}
    >
      <div
        className="flex h-10 shrink-0 cursor-move items-center justify-between gap-2 border-b border-border bg-muted/40 px-3"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          dragRef.current = { ox: e.clientX, oy: e.clientY, px: pos.x, py: pos.y };
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'move';
        }}
      >
        <span className="truncate text-[13px] font-semibold text-foreground">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-foreground/90"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="shrink-0 border-b border-border/60 px-4 py-2">{legend}</div>
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

function MergedChart({
  blocks,
  timeType,
  waterThresholds,
}: {
  blocks: StatsKindBlock[];
  timeType: FloodTimeType;
  waterThresholds?: SafetyWaterLevelThresholds | null;
}) {
  const series = useMergedSeries(blocks);
  const {
    dates,
    rows,
    rainByDate,
    waterByDate,
    rainRange: rainRangeRaw,
    waterRange: waterRangeRaw,
    loading,
    rainBlock,
    waterBlock,
  } = series;
  const showRain = !!rainBlock;
  const showWater = !!waterBlock;
  const showThresholdUi = !!(showWater && waterThresholds);
  const rainRange = rainRangeRaw;
  const waterRange = expandWaterRange(waterRangeRaw, showThresholdUi ? waterThresholds : null);
  const colSpan = 1 + (showRain ? 1 : 0) + (showWater ? 1 : 0);
  const sectionRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(320);
  const [expanded, setExpanded] = useState(false);
  const chartHeight = 168;
  // 우측 수위 최대·최소(+기준수위) 라벨 여유
  const chartPadRight = showWater ? 30 : 10;

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const apply = () => setChartWidth(Math.max(240, Math.floor(el.clientWidth)));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showThresholdUi]);

  const chartProps = {
    dates,
    rainByDate,
    waterByDate,
    rainRange,
    waterRange,
    showRain,
    showWater,
    waterThresholds: showThresholdUi ? waterThresholds : null,
    timeType,
    padRight: chartPadRight,
  };

  const avgRain = (() => {
    const vals = rows.map((r) => r.rain?.value).filter((v): v is number => v != null);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  })();
  const avgWater = (() => {
    const vals = rows.map((r) => r.water?.value).filter((v): v is number => v != null);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  })();

  // sticky 헤더: 불투명 배경 (다크모드에서 스크롤 row 비침 방지)
  const thHead =
    'sticky top-0 z-20 box-border h-8 border-0 border-b border-border bg-muted px-3 py-0 leading-8 text-left font-medium text-muted-foreground';
  const thHeadRight =
    'sticky top-0 z-20 box-border h-8 border-0 border-b border-border bg-muted px-3 py-0 leading-8 text-right font-medium text-muted-foreground';
  const thAvg =
    'sticky top-8 z-20 box-border h-8 border-0 border-b-2 border-border bg-card px-3 py-0 leading-8 text-left font-medium text-foreground/90';
  const thAvgRight =
    'sticky top-8 z-20 box-border h-8 border-0 border-b-2 border-border bg-card px-3 py-0 leading-8 text-right font-medium';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden rounded-[5px] border border-border/90 bg-card p-3 shadow-sm">
      <div className="flex shrink-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <ChartLegend showRain={showRain} showWater={showWater} />
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="cursor-pointer rounded p-1 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground/90"
          title="그래프 확장"
          aria-label="그래프 확장"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div ref={sectionRef} className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-hidden">
        <div className="w-full shrink-0 overflow-hidden">
          <StatsChartSvg width={chartWidth} height={chartHeight} {...chartProps} />
        </div>

        <ChartExpandFloatingModal
          open={expanded}
          onClose={() => setExpanded(false)}
          title="현황 그래프"
          legend={<ChartLegend showRain={showRain} showWater={showWater} />}
        >
          {({ width, height }) => (
            <StatsChartSvg width={width} height={height} {...chartProps} padRight={chartPadRight} />
          )}
        </ChartExpandFloatingModal>

        {showThresholdUi && waterThresholds ? (
          <WaterThresholdLegendTable thresholds={waterThresholds} />
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/90">도표</span>
            <span className="tabular-nums text-muted-foreground" title="도표 행 수">
              총 {rows.length}건
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded border border-border/60">
            <table className="min-w-full border-separate border-spacing-0 text-[11px]">
              <thead>
                <tr>
                  <th className={thHead}>일시</th>
                  {showRain ? <th className={thHeadRight}>강수량(mm)</th> : null}
                  {showWater ? <th className={thHeadRight}>수위(m)</th> : null}
                </tr>
                <tr>
                  <th className={thAvg} scope="row">
                    평균
                  </th>
                  {showRain ? (
                    <th className={cn(thAvgRight, avgRain == null ? 'text-muted-foreground/70' : 'text-foreground')}>
                      {avgRain == null ? '—' : avgRain.toFixed(1)}
                    </th>
                  ) : null}
                  {showWater ? (
                    <th className={cn(thAvgRight, avgWater == null ? 'text-muted-foreground/70' : 'text-foreground')}>
                      {avgWater == null ? '—' : avgWater.toFixed(2)}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.date}>
                    <td className="border-t border-border/60 px-3 py-2 text-foreground/90">
                      {formatStatBucketLabel(row.date, timeType)}
                    </td>
                    {showRain ? (
                      <td
                        className={cn(
                          'border-t border-border/60 px-3 py-2 text-right font-medium',
                          row.rain?.value == null ? 'text-muted-foreground/70' : 'text-foreground'
                        )}
                      >
                        {row.rain?.value == null ? '—' : row.rain.value.toFixed(1)}
                      </td>
                    ) : null}
                    {showWater ? (
                      <td
                        className={cn(
                          'border-t border-border/60 px-3 py-2 text-right font-medium',
                          row.water?.value == null ? 'text-muted-foreground/70' : 'text-foreground'
                        )}
                      >
                        {row.water?.value == null ? '—' : row.water.value.toFixed(2)}
                      </td>
                    ) : null}
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="px-3 py-6 text-center text-muted-foreground/70">
                      {loading ? '불러오는 중…' : '기간 현황이 없습니다.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
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
  waterThresholds = null,
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
      <div className="shrink-0 rounded-[5px] border border-border/90 bg-card p-3 shadow-sm">
        <div className="flex flex-col gap-1.5 text-[11px]">
          <span className="font-medium text-foreground/90">기간 선택</span>
          <p className="text-[10px] leading-snug text-muted-foreground">{rangeNotice}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="shrink-0 text-[10px] text-muted-foreground">빠른 선택</span>
            {quickPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                title={STATS_QUICK_PRESET_LABEL[preset]}
                onClick={() => applyQuick(preset)}
                className="cursor-pointer rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-foreground/90 transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
              >
                {STATS_QUICK_PRESET_LABEL[preset]}
              </button>
            ))}
          </div>
          <div className="flex flex-nowrap items-center gap-1.5">
            <label
              className={cn(
                'inline-flex min-w-0 flex-1 items-center gap-1 rounded border px-1.5 py-1',
                startError ? 'border-red-400 bg-destructive/10' : 'border-border bg-background'
              )}
            >
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
              <input
                type={inputType}
                step={step}
                max={maxValue}
                value={startValue}
                onChange={(e) => onChangeStart(e.target.value)}
                className="min-w-0 flex-1 cursor-pointer bg-transparent text-[10px] text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark]"
                title="시작"
              />
            </label>
            <span className="shrink-0 text-muted-foreground/70">-</span>
            <label
              className={cn(
                'inline-flex min-w-0 flex-1 items-center gap-1 rounded border px-1.5 py-1',
                endError ? 'border-red-400 bg-destructive/10' : 'border-border bg-background'
              )}
            >
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
              <input
                type={inputType}
                step={step}
                max={maxValue}
                value={endValue}
                onChange={(e) => onChangeEnd(e.target.value)}
                className="min-w-0 flex-1 cursor-pointer bg-transparent text-[10px] text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark]"
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

      <MergedChart blocks={blocks} timeType={timeType} waterThresholds={waterThresholds} />
    </div>
  );
}
