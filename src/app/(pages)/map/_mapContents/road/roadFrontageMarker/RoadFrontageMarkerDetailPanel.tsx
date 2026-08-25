'use client';

import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { scheduleFitMapToExtent3857 } from '../../../_mapComponents/config/mapAutoNavigation';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../../_mapComponents/config/mapDefaults';
import { RoadFrontageMarkerItemModal } from './RoadFrontageMarkerItemModal';
import { useRoadFrontageMarkerMapHighlight } from './useRoadFrontageMarkerMapHighlight';
import {
  ROAD_FRONTAGE_MARKER_NEW_ID,
  ROAD_FRONTAGE_MARKER_ROAD_TYPES,
  createEmptyRoadFrontageMarkerItem,
  createEmptyRoadFrontageMarkerLedger,
  createRoadFrontageMarkerId,
  formatMarkerInstallLocation,
  isNewRoadFrontageMarkerId,
  pointExtent3857,
  type RoadFrontageMarkerItem,
  type RoadFrontageMarkerLedger,
} from './roadFrontageMarkerMock';

const fieldClass =
  'h-7 w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/25';
const ATTR_PAIR_GRID = 'grid-cols-[7.5rem_minmax(0,1fr)_7.5rem_minmax(0,1fr)]';
const MARKER_GRID_VIEW = 'grid-cols-[32px_3.5rem_max-content_4.25rem_minmax(0,1fr)_36px_36px]';
const MARKER_GRID_EDIT = 'grid-cols-[32px_3.5rem_max-content_4.25rem_minmax(0,1fr)_36px_36px_28px]';
const btnPrimary =
  'inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50';
const btnGhost =
  'inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50';

function AttrLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center self-stretch bg-muted px-1.5 py-1">
      <span className="min-w-0 truncate whitespace-nowrap text-left text-[11px] leading-none text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

function AttrValue({ value }: { value: ReactNode }) {
  const textValue = typeof value === 'string' ? value : null;
  return (
    <div className="min-w-0 bg-background px-1.5 py-1">
      {textValue != null ? (
        <span className="block truncate whitespace-nowrap text-[11px] leading-snug text-foreground" title={textValue}>
          {textValue}
        </span>
      ) : (
        value
      )}
    </div>
  );
}

type Props = {
  ledgerId: string;
  ledgers: RoadFrontageMarkerLedger[];
  onLedgersChange: Dispatch<SetStateAction<RoadFrontageMarkerLedger[]>>;
  onClose: () => void;
  onDeleted: () => void;
  onLedgerIdChange?: (id: string) => void;
  overlayLeftPx: number;
  overlayWidthPx: number;
};

type ItemModalState = { isNew: boolean; draft: RoadFrontageMarkerItem } | null;

