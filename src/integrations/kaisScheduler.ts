import { defaultDailyWindow, resolveKaisSggCode, runKais } from '@/integrations/kais';
import { KAIS_CNTC_CODES, KAIS_REFRESH_SCHEDULE } from '@/integrations/kais.config';
import { calendarSlotKey, intervalSlotKey } from '@/integrations/integrationSchedule';
import { describeSafetydataSchedule } from '@/integrations/safetydata';

const LOG = '[kais-scheduler]';

const HARDCODED_KAIS_APP_KEY = 'U01TX0FVVEgyMDIzMDUzMDE3MzU1NDExMzgxMTM=';

async function runKaisDailyJob(label: string): Promise<void> {
  const appKey = (process.env.KAIS_APP_KEY ?? '').trim() || HARDCODED_KAIS_APP_KEY;
  const sggCode = await resolveKaisSggCode();
  const window = defaultDailyWindow();
  try {
    for (const cntcCd of KAIS_CNTC_CODES) {
      await runKais({
        mode: 'daily',
        appKey,
        cntcCd,
        dateGb: 'D',
        retryIn: 'Y',
        from: window.from,
        to: window.to,
        sggCode,
      });
    }
    console.info(`${LOG} ok (${label})`);
  } catch (e) {
    console.warn(`${LOG} fail:`, e instanceof Error ? e.message : e);
  }
}

/**
 * `kais.config`의 KAIS_REFRESH_SCHEDULE(일/주/월/interval)에 맞춰 실행. 기동 직시 실행 없음.
 */
export function startKaisScheduler(): void {
  const sched = KAIS_REFRESH_SCHEDULE;
  const desc = describeSafetydataSchedule(sched);
  console.info(`${LOG} registered: ${desc}, no run on startup`);

  let lastSlot: string | null = null;

  setInterval(() => {
    const now = new Date();
    let slot: string | null = null;
    if (sched.mode === 'interval') {
      slot = intervalSlotKey(sched, now);
    } else {
      slot = calendarSlotKey(sched, now);
    }
    if (!slot) return;
    if (lastSlot === slot) return;
    lastSlot = slot;
    void runKaisDailyJob(desc);
  }, 15_000);
}
