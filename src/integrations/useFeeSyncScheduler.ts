import { calendarSlotKey, intervalSlotKey } from '@/integrations/integrationSchedule';
import { describeSafetydataSchedule } from '@/integrations/safetydata';
import { USE_FEE_SYNC_SCHEDULE } from '@/integrations/useFeeSync.config';
import { runNextGenFeeSync } from '@/lib/nextGenLinkage/syncRunner';

const LOG = '[use-fee-sync-scheduler]';

/**
 * `useFeeSync.config` 스케줄·접속값 기준. 기동 직후 실행 없음.
 * 접속값 비어 있으면 스킵. DISABLE_USE_FEE_SYNC_SCHEDULER=1 로 끔.
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

    void runNextGenFeeSync().then((r) => {
      if (r.skipped) console.info(`${LOG} skipped: ${r.skipped} — ${r.message}`);
      else console.info(`${LOG} ${r.message}`);
    });
  }, 15_000);
}
