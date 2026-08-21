import { calendarSlotKey, intervalSlotKey } from '@/integrations/integrationSchedule';
import { isKrasLayerAutoEnabled } from '@/integrations/krasLayerSync';
import { runKrasFullSync } from '@/integrations/krasLandFileSync';
import { KRAS_LAYER_REFRESH_SCHEDULE } from '@/integrations/krasLayerSync.config';
import { describeSafetydataSchedule } from '@/integrations/safetydata';

const LOG = '[kras-layer-scheduler]';

async function runDailyJob(label: string): Promise<void> {
  if (!isKrasLayerAutoEnabled()) {
    console.info(`${LOG} skipped: 개발 실행이거나 접속정보 없음`);
    return;
  }
  try {
    const r = await runKrasFullSync({ includeShape: true, includePriceFile: true });
    console.info(`${LOG} ok (${label}) success=${r.success} skipped=${r.skipped} failed=${r.failed}`);
  } catch (e) {
    console.warn(`${LOG} fail:`, e instanceof Error ? e.message : e);
  }
}

/** 매일 새벽 1시. 기동 직후 실행 없음. */
export function startKrasLayerScheduler(): void {
  const sched = KRAS_LAYER_REFRESH_SCHEDULE;
  const desc = describeSafetydataSchedule(sched);
  console.info(`${LOG} registered: ${desc}, no run on startup`);

  let lastSlot: string | null = null;

  setInterval(() => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    let slot: string | null = null;
    if (sched.mode === 'interval') {
      slot = intervalSlotKey(sched, now);
    } else {
      slot = calendarSlotKey(sched, now);
    }
    if (!slot) return;
    if (lastSlot === slot) return;
    lastSlot = slot;
    void runDailyJob(desc);
  }, 15_000);
}
