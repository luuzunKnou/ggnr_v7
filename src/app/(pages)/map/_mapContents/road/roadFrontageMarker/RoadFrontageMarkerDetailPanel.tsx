'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { call } from '@/lib/api';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import { cn } from '@/lib/utils';
import { getAddressFromCoord } from '../../../_mapComponents/addressSearch/vworldAddressSearch';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { layerRowPanelButtonClass } from '../../../_mapComponents/layerRowEdit/layerRowPanelButtonStyles';
import { useMapVisualCenterPixel } from '../../../_mapComponents/hooks/useMapVisualCenterPixel';
import {
  GEOM_EDIT_HINT_BELOW_SEARCH_GAP,
  useSearchBarOffset,
} from '../../../searchBarOffsetContext';
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll';
import { RoadFrontageMarkerItemModal } from './RoadFrontageMarkerItemModal';
import { fetchInstallPlacePreview } from './fetchInstallPlacePreview';
import {
  ROAD_FRONTAGE_MARKER_NEW_ID,
  ROAD_FRONTAGE_MARKER_ROAD_TYPES,
  createEmptyRoadFrontageMarkerItem,
  createEmptyRoadFrontageMarkerLedger,
  createRoadFrontageMarkerId,
  isNewRoadFrontageMarkerId,
  normalizeMarkerInstallLocation,
  type RoadFrontageMarkerItem,
  type RoadFrontageMarkerLedger,
} from './roadFrontageMarkerMock';
import {
  fitMapToMarkerPoints,
  flyToMarker,
  useRoadFrontageMarkerMapHighlight,
} from './useRoadFrontageMarkerMapHighlight';

const fieldClass =
  'h-7 w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/25';
const attrLabelClass = 'w-[64px] shrink-0';
const btnPrimary =
  'inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50';
const btnGhost =
  'inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50';
const btnDanger =
  'inline-flex h-7 items-center gap-1 rounded border border-red-200 bg-background px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40';

function AttrRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start">
      <div
        className={cn(
          'flex min-w-0 shrink-0 items-center self-stretch bg-muted px-1.5 py-1',
          attrLabelClass
        )}
      >
        <span className="min-w-0 w-full whitespace-normal break-keep text-left text-[11px] leading-snug text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="min-w-0 flex-1 bg-background px-1.5 py-1">
        {typeof value === 'string' ? (
          <span className="block truncate text-[11px] leading-snug text-foreground" title={value}>
            {value}
          </span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

type Props = {
  ledgerId: string;
  onClose: () => void;
  onSaved?: () => void;
  onCreated?: (newId: string) => void;
  onDeleted: () => void;
  overlayLeftPx: number;
  overlayWidthPx: number;
};

type ItemModalState = { mode: 'new' | 'edit' | 'view'; draft: RoadFrontageMarkerItem } | null;

const MARKER_ROW_COLS =
  'grid-cols-[minmax(8.5rem,0.9fr)_3.25rem_4.5rem_minmax(0,1.25fr)]';
const MARKER_ROW_COLS_EDIT =
  'grid-cols-[minmax(8.5rem,0.9fr)_3.25rem_4.5rem_minmax(0,1.25fr)_3rem]';

export function RoadFrontageMarkerDetailPanel({
  ledgerId,
  onClose,
  onSaved,
  onCreated,
  onDeleted,
  overlayLeftPx,
  overlayWidthPx,
}: Props) {
  const isCreateMode = isNewRoadFrontageMarkerId(ledgerId);

  const [attrsOpen, setAttrsOpen] = useState(true);
  const [isEditing, setIsEditing] = useState(isCreateMode);
  /** 등록(부모만)과 표주(자식) 편집을 분리 — 신규 등록 중에는 표주 추가 불가 */
  const canEditMarkers = isEditing && !isCreateMode;
  const [loading, setLoading] = useState(!isCreateMode);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<RoadFrontageMarkerLedger | null>(null);
  const [draft, setDraft] = useState<RoadFrontageMarkerLedger>(() =>
    isCreateMode
      ? { ...createEmptyRoadFrontageMarkerLedger(), id: ROAD_FRONTAGE_MARKER_NEW_ID }
      : createEmptyRoadFrontageMarkerLedger()
  );
  const [itemModal, setItemModal] = useState<ItemModalState>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const markerPointSnapshotRef = useRef<{
    lon: number | null;
    lat: number | null;
    installLocation: string;
    landCategory: string;
  } | null>(null);
  const [markerPointSnapshot, setMarkerPointSnapshot] = useState<{
    lon: number | null;
    lat: number | null;
    installLocation: string;
    landCategory: string;
  } | null>(null);
  const markerPointOpsRef = useRef<{
    startDraw: () => void;
    reset: () => void;
    deleteGeom: () => void;
  } | null>(null);
  const mapContext = useMapContext();
  const vworldApiKey = mapContext?.vworldApiKey ?? '';
  const mapReady = mapContext?.mapReady ?? false;
  const mapPaddingLeft = mapContext?.mapPaddingLeft ?? 0;
  const map = mapReady ? (mapContext?.mapInstanceRef?.current ?? null) : null;
  const mapPickBannerHost =
    mapContext?.mapInstanceRef?.current?.getTargetElement()?.parentElement ?? null;
  const pointPickRef = mapContext?.roadFrontageMarkerPointPickRef;
  const setPointPickActive = mapContext?.setRoadFrontageMarkerPointPickActive;
  const setDraftPoint = mapContext?.setRoadFrontageMarkerDraftPoint;
  const { inputBottomPx } = useSearchBarOffset();
  const mapPickHintTopPx = inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP;
  const displayMarkers = isEditing ? draft.markers : (saved?.markers ?? draft.markers);

  /** 표주 모달(추가·수정) 열린 동안만 지도 점 찍기 */
  const mapPickActive =
    canEditMarkers && itemModal != null && itemModal.mode !== 'view';
  const mapPickHasPoint =
    mapPickActive &&
    itemModal != null &&
    itemModal.draft.lon != null &&
    itemModal.draft.lat != null &&
    Number.isFinite(itemModal.draft.lon) &&
    Number.isFinite(itemModal.draft.lat);
  const mapPickHintText = mapPickHasPoint
    ? '지도에서 위치를 수정해 주세요.'
    : '지도에서 위치를 찍어 주세요.';
  const mapPickShowReset =
    mapPickActive &&
    markerPointSnapshot != null &&
    (itemModal?.draft.lon !== markerPointSnapshot.lon ||
      itemModal?.draft.lat !== markerPointSnapshot.lat ||
      itemModal?.draft.installLocation !== markerPointSnapshot.installLocation ||
      itemModal?.draft.landCategory !== markerPointSnapshot.landCategory);
  const mapPickCenterPixel = useMapVisualCenterPixel(map, mapPickActive, mapPaddingLeft);

  /** 점 찍기 중에는 pick 레이어가 드래프트를 표시 — highlight 중복 방지 */
  const mapMarkers = useMemo(() => {
    if (!itemModal || itemModal.mode === 'view') return displayMarkers;
    const d = itemModal.draft;
    if (mapPickActive) return displayMarkers.filter((m) => m.id !== d.id);
    return [...displayMarkers.filter((m) => m.id !== d.id), d];
  }, [displayMarkers, itemModal, mapPickActive]);

  const applyPickCoords = useCallback(
    async (lon: number, lat: number) => {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

      setItemModal((prev) => {
        if (!prev || prev.mode === 'view') return prev;
        return {
          ...prev,
          draft: { ...prev.draft, lon, lat },
        };
      });

      let loc = '';
      try {
        if (vworldApiKey) {
          const addr = await getAddressFromCoord(lon, lat, {
            apiKey: vworldApiKey,
            type: 'PARCEL',
          });
          const raw = String(addr?.jibun ?? '').trim() || String(addr?.road ?? '').trim();
          loc = normalizeMarkerInstallLocation(formatAddressStripSidoSigungu(raw) || raw);
        }
      } catch {
        /* ignore */
      }
      let jimok = '';
      try {
        const place = await fetchInstallPlacePreview({
          installLocation: loc,
          lon,
          lat,
        });
        if (place.installLocation) loc = place.installLocation;
        jimok = place.landCategory;
      } catch {
        /* ignore */
      }

      setItemModal((prev) => {
        if (!prev || prev.mode === 'view') return prev;
        return {
          ...prev,
          draft: {
            ...prev.draft,
            installLocation: loc || prev.draft.installLocation,
            landCategory: jimok || prev.draft.landCategory,
            lon,
            lat,
          },
        };
      });

      flyToMarker(map, {
        id: '',
        serialNo: null,
        stationDistance: '',
        installLocation: loc,
        landCategory: jimok,
        ownerName: '',
        ownerAddress: '',
        sign: '',
        remark: '',
        lon,
        lat,
      });
    },
    [map, vworldApiKey]
  );

  useRoadFrontageMarkerMapHighlight(
    map,
    mapMarkers,
    itemModal?.mode === 'view' ? selectedMarkerId : (itemModal?.draft.id ?? selectedMarkerId)
  );


  useEffect(() => {
    if (!map || loading) return;
    if (displayMarkers.length === 0) return;
    fitMapToMarkerPoints(map, displayMarkers);
  }, [map, loading, ledgerId]);

  useEffect(() => {
    if (!pointPickRef) return;
    if (!mapPickActive) {
      pointPickRef.current = null;
      setPointPickActive?.(false);
      return;
    }
    setPointPickActive?.(true);
    pointPickRef.current = (lon, lat) => {
      void applyPickCoords(lon, lat);
    };
    return () => {
      pointPickRef.current = null;
      setPointPickActive?.(false);
    };
  }, [mapPickActive, pointPickRef, setPointPickActive, applyPickCoords]);

  useEffect(() => {
    if (!mapPickActive || !itemModal || itemModal.mode === 'view') {
      setDraftPoint?.(null);
      return;
    }
    const { lon, lat } = itemModal.draft;
    setDraftPoint?.(
      lon != null && lat != null && Number.isFinite(lon) && Number.isFinite(lat)
        ? { lon, lat }
        : null
    );
    return () => setDraftPoint?.(null);
  }, [mapPickActive, itemModal, setDraftPoint]);

  useEffect(() => {
    if (!mapPickActive || !itemModal || itemModal.mode === 'view') {
      markerPointOpsRef.current = null;
      return;
    }
    markerPointOpsRef.current = {
      startDraw: () => {
        setItemModal((prev) => {
          if (!prev || prev.mode === 'view') return prev;
          return {
            ...prev,
            draft: {
              ...prev.draft,
              lon: null,
              lat: null,
              installLocation: '',
              landCategory: '',
            },
          };
        });
      },
      reset: () => {
        const snap = markerPointSnapshotRef.current;
        if (!snap) return;
        setItemModal((prev) => {
          if (!prev || prev.mode === 'view') return prev;
          return {
            ...prev,
            draft: {
              ...prev.draft,
              lon: snap.lon,
              lat: snap.lat,
              installLocation: snap.installLocation,
              landCategory: snap.landCategory,
            },
          };
        });
      },
      deleteGeom: () => {
        setItemModal((prev) => {
          if (!prev || prev.mode === 'view') return prev;
          return {
            ...prev,
            draft: {
              ...prev.draft,
              lon: null,
              lat: null,
              installLocation: '',
              landCategory: '',
            },
          };
        });
      },
    };
    return () => {
      markerPointOpsRef.current = null;
    };
  }, [mapPickActive, itemModal]);

  useEffect(() => {
    if (!mapPickActive) {
      setMarkerPointSnapshot(null);
      markerPointSnapshotRef.current = null;
    }
  }, [mapPickActive]);

  useEffect(() => {
    return () => {
      setPointPickActive?.(false);
      setDraftPoint?.(null);
      if (pointPickRef) pointPickRef.current = null;
    };
  }, [setPointPickActive, setDraftPoint, pointPickRef]);

  useEffect(() => {
    if (isCreateMode) {
      setSaved(null);
      setDraft({ ...createEmptyRoadFrontageMarkerLedger(), id: ROAD_FRONTAGE_MARKER_NEW_ID });
      setIsEditing(true);
      setItemModal(null);
      setSelectedMarkerId(null);
      setLoading(false);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setIsEditing(false);
    void call('', 'POST', {
      service: 'roadFrontageMarkerService',
      action: 'get',
      params: { id: ledgerId },
    })
      .then((res) => {
        if (cancelled) return;
        if (res?.success === false) {
          setSaved(null);
          setLoadError(String(res.error ?? '관리대장을 불러오지 못했습니다.'));
          return;
        }
        const data = res?.data ?? res;
        if (!data || typeof data !== 'object') {
          setSaved(null);
          setLoadError('선택한 관리대장을 찾을 수 없습니다.');
          return;
        }
        const row = data as RoadFrontageMarkerLedger;
        setSaved(row);
        setDraft(row);
      })
      .catch(() => {
        if (!cancelled) {
          setSaved(null);
          setLoadError('관리대장을 불러오지 못했습니다.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isCreateMode, ledgerId]);

  const current = isEditing ? draft : (saved ?? draft);
  const markers = current.markers;

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

  const handleSave = async () => {
    if (!current.roadType.trim() && !current.routeName.trim()) {
      window.alert('도로의 종류 또는 노선명을 입력하세요.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...draft,
        id: isCreateMode ? undefined : draft.id,
        /** 신규 등록은 노선만 — 표주는 등록 후 상세에서 추가 */
        markers: isCreateMode ? [] : draft.markers,
      };
      const res = await call('', 'POST', {
        service: 'roadFrontageMarkerService',
        action: 'save',
        params: body,
      });
      if (res?.success === false) {
        window.alert(String(res.error ?? '저장에 실패했습니다.'));
        return;
      }
      const row = (res?.data ?? res) as RoadFrontageMarkerLedger | null;
      if (!row?.id) {
        window.alert('저장에 실패했습니다.');
        return;
      }
      setSaved(row);
      setDraft(row);
      setIsEditing(false);
      setItemModal(null);
      if (isCreateMode) onCreated?.(row.id);
      else onSaved?.();
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!saved) return;
    if (!window.confirm('이 관리대장을 삭제할까요?')) return;
    try {
      const res = await call('', 'POST', {
        service: 'roadFrontageMarkerService',
        action: 'remove',
        params: { id: saved.id },
      });
      if (res?.success === false) {
        window.alert(String(res.error ?? '삭제에 실패했습니다.'));
        return;
      }
      onDeleted();
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : '삭제에 실패했습니다.');
    }
  };

  const focusMarker = (item: RoadFrontageMarkerItem) => {
    setSelectedMarkerId(item.id);
    if (item.lon == null || item.lat == null) {
      window.alert('이 표주는 지도 위치가 없습니다. (지적 주소 미매칭)');
      return;
    }
    flyToMarker(map, item);
  };

  /** 조회: 행 클릭 시 읽기 전용 상세. 수정 모드: 행 클릭 시 지도만 이동 */
  const handleMarkerRowClick = (item: RoadFrontageMarkerItem) => {
    focusMarker(item);
    if (!isEditing) {
      setItemModal({ mode: 'view', draft: { ...item } });
    }
  };

  const handleOpenEditMarker = (item: RoadFrontageMarkerItem) => {
    if (!canEditMarkers) return;
    focusMarker(item);
    markerPointSnapshotRef.current = {
      lon: item.lon ?? null,
      lat: item.lat ?? null,
      installLocation: item.installLocation,
      landCategory: item.landCategory,
    };
    setMarkerPointSnapshot(markerPointSnapshotRef.current);
    setItemModal({ mode: 'edit', draft: { ...item } });
  };

  const submitItemModal = () => {
    if (!itemModal || itemModal.mode === 'view') return;
    const item: RoadFrontageMarkerItem = {
      ...itemModal.draft,
      installLocation: normalizeMarkerInstallLocation(itemModal.draft.installLocation),
    };
    if (!item.installLocation.trim()) {
      window.alert('설치 위치를 입력하세요.');
      return;
    }
    setDraft((prev) => ({
      ...prev,
      markers:
        itemModal.mode === 'new'
          ? [...prev.markers, item]
          : prev.markers.map((m) => (m.id === item.id ? item : m)),
    }));
    setSelectedMarkerId(item.id);
    setItemModal(null);
  };

  const removeMarker = (id: string) => {
    if (!canEditMarkers) {
      window.alert('상단 «수정»을 누른 뒤 표주를 삭제해 주세요. 저장 시에만 DB에 반영됩니다.');
      return;
    }
    if (!window.confirm('이 표주를 삭제할까요? (저장 시 반영)')) return;
    if (itemModal?.draft.id === id) setItemModal(null);
    setDraft((prev) => ({ ...prev, markers: prev.markers.filter((m) => m.id !== id) }));
    setSelectedMarkerId((prev) => (prev === id ? null : prev));
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="text-sm font-semibold text-foreground">접도구역 표주 상세</span>
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
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">불러오는 중…</p>
      </div>
    );
  }

  if (!saved && !isCreateMode) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="text-sm font-semibold text-foreground">접도구역 표주 상세</span>
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
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          {loadError || '선택한 관리대장을 찾을 수 없습니다.'}
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2
          className={cn(
            'min-w-0 truncate text-sm font-semibold',
            current.routeName.trim() || isCreateMode ? 'text-foreground' : 'text-muted-foreground'
          )}
          title={isCreateMode ? '관리대장 등록' : current.routeName.trim() || '(노선명 미입력)'}
        >
          {isCreateMode ? '관리대장 등록' : current.routeName.trim() || '(노선명 미입력)'}
        </h2>
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
        <div className="flex items-center gap-1 px-2 py-1.5">
          <button
            type="button"
            onClick={() => setAttrsOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold text-foreground"
          >
            {attrsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            )}
            기본정보
          </button>
          {attrsOpen ? (
            <div className="flex shrink-0 items-center gap-1">
              {!isEditing ? (
                <>
                  <button type="button" className={btnGhost} onClick={beginEdit}>
                    <Pencil className="h-3 w-3" />
                    수정
                  </button>
                  {!isCreateMode ? (
                    <button
                      type="button"
                      className={btnDanger}
                      onClick={() => void handleDelete()}
                    >
                      <Trash2 className="h-3 w-3" />
                      삭제
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <button type="button" className={btnGhost} onClick={cancelEdit} disabled={saving}>
                    취소
                  </button>
                  <button
                    type="button"
                    className={btnPrimary}
                    onClick={() => void handleSave()}
                    disabled={saving}
                  >
                    {isCreateMode ? '등록' : '저장'}
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
        {attrsOpen ? (
          <div className="max-h-[42vh] overflow-y-auto px-3 pb-2.5 scrollbar-thin">
            <div className="overflow-hidden rounded-[5px] border border-border">
              <div className="grid grid-cols-2 divide-x divide-border">
                <AttrRow
                  label="도로종류"
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
                <AttrRow
                  label="노선명"
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
          </div>
        ) : null}
      </section>

      {!isCreateMode ? (
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-2 pt-1.5"
          role="tablist"
          aria-label="표주목록"
        >
          <div className="flex min-w-0 flex-1 items-stretch gap-0.5 self-stretch">
            <button
              type="button"
              role="tab"
              aria-selected
              className="relative flex shrink-0 items-center px-2.5 pb-1.5 text-[11px] font-medium text-primary"
            >
              표주목록 ({markers.length.toLocaleString()})
              <span className="absolute inset-x-1 bottom-1 h-0.5 rounded-full bg-primary" />
            </button>
          </div>
          {canEditMarkers ? (
            <button
              type="button"
              className={btnGhost}
              onClick={() => {
                markerPointSnapshotRef.current = {
                  lon: null,
                  lat: null,
                  installLocation: '',
                  landCategory: '',
                };
                setMarkerPointSnapshot(markerPointSnapshotRef.current);
                setItemModal({
                  mode: 'new',
                  draft: createEmptyRoadFrontageMarkerItem(),
                });
              }}
            >
              <Plus className="h-3 w-3" />
              추가
            </button>
          ) : null}
        </div>

        <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
          {markers.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-muted-foreground">
              등록된 표주가 없습니다.
            </p>
          ) : (
            <div className="w-full overflow-hidden rounded border border-border text-[11px]">
              <div
                className={cn(
                  'grid h-7 items-center border-b border-border bg-muted',
                  canEditMarkers ? MARKER_ROW_COLS_EDIT : MARKER_ROW_COLS
                )}
              >
                <div className="min-w-0 px-1.5 text-left font-semibold text-foreground">설치 위치</div>
                <div className="px-1 text-center font-semibold text-foreground">지목</div>
                <div className="px-1 text-center font-semibold whitespace-nowrap text-foreground">
                  지점거리
                </div>
                <div className="min-w-0 px-1 text-left font-semibold text-foreground">소유자</div>
                {canEditMarkers ? <div aria-hidden /> : null}
              </div>
              {markers.map((m) => {
                const loc = normalizeMarkerInstallLocation(m.installLocation);
                const selected = m.id === selectedMarkerId;
                return (
                  <div
                    key={m.id || createRoadFrontageMarkerId('row')}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleMarkerRowClick(m)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleMarkerRowClick(m);
                      }
                    }}
                    title={
                      canEditMarkers
                        ? '클릭하면 지도에서 위치를 확인합니다'
                        : '클릭하면 표주 상세를 봅니다'
                    }
                    className={cn(
                      'grid h-7 cursor-pointer items-center border-b border-border last:border-b-0 hover:bg-muted/50',
                      canEditMarkers ? MARKER_ROW_COLS_EDIT : MARKER_ROW_COLS,
                      selected && 'bg-primary/5'
                    )}
                  >
                    <div
                      className="min-w-0 truncate px-1.5 text-left text-foreground"
                      title={loc || undefined}
                    >
                      {loc || '—'}
                    </div>
                    <div
                      className="truncate px-1 text-center text-foreground"
                      title={m.landCategory || undefined}
                    >
                      {m.landCategory.trim() || '—'}
                    </div>
                    <div
                      className="truncate px-1 text-center tabular-nums text-foreground"
                      title={m.stationDistance || undefined}
                    >
                      {m.stationDistance || '—'}
                    </div>
                    <div
                      className="min-w-0 truncate px-1 text-left text-foreground"
                      title={m.ownerName || undefined}
                    >
                      {m.ownerName || '—'}
                    </div>
                    {canEditMarkers ? (
                      <div
                        className="flex w-full shrink-0 items-center justify-center gap-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => handleOpenEditMarker(m)}
                          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary"
                          aria-label="표주 수정"
                          title="수정"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeMarker(m.id)}
                          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                          aria-label="표주 삭제"
                          title="삭제"
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
        </MapSideDetailScroll>
      </div>
      ) : null}

      {mapPickActive && mapPickBannerHost
        ? createPortal(
            <div
              className="pointer-events-none absolute z-[15] flex -translate-x-1/2 flex-col gap-1.5 rounded border border-red-300 bg-red-50/95 px-3 py-1.5 text-[11px] font-medium text-red-700 shadow-sm dark:border-red-800 dark:bg-red-950/80 dark:text-red-300"
              style={
                mapPickCenterPixel
                  ? { left: mapPickCenterPixel.x, top: mapPickHintTopPx }
                  : { left: '50%', top: mapPickHintTopPx }
              }
            >
              <span className="whitespace-nowrap text-center">{mapPickHintText}</span>
              <div className="pointer-events-none flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  className={layerRowPanelButtonClass(
                    'default',
                    'pointer-events-auto shrink-0 border-red-200 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50'
                  )}
                  disabled={!mapPickHasPoint}
                  onClick={() => markerPointOpsRef.current?.startDraw()}
                >
                  도형추가
                </button>
                {mapPickShowReset ? (
                  <button
                    type="button"
                    className={layerRowPanelButtonClass(
                      'default',
                      'pointer-events-auto shrink-0 border-red-200 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50'
                    )}
                    onClick={() => markerPointOpsRef.current?.reset()}
                  >
                    초기화
                  </button>
                ) : null}
                <button
                  type="button"
                  className={layerRowPanelButtonClass('danger', 'pointer-events-auto shrink-0')}
                  disabled={!mapPickHasPoint}
                  onClick={() => markerPointOpsRef.current?.deleteGeom()}
                >
                  도형삭제
                </button>
              </div>
            </div>,
            mapPickBannerHost
          )
        : null}

      {itemModal && !isCreateMode ? (
        <RoadFrontageMarkerItemModal
          draft={itemModal.draft}
          isNew={itemModal.mode === 'new'}
          readOnly={itemModal.mode === 'view'}
          vworldApiKey={vworldApiKey}
          onChange={(next) => {
            setItemModal((prev) => {
              if (!prev || prev.mode === 'view') return prev;
              const draft = typeof next === 'function' ? next(prev.draft) : next;
              if (
                draft.lon != null &&
                draft.lat != null &&
                Number.isFinite(draft.lon) &&
                Number.isFinite(draft.lat)
              ) {
                setSelectedMarkerId(draft.id);
                flyToMarker(map, draft);
              }
              return { ...prev, draft };
            });
          }}
          onSubmit={submitItemModal}
          onClose={() => setItemModal(null)}
          onDelete={
            itemModal.mode === 'edit' ? () => removeMarker(itemModal.draft.id) : undefined
          }
          overlayLeftPx={overlayLeftPx}
          overlayWidthPx={overlayWidthPx}
        />
      ) : null}
    </div>
  );
}
