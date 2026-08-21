/**
 * Next.js 서버(Node) 기동 시 타이머만 등록(기동 직후 연계 실행 없음).
 * 재난안전데이터: safetydata.config 의 일/주/월·interval 스케줄.
 * KAIS: kais.config 의 KAIS_REFRESH_SCHEDULE.
 * 점사용료(차세대): useFeeSync.config 의 USE_FEE_SYNC_SCHEDULE.
 * nssm 로그 백업: start 전용, 매일 00:00 (C:\\logs → backup).
 * interval(분)은 시계 격자(예 5분→:00,:05,…)에 맞춤. (next dev에서는 5분 interval만 daily 1회로 축소)
 * - process.env DISABLE_*_SCHEDULER=1 또는 runtime.env DISABLED_SCHEDULERS=useFeeSync,kais,…
 *
 * 앱 layer 테이블: 도로점용대장·공통점용(9)·점사용료(3)·차세대 연계(ngl_error_log·ngl_query_table)·메모·영상 등 — 없으면 CREATE, public에만 있으면 layer로 이동.
 *
 * instrumentation은 edge/nodejs 둘 다 컴파일되므로, pg를 쓰는 스케줄러는
 * NEXT_RUNTIME === 'nodejs' 분기 안에서만 동적 import 한다.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const g = globalThis as typeof globalThis & { __ggnrIntegrationSchedulersRegistered?: boolean };
    if (g.__ggnrIntegrationSchedulersRegistered) return;
    g.__ggnrIntegrationSchedulersRegistered = true;

    const { isSchedulerDisabledInRuntime, SCHEDULER_CODES } = await import(
      '@/lib/runtimeEnvFile'
    );

    try {
      const { flushPendingVersionHistory } = await import('@/service/flushPendingVersionHistory');
      await flushPendingVersionHistory();
    } catch (e) {
      console.warn(
        '[instrumentation] pending version history flush skipped:',
        e instanceof Error ? e.message : e
      );
    }

    try {
      const { ensureLayerAppTables } = await import('@/service/ensureLayerAppTables');
      const ensured = await ensureLayerAppTables();
      if (ensured.created.length || ensured.moved.length) {
        console.info(
          '[instrumentation] layer app tables:',
          [
            ensured.created.length ? `created=${ensured.created.join(',')}` : '',
            ensured.moved.length ? `moved=${ensured.moved.join(',')}` : '',
          ]
            .filter(Boolean)
            .join(' ')
        );
      }
      if (ensured.errors.length) {
        console.warn('[instrumentation] layer app tables errors:', ensured.errors.join(' | '));
      }
    } catch (e) {
      console.warn(
        '[instrumentation] layer app tables ensure skipped:',
        e instanceof Error ? e.message : e
      );
    }

    const skipSafety =
      process.env.DISABLE_SAFETYDATA_SCHEDULER === '1' ||
      isSchedulerDisabledInRuntime(SCHEDULER_CODES.safetydata);
    if (!skipSafety) {
      const { startSafetydataScheduler } = await import('@/integrations/safetydataScheduler');
      startSafetydataScheduler();
    } else {
      console.info('[instrumentation] safetydata scheduler skipped');
    }

    const skipKais =
      process.env.DISABLE_KAIS_SCHEDULER === '1' ||
      isSchedulerDisabledInRuntime(SCHEDULER_CODES.kais);
    if (!skipKais) {
      const { startKaisScheduler } = await import('@/integrations/kaisScheduler');
      startKaisScheduler();
    } else {
      console.info('[instrumentation] KAIS scheduler skipped');
    }

    const skipNssm =
      process.env.DISABLE_NSSM_LOG_BACKUP_SCHEDULER === '1' ||
      isSchedulerDisabledInRuntime(SCHEDULER_CODES.nssmLogBackup);
    if (!skipNssm) {
      const { startNssmLogBackupScheduler } = await import('@/integrations/nssmLogBackupScheduler');
      startNssmLogBackupScheduler();
    } else {
      console.info('[instrumentation] nssm log backup scheduler skipped');
    }

    const skipUseFee =
      process.env.DISABLE_USE_FEE_SYNC_SCHEDULER === '1' ||
      isSchedulerDisabledInRuntime(SCHEDULER_CODES.useFeeSync);
    if (!skipUseFee) {
      const { startUseFeeSyncScheduler } = await import('@/integrations/useFeeSyncScheduler');
      startUseFeeSyncScheduler();
    } else {
      console.info(
        '[instrumentation] use-fee sync scheduler skipped (DISABLE_USE_FEE_SYNC_SCHEDULER or DISABLED_SCHEDULERS=useFeeSync)'
      );
    }
  }
}
