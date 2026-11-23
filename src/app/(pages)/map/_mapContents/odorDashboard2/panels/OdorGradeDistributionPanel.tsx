'use client';

import { useMemo, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Eye, EyeOff } from 'lucide-react';
import type { OdorSensorListItem } from '@/service/odorSensorService';
import {
  buildAgencyDeviceGroups,
  mockAbatementRunningCount,
  sumGradeGroup,
  type EmdGradeStatusMock,
  type OdorGrade,
  type OdorGradeCounts,
  type OdorGradePointMock,
} from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock';
import { GRADE_MAX_PPM } from '@/app/(pages)/(index)/odorPh/odorAlertDetailMock';
import {
  DEFAULT_ODOR_MAP_LAYER_VISIBILITY,
  type OdorMapLayerVisibility,
} from '@/app/(pages)/(index)/odorPh/OdorIndexMiniMap';
import { cn } from '@/lib/utils';

/** 등급 구간 중간 ppm — 분포 평균 표시용 목업 */
function midPpmForGrade(grade: OdorGrade): number {
  const lo = grade <= 1 ? 0 : GRADE_MAX_PPM[(grade - 1) as OdorGrade];
  const hi = GRADE_MAX_PPM[grade];
  return (lo + hi) / 2;
}

const OdorIndexMiniMap = dynamic(
  () =>
    import('@/app/(pages)/(index)/odorPh/OdorIndexMiniMap').then((m) => m.OdorIndexMiniMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center rounded border border-border bg-muted/20 text-xs text-muted-foreground">
        지도 로딩 중…
      </div>
    ),
  }
);

const OdorGradeBarChart = dynamic(
  () => import('./OdorGradeBarChart').then((m) => m.OdorGradeBarChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-5 w-full shrink-0 animate-pulse rounded-[5px] bg-muted/40" />
    ),
  }
);

const GRADE_COLORS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: '#22c55e',
  2: '#84cc16',
  3: '#eab308',
  4: '#f97316',
  5: '#ef4444',
};

type CardKey = 'normal' | 'caution' | 'warning' | 'abatement';

type Props = {
  counts: OdorGradeCounts;
  points: OdorGradePointMock[];
  emdStatuses: EmdGradeStatusMock[];
  sensors: OdorSensorListItem[];
  /** 카드 아래 슬롯 (예: 기기 상태) */
  belowCards?: ReactNode;
  /** 기기 목록 선택 → 지도 하이라이트 */
  highlightSensorKey?: string | null;
  /** true면 임베디드 미니맵 숨김 (지도 플로팅 UI 등) */
  hideMiniMap?: boolean;
};

function countsFromPoints(pts: OdorGradePointMock[]): OdorGradeCounts {
  const c: OdorGradeCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const p of pts) {
    c[p.grade as OdorGrade] += 1;
  }
  return c;
}

/**
 * 지도(항공+emd) | 업체 칩·Chart.js 막대·카드(eye 레이어 토글)
 */
