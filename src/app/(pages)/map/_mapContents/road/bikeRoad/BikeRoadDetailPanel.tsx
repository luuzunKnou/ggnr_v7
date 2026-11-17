"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { useMapContext } from "../../../_mapComponents/MapContext";
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from "../../../_mapComponents/standard/ServiceFileImagePreview";
import {
  GEOM_EDIT_HINT_BELOW_SEARCH_GAP,
  useSearchBarOffset,
} from "../../../searchBarOffsetContext";
import { BikeRoadAttrTable, type BikeRoadAttrDraft } from "./BikeRoadAttrTable";
import { BikeRoadLocationMap } from "./BikeRoadLocationMap";
import { BikeRoadSegmentDrawBanner } from "./BikeRoadSegmentDrawBanner";
import { BikeRoadSegmentListSection } from "./BikeRoadSegmentListSection";
import { titleFromDirection } from "./bikeRoadDirection";
import { mergeRouteLineCoords } from "./bikeRoadSegmentGeom";
import {
  bikeRoadSerialPrefix,
  isNewBikeRoadRouteId,
  normalizeBikeRoadKind,
  pathStyleFromKind,
  renumberBikeRoadSegments,
  type BikeRoadAttachment,
  type BikeRoadRoute,
  type BikeRoadSegment,
} from "./bikeRoadMock";
import {
  useBikeRoadSegmentDraw,
  type BikeRoadDrawSideMode,
} from "./useBikeRoadSegmentDraw";

function isBikeRoadImageAttachment(att: BikeRoadAttachment): boolean {
  if (!att.url) return false;
  return (
    /\.(png|jpe?g|webp|gif)$/i.test(att.name) ||
    /\.(png|jpe?g|webp|gif)$/i.test(att.url) ||
    att.url.startsWith("blob:")
  );
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
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const mapPaddingLeft = mapContext?.mapPaddingLeft ?? 0;
  const mapPaddingRight = mapContext?.mapPaddingRight ?? 0;
  const { inputBottomPx } = useSearchBarOffset();
  const geomHintTopPx = inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP;

  const [attrsOpen, setAttrsOpen] = useState(true);
  const [attrEditing, setAttrEditing] = useState(isNew);
  const [draft, setDraft] = useState<BikeRoadAttrDraft>(() => routeToDraft(route));
  const [draftSegments, setDraftSegments] = useState<BikeRoadSegment[]>(() =>
    route.segments.map((s) => ({ ...s }))
  );
  const [drawMode, setDrawMode] = useState<BikeRoadDrawSideMode | null>(null);
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

  const segmentDraw = useBikeRoadSegmentDraw({
    active: attrEditing && drawMode != null,
    mode: drawMode,
    routePrefix: drawPrefix,
    nextIndex1: drawNextIndex,
    onComplete: (result) => {
      setDraftSegments((list) => {
        const next = [...list, ...result.segments];
        const merged = mergeRouteLineCoords(next);
        const first = next[0];
        const last = next[next.length - 1];
        // 지도·위치도에 바로 보이게 저장(수정 모드는 유지)
        onSave({
          ...route,
          segments: next,
          lineCoords: merged.length >= 2 ? merged : route.lineCoords,
          startLabel:
            route.startLabel.trim() || first?.startName?.trim() || route.startLabel,
          endLabel: route.endLabel.trim() || last?.endName?.trim() || route.endLabel,
          locationMapUrl: undefined,
        });
        return next;
      });
      setDrawMode(null);
    },
    onCancel: () => setDrawMode(null),
  });

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
    setDrawMode(null);
    setBottomTab("history");
  }, [route.id]);

  const beginEdit = () => {
    setDraft(routeToDraft(route));
    setDraftSegments(route.segments.map((s) => ({ ...s })));
    setAttrEditing(true);
    setAttrsOpen(true);
    setDrawMode(null);
  };

  const cancelEdit = () => {
    if (isNew) {
      onDelete(route.id);
      return;
    }
    setDraft(routeToDraft(route));
    setDraftSegments(route.segments.map((s) => ({ ...s })));
    setAttrEditing(false);
    setDrawMode(null);
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
      startPoint: draft.startPoint.trim(),
      endPoint: draft.endPoint.trim(),
      bridges: draft.bridges.trim(),
      subway: draft.subway.trim(),
      remark: draft.remark.trim(),
      startLabel:
        route.startLabel.trim() ||
        firstSeg?.startName?.trim() ||
        draft.startPoint.trim(),
      endLabel:
        route.endLabel.trim() ||
        lastSeg?.endName?.trim() ||
        draft.endPoint.trim(),
      pathStyle: pathStyleFromKind(kind),
      segments,
      lineCoords: mergedLine.length >= 2 ? mergedLine : route.lineCoords,
      id: isNew ? `bike-route-${Date.now()}` : route.id,
    };
    onSave(next);
    setDraftSegments(segments.map((s) => ({ ...s })));
    setAttrEditing(false);
    setDrawMode(null);
  };

  const handleRemoveSegment = (segmentId: string) => {
    const target = draftSegments.find((s) => s.id === segmentId);
    const label = target
      ? `${target.serialNo}${target.routeName ? ` · ${target.routeName}` : ""}`
      : "구간";
    if (!window.confirm(`「${label}」을(를) 목록에서 뺄까요?`)) return;
    setDraftSegments((list) => list.filter((s) => s.id !== segmentId));
  };

  const handleChangeSegment = (
    segmentId: string,
    key: Exclude<keyof BikeRoadSegment, "id">,
    value: string
  ) => {
    setDraftSegments((list) =>
      list.map((s) => (s.id === segmentId ? { ...s, [key]: value } : s))
    );
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
      setDrawMode(null);
    }
    onClose();
  };

  const title = attrEditing
    ? titleFromDirection(draft.direction) || draft.title || route.title
    : route.title;
  const bannerHost = map?.getTargetElement()?.parentElement ?? null;

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
            drawActive={drawMode != null}
            onAddPick={(mode) => setDrawMode(mode)}
            onRemove={handleRemoveSegment}
            onChange={handleChangeSegment}
          />
        </div>

        {drawMode && bannerHost
          ? createPortal(
              <div
                className="pointer-events-none absolute z-[15] flex justify-center"
                style={{
                  top: geomHintTopPx,
                  left: mapPaddingLeft,
                  right: mapPaddingRight,
                }}
              >
                <BikeRoadSegmentDrawBanner
                  mode={drawMode}
                  pointCount={segmentDraw.pointCount}
                  busy={segmentDraw.busy}
                  notice={segmentDraw.notice}
                  onFinish={() => void segmentDraw.finish()}
                  onUndo={segmentDraw.undoLast}
                  onCancel={segmentDraw.cancel}
                />
              </div>,
              bannerHost
            )
          : null}

        <div className="relative flex min-h-0 flex-1 flex-col bg-background">
          <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border">
            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="flex h-9 shrink-0 items-center border-b border-border px-3">
                <span className="text-xs font-semibold text-foreground/90">위치도</span>
              </div>
              <div className="min-h-0 flex-1 p-2">
                <BikeRoadLocationMap
                  route={route}
                  onSaveImage={
                    isNew
                      ? undefined
                      : (dataUrl) => {
                          onSave({ ...route, locationMapUrl: dataUrl });
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
