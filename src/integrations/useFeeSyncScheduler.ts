import { calendarSlotKey, intervalSlotKey } from '@/integrations/integrationSchedule';
import { describeSafetydataSchedule } from '@/integrations/safetydata';
import { USE_FEE_SYNC_SCHEDULE } from '@/integrations/useFeeSync.config';
import { runIntegration } from '@/service/integrationService';

const LOG = '[use-fee-sync-scheduler]';

/**
 * `useFeeSync.config` 스케줄·접속값 기준. 기동 직후 실행 없음.
 * 접속값 비어 있으면 스킵. DISABLE_USE_FEE_SYNC_SCHEDULER=1 로 끔.
 * 실행 결과는 수동 연계와 동일하게 연도별 integration_job_log 에 기록.
 */
export function startUseFeeSyncScheduler(): void {
  const sched = USE_FEE_SYNC_SCHEDULE;
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

    console.info(`${LOG} 스케줄 시각 — 연계 시작`);
    void runIntegration({ system: 'NEXTGEN', mode: 'daily', trigger: 'scheduler' })
      .then((r) => {
        console.info(`${LOG} done ok=${r.ok}`);
      })
      .catch((e) => {
        console.warn(`${LOG} fail:`, e instanceof Error ? e.message : e);
      });
  }, 15_000);
}
