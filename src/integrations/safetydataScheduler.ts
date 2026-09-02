import { KAIS_REFRESH_SCHEDULE } from '@/integrations/kais.config';
import { SAFETYDATA_DATASETS, type SafetydataRefreshSchedule } from '@/integrations/safetydata.config';
import { hasSafetydataDatasetApiKey } from '@/integrations/safetydataHttp';
import { calendarSlotKey, intervalSlotKey } from '@/integrations/integrationSchedule';
import { describeSafetydataSchedule } from '@/integrations/safetydata';
import { ingestSafetydataDatasetToLayer } from '@/integrations/safetydataIngest';

const LOG = '[safetydata-scheduler]';

/**
 * `next dev`에서만 5분 interval 데이터셋을 운영과 동일한 daily 슬롯(kais.config의 일일 시각)으로만 실행.
 * 프로덕션에서는 기존처럼 시계 5분 격자.
 */
function scheduleForSlotComputation(sched: SafetydataRefreshSchedule): SafetydataRefreshSchedule {
  if (
    process.env.NODE_ENV === 'development' &&
    sched.mode === 'interval' &&
    sched.minutes === 5
  ) {
    const k = KAIS_REFRESH_SCHEDULE;
    if (k.mode === 'daily') {
      return { mode: 'daily', hour: k.hour, minute: k.minute };
    }
  }
  return sched;
}

async function runIngest(datasetId: string, label: string): Promise<void> {
  try {
    await ingestSafetydataDatasetToLayer(datasetId);
    console.info(`${LOG} ok ${datasetId} (${label})`);
  } catch (e) {
    console.warn(`${LOG} fail ${datasetId}:`, e instanceof Error ? e.message : e);
  }
}

/**
 * `safetydata.config`의 refreshSchedule별 적재.
 * - 일/주/월: 해당 시·분 슬롯 1회
 * - interval: 시계 격자(예: 5분이면 :00,:05,…,:55)마다 1회 — 기동 직시 실행 없음
 *   (개발 모드에서 5분 interval만 daily 배치 시각 1회로 축소)
 */
export function startSafetydataScheduler(): void {
  const withKey = SAFETYDATA_DATASETS.filter((d) => hasSafetydataDatasetApiKey(d) && !d.excludeFromAutoScheduler);
  if (withKey.length === 0) {
    console.info(`${LOG} skip: no datasets with API keys`);
    return;
  }

  console.info(
    `${LOG} registered: per-dataset schedules (${withKey.length} datasets), no run on startup`
  );

  const lastSlot = new Map<string, string>();

  setInterval(() => {
    const now = new Date();
    for (const d of withKey) {
      const sched = scheduleForSlotComputation(d.refreshSchedule);
      const label = describeSafetydataSchedule(sched);

      let slot: string | null = null;
      if (sched.mode === 'interval') {
        slot = intervalSlotKey(sched, now);
      } else {
        slot = calendarSlotKey(sched, now);
      }
      if (!slot) continue;
      if (lastSlot.get(d.id) === slot) continue;
      lastSlot.set(d.id, slot);
      void runIngest(d.id, label);
    }
  }, 15_000);
}
