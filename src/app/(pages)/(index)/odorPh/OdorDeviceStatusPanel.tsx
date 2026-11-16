'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { OdorSensorListItem } from '@/service/odorSensorService';
import {
  buildAgencyDeviceGroups,
  commRateTrafficColor,
} from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock';
import { cn } from '@/lib/utils';

const DOT_CLASS: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  red: 'bg-red-500',
};

type Props = {
  sensors: OdorSensorListItem[];
  /** 선택된 센서 key (문자열) — 지도 하이라이트와 동기 */
  selectedSensorKey?: string | null;
  onSelectSensor?: (sensorKey: string | null) => void;
};

/** odor_sensor: 업체(agency) 아코디언 → 하위 센서 */
export function OdorDeviceStatusPanel({
  sensors,
  selectedSensorKey = null,
  onSelectSensor,
}: Props) {
  const groups = useMemo(() => buildAgencyDeviceGroups(sensors), [sensors]);
  /** 기본 접힘 */
  const [openAgencies, setOpenAgencies] = useState<string[]>([]);

  const toggle = (agency: string) => {
    setOpenAgencies((prev) =>
      prev.includes(agency) ? prev.filter((a) => a !== agency) : [...prev, agency]
    );
  };

  const deviceTotal = useMemo(
    () => groups.reduce((sum, g) => sum + g.deviceCount, 0),
    [groups]
  );

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border border-border p-2">
      <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">기기 상태</h2>
        <div className="shrink-0 text-[11px] text-muted-foreground">
          총{' '}
          <span className="font-semibold tabular-nums text-foreground">{deviceTotal}</span>개
        </div>
      </div>

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
        {groups.map((row) => {
          const color = commRateTrafficColor(row.rate);
          const open = openAgencies.includes(row.agency);
          return (
            <li key={row.agency} className="overflow-hidden rounded-md border border-border/60">
              <button
                type="button"
                title={open ? `${row.agency} 접기` : `${row.agency} 펼치기`}
                onClick={() => toggle(row.agency)}
                className="flex w-full cursor-pointer items-center gap-1.5 bg-muted/30 px-2 py-1.5 text-left hover:bg-muted/50"
              >
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 self-center text-muted-foreground transition-transform',
                    open ? 'rotate-180' : 'rotate-0'
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[color]}`}
                      title={`통신 정상율 ${row.rate.toFixed(1)}%`}
                      aria-label={`통신 상태 ${color}`}
                    />
                    <span className="truncate text-[12px] font-medium text-foreground">
                      {row.agency}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    센서{' '}
                    <span className="font-semibold text-foreground">{row.deviceCount}</span>대 · 통신{' '}
                    <span className="font-semibold text-foreground">{row.rate.toFixed(1)}%</span>
                  </div>
                </div>
              </button>

              {open ? (
                <ul className="space-y-0.5 border-t border-border/50 bg-background px-1.5 py-1">
                  {row.devices.map((d) => {
                    const selected = selectedSensorKey === d.id;
                    return (
                      <li key={d.id}>
                        <button
                          type="button"
                          title={d.label}
                          onClick={() =>
                            onSelectSensor?.(selected ? null : d.id)
                          }
                          className={cn(
                            'flex w-full cursor-pointer items-center justify-between gap-1 rounded px-1.5 py-1 text-left text-[11px] transition-colors',
                            selected
                              ? 'bg-primary/15 text-foreground ring-1 ring-primary/40'
                              : 'hover:bg-muted/60'
                          )}
                        >
                          <span className="min-w-0 truncate text-foreground">{d.label}</span>
                          <span
                            className={cn(
                              'shrink-0 rounded px-1 py-0.5 text-[9px] font-medium',
                              d.online
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : 'bg-red-500/15 text-red-700 dark:text-red-300'
                            )}
                          >
                            {d.online ? '정상' : '이상'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