export function RoadFrontageMarkerDetailPanel({
  ledgerId,
  ledgers,
  onLedgersChange,
  onClose,
  onDeleted,
  onLedgerIdChange,
  overlayLeftPx,
  overlayWidthPx,
}: Props) {
  const mapContext = useMapContext();
  const isCreateMode = isNewRoadFrontageMarkerId(ledgerId);
  const saved = useMemo(
    () => ledgers.find((l) => l.id === ledgerId) ?? null,
    [ledgers, ledgerId]
  );

  const [attrsOpen, setAttrsOpen] = useState(true);
  const [isEditing, setIsEditing] = useState(isCreateMode);
  const [draft, setDraft] = useState<RoadFrontageMarkerLedger>(() =>
    isCreateMode
      ? { ...createEmptyRoadFrontageMarkerLedger(), id: ROAD_FRONTAGE_MARKER_NEW_ID }
      : (saved ?? createEmptyRoadFrontageMarkerLedger())
  );
  const [itemModal, setItemModal] = useState<ItemModalState>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);

  const current = isEditing ? draft : (saved ?? draft);
  const markers = current.markers;

  useRoadFrontageMarkerMapHighlight(markers, selectedMarkerId, !isCreateMode);

  const beginEdit = () => {
    setDraft(saved ?? draft);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setItemModal(null);
    if (isCreateMode) {
      onClose();
      return;
    }
    setDraft(saved ?? draft);
    setIsEditing(false);
  };

  const handleSave = () => {
    if (isCreateMode) {
      const nextId = createRoadFrontageMarkerId('ledger');
      const created = { ...draft, id: nextId };
      onLedgersChange((prev) => [created, ...prev]);
      onLedgerIdChange?.(nextId);
      setIsEditing(false);
      return;
    }
    onLedgersChange((prev) => prev.map((l) => (l.id === draft.id ? draft : l)));
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (!saved) return;
    if (!window.confirm('이 관리대장을 삭제할까요?')) return;
    onLedgersChange((prev) => prev.filter((l) => l.id !== saved.id));
    onDeleted();
  };

  const focusMarker = (item: RoadFrontageMarkerItem) => {
    setSelectedMarkerId(item.id);
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;
    scheduleFitMapToExtent3857(map, pointExtent3857(item.mockLonLat), {
      maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    });
  };

  const submitItemModal = () => {
    if (!itemModal) return;
    const item = itemModal.draft;
    setDraft((prev) => ({
      ...prev,
      markers: itemModal.isNew
        ? [...prev.markers, item]
        : prev.markers.map((m) => (m.id === item.id ? item : m)),
    }));
    setSelectedMarkerId(item.id);
    setItemModal(null);
  };

  const removeMarker = (id: string) => {
    setDraft((prev) => ({ ...prev, markers: prev.markers.filter((m) => m.id !== id) }));
    setSelectedMarkerId((prev) => (prev === id ? null : prev));
  };

  if (!saved && !isCreateMode) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <span className="text-sm font-semibold text-foreground">접도구역 표주</span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">선택한 관리대장을 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">
          {isCreateMode ? '관리대장 등록' : current.routeName.trim() || '(노선명 미입력)'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <section className="shrink-0 border-b border-border">
        <div className="flex items-center justify-between gap-2 px-3 py-1.5">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-foreground"
            onClick={() => setAttrsOpen((v) => !v)}
          >
            {attrsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            기본정보
          </button>
          <div className="flex items-center gap-1">
            {!isEditing ? (
              <>
                <button type="button" className={btnGhost} onClick={beginEdit}>
                  <Pencil className="h-3 w-3" />
                  수정
                </button>
                <button
                  type="button"
                  className={btnGhost}
                  onClick={handleDelete}
                  disabled={isCreateMode}
                >
                  <Trash2 className="h-3 w-3" />
                  삭제
                </button>
              </>
            ) : (
              <>
                <button type="button" className={btnGhost} onClick={cancelEdit}>
                  취소
                </button>
                <button type="button" className={btnPrimary} onClick={handleSave}>
                  {isCreateMode ? '등록' : '저장'}
                </button>
              </>
            )}
          </div>
        </div>
        {attrsOpen ? (
          <div className="px-3 pb-2.5">
            <div className={`grid ${ATTR_PAIR_GRID} overflow-hidden rounded border border-border`}>
              <AttrLabel>도로의 종류</AttrLabel>
              <AttrValue
                value={
                  isEditing ? (
                    <select
                      className={fieldClass}
                      value={current.roadType}
                      onChange={(e) => setDraft((prev) => ({ ...prev, roadType: e.target.value }))}
                    >
                      <option value="">선택</option>
                      {ROAD_FRONTAGE_MARKER_ROAD_TYPES.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    current.roadType || '—'
                  )
                }
              />
              <AttrLabel>노선명</AttrLabel>
              <AttrValue
                value={
                  isEditing ? (
                    <input
                      className={fieldClass}
                      value={current.routeName}
                      onChange={(e) => setDraft((prev) => ({ ...prev, routeName: e.target.value }))}
                    />
                  ) : (
                    current.routeName || '—'
                  )
                }
              />
            </div>
          </div>
        ) : null}
      </section>

      <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
        <section className="mb-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-foreground">
              표주 목록 ({markers.length.toLocaleString()})
            </span>
            {isEditing ? (
              <button
                type="button"
                className={btnGhost}
                onClick={() => {
                  const nextNo =
                    markers.reduce((max, m) => Math.max(max, m.serialNo ?? 0), 0) + 1;
                  setItemModal({
                    isNew: true,
                    draft: createEmptyRoadFrontageMarkerItem(nextNo),
                  });
                }}
              >
                <Plus className="h-3 w-3" />
                추가
              </button>
            ) : null}
          </div>
          {markers.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-muted-foreground">
              {isEditing ? '추가를 눌러 표주를 담으세요.' : '등록된 표주가 없습니다.'}
            </p>
          ) : (
            <div className="w-full overflow-hidden rounded border border-border text-[11px]">
              <div
                className={cn(
                  'grid h-7 items-center border-b border-border bg-muted',
                  isEditing ? MARKER_GRID_EDIT : MARKER_GRID_VIEW
                )}
              >
                <div className="px-1 text-center font-semibold text-foreground">번호</div>
                <div className="px-1 text-center font-semibold whitespace-nowrap text-foreground">지점거리</div>
                <div className="px-1 text-left font-semibold whitespace-nowrap text-foreground">설치위치</div>
                <div className="min-w-0 px-1 text-left font-semibold whitespace-nowrap text-foreground">소유자</div>
                <div className="min-w-0 px-1 text-left font-semibold whitespace-nowrap text-foreground">소유자주소</div>
                <div className="px-1 text-center font-semibold text-foreground">표지</div>
                <div className="px-1 text-center font-semibold text-foreground">비고</div>
                {isEditing ? <div aria-hidden /> : null}
              </div>
              {markers.map((m) => {
                const loc = formatMarkerInstallLocation(m);
                const selected = m.id === selectedMarkerId;
                return (
                  <div
                    key={m.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      focusMarker(m);
                      if (isEditing) setItemModal({ isNew: false, draft: m });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        focusMarker(m);
                        if (isEditing) setItemModal({ isNew: false, draft: m });
                      }
                    }}
                    title={isEditing ? '클릭하면 내용을 수정합니다' : '클릭하면 지도가 이 표주로 이동합니다'}
                    className={cn(
                      'grid min-h-7 cursor-pointer items-center border-b border-border py-1 last:border-b-0',
                      isEditing ? MARKER_GRID_EDIT : MARKER_GRID_VIEW,
                      selected
                        ? 'bg-primary/10 dark:bg-primary/25'
                        : 'hover:bg-muted/50'
                    )}
                  >
                    <div className="px-1 text-center tabular-nums text-foreground">{m.serialNo ?? '—'}</div>
                    <div className="px-1 text-center tabular-nums text-foreground">
                      {m.stationDistance || '—'}
                    </div>
                    <div className="px-1 text-left whitespace-nowrap text-foreground">
                      {loc || '—'}
                    </div>
                    <div className="min-w-0 px-1 text-left break-keep text-foreground">
                      {m.ownerName || '—'}
                    </div>
                    <div className="min-w-0 px-1 text-left leading-snug break-keep text-foreground">
                      {m.ownerAddress || '—'}
                    </div>
                    <div className="truncate px-1 text-center text-foreground" title={m.sign || undefined}>
                      {m.sign || '—'}
                    </div>
                    <div className="truncate px-1 text-center text-foreground" title={m.remark || undefined}>
                      {m.remark || '—'}
                    </div>
                    {isEditing ? (
                      <div className="flex items-center justify-center">
                        <button
                          type="button"
                          title="삭제"
                          aria-label="삭제"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeMarker(m.id);
                          }}
                          className="rounded p-0.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </MapSideDetailScroll>

      {itemModal ? (
        <RoadFrontageMarkerItemModal
          draft={itemModal.draft}
          isNew={itemModal.isNew}
          onChange={(next) => setItemModal({ ...itemModal, draft: next })}
          onSubmit={submitItemModal}
          onClose={() => setItemModal(null)}
          overlayLeftPx={overlayLeftPx}
          overlayWidthPx={overlayWidthPx}
        />
      ) : null}
    </div>
  );
}
