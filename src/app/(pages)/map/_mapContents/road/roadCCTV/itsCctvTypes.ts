/** 국가교통정보센터 ITS CCTV OpenAPI (cctvInfo) — 클라이언트용 */
export type ItsCctvItem = {
  /** 목록·지도에서 동일 건 식별용 */
  key: string;
  cctvname: string;
  coordx: number;
  coordy: number;
  cctvurl: string;
  cctvtype: string;
  cctvformat: string;
  roadsectionid: string;
  filecreatetime: string;
  cctvresolution: string;
};
