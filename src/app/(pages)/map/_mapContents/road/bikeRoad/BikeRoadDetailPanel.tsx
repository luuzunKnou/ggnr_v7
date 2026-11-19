"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MapSideDetailScroll } from "../../../_mapComponents/MapSideDetailScroll";
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from "../../../_mapComponents/standard/ServiceFileImagePreview";
import { BikeRoadAttrTable, type BikeRoadAttrDraft } from "./BikeRoadAttrTable";
import { BikeRoadLocationMap } from "./BikeRoadLocationMap";
import { BikeRoadSegmentDrawModal } from "./BikeRoadSegmentDrawModal";
import { BikeRoadSegmentListSection } from "./BikeRoadSegmentListSection";
import { titleFromDirection } from "./bikeRoadDirection";
import { fromLonLat } from "ol/proj";
import { call } from "@/lib/api";
import { getAddressFromCoord } from "../../../_mapComponents/addressSearch/vworldAddressSearch";
import { useMapContext } from "../../../_mapComponents/MapContext";
import {
  bikeRoadPointAddressLabel,
  bikeRoadShortAddress,
  isBikeRoadPlaceholderName,
  mergeRouteLineCoords,
  routeEndsFromSegments,
} from "./bikeRoadSegmentGeom";
import { sumBikeRoadLengthKm } from "./bikeRoadOverlapDisplay";
import { warmBikeRoadNetByBbox } from "./loadBikeRoadNet";
import {
  bikeRoadSerialPrefix,
  isNewBikeRoadRouteId,
  normalizeBikeRoadKind,
  pathStyleFromKind,
  pathStyleFromPathType,
  renumberBikeRoadSegments,
  type BikeRoadAttachment,
  type BikeRoadRoute,
  type BikeRoadSegment,
} from "./bikeRoadMock";
import type { DrawSnapAnchor } from "./useBikeRoadSegmentDraw";

function isBikeRoadImageAttachment(att: BikeRoadAttachment): boolean {
  if (!att.url) return false;
  return (
    /\.(png|jpe?g|webp|gif)$/i.test(att.name) ||
    /\.(png|jpe?g|webp|gif)$/i.test(att.url) ||
    att.url.startsWith("blob:")
  );
}

/** «기점»«종점» 자리표시면 좌표로 점(지번) 주소 다시 채움 */
async function fillPlaceholderEndNames(
  seg: BikeRoadSegment,
  apiKey?: string
): Promise<BikeRoadSegment> {
  const needS = isBikeRoadPlaceholderName(seg.startName);
  const needE = isBikeRoadPlaceholderName(seg.endName);
  if (!needS && !needE) return seg;
  const coords = seg.centerLineCoords ?? seg.lineCoords;
  if (!coords || coords.length < 2) return seg;
  const s = coords[0]!;
  const e = coords[coords.length - 1]!;
  const opts = apiKey ? { apiKey } : undefined;
  try {
    const [sa, ea] = await Promise.all([
      needS ? getAddressFromCoord(s[0], s[1], opts) : Promise.resolve(null),
      needE ? getAddressFromCoord(e[0], e[1], opts) : Promise.resolve(null),
    ]);
    return {
      ...seg,
      startName: needS
        ? bikeRoadPointAddressLabel(sa) || bikeRoadShortAddress(seg.startName)
        : bikeRoadShortAddress(seg.startName),
      endName: needE
        ? bikeRoadPointAddressLabel(ea) || bikeRoadShortAddress(seg.endName)
        : bikeRoadShortAddress(seg.endName),
    };
  } catch {
    return seg;
  }
}

type Props = {
  route: BikeRoadRoute;
  onClose: () => void;
  onSave: (next: BikeRoadRoute) => void;
  onDelete: (id: string) => void;
};

type BottomTab = "history" | "attachments";

const actionBtn = "standard-detail-action-btn inline-flex h-7 items-center gap-1";
const actionBtnPrimary =
  "inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50";
const actionBtnDanger = "standard-detail-action-btn-danger inline-flex h-7 items-center gap-1";

