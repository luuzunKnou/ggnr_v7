/** 변동이력분석 — 타입·상수 (1차) */

/** opened / ser_eng — serviceList·systemList 와 동일 */
export const CHANGE_HISTORY_OPENED_KEY = 'changeHistory';

export const CHANGE_HISTORY_PANEL_DEFAULT_WIDTH = 280;
export const CHANGE_HISTORY_PANEL_MIN_WIDTH = 260;
export const CHANGE_HISTORY_PANEL_MAX_WIDTH = 400;

export type ChangeHistoryAreaMethod = 'draw' | 'boundary';

export type ChangeHistoryArea = {
  method: ChangeHistoryAreaMethod;
  summaryLabel: string;
  summaryDetail?: string;
  targetLabel: string;
  wkt: string;
  itemCount: number;
  areaSqm: number;
};

export type ChangeHistoryModalStep = 'choose' | 'draw' | 'boundary';

export type ChangeHistoryDrawTool = 'rectangle' | 'polygon' | 'circle';

/** 데이터조회와 동일 계열 — 결과 지도에 표시할 레이어 */
export type ChangeHistoryLayerItem = {
  id: string;
  name: string;
  tableName: string;
};

export type ChangeHistoryLayerGroup = {
  id: string;
  title: string;
  items: ChangeHistoryLayerItem[];
};

/** 시점(as-of) 벡터 1건 — 서버 featuresAsOf 결과 */
export type ChangeHistoryAsOfFeature = {
  tableName: string;
  keyField: string;
  keyValue: string;
  properties?: Record<string, unknown>;
  geom: { type: string; coordinates?: unknown };
  lastOp: 'append' | 'remove' | 'conflict' | 'kept';
  lastAt: string;
};

/** 선택일 당일 변경 — 전·후 겹침 */
export type ChangeHistoryDayDiffFeature = {
  tableName: string;
  keyField: string;
  keyValue: string;
  op: 'append' | 'remove' | 'conflict' | 'kept';
  side: 'old' | 'new';
  geom: { type: string; coordinates?: unknown };
  appliedAt: string;
};
