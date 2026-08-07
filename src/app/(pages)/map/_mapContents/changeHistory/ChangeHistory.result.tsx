'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { call } from '@/lib/api';
import { isLargeParcelAnalysisArea } from '../parcelAnalysis/parcelAnalysis.types';
import {
  filterHistoryEventsByLayers,
  mergeHistoryEvents,
  type HistoryEvent,
} from './changeHistory.timeline';
import { ChangeHistoryLiveMap } from './ChangeHistory.map';
import {
  formatChangeHistoryBackgroundLabel,
  pickNearestOrthoBackgroundId,
} from './changeHistory.ortho';
import { filterWmsTableNames } from './changeHistory.wms';
import { useChangeHistory } from './changeHistoryContext';
import {
  type ChangeHistoryAsOfFeature,
  type ChangeHistoryDayDiffFeature,
  type ChangeHistoryLayerGroup,
} from './changeHistory.types';
import { PARCEL_ANALYSIS_ANALYZING_SPINNER } from '../parcelAnalysis/ParcelAnalysis.themeMap';
import type { OrthophotoTileOutputsPayload } from '@/app/(pages)/map/_mapComponents/mapControlPanel/backgroundMapSelector';

const RESULT_MODAL_WIDTH = 'min(1100px, calc(100vw - 2rem))';
/** 필지분석 결과 모달과 동일 — 고정 높이 */
const RESULT_MODAL_HEIGHT = 'min(720px, 85vh)';
const RESULT_MODAL_Z = 'z-[1300]';
const OUTSIDE_CLICK_MOVE_THRESHOLD_PX = 6;
/** 좌측 세로 타임라인 폭 */
const TIMELINE_WIDTH_PX = 200;

/** YYYY-MM-DD 만 허용 — 조각 누락 시 null */
function parseYmd(date: string): { y: string; m: string; d: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? '').trim());
  if (!m) return null;
  return { y: m[1], m: m[2], d: m[3] };
}

/** E 스타일 — 흰색·사각에 가까운 알약(레일) */

type ChangeItem = {
  id: string;
  name: string;
  group: string;
};

/** 타임라인 날짜 표시 — YYYY-MM-DD */
function formatTimelineDate(date: string) {
  return date;
}

const TIMELINE_YEAR_ALL = 'all';

function buildChangeItems(
  event: HistoryEvent,
  layerGroups: ChangeHistoryLayerGroup[]
): ChangeItem[] {
  const catalog = layerGroups.flatMap((g) =>
    g.items.map((item) => ({
      id: item.id,
      name: item.name,
      tableName: item.tableName,
      group: g.title,
    }))
  );
  // sync_log 테이블명·레이어 id 기준 (표시명 키는 라벨 매핑 실패 시 전부 미스)
  const byTable = new Map<string, (typeof catalog)[number]>();
  for (const c of catalog) {
    byTable.set(c.id.toLowerCase(), c);
    if (c.tableName) byTable.set(c.tableName.toLowerCase(), c);
  }
  const byName = new Map(catalog.map((c) => [c.name, c]));

  // 정본은 tableNames(테이블 id). layers 는 병합 후 표시명일 수 있어 폴백만.
  const keys =
    event.tableNames && event.tableNames.length > 0 ? event.tableNames : event.layers;

  const items: ChangeItem[] = [];
  for (const key of keys) {
    const hit = byTable.get(String(key).toLowerCase()) ?? byName.get(key);
    if (hit) {
      items.push({ id: `${event.date}-${hit.id}`, name: hit.name, group: hit.group });
    } else {
      items.push({
        id: `${event.date}-hist-${key}`,
        name: key,
        group: event.source === 'syncLog' ? '동기화이력' : '기타',
      });
    }
  }
  return items;
}

function groupChangeItems(items: ChangeItem[]) {
  const map = new Map<string, ChangeItem[]>();
  for (const item of items) {
    if (!item.group) continue;
    const list = map.get(item.group) ?? [];
    list.push(item);
    map.set(item.group, list);
  }
  return [...map.entries()].map(([title, rows]) => ({ title, rows }));
}

function ChangeChip({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-full items-center truncate rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-foreground shadow-sm">
      {name}
    </span>
  );
}