export function OdorGradeDistributionPanel({
  counts: _counts,
  points,
  emdStatuses,
  sensors,
  belowCards,
  highlightSensorKey = null,
  hideMiniMap = false,
}: Props) {
  const agencies = useMemo(
    () => buildAgencyDeviceGroups(sensors).map((g) => g.agency),
    [sensors]
  );
  const [agencyFilter, setAgencyFilter] = useState<string>('all');
  const [layerVisibility, setLayerVisibility] = useState<OdorMapLayerVisibility>(
    DEFAULT_ODOR_MAP_LAYER_VISIBILITY
  );

  const filteredPoints = useMemo(() => {
    if (agencyFilter === 'all') return points;
    return points.filter((p) => p.agency === agencyFilter);
  }, [points, agencyFilter]);

  const filteredCounts = useMemo(() => countsFromPoints(filteredPoints), [filteredPoints]);

  const groups = sumGradeGroup(filteredCounts);
  const total = ([1, 2, 3, 4, 5] as const).reduce((s, g) => s + filteredCounts[g], 0);
  const avgPpm = useMemo(() => {
    if (total <= 0) return null;
    let sum = 0;
    for (const g of [1, 2, 3, 4, 5] as const) {
      sum += midPpmForGrade(g) * filteredCounts[g];
    }
    return sum / total;
  }, [filteredCounts, total]);
  const abatementRunning = mockAbatementRunningCount(total);

  const toggleLayer = (key: CardKey) => {
    setLayerVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const cards: Array<{
    key: CardKey;
    title: string;
    sub: string;
    value: number;
    accent: string;
  }> = [
    {
      key: 'normal',
      title: '정상',
      sub: '1·2등급',
      value: groups.normal,
      accent: '#22c55e',
    },
    {
      key: 'caution',
      title: '주의',
      sub: '3등급',
      value: groups.caution,
      accent: '#eab308',
    },
    {
      key: 'warning',
      title: '경고',
      sub: '4·5등급',
      value: groups.warning,
      accent: '#ef4444',
    },
    {
      key: 'abatement',
      title: '저감설비 가동',
      sub: '목업',
      value: abatementRunning,
      accent: '#3b82f6',
    },
  ];

  return (
    <section
      className={cn(
        'flex min-h-0 flex-col overflow-hidden',
        hideMiniMap ? 'h-auto shrink-0 p-2' : 'h-full border border-border p-3'
      )}
    >
      {!hideMiniMap ? (
        <h2 className="mb-1.5 shrink-0 text-base font-semibold text-foreground">
          실시간 통합 현황
        </h2>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
        {!hideMiniMap ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <OdorIndexMiniMap
              embedded
              points={points}
              emdStatuses={emdStatuses}
              agencyFilter={agencyFilter}
              layerVisibility={layerVisibility}
              highlightSensorKey={highlightSensorKey}
              className="h-full w-full"
            />
          </div>
        ) : null}

        <div
          className={cn(
            'flex shrink-0 flex-col gap-1.5 overflow-hidden',
            hideMiniMap
              ? 'min-h-0 w-full min-w-0 flex-1'
              : 'w-[min(100%,280px)]',
            belowCards ? 'min-h-0 self-stretch' : 'self-start'
          )}
        >
          <div
            className={cn(
              'flex shrink-0 flex-col gap-1.5 overflow-hidden',
              !hideMiniMap && 'rounded border border-border p-2'
            )}
          >
            {!hideMiniMap ? (
              <h3 className="shrink-0 text-[12px] font-semibold text-foreground">악취 등급 분포</h3>
            ) : null}

            <div className="standard-filter-chips shrink-0">
              <button
                type="button"
                title="전체"
                onClick={() => setAgencyFilter('all')}
                className={cn(
                  'standard-filter-chip cursor-pointer',
                  agencyFilter === 'all' && 'standard-filter-chip-active'
                )}
              >
                전체
              </button>
              {agencies.map((agency) => (
                <button
                  key={agency}
                  type="button"
                  title={agency}
                  onClick={() => setAgencyFilter(agency)}
                  className={cn(
                    'standard-filter-chip max-w-[7.5rem] cursor-pointer truncate',
                    agencyFilter === agency && 'standard-filter-chip-active'
                  )}
                >
                  {agency}
                </button>
              ))}
            </div>

            <div className="flex shrink-0 flex-col gap-1">
              <p className="text-right text-[11px] font-medium tabular-nums text-muted-foreground">
                {avgPpm != null ? `평균 ${avgPpm.toFixed(1)} ppm` : '평균 — ppm'}
              </p>
              <OdorGradeBarChart counts={filteredCounts} total={Math.max(total, 1)} />
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-1.5">
              {cards.map((c) => {
                const visible = layerVisibility[c.key];
                return (
                  <div
                    key={c.key}
                    title={`${c.title} ${c.value}`}
                    className={cn(
                      'flex items-center justify-between gap-1.5 rounded-[5px] border border-border bg-card px-2.5 py-2',
                      !hideMiniMap && !visible && 'opacity-70'
                    )}
                    style={{
                      borderLeftWidth: '4px',
                      borderLeftColor: c.accent,
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[10px] font-medium tracking-wide text-muted-foreground/55">
                        {c.title}
                        <span className="ml-1 font-normal normal-case opacity-80">({c.sub})</span>
                      </div>
                      <span className="text-xl font-bold leading-none text-foreground tabular-nums">
                        {c.value}
                      </span>
                    </div>
                    {!hideMiniMap ? (
                      <button
                        type="button"
                        title={visible ? `${c.title} 숨기기` : `${c.title} 보이기`}
                        onClick={() => toggleLayer(c.key)}
                        className="inline-flex shrink-0 cursor-pointer items-center self-center text-muted-foreground hover:text-foreground"
                      >
                        {visible ? (
                          <Eye className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {belowCards ? (
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{belowCards}</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
