import type { SafetydataRefreshSchedule } from '@/integrations/safetydata.config';

/**
 * FMS 안전점검 연계 설정.
 * v6 FmsInfoModule = 매일 01:05 (Asia/Seoul)
 */
export const FMS_SYNC_SCHEDULE: SafetydataRefreshSchedule = {
  mode: 'daily',
  hour: 1,
  minute: 5,
};