function routeToDraft(route: BikeRoadRoute): BikeRoadAttrDraft {
  return {
    title: route.title,
    kind: normalizeBikeRoadKind(route.kind),
    totalLength: route.totalLength ?? "",
    direction: route.direction,
    startPoint: route.startPoint,
    endPoint: route.endPoint,
    bridges: route.bridges,
    subway: route.subway,
    remark: route.remark,
  };
}

function AttachmentThumb({
  att,
  onPreview,
  onRemove,
}: {
  att: BikeRoadAttachment;
  onPreview?: () => void;
  onRemove?: (id: string) => void;
}) {
  const lower = att.name.toLowerCase();
  const isImage = isBikeRoadImageAttachment(att);
  const isPdf = lower.endsWith(".pdf");
  const isExcel = /\.(xlsx?|csv)$/i.test(lower);
  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        onClick={onPreview}
        disabled={!onPreview}
        className={cn(
          "relative flex aspect-square w-full flex-col items-center justify-center gap-1 overflow-hidden rounded border border-border bg-muted/50 text-muted-foreground",
          onPreview ? "cursor-zoom-in" : "cursor-default"
        )}
        title={onPreview ? `${att.name} 미리보기` : att.name}
      >
        {isImage && att.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- 프로토타입 첨부 미리보기
          <img src={att.url} alt={att.name} className="h-full w-full object-cover" />
        ) : (
          <>
            <FileText className="h-5 w-5" />
            <span className="text-[10px] font-semibold">
              {isPdf ? "PDF" : isExcel ? "엑셀" : "파일"}
            </span>
          </>
        )}
      </button>
      {onRemove ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end p-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            className="pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded-md bg-background text-destructive shadow-md ring-1 ring-border/80 hover:bg-destructive/10"
            title="첨부 삭제"
            aria-label="첨부 삭제"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(att.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={att.name}>
        {att.name}
      </p>
    </div>
  );
}

