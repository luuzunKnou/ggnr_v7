/**
 * file_data API (`/api/service-files`)에 넘기는 ser_eng.
 * 값은 serviceList.config 의 ser_eng 와 동일해야 하며, `serviceFileDataPolicy`에서 검증됩니다.
 * 게시판 등 설정에 없는 서비스는 policy 의 SERVICE_FILE_DATA_EXTRA_SER_ENG 에 추가합니다.
 */
export const SER_FILE_ENG = {
  dataQuery: 'dataQuery',
  riverBasicPlan: 'riverBasicPlan',
  riverUseLedger: 'riverUseLedger',
  riverConstructionLedger: 'riverConstructionLedger',
  smallRiverUseLedger: 'smallRiverUseLedger',
  roadUseLedger: 'roadUseLedger',
  roadFrontageBuilding: 'roadFrontageBuilding',
  waterworksLedger: 'waterworksLedger',
  complaint: 'complaint',
  memo: 'memo',
  /** 공지사항 첨부 — file_data/notice/{key}/ */
  notice: 'notice',
  /** 자료실 첨부 — file_data/board/{key}/ */
  board: 'board',
} as const;

export type SerFileEng = (typeof SER_FILE_ENG)[keyof typeof SER_FILE_ENG];
