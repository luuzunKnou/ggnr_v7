import type { SafetydataRefreshSchedule } from '@/integrations/safetydata.config';

/**
 * 차세대 세외수입(점사용료) 연계 설정.
 * `useFeeSyncScheduler` / `syncRunner` 가 참조.
 * 자동 스케줄러는 GGNR_ENV=prod 에서만 instrumentation 이 등록한다.
 */

/** 배치 시각 (v6 NextGenInfoModule = 매일 01:00) */
export const USE_FEE_SYNC_SCHEDULE: SafetydataRefreshSchedule = {
  mode: 'daily',
  hour: 1,
  minute: 0,
};

/** 접속 정보. 기관코드(srcOrgCd)는 프로젝트 runtime.env `USE_FEE_SYNC_SRC_ORG_CD` */
export const USE_FEE_SYNC_CONNECTION = {
  baseUrl: 'https://10.60.75.57:32471/mediate/ltis',
  srcSysCd: 'PUM',
  /** CSV 저장 경로. 빈 문자열이면 파일 저장 안 함 */
  filePath: 'C:\\NextGen_Data',
} as const;

/** 동일 부과번호 연속 빈응답/실패 시 해당 (연도×인터페이스) 탐색 종료 */
export const USE_FEE_SYNC_MAX_EMPTY_COUNT = 5;

/** fyr 미지정 시 탐색 시작 연도 (~ 현재 연도) */
export const USE_FEE_SYNC_DEFAULT_START_YEAR = 2000;
