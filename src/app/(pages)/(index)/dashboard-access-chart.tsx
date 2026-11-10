'use client';

import { useEffect, useRef, useState } from 'react';

export type DashboardChartPoint = { label: string; count: number };

export const DASHBOARD_ACCESS_CHART_COLOR = '#2563eb';
const CHART_LINE_DRAW_MS = 750;

function niceMax(n: number): number {
  if (n <= 0) return 5;
  const exp = Math.floor(Math.log10(n));
  const f = n / 10 ** exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}

function formatCountValue(v: number): string {
  if (!Number.isFinite(v)) return '';
  return String(Math.round(v));
}

function AnimatedChartPolyline({
  points,
  stroke,
  animKey,
}: {
  points: string;
  stroke: string;
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

/** 메인·시스템관리 접속률 선 그래프 (애니메이션) */
export function DashboardAccessRateLineChart({
  data,
  height = 238,
  emptyMessage = '접속 없음',
  stroke = DASHBOARD_ACCESS_CHART_COLOR,
}: {
  data: DashboardChartPoint[];
  height?: number;
  emptyMessage?: string;
  stroke?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => setWidth(Math.max(120, Math.floor(el.clientWidth)));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (data.length === 0) {
    return <p className="text-xs leading-snug text-muted-foreground">{emptyMessage}</p>;
  }

  const maxVal = niceMax(Math.max(0, ...data.map((d) => d.count)));
  const padL = 6;
  const padR = 6;
  const padT = 10;
  const padB = 14;
  const plotW = Math.max(1, width - padL - padR);
  const plotH = Math.max(1, height - padT - padB);
  const n = data.length;

  const pointX = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const pointY = (v: number) => padT + ((maxVal - v) / Math.max(1, maxVal)) * plotH;
  const axisY = padT + plotH;

  const linePoints = data.map((d, i) => `${pointX(i)},${pointY(d.count)}`).join(' ');
  const lineAnimKey = `${data.map((d) => `${d.label}:${d.count}`).join('|')}:${width}x${height}`;

  return (
    <div ref={wrapRef} className="h-full min-h-0 w-full overflow-hidden">
      <svg width={width} height={height} className="block max-h-full w-full">
        <line x1={padL} y1={axisY} x2={width - padR} y2={axisY} stroke="#cbd5e1" />
        {linePoints ? (
          <AnimatedChartPolyline points={linePoints} stroke={stroke} animKey={lineAnimKey} />
        ) : null}
        {data.map((d, i) => {
          const x = pointX(i);
          const y = pointY(d.count);
          return (
            <g key={d.label}>
              <circle cx={x} cy={y} r="2.5" fill="#fff" stroke={stroke} strokeWidth="1.5" />
              {d.count > 0 ? (
                <text
                  x={x}
                  y={Math.max(padT + 8, y - 5)}
                  textAnchor="middle"
                  className="fill-foreground text-[9px] tabular-nums"
                >
                  {formatCountValue(d.count)}
                </text>
              ) : null}
              <text
                x={x}
                y={height - 4}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
