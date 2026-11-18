'use client';

import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type TooltipItem,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import type { OdorGradeCounts } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock';

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, Tooltip);

const GRADE_COLORS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: '#22c55e',
  2: '#84cc16',
  3: '#eab308',
  4: '#f97316',
  5: '#ef4444',
};

type Props = {
  counts: OdorGradeCounts;
  total: number;
};

/** Chart.js 가로 누적 막대 — 호버 툴팁용 (클라이언트 전용) */
export function OdorGradeBarChart({ counts, total }: Props) {
  const chartData = useMemo<ChartData<'bar'>>(
    () => ({
      labels: ['등급'],
      datasets: ([1, 2, 3, 4, 5] as const).map((g) => ({
        label: `${g}등급`,
        data: [counts[g]],
        backgroundColor: GRADE_COLORS[g],
        borderWidth: 0,
        barPercentage: 1,
        categoryPercentage: 1,
      })),
    }),
    [counts]
  );

  const chartOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: 0 },
      events: ['mousemove', 'mouseout', 'touchstart', 'touchmove'],
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          mode: 'nearest',
          intersect: true,
          callbacks: {
            title: () => '',
            label: (ctx: TooltipItem<'bar'>) => {
              const v = typeof ctx.parsed.x === 'number' ? ctx.parsed.x : 0;
              const grade = ctx.dataset.label ?? '';
              return `${grade}, ${v}`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          display: false,
          min: 0,
          max: Math.max(total, 1),
          grid: { display: false, drawBorder: false },
          border: { display: false },
        },
        y: {
          stacked: true,
          display: false,
          grid: { display: false, drawBorder: false },
          border: { display: false },
        },
      },
    }),
    [total]
  );

  return (
    <div
      className="h-5 w-full shrink-0 overflow-hidden rounded-[5px]"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Bar data={chartData} options={chartOptions} />
    </div>
  );
}
