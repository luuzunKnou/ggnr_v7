'use client';

import { useMemo, useState } from 'react';
import type { OdorSensorListItem } from '@/service/odorSensorService';
import { OdorDeviceStatusPanel } from '@/app/(pages)/(index)/odorPhV2/OdorDeviceStatusPanel';
import { OdorGradeDistributionPanel } from '@/app/(pages)/(index)/odorPhV2/OdorGradeDistributionPanel';
import { OdorCautionAlertList } from '@/app/(pages)/(index)/odorPhV2/OdorCautionAlertList';
import { OdorRecentAlertList } from '@/app/(pages)/(index)/odorPhV2/OdorRecentAlertList';
import { buildDashboardGradeMock } from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock';
import type { OdorIndexMenuId } from '@/app/(pages)/(index)/odorPhV2/odorIndexMenus';

type Props = {
  sensors: OdorSensorListItem[];
  onGoMenu?: (menuId: OdorIndexMenuId) => void;
};

/** 홈 대시보드 — 구성 F 고정 (등급·카드 아래 기기 · 경보) */
export function IndexPageOdorPh({ sensors, onGoMenu }: Props) {
  const { gradeCounts, points, emdStatuses } = useMemo(
    () => buildDashboardGradeMock(sensors),
    [sensors]
  );
  const [highlightSensorKey, setHighlightSensorKey] = useState<string | null>(null);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-2 overflow-hidden lg:grid-cols-[minmax(0,0.95fr)_minmax(280px,1.15fr)]">
      <OdorGradeDistributionPanel
        counts={gradeCounts}
        points={points}
        emdStatuses={emdStatuses}
        sensors={sensors}
        highlightSensorKey={highlightSensorKey}
        belowCards={
          <OdorDeviceStatusPanel
            sensors={sensors}
            selectedSensorKey={highlightSensorKey}
            onSelectSensor={setHighlightSensorKey}
          />
        }
      />
      <div className="grid min-h-0 grid-rows-2 gap-2 overflow-hidden">
        <OdorRecentAlertList onGoAlertList={() => onGoMenu?.('alertList')} />
        <OdorCautionAlertList onGoAlertList={() => onGoMenu?.('alertList')} />
      </div>
    </div>
  );
}
