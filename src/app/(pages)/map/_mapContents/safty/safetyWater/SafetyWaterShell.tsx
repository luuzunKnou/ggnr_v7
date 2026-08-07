'use client';

import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel';
import { SafetyWaterForecastModal } from './SafetyWaterForecastModal';
import { SafetyWaterMapBindings } from './SafetyWaterMapBindings';
import { SafetyWaterNearbyCctv } from './SafetyWaterNearbyCctv';
import { SafetyWaterPanel } from './SafetyWaterPanel';
import { SafetyWaterStatsSidePanel } from './SafetyWaterStatsSidePanel';
import type { SafetyWaterStationKind } from './safetyWaterTypes';
import { SafetyWaterProvider, useSafetyWater } from './safetyWaterContext';

type ShellProps = {
  listLeftPx: number;
  listWidth: number;
  listMinWidth: number;
  listMaxWidth: number;
  onListWidthChange: (width: number) => void;
  statsLeftPx: number;
  statsWidth: number;
  onStatsWidthChange: (width: number) => void;
  statsMinWidth: number;
  statsMaxWidth: number;
  statsKinds: SafetyWaterStationKind[];
  onStatsKindsChange: (kinds: SafetyWaterStationKind[]) => void;
  onClose: () => void;
};

function SafetyWaterPanels({
  listLeftPx,
  listWidth,
  listMinWidth,
  listMaxWidth,
  onListWidthChange,
  statsLeftPx,
  statsWidth,
  onStatsWidthChange,
  statsMinWidth,
  statsMaxWidth,
  statsKinds,
  onClose,
}: Omit<ShellProps, 'onStatsKindsChange'>) {
  const { closeStats } = useSafetyWater();
  const statsOpen = statsKinds.length > 0;

  return (
    <>
      <SafetyWaterMapBindings />
      <SafetyWaterNearbyCctv />
      <SafetyWaterForecastModal />
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={listWidth}
          minWidth={listMinWidth}
          maxWidth={listMaxWidth}
          leftOffsetPx={listLeftPx}
          onWidthChange={onListWidthChange}
        >
          <SafetyWaterPanel onClose={onClose} />
        </MapSideListPanel>
      </div>
      {statsOpen ? (
        <div className="pointer-events-auto shrink-0">
          <MapSideListPanel
            width={statsWidth}
            minWidth={statsMinWidth}
            maxWidth={statsMaxWidth}
            leftOffsetPx={statsLeftPx}
            onWidthChange={onStatsWidthChange}
            contentClassName="min-h-0 overflow-hidden"
          >
            <SafetyWaterStatsSidePanel onClose={closeStats} />
          </MapSideListPanel>
        </div>
      ) : null}
    </>
  );
}

export function SafetyWaterShell({
  statsKinds,
  onStatsKindsChange,
  ...panelProps
}: ShellProps) {
  return (
    <SafetyWaterProvider statsKinds={statsKinds} onStatsKindsChange={onStatsKindsChange}>
      <SafetyWaterPanels statsKinds={statsKinds} {...panelProps} />
    </SafetyWaterProvider>
  );
}
