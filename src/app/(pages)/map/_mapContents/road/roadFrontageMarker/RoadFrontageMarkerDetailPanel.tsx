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

const inputClass = 'standard-detail-input h-7 w-full min-w-0 text-foreground';
const actionBtn =
  'standard-detail-action-btn inline-flex h-7 items-center gap-1';
const actionBtnPrimary =
  'inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50';

function AttrLabel({ children }: { children: ReactNode }) {
  return (
    <div className="standard-detail-attr-label flex min-w-0 items-center self-stretch">
      <span className="min-w-0 truncate whitespace-nowrap text-left leading-none">{children}</span>
    </div>
  );
}

function AttrValue({ value }: { value: ReactNode }) {
  const textValue = typeof value === 'string' ? value : null;
  return (
    <div className="standard-detail-attr-value min-w-0 text-foreground">
      {textValue != null ? (
        <span className="block truncate whitespace-nowrap leading-snug" title={textValue}>
          {textValue}
        </span>
      ) : (
        value
      )}
    </div>
  );
}

const ATTR_PAIR_GRID = 'grid-cols-[7.5rem_minmax(0,1fr)_7.5rem_minmax(0,1fr)]';

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
  const [markersOpen, setMarkersOpen] = useState(true);
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
      <div className="standard-panel-root">
        <div className="standard-panel-header">
          <span className="standard-panel-title">접도구역 표주</span>
          <button
            type="button"
            onClick={onClose}
            className="standard-panel-close"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="standard-detail-scroll px-3 py-6 text-center text-muted-foreground">
          선택한 관리대장을 찾을 수 없습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title truncate">
          {isCreateMode ? '관리대장 등록' : current.routeName.trim() || '(노선명 미입력)'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="standard-panel-close"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <section className="standard-detail-section">
        <div className="standard-detail-section-header">
          <button
            type="button"
            className="standard-detail-section-toggle"
            onClick={() => setAttrsOpen((v) => !v)}
            title="기본정보"
          >
            {attrsOpen ? (
              <ChevronDown className="standard-detail-section-chevron" />
            ) : (
              <ChevronRight className="standard-detail-section-chevron" />
            )}
            <span className="standard-detail-section-toggle-label">기본정보</span>
          </button>
          {attrsOpen ? (
            <div className="standard-detail-section-header-actions">
              {!isEditing ? (
                <>
                  <button type="button" className={actionBtn} onClick={beginEdit} title="수정">
                    <Pencil className="h-3 w-3" />
                    수정
                  </button>
                  <button
                    type="button"
                    className={actionBtn}
                    onClick={handleDelete}
                    disabled={isCreateMode}
                    title="삭제"
                  >
                    <Trash2 className="h-3 w-3" />
                    삭제
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className={actionBtn} onClick={cancelEdit} title="취소">
                    취소
                  </button>
                  <button type="button" className={actionBtnPrimary} onClick={handleSave} title={isCreateMode ? '등록' : '저장'}>
                    {isCreateMode ? '등록' : '저장'}
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
        {attrsOpen ? (
          <div className="standard-detail-section-body">
            <div className={cn('grid overflow-hidden rounded border border-border', ATTR_PAIR_GRID)}>
              <AttrLabel>도로의 종류</AttrLabel>
              <AttrValue
                value={
                  isEditing ? (
                    <select
                      className={inputClass}
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
                      className={inputClass}
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

      <MapSideDetailScroll className="standard-detail-scroll pt-0">
        <section className="standard-detail-section-block-first">
          <div className="standard-detail-section-header standard-detail-section-header-bleed">
            <button
              type="button"
              className="standard-detail-section-toggle"
              onClick={() => setMarkersOpen((v) => !v)}
              title="표주 목록"
            >
              {markersOpen ? (
                <ChevronDown className="standard-detail-section-chevron" />
              ) : (
                <ChevronRight className="standard-detail-section-chevron" />
              )}
              <span className="standard-detail-section-toggle-label">
                표주 목록 ({markers.length.toLocaleString()})
              </span>
            </button>
            {markersOpen && isEditing ? (
              <div className="standard-detail-section-header-actions">
                <button
                  type="button"
                  className={actionBtn}
                  title="추가"
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
              </div>
            ) : null}
          </div>
          {markersOpen ? (
          <>
          {markers.length === 0 ? (
            <p className="standard-detail-empty-dashed-compact">
              {isEditing ? '추가를 눌러 표주를 담으세요.' : '등록된 표주가 없습니다.'}
            </p>
          ) : (
            <div className="overflow-hidden rounded border border-border">
              <table className="w-full min-w-0 table-fixed border-collapse text-left text-[11px]">
                <colgroup>
                  <col className="w-8" />
                  <col className="w-14" />
                  <col className="w-24" />
                  <col className="w-[4.25rem]" />
                  <col />
                  <col className="w-9" />
                  <col className="w-9" />
                  {isEditing ? <col className="w-7" /> : null}
                </colgroup>
                <thead className="bg-muted">
                  <tr>
                    <th className="standard-table-th standard-table-th-center px-1">번호</th>
                    <th className="standard-table-th standard-table-th-center px-1">지점거리</th>
                    <th className="standard-table-th standard-table-th-left px-1">설치위치</th>
                    <th className="standard-table-th standard-table-th-left px-1">소유자</th>
                    <th className="standard-table-th standard-table-th-left px-1">소유자주소</th>
                    <th className="standard-table-th standard-table-th-center px-1">표지</th>
                    <th className="standard-table-th standard-table-th-center px-1">비고</th>
                    {isEditing ? (
                      <th className="standard-table-th standard-table-th-center px-0" aria-hidden />
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {markers.map((m) => {
                    const loc = formatMarkerInstallLocation(m);
                    const selected = m.id === selectedMarkerId;
                    return (
                      <tr
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
                        title={
                          isEditing
                            ? '클릭하면 내용을 수정합니다'
                            : '클릭하면 지도가 이 표주로 이동합니다'
                        }
                        className={cn(
                          'standard-list-row',
                          selected && 'standard-list-row-selected'
                        )}
                      >
                        <td className="standard-table-td-compact text-center tabular-nums text-foreground">
                          <span className="block truncate">{m.serialNo ?? '—'}</span>
                        </td>
                        <td className="standard-table-td-compact text-center tabular-nums text-foreground">
                          <span className="block truncate">{m.stationDistance || '—'}</span>
                        </td>
                        <td className="standard-table-td-text" title={loc || undefined}>
                          <span className="block truncate">{loc || '—'}</span>
                        </td>
                        <td className="standard-table-td-text" title={m.ownerName || undefined}>
                          <span className="block truncate">{m.ownerName || '—'}</span>
                        </td>
                        <td className="standard-table-td-text" title={m.ownerAddress || undefined}>
                          <span className="block truncate">{m.ownerAddress || '—'}</span>
                        </td>
                        <td
                          className="standard-table-td-compact text-center text-foreground"
                          title={m.sign || undefined}
                        >
                          <span className="block truncate">{m.sign || '—'}</span>
                        </td>
                        <td
                          className="standard-table-td-compact text-center text-foreground"
                          title={m.remark || undefined}
                        >
                          <span className="block truncate">{m.remark || '—'}</span>
                        </td>
                        {isEditing ? (
                          <td className="standard-table-td-compact px-0 text-center">
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
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </>
          ) : null}
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