function MidUiE({ items }: { items: ChangeItem[] }) {
  const groups = useMemo(() => groupChangeItems(items), [items]);

  if (groups.length === 0) {
    return <p className="text-[11px] text-muted-foreground">표시할 변경 레이어가 없습니다.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {groups.map((g) => (
        <div key={g.title} className="flex flex-wrap items-center gap-1 border-l-2 border-primary/70 pl-2">
          <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">{g.title}</span>
          {g.rows.map((row) => (
            <ChangeChip key={row.id} name={row.name} />
          ))}
        </div>
      ))}
    </div>
  );
}

function unwrapPayload<T>(res: { data?: unknown; success?: boolean }): T | null {
  const outer = res.data as { data?: T; success?: boolean } | T | undefined;
  if (outer && typeof outer === 'object' && 'data' in (outer as object) && 'success' in (outer as object)) {
    return (outer as { data: T }).data ?? null;
  }
  return (outer as T) ?? null;
}

/** 이력 보기 직후 — 타임라인·시점 도형 준비될 때까지 (필지분석 «분석 중»과 동일 계열) */
function ChangeHistoryPreparingModal({
  open,
  onCancel,
}: {
  open: boolean;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex w-[min(380px,calc(100vw-2rem))] flex-col items-center gap-3 border-border px-6 py-8 sm:max-w-[min(380px,calc(100vw-2rem))]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={() => onCancel()}
      >
        <DialogTitle className="sr-only">이력 불러오는 중</DialogTitle>
        <DialogDescription className="sr-only">변동 이력을 조회하는 중입니다.</DialogDescription>
        <div className={PARCEL_ANALYSIS_ANALYZING_SPINNER} />
        <p className="text-sm font-medium text-foreground">이력 불러오는 중…</p>
        <p className="w-full break-keep text-center text-xs leading-relaxed text-muted-foreground">
          선택 영역·레이어의 변동 이력을 조회합니다.
          <br />
          그만두려면 취소를 누르세요.
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-1" onClick={onCancel} title="취소">
          취소
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function ChangeHistoryResult() {
  const { resultOpen, closeResult, selectedDate, setSelectedDate, layerIds, layerGroups, area } =
    useChangeHistory();
  const trackRef = useRef<HTMLDivElement>(null);
  const backdropPointerSessionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  /** document pointerup/cancel 해제 — unmount·모달 닫힘 시에도 호출 */
  const backdropPointerDetachRef = useRef<(() => void) | null>(null);
  const [timelineYear, setTimelineYear] = useState<string>(TIMELINE_YEAR_ALL);
  const [shapeEvents, setShapeEvents] = useState<HistoryEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [asOfFeatures, setAsOfFeatures] = useState<ChangeHistoryAsOfFeature[]>([]);
  const [dayDiffFeatures, setDayDiffFeatures] = useState<ChangeHistoryDayDiffFeature[]>([]);
  const [asOfLoading, setAsOfLoading] = useState(false);
  const [orthoTilePayload, setOrthoTilePayload] = useState<OrthophotoTileOutputsPayload | null>(null);
  const [mapBg, setMapBg] = useState<{ isOrtho: boolean; year: string | null }>({
    isOrtho: false,
    year: null,
  });
  /** 결과 모달 첫 진입 — 타임라인(+시점) 준비 전 로딩 모달 */
  const [contentReady, setContentReady] = useState(false);
  const [timelineSettled, setTimelineSettled] = useState(false);

  const selectedLayerMeta = useMemo(() => {
    const items = layerGroups.flatMap((g) => g.items).filter((l) => layerIds.has(l.id));
    return {
      names: items.map((i) => i.name),
      tableNames: items.map((i) => i.tableName).filter(Boolean),
    };
  }, [layerGroups, layerIds]);

  const tableLabelByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of layerGroups) {
      for (const it of g.items) {
        if (it.tableName) m.set(it.tableName.toLowerCase(), it.name);
      }
    }
    return m;
  }, [layerGroups]);

  const tableNamesKey = selectedLayerMeta.tableNames.join('|');

  useEffect(() => {
    if (!resultOpen) {
      setContentReady(false);
      setTimelineSettled(false);
      return;
    }
  }, [resultOpen]);

  useEffect(() => {
    if (!resultOpen) return;
    const tables = tableNamesKey ? tableNamesKey.split('|') : [];
    if (tables.length === 0) {
      setShapeEvents([]);
      setTimelineError(null);
      setTimelineSettled(true);
      return;
    }
    let cancelled = false;
    setTimelineLoading(true);
    setTimelineSettled(false);
    setTimelineError(null);
    void call('', 'POST', {
      service: 'changeHistoryService',
      action: 'listTimeline',
      params: { tableNames: tables, wkt: area?.wkt ?? null },
    })
      .then((res) => {
        if (cancelled) return;
        const data = unwrapPayload<{ events?: HistoryEvent[] }>(res);
        const events = Array.isArray(data?.events) ? data.events : [];
        setShapeEvents(
          events.map((ev) => ({
            ...ev,
            kind: 'shape' as const,
            hasShp: true,
            source: 'syncLog' as const,
            layers: ev.tableNames ?? ev.layers ?? [],
            tableNames: ev.tableNames ?? [],
            changeCount: ev.changeCount ?? 0,
            orthoYear: ev.orthoYear ?? (Number(String(ev.date).slice(0, 4)) || 2026),
          }))
        );
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setShapeEvents([]);
        setTimelineError(e instanceof Error ? e.message : '이력 조회 실패');
      })
      .finally(() => {
        if (!cancelled) {
          setTimelineLoading(false);
          setTimelineSettled(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resultOpen, tableNamesKey, area?.wkt]);

  const historyEvents = useMemo(() => {
    const merged = mergeHistoryEvents(shapeEvents, tableLabelByName);
    return filterHistoryEventsByLayers(merged, selectedLayerMeta);
  }, [shapeEvents, tableLabelByName, selectedLayerMeta]);

  const event = useMemo(() => {
    const hit = historyEvents.find((e) => e.date === selectedDate);
    if (hit) return hit;
    return historyEvents[historyEvents.length - 1] ?? null;
  }, [historyEvents, selectedDate]);

  useEffect(() => {
    if (!resultOpen || historyEvents.length === 0) return;
    if (historyEvents.some((e) => e.date === selectedDate)) return;
    const next = historyEvents[historyEvents.length - 1];
    if (next) setSelectedDate(next.date);
  }, [resultOpen, historyEvents, selectedDate, setSelectedDate]);

  useEffect(() => {
    if (!resultOpen) return;
    let cancelled = false;
    void call('', 'POST', {
      service: 'orthophotoService',
      action: 'listOrthophotoTileOutputs',
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const d = (res?.data ?? res) as OrthophotoTileOutputsPayload;
        setOrthoTilePayload(d ?? {});
      })
      .catch(() => {
        if (!cancelled) setOrthoTilePayload({});
      });
    return () => {
      cancelled = true;
    };
  }, [resultOpen]);

  const orthoBackgroundMapId = useMemo(() => {
    const date = event?.date ?? selectedDate;
    if (!date) return null;
    return pickNearestOrthoBackgroundId(date, orthoTilePayload);
  }, [event?.date, selectedDate, orthoTilePayload]);

  const onMapBackgroundResolved = useCallback(
    (info: { isOrtho: boolean; year: string | null }) => {
      setMapBg(info);
    },
    []
  );

  const dayChangeCount = useMemo(() => {
    const keys = new Set(dayDiffFeatures.map((d) => d.keyValue));
    return keys.size;
  }, [dayDiffFeatures]);

  const changeItems = useMemo(
    () => (event ? buildChangeItems(event, layerGroups) : []),
    [event, layerGroups]
  );

  const eventTableNames = event?.tableNames ?? [];

  const wmsTableNames = useMemo(
    () => filterWmsTableNames(selectedLayerMeta.tableNames),
    [selectedLayerMeta.tableNames]
  );

  const asOfTableNames = useMemo(() => {
    if (!event) return [] as string[];
    const selected = selectedLayerMeta.tableNames;
    if (event.kind === 'shape') {
      const sel = new Set(selected.map((t) => t.toLowerCase()));
      const hit = eventTableNames.filter((t) => sel.has(t.toLowerCase()));
      return hit.length > 0 ? hit : selected;
    }
    return selected;
  }, [event, eventTableNames, selectedLayerMeta.tableNames]);

  const asOfTablesKey = asOfTableNames.join('|');
  const asOfDate = event?.date ?? '';

  useEffect(() => {
    if (!resultOpen || !asOfDate || !asOfTablesKey) {
      setAsOfFeatures([]);
      setDayDiffFeatures([]);
      return;
    }
    const tables = asOfTablesKey.split('|');
    let cancelled = false;
    setAsOfLoading(true);
    void Promise.all([
      call('', 'POST', {
        service: 'changeHistoryService',
        action: 'featuresAsOf',
        params: {
          selectedDate: asOfDate,
          tableNames: tables,
          wkt: area?.wkt ?? null,
        },
      }),
      call('', 'POST', {
        service: 'changeHistoryService',
        action: 'featuresDayDiff',
        params: {
          selectedDate: asOfDate,
          tableNames: tables,
          wkt: area?.wkt ?? null,
        },
      }),
    ])
      .then(([asOfRes, diffRes]) => {
        if (cancelled) return;
        const asOfData = unwrapPayload<{
          features?: Array<{
            tableName: string;
            keyField: string;
            keyValue: string;
            geom: { type: string; coordinates?: unknown };
            lastOp: ChangeHistoryAsOfFeature['lastOp'];
            lastAt: string;
          }>;
        }>(asOfRes);
        const list = Array.isArray(asOfData?.features) ? asOfData.features : [];
        setAsOfFeatures(
          list.map((f) => ({
            tableName: f.tableName || (f as { table_name?: string }).table_name || '',
            keyField: f.keyField,
            keyValue: f.keyValue,
            properties: {},
            geom: f.geom,
            lastOp: f.lastOp,
            lastAt: f.lastAt,
          }))
        );

        const diffData = unwrapPayload<{
          features?: ChangeHistoryDayDiffFeature[];
        }>(diffRes);
        const diffs = Array.isArray(diffData?.features) ? diffData.features : [];
        setDayDiffFeatures(
          diffs.map((f) => ({
            tableName: f.tableName,
            keyField: f.keyField,
            keyValue: f.keyValue,
            op: f.op,
            side: f.side,
            geom: f.geom,
            appliedAt: f.appliedAt ?? '',
          }))
        );
      })
      .catch(() => {
        if (!cancelled) {
          setAsOfFeatures([]);
          setDayDiffFeatures([]);
        }
      })
      .finally(() => {
        if (!cancelled) setAsOfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resultOpen, asOfDate, asOfTablesKey, area?.wkt]);

  useEffect(() => {
    if (!resultOpen || contentReady || !timelineSettled || timelineLoading) return;
    if (historyEvents.length > 0) {
      if (!event) return;
      if (asOfLoading) return;
    }
    setContentReady(true);
  }, [
    resultOpen,
    contentReady,
    timelineSettled,
    timelineLoading,
    historyEvents.length,
    event,
    asOfLoading,
  ]);

  const emptyTimeline = !timelineLoading && historyEvents.length === 0;
  /** 변경 칩이 있으면 «없다» 긴 안내는 숨김 — 헤더 시점시설 N개만으로 충분 */
  const emptyAsOf =
    !asOfLoading &&
    event?.kind === 'shape' &&
    eventTableNames.length > 0 &&
    asOfFeatures.length === 0 &&
    changeItems.length === 0;
  const orthoMissingHint =
    event?.kind === 'shape' && orthoTilePayload != null && !orthoBackgroundMapId;
  const years = useMemo(
    () =>
      [...new Set(historyEvents.map((e) => e.date.slice(0, 4)))].sort((a, b) => a.localeCompare(b)),
    [historyEvents]
  );

  const timelineEvents = useMemo(() => {
    if (timelineYear === TIMELINE_YEAR_ALL) return historyEvents;
    return historyEvents.filter((e) => e.date.startsWith(`${timelineYear}-`));
  }, [timelineYear, historyEvents]);

  const jumpToYear = useCallback(
    (ny: string) => {
      const parts = parseYmd(selectedDate);
      const cm = parts?.m;
      const cd = parts?.d;
      const hit =
        (cm && cd
          ? historyEvents.find((ev) => ev.date === `${ny}-${cm}-${cd}`)
          : undefined) ??
        (cm ? historyEvents.find((ev) => ev.date.startsWith(`${ny}-${cm}`)) : undefined) ??
        historyEvents.find((ev) => ev.date.startsWith(`${ny}-`));
      if (hit) setSelectedDate(hit.date);
    },
    [historyEvents, selectedDate, setSelectedDate]
  );

  const onTimelineYearChange = useCallback(
    (value: string) => {
      setTimelineYear(value);
      if (value === TIMELINE_YEAR_ALL) return;
      if (!selectedDate.startsWith(`${value}-`)) {
        const hit = historyEvents.find((ev) => ev.date.startsWith(`${value}-`));
        if (hit) setSelectedDate(hit.date);
      }
    },
    [historyEvents, selectedDate, setSelectedDate]
  );

  useEffect(() => {
    if (!resultOpen) return;
    const track = trackRef.current;
    if (!track) return;
    const active = track.querySelector<HTMLElement>(`[data-date="${selectedDate}"]`);
    if (!active) return;
    active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [selectedDate, resultOpen, timelineEvents]);

  useEffect(() => {
    if (!resultOpen) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, [resultOpen]);

  const clearBackdropPointerTracking = useCallback(() => {
    backdropPointerDetachRef.current?.();
    backdropPointerDetachRef.current = null;
    backdropPointerSessionRef.current = null;
  }, []);

  const handleBackdropPointerDown = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>) => {
      if (ev.target !== ev.currentTarget) return;

      clearBackdropPointerTracking();

      backdropPointerSessionRef.current = {
        pointerId: ev.pointerId,
        startX: ev.clientX,
        startY: ev.clientY,
      };

      const onPointerUp = (up: PointerEvent) => {
        const session = backdropPointerSessionRef.current;
        if (!session || up.pointerId !== session.pointerId) return;

        const dx = Math.abs(up.clientX - session.startX);
        const dy = Math.abs(up.clientY - session.startY);
        clearBackdropPointerTracking();

        if (dx <= OUTSIDE_CLICK_MOVE_THRESHOLD_PX && dy <= OUTSIDE_CLICK_MOVE_THRESHOLD_PX) {
          closeResult();
        }
      };

      const onPointerCancel = (up: PointerEvent) => {
        if (backdropPointerSessionRef.current?.pointerId !== up.pointerId) return;
        clearBackdropPointerTracking();
      };

      const detach = () => {
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointercancel', onPointerCancel);
      };
      backdropPointerDetachRef.current = detach;

      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerCancel);
    },
    [clearBackdropPointerTracking, closeResult]
  );

  useEffect(() => {
    if (!resultOpen) {
      clearBackdropPointerTracking();
    }
    return () => {
      clearBackdropPointerTracking();
    };
  }, [resultOpen, clearBackdropPointerTracking]);

  const preparing = resultOpen && !contentReady;

  if (!resultOpen) return null;

  if (preparing || !event) {
    return (
      <>
        <ChangeHistoryPreparingModal open={preparing} onCancel={closeResult} />
        {!preparing && !event ? (
          <div className={cn('pointer-events-none fixed inset-0', RESULT_MODAL_Z)}>
            <div
              className="pointer-events-auto absolute inset-0 bg-black/50"
              aria-hidden
              onPointerDown={handleBackdropPointerDown}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="change-history-empty-title"
              className="bg-background pointer-events-auto fixed top-[50%] left-[50%] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[5px] border border-border p-4 shadow-xl"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <h2 id="change-history-empty-title" className="text-base font-semibold text-foreground">
                변동이력 결과
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {timelineError ??
                  '선택한 조건에 해당하는 이력이 없습니다. 영역·표시 레이어를 확인해 주세요.'}
              </p>
              <div className="mt-4 flex justify-end">
                <Button type="button" variant="outline" size="sm" onClick={closeResult} title="닫기">
                  닫기
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  const ymd = parseYmd(selectedDate) ?? parseYmd(event.date);
  const y = ymd?.y ?? '';
  const m = ymd?.m ?? '';
  const d = ymd?.d ?? '';
  const headerYearEvents = historyEvents.filter((e) => y && e.date.startsWith(`${y}-`));
  const monthsInY = [
    ...new Set(headerYearEvents.map((e) => e.date.slice(5, 7))),
  ].sort((a, b) => a.localeCompare(b));
  const daysInYm = [
    ...new Set(
      headerYearEvents
        .filter((e) => y && m && e.date.startsWith(`${y}-${m}`))
        .map((e) => e.date.slice(8, 10))
    ),
  ].sort((a, b) => a.localeCompare(b));

  const selectClass =
    'h-8 rounded border border-border bg-background px-2 text-xs text-foreground shadow-sm';
  const timelineSelectClass =
    'h-7 w-full rounded border border-border bg-background px-1.5 text-[11px] text-foreground';

  return (
    <div className={cn('pointer-events-none fixed inset-0', RESULT_MODAL_Z)}>
      <div
        className="pointer-events-auto absolute inset-0 bg-black/50"
        aria-hidden
        onPointerDown={handleBackdropPointerDown}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-history-result-title"
        className={cn(
          'bg-background pointer-events-auto fixed top-[50%] left-[50%] flex min-h-0 -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden',
          'rounded-[5px] border border-border p-0 shadow-xl outline-none'
        )}
        style={{
          width: RESULT_MODAL_WIDTH,
          maxWidth: RESULT_MODAL_WIDTH,
          height: RESULT_MODAL_HEIGHT,
          maxHeight: RESULT_MODAL_HEIGHT,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="change-history-result-title" className="text-base font-semibold text-foreground">
              ○ 변동이력 결과
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {area?.summaryLabel ?? '영역'}
            </p>
            {area && isLargeParcelAnalysisArea(area) ? (
              <p className="mt-1 text-[11px] leading-snug text-orange-800 dark:text-orange-200">
                분석 영역이 넓습니다. 조회가 오래 걸릴 수 있습니다.
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <select
              className={selectClass}
              value={y}
              aria-label="연"
              onChange={(e) => jumpToYear(e.target.value)}
            >
              {years.map((yy) => (
                <option key={yy} value={yy}>
                  {yy}년
                </option>
              ))}
            </select>
            <select
              className={selectClass}
              value={m}
              aria-label="월"
              onChange={(e) => {
                const nm = e.target.value;
                if (!y) return;
                const hit =
                  (d
                    ? headerYearEvents.find((ev) => ev.date === `${y}-${nm}-${d}`)
                    : undefined) ??
                  headerYearEvents.find((ev) => ev.date.startsWith(`${y}-${nm}`));
                if (hit) setSelectedDate(hit.date);
              }}
            >
              {monthsInY.map((mm) => (
                <option key={mm} value={mm}>
                  {Number(mm)}월
                </option>
              ))}
            </select>
            <select
              className={selectClass}
              value={d}
              aria-label="일"
              onChange={(e) => {
                if (!y || !m) return;
                const nd = e.target.value;
                const next = `${y}-${m}-${nd}`;
                if (headerYearEvents.some((ev) => ev.date === next)) {
                  setSelectedDate(next);
                }
              }}
            >
              {daysInYm.map((dd) => (
                <option key={dd} value={dd}>
                  {Number(dd)}일
                </option>
              ))}
            </select>
            <Button type="button" variant="outline" size="sm" onClick={closeResult}>
              닫기
            </Button>
          </div>
        </div>

        {/* 좌: 세로 타임라인 · 우: 지도 · 하단: 변경 요약 */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-4 pb-3 pt-2">
          {timelineError ? (
            <div className="shrink-0 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
              {timelineError}
            </div>
          ) : null}
          {emptyTimeline ? (
            <div className="shrink-0 rounded-md border border-border bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
              선택한 조건에 해당하는 이력이 없습니다. 영역·표시 레이어를 확인해 주세요.
            </div>
          ) : null}
          {orthoMissingHint ? (
            <div className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              선택일 이전·당해 연도의 자체 정사 타일이 없습니다. 배경은 항공영상(vworld)으로 표시합니다.
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
            <div
              className="flex shrink-0 flex-col overflow-hidden rounded-md border border-border bg-muted/30"
              style={{ width: TIMELINE_WIDTH_PX }}
            >
              <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2">
                <div className="flex items-center gap-1 text-[11px] font-semibold text-foreground">
                  <CalendarDays className="h-3.5 w-3.5 text-primary" />
                  타임라인
                </div>
                <select
                  className={timelineSelectClass}
                  value={timelineYear}
                  aria-label="연도 구분"
                  onChange={(e) => onTimelineYearChange(e.target.value)}
                >
                  <option value={TIMELINE_YEAR_ALL}>전체</option>
                  {years.map((yy) => (
                    <option key={yy} value={yy}>
                      {yy}년
                    </option>
                  ))}
                </select>
              </div>
              <div ref={trackRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
                {timelineEvents.length === 0 ? (
                  <p className="px-1 py-6 text-center text-[11px] text-muted-foreground">이력 없음</p>
                ) : (
                  <div className="relative">
                    {/* 세로 기준선 — 원 열(w-5) 정중앙 */}
                    <div
                      className="absolute bottom-3 left-2.5 top-3 w-px -translate-x-1/2 bg-border"
                      aria-hidden
                    />
                    <ul className="relative flex flex-col">
                      {timelineEvents.map((ev) => {
                        const active = ev.date === selectedDate;
                        const isOrtho = ev.kind === 'ortho';
                        return (
                          <li key={`${ev.kind}-${ev.date}`}>
                            <button
                              type="button"
                              data-date={ev.date}
                              title={ev.date}
                              onClick={() => setSelectedDate(ev.date)}
                              className={cn(
                                'flex w-full items-center gap-3 rounded-md py-2.5 pr-1 text-left transition-colors',
                                active ? 'bg-primary/10' : 'hover:bg-background/80'
                              )}
                            >
                              <span className="relative z-[1] flex w-5 shrink-0 items-center justify-center">
                                <span
                                  className={cn(
                                    'size-2.5 rounded-full border-2',
                                    active
                                      ? isOrtho
                                        ? 'border-amber-600 bg-amber-500'
                                        : 'border-primary bg-primary'
                                      : isOrtho
                                        ? 'border-amber-500/60 bg-amber-500/20'
                                        : 'border-border bg-background'
                                  )}
                                  aria-hidden
                                />
                              </span>
                              <span
                                className={cn(
                                  'min-w-0 flex-1 text-[12px] tabular-nums leading-tight',
                                  active
                                    ? 'font-semibold text-foreground'
                                    : 'font-medium text-muted-foreground'
                                )}
                              >
                                {formatTimelineDate(ev.date)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <ChangeHistoryLiveMap
                wkt5181={area?.wkt ?? null}
                selectedDate={event?.date ?? selectedDate}
                orthoBackgroundMapId={orthoBackgroundMapId}
                wmsTableNames={wmsTableNames}
                asOfFeatures={asOfFeatures}
                dayDiffFeatures={dayDiffFeatures}
                mapLoading={timelineLoading || asOfLoading}
                onBackgroundResolved={onMapBackgroundResolved}
              />
            </div>
          </div>

          <div className="max-h-[28%] min-h-0 shrink-0 overflow-y-auto overscroll-contain rounded-md border border-dashed border-amber-300 bg-amber-50/60 px-2.5 py-2 dark:border-amber-700 dark:bg-amber-950/30">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-foreground">
                {asOfLoading ? (
                  <span className="text-muted-foreground">조회 중…</span>
                ) : (
                  <>
                    시설 <strong className="text-primary">{asOfFeatures.length}</strong>개
                    <span className="text-muted-foreground">
                      {' '}
                      · 변경 <strong className="text-foreground">{dayChangeCount}</strong>건
                      {' · '}
                      {formatChangeHistoryBackgroundLabel(mapBg.isOrtho, mapBg.year)}
                    </span>
                  </>
                )}
              </span>
            </div>
            {changeItems.length > 0 ? (
              <div className="mb-1">
                <span className="mb-1 block text-[11px] text-muted-foreground">관련 레이어</span>
                <MidUiE items={changeItems} />
              </div>
            ) : null}
            {emptyAsOf ? (
              <p className="mb-1 text-[11px] text-muted-foreground">
                이 날짜·레이어에 표시할 시설이 없습니다.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
