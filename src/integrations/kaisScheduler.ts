import { KAIS_REFRESH_SCHEDULE } from '@/integrations/kais.config';
import { calendarSlotKey, intervalSlotKey } from '@/integrations/integrationSchedule';
import { describeSafetydataSchedule } from '@/integrations/safetydata';
import { runIntegration } from '@/service/integrationService';

const LOG = '[kais-scheduler]';

/**
 * `kais.config`의 KAIS_REFRESH_SCHEDULE(일/주/월·interval)에 맞춰 실행. 기동 직후 실행 없음.
 * 실행 결과는 수동 연계와 동일하게 integration_job_log 에 기록.
 */
export function startKaisScheduler(): void {
  const sched = KAIS_REFRESH_SCHEDULE;
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
    void runIntegration({ system: 'KAIS', mode: 'daily', trigger: 'scheduler' })
      .then((r) => {
        console.info(`${LOG} done ijlKey=${r.ijlKey ?? '-'} ok=${r.ok}`);
      })
      .catch((e) => {
        console.warn(`${LOG} fail:`, e instanceof Error ? e.message : e);
      });
  }, 15_000);
}
