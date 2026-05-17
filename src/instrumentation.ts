/**
 * Next.js 서버(Node) 기동 시 타이머만 등록(기동 직후 연계 실행 없음).
 * 재난안전데이터: safetydata.config 의 일/주/월·interval 스케줄.
 * KAIS: kais.config 의 KAIS_REFRESH_SCHEDULE.
 * interval(분)은 시계 격자(예 5분→:00,:05,…)에 맞춤. (next dev에서는 5분 interval만 daily 1회로 축소)
 * - DISABLE_SAFETYDATA_SCHEDULER=1 / DISABLE_KAIS_SCHEDULER=1 로 개별 끔
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') return;

  const g = globalThis as typeof globalThis & { __ggnrIntegrationSchedulersRegistered?: boolean };
  if (g.__ggnrIntegrationSchedulersRegistered) return;
  g.__ggnrIntegrationSchedulersRegistered = true;

  if (process.env.DISABLE_SAFETYDATA_SCHEDULER !== '1') {
    const { startSafetydataScheduler } = await import('@/integrations/safetydataScheduler');
    startSafetydataScheduler();
  } else {
    console.info('[instrumentation] safetydata scheduler skipped (DISABLE_SAFETYDATA_SCHEDULER=1)');
  }

  if (process.env.DISABLE_KAIS_SCHEDULER !== '1') {
    const { startKaisScheduler } = await import('@/integrations/kaisScheduler');
    startKaisScheduler();
  } else {
    console.info('[instrumentation] KAIS scheduler skipped (DISABLE_KAIS_SCHEDULER=1)');
  }
}
