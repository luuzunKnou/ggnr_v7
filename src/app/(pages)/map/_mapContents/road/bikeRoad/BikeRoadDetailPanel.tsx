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
import { BikeRoadAttrTable, type BikeRoadAttrEntry } from "./BikeRoadAttrTable";
import { BikeRoadSegmentListSection } from "./BikeRoadSegmentListSection";
import { BikeRoadSegmentModal } from "./BikeRoadSegmentModal";
import {
  BIKE_ROAD_KIND_OPTIONS,
  bikeRoadSerialPrefix,
  createEmptyBikeRoadSegment,
  formatBikeRoadLengthKm,
  isNewBikeRoadRouteId,
  normalizeBikeRoadKind,
  renumberBikeRoadSegments,
  type BikeRoadAttachment,
  type BikeRoadRoute,
  type BikeRoadSegment,
} from "./bikeRoadMock";

function isBikeRoadImageAttachment(att: BikeRoadAttachment): boolean {
  if (!att.url) return false;
  return (
    /\.(png|jpe?g|webp|gif)$/i.test(att.name) ||
    /\.(png|jpe?g|webp|gif)$/i.test(att.url) ||
    att.url.startsWith("blob:")
  );
}

type SegModalState =
  | { mode: "view"; segment: BikeRoadSegment }
  | { mode: "edit"; segment: BikeRoadSegment }
  | { mode: "new"; segment: BikeRoadSegment };

type Props = {
  route: BikeRoadRoute;
  onClose: () => void;
  onSave: (next: BikeRoadRoute) => void;
  onDelete: (id: string) => void;
  overlayLeftPx: number;
  overlayWidthPx: number;
};

type AttrDraft = {
  title: string;
  kind: string;
  lengthKm: string;
  direction: string;
  startPoint: string;
  endPoint: string;
  bridges: string;
  subway: string;
  remark: string;
};

/** 조회 행과 비슷한 높이 유지 + 얇은 테두리 */
const fieldClass =
  "box-border h-[22px] w-full min-w-0 max-w-full rounded border border-border bg-background px-1 text-[11px] leading-none text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/25";
const btnPrimary =
  "inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";
const btnGhost =
  "inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-50";
const btnDanger =
  "inline-flex h-7 items-center gap-1 rounded border border-destructive/30 bg-background px-2 text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50";

