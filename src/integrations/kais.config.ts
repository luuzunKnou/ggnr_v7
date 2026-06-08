import type { SafetydataRefreshSchedule } from '@/integrations/safetydata.config';

/**
 * KAIS 배치 시각(`kaisScheduler`가 일/주/월·interval 반영).
 */
export const KAIS_REFRESH_SCHEDULE: SafetydataRefreshSchedule = {
  mode: 'daily',
  hour: 0,
  minute: 0,
};

/** `integrationService` / `scripts/integrations-kais.ts`와 동일 계약 코드 목록 */
export const KAIS_CNTC_CODES = ['300001', '300002', '300003'] as const;
