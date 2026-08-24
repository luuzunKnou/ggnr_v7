import { calendarSlotKey, intervalSlotKey } from '@/integrations/integrationSchedule';
import { describeSafetydataSchedule } from '@/integrations/safetydata';
import { FMS_SYNC_SCHEDULE } from '@/integrations/fmsSync.config';
import { runIntegration } from '@/service/integrationService';

const LOG = '[fms-sync-scheduler]';

/**
 * `fmsSync.config` 스케줄·runtime.env FMS_* 기준. 기동 직후 실행 없음.
 * DISABLE_FMS_SYNC_SCHEDULER=1 또는 DISABLED_SCHEDULERS=fmsSync 로 끔.
 * 실행 결과는 수동 연계와 동일하게 integration_job_log 에 기록.
 */
export function startFmsSyncScheduler(): void {
  const sched = FMS_SYNC_SCHEDULE;
  const desc = describeSafetydataSchedule(sched);
  console.info(`${LOG} registered: ${desc}, no run on startup`);

  let lastSlot: string | null = null;

  setInterval(() => {
    const now = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' })
    );
    let slot: string | null = null;
    if (sched.mode === 'interval') {
      slot = intervalSlotKey(sched, now);
    } else {
      slot = calendarSlotKey(sched, now);
    }
    if (!slot) return;
    if (lastSlot === slot) return;
    lastSlot = slot;

    void runIntegration({ system: 'FMS', mode: 'daily', trigger: 'scheduler' })
      .then((r) => {
        console.info(`${LOG} done ijlKey=${r.ijlKey ?? '-'} ok=${r.ok}`);
      })
      .catch((e) => {
        console.warn(`${LOG} fail:`, e instanceof Error ? e.message : e);
      });
  }, 15_000);
}