export function BikeRoadDetailPanel({ route, onClose, onSave, onDelete }: Props) {
  const isNew = isNewBikeRoadRouteId(route.id);
  const mapContext = useMapContext();
  const routeRef = useRef(route);
  routeRef.current = route;
  const draftSegmentsRef = useRef<BikeRoadSegment[]>([]);

  const [attrsOpen, setAttrsOpen] = useState(true);
  const [attrEditing, setAttrEditing] = useState(isNew);
  const [draft, setDraft] = useState<BikeRoadAttrDraft>(() => routeToDraft(route));
  const [draftSegments, setDraftSegments] = useState<BikeRoadSegment[]>(() =>
    route.segments.map((s) => ({ ...s }))
  );
  const [drawModalOpen, setDrawModalOpen] = useState(false);

  /** 상세 열리면 현재 지도 범위 도로망 미리 받아 두기 — 구간 추가 창이 바로 뜨게 */
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map || !mapContext?.mapReady) return;
    const size = map.getSize();
    if (!size) return;
    const extent = map.getView().calculateExtent(size) as [
      number,
      number,
      number,
      number,
    ];
    const resolution = map.getView().getResolution() ?? undefined;
    void warmBikeRoadNetByBbox(extent, { resolution });
  }, [mapContext, mapContext?.mapReady, route.id]);

  const openDrawModal = () => {
    const map = mapContext?.mapInstanceRef?.current;
    if (map) {
      const size = map.getSize();
      if (size) {
        const extent = map.getView().calculateExtent(size) as [
          number,
          number,
          number,
          number,
        ];
        const resolution = map.getView().getResolution() ?? undefined;
        void warmBikeRoadNetByBbox(extent, { resolution });
      }
    }
    setDrawModalOpen(true);
    const snapshot = draftSegments;
    const apiKey = mapContext?.vworldApiKey?.trim() || undefined;
    void (async () => {
      const filled = await Promise.all(
        snapshot.map((s) => fillPlaceholderEndNames(s, apiKey))
      );
      const changed = filled.some(
        (s, i) =>
          s.startName !== snapshot[i]!.startName ||
          s.endName !== snapshot[i]!.endName
      );
      if (!changed) return;
      setDraftSegments(filled);
      const ends = routeEndsFromSegments(filled);
      const sum = sumBikeRoadLengthKm(filled);
      setDraft((d) => ({
        ...d,
        startPoint: ends.startPoint,
        endPoint: ends.endPoint,
        direction: ends.direction || d.direction,
        title: ends.direction
          ? titleFromDirection(ends.direction) || d.title
          : d.title,
        totalLength: sum || d.totalLength,
      }));
    })();
  };
  const [bottomTab, setBottomTab] = useState<BottomTab>("history");
  const [filePreview, setFilePreview] = useState<{
    items: ServiceFilePreviewItem[];
    index: number;
  } | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const displaySegments = attrEditing ? draftSegments : route.segments;
  const attrValues = attrEditing ? draft : routeToDraft(route);
  const drawPrefix = bikeRoadSerialPrefix(draftSegments);
  const drawNextIndex = draftSegments.length + 1;
  draftSegmentsRef.current = draftSegments;

  /** 위치도·캡처용 — 편집 중 구간 종류(색)도 반영. 종류가 저장본과 다르면 옛 이미지 숨김 */
  const locationRoute = useMemo(() => {
    const segments =
      draftSegments.length > 0 ? draftSegments : route.segments;
    const keyOf = (list: BikeRoadSegment[]) =>
      list
        .map((s) => {
          const pt = s.pathType ?? "";
          return `${s.id}:${pt}:${pathStyleFromPathType(pt)}`;
        })
        .join("|");
    const typesInSync = keyOf(segments) === keyOf(route.segments);
    return {
      ...route,
      segments,
      locationMapUrl: typesInSync ? route.locationMapUrl : undefined,
    };
  }, [route, draftSegments]);

  const snapAnchors = useMemo((): DrawSnapAnchor[] => {
    const out: DrawSnapAnchor[] = [];
    for (const s of draftSegments) {
      const coords = s.centerLineCoords ?? s.lineCoords;
      if (!coords || coords.length < 2) continue;
      const a = fromLonLat(coords[0]!);
      const b = fromLonLat(coords[coords.length - 1]!);
      out.push({
        point3857: [a[0]!, a[1]!],
        name: s.startName,
      });
      out.push({
        point3857: [b[0]!, b[1]!],
        name: s.endName,
      });
    }
    return out;
  }, [draftSegments]);

  const handleDrawCommit = (result: {
    segments: BikeRoadSegment[];
  }) => {
    setDraftSegments((list) => {
      const next = [...list, ...result.segments];
      const merged = mergeRouteLineCoords(next);
      const ends = routeEndsFromSegments(next);
      const sum = sumBikeRoadLengthKm(next);
      const nextDirection = ends.direction || route.direction;
      const nextTitle = ends.direction
        ? titleFromDirection(ends.direction) || route.title
        : route.title;
      setDraft((d) => ({
        ...d,
        startPoint: ends.startPoint || d.startPoint,
        endPoint: ends.endPoint || d.endPoint,
        direction: ends.direction || d.direction,
        title: ends.direction
          ? titleFromDirection(ends.direction) || d.title
          : d.title,
        totalLength: sum || d.totalLength,
      }));
      const payload = {
        ...route,
        segments: next,
        lineCoords: merged.length >= 2 ? merged : route.lineCoords,
        startPoint: ends.startPoint || route.startPoint,
        endPoint: ends.endPoint || route.endPoint,
        startLabel: ends.startPoint || route.startLabel,
        endLabel: ends.endPoint || route.endLabel,
        direction: nextDirection,
        title: nextTitle,
        totalLength: sum || route.totalLength,
        locationMapUrl: undefined,
      };
      queueMicrotask(() => {
        onSave(payload);
      });
      return next;
    });
    setDrawModalOpen(false);
  };

  /** 구간 추가·삭제·기점/종점 수정 시 → 속성 시점·종점·총연장 실시간 반영 */
  useEffect(() => {
    if (!attrEditing) return;
    const ends = routeEndsFromSegments(draftSegments);
    const sum = sumBikeRoadLengthKm(draftSegments);
    setDraft((d) => {
      const nextTotal = sum || d.totalLength;
      const nextDirection = ends.direction || d.direction;
      const nextTitle = ends.direction
        ? titleFromDirection(ends.direction) || d.title
        : d.title;
      if (
        d.startPoint === ends.startPoint &&
        d.endPoint === ends.endPoint &&
        d.direction === nextDirection &&
        d.title === nextTitle &&
        d.totalLength === nextTotal
      ) {
        return d;
      }
      return {
        ...d,
        startPoint: ends.startPoint,
        endPoint: ends.endPoint,
        direction: nextDirection,
        title: nextTitle,
        totalLength: nextTotal,
      };
    });
  }, [
    attrEditing,
    draftSegments.length,
    draftSegments[0]?.startName,
    draftSegments[draftSegments.length - 1]?.endName,
    draftSegments.map((s) => `${s.id}:${s.totalLength}:${s.side}`).join('|'),
  ]);

  const imagePreviewItems = useMemo<ServiceFilePreviewItem[]>(
    () =>
      route.attachments
        .filter(isBikeRoadImageAttachment)
        .map((a) => ({
          url: a.url!,
          fileName: a.name,
          kind: "image" as const,
        })),
    [route.attachments]
  );

  const historyNewestFirst = useMemo(
    () =>
      [...(route.history ?? [])].sort((a, b) =>
        a.at < b.at ? 1 : a.at > b.at ? -1 : 0
      ),
    [route.history]
  );

  useEffect(() => {
    setAttrsOpen(true);
    setFilePreview(null);
    setDraft(routeToDraft(route));
    setDraftSegments(route.segments.map((s) => ({ ...s })));
    setAttrEditing(isNewBikeRoadRouteId(route.id));
    setDrawModalOpen(false);
    setBottomTab("history");
  }, [route.id]);

  const refillSegmentAddresses = (snapshot: BikeRoadSegment[]) => {
    const apiKey = mapContext?.vworldApiKey?.trim() || undefined;
    void (async () => {
      let key = apiKey;
      if (!key) {
        try {
          const res = await call('', 'POST', {
            service: 'configService',
            action: 'getMapConfig',
            params: {},
          });
          const data = res?.data ?? res;
          key = String(data?.VWORLD_API_KEY ?? '').trim() || undefined;
          if (key) mapContext?.setVworldApiKey?.(key);
        } catch {
          /* ignore */
        }
      }
      const filled = await Promise.all(
        snapshot.map((s) => fillPlaceholderEndNames(s, key))
      );
      const shortened = filled.map((s) => ({
        ...s,
        startName: bikeRoadShortAddress(s.startName),
        endName: bikeRoadShortAddress(s.endName),
      }));
      const changed = shortened.some(
        (s, i) =>
          s.startName !== snapshot[i]!.startName ||
          s.endName !== snapshot[i]!.endName
      );
      const ends = routeEndsFromSegments(shortened);
      const sum = sumBikeRoadLengthKm(shortened);
      if (changed) setDraftSegments(shortened);
      setDraft((d) => ({
        ...d,
        startPoint: bikeRoadShortAddress(ends.startPoint || d.startPoint),
        endPoint: bikeRoadShortAddress(ends.endPoint || d.endPoint),
        totalLength: sum || d.totalLength,
      }));
    })();
  };

  const beginEdit = () => {
    const segs = route.segments.map((s) => ({ ...s }));
    setDraft(routeToDraft(route));
    setDraftSegments(segs);
    setAttrEditing(true);
    setAttrsOpen(true);
    setDrawModalOpen(false);
    refillSegmentAddresses(segs);
  };

  const cancelEdit = () => {
    if (isNew) {
      onDelete(route.id);
      return;
    }
    setDraft(routeToDraft(route));
    setDraftSegments(route.segments.map((s) => ({ ...s })));
    setAttrEditing(false);
    setDrawModalOpen(false);
  };

  const handleSave = () => {
    const title =
      titleFromDirection(draft.direction) ||
      draft.title.trim() ||
      [draft.startPoint.trim(), draft.endPoint.trim()].filter(Boolean).join(" ~ ") ||
      "새 노선";
    const kind = normalizeBikeRoadKind(draft.kind || route.kind);
    const prefix = bikeRoadSerialPrefix(draftSegments);
    const segments = renumberBikeRoadSegments(draftSegments, prefix);
    const mergedLine = mergeRouteLineCoords(segments);
    const firstSeg = segments[0];
    const lastSeg = segments[segments.length - 1];
    const next: BikeRoadRoute = {
      ...route,
      title,
      kind,
      totalLength: draft.totalLength.trim(),
      direction: draft.direction.trim(),
      bridges: draft.bridges.trim(),
      subway: draft.subway.trim(),
      remark: draft.remark.trim(),
      startPoint: draft.startPoint.trim() || firstSeg?.startName?.trim() || "",
      endPoint: draft.endPoint.trim() || lastSeg?.endName?.trim() || "",
      startLabel:
        draft.startPoint.trim() ||
        firstSeg?.startName?.trim() ||
        route.startLabel.trim(),
      endLabel:
        draft.endPoint.trim() ||
        lastSeg?.endName?.trim() ||
        route.endLabel.trim(),
      pathStyle: pathStyleFromKind(kind),
      segments,
      lineCoords: mergedLine.length >= 2 ? mergedLine : route.lineCoords,
      id: isNew ? `bike-route-${Date.now()}` : route.id,
    };
    onSave(next);
    setDraftSegments(segments.map((s) => ({ ...s })));
    setAttrEditing(false);
    setDrawModalOpen(false);
  };

  const handleRemoveSegment = (segmentId: string) => {
    const target = draftSegments.find((s) => s.id === segmentId);
    const label = target
      ? `${target.serialNo}${target.routeName ? ` · ${target.routeName}` : ""}`
      : "구간";
    if (!window.confirm(`「${label}」을(를) 목록에서 뺄까요?`)) return;
    setDraftSegments((list) => {
      const next = list.filter((s) => s.id !== segmentId);
      const merged = mergeRouteLineCoords(next);
      const ends = routeEndsFromSegments(next);
      queueMicrotask(() => {
        onSave({
          ...route,
          segments: next,
          lineCoords: merged.length >= 2 ? merged : [],
          startPoint: ends.startPoint,
          endPoint: ends.endPoint,
          startLabel: ends.startPoint || route.startLabel,
          endLabel: ends.endPoint || route.endLabel,
          direction: ends.direction || route.direction,
          title: ends.direction
            ? titleFromDirection(ends.direction) || route.title
            : route.title,
          locationMapUrl: undefined,
        });
      });
      return next;
    });
  };

  const handleChangeSegment = (
    segmentId: string,
    key: Exclude<keyof BikeRoadSegment, "id">,
    value: string
  ) => {
    setDraftSegments((list) => {
      const next = list.map((s) =>
        s.id === segmentId ? { ...s, [key]: value } : s
      );
      // 종류 변경 시 지도·위치도 색이 바로 바뀌도록 저장 (위치도 재캡처)
      if (key === "pathType" && !isNew) {
        const merged = mergeRouteLineCoords(next);
        const ends = routeEndsFromSegments(next);
        const base = routeRef.current;
        queueMicrotask(() => {
          onSave({
            ...base,
            segments: next,
            lineCoords: merged.length >= 2 ? merged : base.lineCoords,
            startPoint: ends.startPoint || base.startPoint,
            endPoint: ends.endPoint || base.endPoint,
            startLabel: ends.startPoint || base.startLabel,
            endLabel: ends.endPoint || base.endLabel,
            direction: ends.direction || base.direction,
            title: ends.direction
              ? titleFromDirection(ends.direction) || base.title
              : base.title,
            locationMapUrl: undefined,
          });
        });
      }
      return next;
    });
  };

  const persistAttachments = (attachments: BikeRoadAttachment[]) => {
    if (isNew) return;
    onSave({ ...route, attachments });
  };

  const handleAddAttachments = (files: FileList | null) => {
    if (!files || files.length === 0 || isNew) return;
    const added: BikeRoadAttachment[] = Array.from(files).map((file, i) => {
      const isImg =
        /^image\//i.test(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
      return {
        id: `att-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        url: isImg ? URL.createObjectURL(file) : undefined,
      };
    });
    persistAttachments([...route.attachments, ...added]);
    if (attachInputRef.current) attachInputRef.current.value = "";
  };

  const handleRemoveAttachment = (id: string) => {
    const target = route.attachments.find((a) => a.id === id);
    const label = target?.name ?? "첨부";
    if (!window.confirm(`«${label}»을(를) 삭제할까요?`)) return;
    const removed = route.attachments.find((a) => a.id === id);
    if (removed?.url?.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(removed.url);
      } catch {
        /* ignore */
      }
    }
    persistAttachments(route.attachments.filter((a) => a.id !== id));
  };

  const handlePreviewAttachment = (att: BikeRoadAttachment) => {
    if (!isBikeRoadImageAttachment(att) || imagePreviewItems.length === 0) return;
    const index = imagePreviewItems.findIndex(
      (item) => item.url === att.url && item.fileName === att.name
    );
    setFilePreview({
      items: imagePreviewItems,
      index: index >= 0 ? index : 0,
    });
  };

  const handleDelete = () => {
    if (isNew) {
      onDelete(route.id);
      return;
    }
    if (!window.confirm(`「${route.title}」을(를) 삭제할까요?`)) return;
    onDelete(route.id);
  };

  const handleClose = () => {
    if (isNew) {
      onDelete(route.id);
      return;
    }
    if (attrEditing) {
      setDraft(routeToDraft(route));
      setDraftSegments(route.segments.map((s) => ({ ...s })));
      setAttrEditing(false);
      setDrawModalOpen(false);
    }
    onClose();
  };

  const title = attrEditing
    ? titleFromDirection(draft.direction) || draft.title || route.title
    : route.title;

  return (
    <div className="standard-panel-root relative flex h-full min-h-0 flex-col bg-muted">
      <div className="standard-panel-header shrink-0 bg-background">
        <span className="standard-panel-title min-w-0 truncate" title={title}>
          {title}
        </span>
        <button
          type="button"
          onClick={handleClose}
          className="standard-panel-close"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <section className="shrink-0 border-b border-border bg-background">
          <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
            <button
              type="button"
              onClick={() => setAttrsOpen((v) => !v)}
              className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold text-foreground/90"
            >
              {attrsOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              속성정보
            </button>
          </div>
          {attrsOpen ? (
            <div className="max-h-[30vh] overflow-y-auto px-3 pb-2.5 scrollbar-hide">
              <BikeRoadAttrTable
                editing={attrEditing}
                values={attrValues}
                onChange={(key, value) =>
                  setDraft((d) => ({ ...d, [key]: value }))
                }
              />
            </div>
          ) : null}
        </section>

        <div className="shrink-0 bg-background">
          <BikeRoadSegmentListSection
            segments={displaySegments}
            isEditing={attrEditing}
            drawActive={drawModalOpen}
            onAdd={openDrawModal}
            onRemove={handleRemoveSegment}
            onChange={handleChangeSegment}
          />
        </div>

        <BikeRoadSegmentDrawModal
          open={drawModalOpen}
          routePrefix={drawPrefix}
          nextIndex1={drawNextIndex}
          snapAnchors={snapAnchors}
          existingSegments={draftSegments}
          onChangeExisting={(segmentId, key, value) =>
            handleChangeSegment(segmentId, key, value)
          }
          onCommit={handleDrawCommit}
          onClose={() => setDrawModalOpen(false)}
        />

        <div className="relative flex min-h-0 flex-1 flex-col bg-background">
          <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border">
            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="flex h-9 shrink-0 items-center border-b border-border px-3">
                <span className="text-xs font-semibold text-foreground/90">위치도</span>
              </div>
              <div className="min-h-0 flex-1 p-2">
                <BikeRoadLocationMap
                  route={locationRoute}
                  onSaveImage={
                    isNew
                      ? undefined
                      : (dataUrl) => {
                          const cur = routeRef.current;
                          const segs =
                            draftSegmentsRef.current.length > 0
                              ? draftSegmentsRef.current
                              : cur.segments;
                          // 캡처 시점 구간(종류·좌표)을 그대로 저장 — 옛 URL만 덮지 않음
                          onSave({
                            ...cur,
                            segments: segs.map((s) => ({ ...s })),
                            locationMapUrl: dataUrl,
                          });
                        }
                  }
                />
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-col">
              <div
                className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2"
                role="tablist"
                aria-label="정비내역·첨부"
              >
                <div className="flex min-w-0 items-stretch gap-0.5 self-stretch">
                  {(
                    [
                      {
                        id: "history" as const,
                        label: `정비내역 (${historyNewestFirst.length})`,
                      },
                      {
                        id: "attachments" as const,
                        label: `첨부 (${route.attachments.length})`,
                      },
                    ] as const
                  ).map((t) => {
                    const active = bottomTab === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setBottomTab(t.id)}
                        className={cn(
                          "relative flex shrink-0 items-center px-2.5 text-[11px] font-medium transition-colors",
                          active
                            ? "text-primary"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {t.label}
                        {active ? (
                          <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {bottomTab === "attachments" ? (
                  <>
                    <input
                      ref={attachInputRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv"
                      className="hidden"
                      onChange={(e) => handleAddAttachments(e.target.files)}
                    />
                    <button
                      type="button"
                      className={cn(actionBtnPrimary, "shrink-0")}
                      disabled={isNew}
                      title={isNew ? "노선 등록 후 첨부할 수 있습니다" : "첨부 추가"}
                      onClick={() => attachInputRef.current?.click()}
                    >
                      <Plus className="h-3 w-3" />
                      첨부
                    </button>
                  </>
                ) : null}
              </div>

              <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-2 py-2 text-xs">
                {bottomTab === "history" ? (
                  historyNewestFirst.length === 0 ? (
                    <p className="py-6 text-center text-[11px] text-muted-foreground">
                      정비내역이 없습니다.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {historyNewestFirst.map((h) => (
                        <li
                          key={h.id}
                          className="rounded border border-border bg-muted/20 px-2 py-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium text-foreground">
                              {h.action}
                            </span>
                            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                              {h.at}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {h.user}
                            {h.detail ? ` · ${h.detail}` : ""}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )
                ) : route.attachments.length === 0 ? (
                  <p className="py-6 text-center text-[11px] text-muted-foreground">
                    첨부파일이 없습니다.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {route.attachments.map((a) => (
                      <AttachmentThumb
                        key={a.id}
                        att={a}
                        onPreview={
                          isBikeRoadImageAttachment(a)
                            ? () => handlePreviewAttachment(a)
                            : undefined
                        }
                        onRemove={isNew ? undefined : handleRemoveAttachment}
                      />
                    ))}
                  </div>
                )}
              </MapSideDetailScroll>
            </div>
          </div>

          {filePreview ? (
            <ServiceFileImagePreview
              items={filePreview.items}
              initialIndex={filePreview.index}
              onClose={() => setFilePreview(null)}
            />
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border bg-background px-3 py-2">
        {!attrEditing ? (
          <>
            <button type="button" className={actionBtn} onClick={beginEdit}>
              수정
            </button>
            <button type="button" className={actionBtnDanger} onClick={handleDelete}>
              <Trash2 className="h-3 w-3" />
              삭제
            </button>
          </>
        ) : (
          <>
            <button type="button" className={actionBtnPrimary} onClick={handleSave}>
              {isNew ? "등록" : "저장"}
            </button>
            <button type="button" className={actionBtn} onClick={cancelEdit}>
              취소
            </button>
          </>
        )}
      </div>
    </div>
  );
}
