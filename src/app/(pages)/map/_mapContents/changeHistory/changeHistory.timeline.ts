/** 변동이력분석 — 타임라인 이벤트 타입·병합·필터 (실조회) */

export type HistoryEventKind = 'shape' | 'ortho';

export type HistoryEvent = {
  date: string;
  changeCount: number;
  kind: HistoryEventKind;
  /** 레이어 표시명 */
  layers: string[];
  orthoYear: number;
  hasShp: boolean;
  note?: string;
  source?: 'syncLog';
  /** sync_log sl_table_name 목록 */
  tableNames?: string[];
};

/** 결과 모달 기본 선택일 (실조회 전·빈 타임라인 폴백) */
export const DEFAULT_HISTORY_DATE = new Date().toISOString().slice(0, 10);

/** 실 sync_log 타임라인 — 테이블명→표시명 라벨링 */
export function mergeHistoryEvents(
  shapeEvents: readonly HistoryEvent[],
  tableLabelByName: Map<string, string>
): HistoryEvent[] {
  return shapeEvents
    .map((ev) => ({
      ...ev,
      layers: (ev.tableNames ?? ev.layers).map(
        (t) => tableLabelByName.get(String(t).toLowerCase()) ?? t
      ),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

type TimelineFilterEvent = {
  kind: HistoryEventKind;
  layers?: string[];
  tableNames?: string[];
  source?: 'syncLog';
};

/** 선택 표시 레이어와 겹치는 도형일만 (정사일은 통과 — 현재 정사 이벤트 없음) */
export function filterHistoryEventsByLayers<T extends TimelineFilterEvent>(
  events: readonly T[],
  selected: { names: string[]; tableNames: string[] }
): T[] {
  const nameSet = new Set(selected.names);
  const tableSet = new Set(selected.tableNames.map((t) => t.toLowerCase()));
  const hasSelection = nameSet.size > 0 || tableSet.size > 0;

  return events.filter((ev) => {
    if (ev.kind === 'ortho') return true;
    if (!hasSelection) return true;
    const labels = ev.layers ?? [];
    const tables = ev.tableNames ?? [];
    const nameHit = labels.some((n) => nameSet.has(n));
    const tableHit = tables.some((t) => tableSet.has(t.toLowerCase()));
    return nameHit || tableHit;
  });
}