function routeToDraft(route: BikeRoadRoute): AttrDraft {
  return {
    title: route.title,
    kind: normalizeBikeRoadKind(route.kind),
    lengthKm: Number.isFinite(route.lengthKm) ? String(route.lengthKm) : "",
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
          <img
            src={att.url}
            alt={att.name}
            className="h-full w-full object-cover"
          />
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

export function BikeRoadDetailPanel({
  route,
  onClose,
  onSave,
  onDelete,
  overlayLeftPx,
  overlayWidthPx,
}: Props) {
  const isNew = isNewBikeRoadRouteId(route.id);
  const [attrsOpen, setAttrsOpen] = useState(true);
  const [attrEditing, setAttrEditing] = useState(isNew);
  const [draft, setDraft] = useState<AttrDraft>(() => routeToDraft(route));
  const [draftSegments, setDraftSegments] = useState<BikeRoadSegment[]>(() =>
    route.segments.map((s) => ({ ...s }))
  );
  const [selectedSegId, setSelectedSegId] = useState<string | null>(null);
  const [segModal, setSegModal] = useState<SegModalState | null>(null);
  const [filePreview, setFilePreview] = useState<{
    items: ServiceFilePreviewItem[];
    index: number;
  } | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const displaySegments = attrEditing ? draftSegments : route.segments;

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

  useEffect(() => {
    setAttrsOpen(true);
    setSelectedSegId(null);
    setSegModal(null);
    setFilePreview(null);
    setDraft(routeToDraft(route));
    setDraftSegments(route.segments.map((s) => ({ ...s })));
    setAttrEditing(isNewBikeRoadRouteId(route.id));
  }, [route.id]);

  const viewEntries = useMemo<BikeRoadAttrEntry[]>(() => {
    const entries: BikeRoadAttrEntry[] = [
      {
        fieldKey: "kind",
        label: "구분",
        value: normalizeBikeRoadKind(route.kind),
      },
      {
        fieldKey: "lengthKm",
        label: "연장",
        value: formatBikeRoadLengthKm(route.lengthKm),
      },
      {
        fieldKey: "direction",
        label: "진행방향",
        value: route.direction || "—",
        fullWidth: true,
        multiline: true,
      },
      {
        fieldKey: "startPoint",
        label: "시점",
        value: route.startPoint || "—",
        fullWidth: true,
      },
      {
        fieldKey: "endPoint",
        label: "종점",
        value: route.endPoint || "—",
        fullWidth: true,
      },
      {
        fieldKey: "subway",
        label: "지하철역",
        value: route.subway.trim() || "—",
        fullWidth: true,
      },
      {
        fieldKey: "bridges",
        label: "교량",
        value: route.bridges.trim() || "—",
        fullWidth: true,
      },
    ];
    entries.push({
      fieldKey: "remark",
      label: "비고",
      value: route.remark || "—",
      fullWidth: true,
      multiline: true,
    });
    return entries;
  }, [route]);

  const editEntries = useMemo<BikeRoadAttrEntry[]>(() => {
    const set = <K extends keyof AttrDraft>(key: K, value: AttrDraft[K]) =>
      setDraft((d) => ({ ...d, [key]: value }));

    return [
      {
        fieldKey: "kind",
        label: "구분",
        value: (
          <select
            className={fieldClass}
            value={draft.kind}
            onChange={(e) => set("kind", e.target.value)}
          >
            {BIKE_ROAD_KIND_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ),
      },
      {
        fieldKey: "lengthKm",
        label: "연장(km)",
        value: (
          <input
            className={fieldClass}
            inputMode="decimal"
            value={draft.lengthKm}
            onChange={(e) =>
              set("lengthKm", e.target.value.replace(/[^\d.-]/g, ""))
            }
          />
        ),
      },
      {
        fieldKey: "direction",
        label: "진행방향",
        fullWidth: true,
        value: (
          <input
            className={fieldClass}
            value={draft.direction}
            onChange={(e) => set("direction", e.target.value)}
          />
        ),
      },
      {
        fieldKey: "startPoint",
        label: "시점",
        fullWidth: true,
        value: (
          <input
            className={fieldClass}
            value={draft.startPoint}
            onChange={(e) => set("startPoint", e.target.value)}
          />
        ),
      },
      {
        fieldKey: "endPoint",
        label: "종점",
        fullWidth: true,
        value: (
          <input
            className={fieldClass}
            value={draft.endPoint}
            onChange={(e) => set("endPoint", e.target.value)}
          />
        ),
      },
      {
        fieldKey: "subway",
        label: "지하철역",
        fullWidth: true,
        value: (
          <input
            className={fieldClass}
            value={draft.subway}
            onChange={(e) => set("subway", e.target.value)}
          />
        ),
      },
      {
        fieldKey: "bridges",
        label: "교량",
        fullWidth: true,
        value: (
          <input
            className={fieldClass}
            value={draft.bridges}
            onChange={(e) => set("bridges", e.target.value)}
          />
        ),
      },
      {
        fieldKey: "title",
        label: "목록명",
        fullWidth: true,
        value: (
          <input
            className={fieldClass}
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="시점 ~ 종점"
          />
        ),
      },
      {
        fieldKey: "remark",
        label: "비고",
        fullWidth: true,
        value: (
          <input
            className={fieldClass}
            value={draft.remark}
            onChange={(e) => set("remark", e.target.value)}
          />
        ),
      },
    ];
  }, [draft]);

  const beginEdit = () => {
    setDraft(routeToDraft(route));
    setDraftSegments(route.segments.map((s) => ({ ...s })));
    setSelectedSegId(null);
    setSegModal(null);
    setAttrEditing(true);
    setAttrsOpen(true);
  };

  const cancelEdit = () => {
    if (isNew) {
      onDelete(route.id);
      return;
    }
    setDraft(routeToDraft(route));
    setDraftSegments(route.segments.map((s) => ({ ...s })));
    setSelectedSegId(null);
    setSegModal(null);
    setAttrEditing(false);
  };

  const handleSave = () => {
    const title =
      draft.title.trim() ||
      [draft.startPoint.trim(), draft.endPoint.trim()].filter(Boolean).join(" ~ ") ||
      "새 노선";
    const lengthKm = Number(draft.lengthKm);
    const prefix = bikeRoadSerialPrefix(draftSegments);
    const segments = renumberBikeRoadSegments(draftSegments, prefix);
    const next: BikeRoadRoute = {
      ...route,
      title,
      kind: normalizeBikeRoadKind(draft.kind || route.kind),
      // 선색·경로는 속성 UI에서 다루지 않음 (지도 연동 시 별도)
      lengthKm: Number.isFinite(lengthKm) ? lengthKm : 0,
      direction: draft.direction.trim(),
      startPoint: draft.startPoint.trim(),
      endPoint: draft.endPoint.trim(),
      bridges: draft.bridges.trim(),
      subway: draft.subway.trim(),
      remark: draft.remark.trim(),
      // 기점·종점 라벨은 속성 UI에서 제외 — 기존값 유지, 없으면 시점·종점
      startLabel: route.startLabel.trim() || draft.startPoint.trim(),
      endLabel: route.endLabel.trim() || draft.endPoint.trim(),
      segments,
      // 신규 id는 저장 시 확정 id로 바꿈 (프로토타입 로컬)
      id: isNew ? `bike-route-${Date.now()}` : route.id,
    };
    onSave(next);
    setDraftSegments(segments.map((s) => ({ ...s })));
    setSelectedSegId(null);
    setSegModal(null);
    setAttrEditing(false);
  };

  const handleSelectSegment = (seg: BikeRoadSegment) => {
    setSelectedSegId(seg.id);
    if (attrEditing) {
      setSegModal({ mode: "edit", segment: seg });
    } else {
      setSegModal({ mode: "view", segment: seg });
    }
  };

  const handleAddSegment = () => {
    const prefix = bikeRoadSerialPrefix(draftSegments);
    const seg = createEmptyBikeRoadSegment({
      routePrefix: prefix,
      index1: draftSegments.length + 1,
    });
    setSelectedSegId(seg.id);
    setSegModal({ mode: "new", segment: seg });
  };

  const handleRemoveSegment = (segmentId: string) => {
    const target = draftSegments.find((s) => s.id === segmentId);
    const label = target
      ? `${target.serialNo}${target.routeName ? ` · ${target.routeName}` : ""}`
      : "구간";
    if (!window.confirm(`「${label}」을(를) 목록에서 뺄까요?`)) return;
    setDraftSegments((list) => list.filter((s) => s.id !== segmentId));
    if (selectedSegId === segmentId) setSelectedSegId(null);
    setSegModal((m) => (m?.segment.id === segmentId ? null : m));
  };

  const handleConfirmSegment = (next: BikeRoadSegment) => {
    if (!segModal) return;
    if (segModal.mode === "new") {
      setDraftSegments((list) => [...list, next]);
    } else {
      setDraftSegments((list) =>
        list.map((s) => (s.id === next.id ? next : s))
      );
    }
    setSelectedSegId(next.id);
    setSegModal(null);
  };

  /** 첨부는 노선 속성 «수정»과 무관 — 즉시 반영 */
  const persistAttachments = (attachments: BikeRoadAttachment[]) => {
    if (isNew) return;
    onSave({ ...route, attachments });
  };

  const handleAddAttachments = (files: FileList | null) => {
    if (!files || files.length === 0 || isNew) return;
    const added: BikeRoadAttachment[] = Array.from(files).map((file, i) => {
      const isImg = /^image\//i.test(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
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
    if (!window.confirm(`「${label}」을(를) 삭제할까요?`)) return;
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
      setSelectedSegId(null);
      setSegModal(null);
      setAttrEditing(false);
    }
    onClose();
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <h2
          className="min-w-0 truncate text-sm font-semibold text-foreground"
          title={attrEditing ? draft.title || route.title : route.title}
        >
          {attrEditing ? draft.title || route.title : route.title}
        </h2>
        <button
          type="button"
          onClick={handleClose}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <section className="shrink-0 border-b border-border">
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
          <div className="max-h-[42vh] overflow-y-auto px-3 pb-2.5 scrollbar-hide">
            <BikeRoadAttrTable entries={attrEditing ? editEntries : viewEntries} />
            {attrEditing ? (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                노선 속성과 구간 목록을 함께 저장합니다. 지도 도형은 이후 연동 예정입니다.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <BikeRoadSegmentListSection
        segments={displaySegments}
        activeId={selectedSegId}
        onSelect={handleSelectSegment}
        isEditing={attrEditing}
        onAdd={handleAddSegment}
        onRemove={handleRemoveSegment}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-2 pt-1.5"
          role="tablist"
          aria-label="첨부"
        >
          <div className="flex min-w-0 flex-1 items-stretch gap-0.5 self-stretch overflow-x-auto scrollbar-hide">
            <button
              type="button"
              role="tab"
              aria-selected
              className="relative flex shrink-0 items-center px-2.5 pb-1.5 text-[11px] font-medium text-primary"
            >
              {`첨부 (${route.attachments.length})`}
              <span className="absolute inset-x-1 bottom-1 h-0.5 rounded-full bg-primary" />
            </button>
          </div>
          <div className="mb-1 mr-1 flex h-7 shrink-0 items-center justify-end">
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
              className={cn(btnPrimary, "shrink-0")}
              disabled={isNew}
              title={isNew ? "노선 등록 후 첨부할 수 있습니다" : "첨부 추가"}
              onClick={() => attachInputRef.current?.click()}
            >
              <Plus className="h-3 w-3" />
              첨부
            </button>
          </div>
        </div>

        <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
          {route.attachments.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-muted-foreground">
              첨부파일이 없습니다.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
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

        {segModal ? (
          <BikeRoadSegmentModal
            segment={segModal.segment}
            readOnly={segModal.mode === "view"}
            isNew={segModal.mode === "new"}
            onConfirm={
              segModal.mode === "view" ? undefined : handleConfirmSegment
            }
            onClose={() => setSegModal(null)}
            overlayLeftPx={overlayLeftPx}
            overlayWidthPx={overlayWidthPx}
          />
        ) : null}

        {filePreview ? (
          <ServiceFileImagePreview
            items={filePreview.items}
            initialIndex={filePreview.index}
            onClose={() => setFilePreview(null)}
          />
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border bg-background px-3 py-2">
        {!attrEditing ? (
          <>
            <button type="button" className={btnGhost} onClick={beginEdit}>
              수정
            </button>
            <button type="button" className={btnDanger} onClick={handleDelete}>
              <Trash2 className="h-3 w-3" />
              삭제
            </button>
          </>
        ) : (
          <>
            <button type="button" className={btnPrimary} onClick={handleSave}>
              {isNew ? "등록" : "저장"}
            </button>
            <button type="button" className={btnGhost} onClick={cancelEdit}>
              취소
            </button>
          </>
        )}
      </div>
    </div>
  );
}
