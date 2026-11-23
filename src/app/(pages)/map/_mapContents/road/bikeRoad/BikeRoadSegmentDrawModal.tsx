"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Map, View } from "ol";
import type { Map as OlMap } from "ol";
import { defaults as defaultControls } from "ol/control";
import { defaults as defaultInteractions } from "ol/interaction";
import {
  Check,
  ListChecks,
  Loader2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { FALLBACK_BACKGROUND_MAP_ID } from "../../../_mapComponents/mapControlPanel/backgroundMapSelector";
import { RESOLUTIONS_3857 } from "../../../_mapComponents/config/mapDefaults";
import { createPrintCaptureBackgroundLayer } from "../../mapPrint/mapPrintCapture";
import type { BuiltSegmentDrawResult } from "./bikeRoadSegmentGeom";
import type { BikeRoadSegment } from "./bikeRoadMock";
import { BikeRoadPathLegend } from "./BikeRoadPathLegend";
import {
  useBikeRoadSegmentDraw,
  type BikeRoadDrawSideMode,
  type DrawSnapAnchor,
} from "./useBikeRoadSegmentDraw";

type Props = {
  open: boolean;
  routePrefix: string;
  nextIndex1: number;
  snapAnchors?: DrawSnapAnchor[];
  /** 이미 표에 반영된 구간 — 모달에서 기점·종점 수정 */
  existingSegments?: BikeRoadSegment[];
  onChangeExisting?: (
    segmentId: string,
    key: "startName" | "endName",
    value: string
  ) => void;
  onCommit: (result: BuiltSegmentDrawResult) => void;
  onClose: () => void;
};

const btn =
  "inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted/60 disabled:opacity-50";
const btnPrimary =
  "inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50";
const btnSide =
  "inline-flex h-7 flex-1 items-center justify-center rounded border border-border bg-background px-1.5 text-[11px] font-medium hover:bg-muted/50 disabled:opacity-50";
const btnSideActive =
  "inline-flex h-7 flex-1 items-center justify-center rounded border border-primary bg-primary/10 px-1.5 text-[11px] font-semibold text-primary";

function sideLabel(side: string): string {
  if (side === "both" || side === "R,L") return "양측";
  if (side === "R") return "우측";
  if (side === "L") return "좌측";
  if (side === "C") return "편측";
  return "편측";
}

/**
 * 구간 추가 전용 큰 모달 — 인쇄처럼 넓은 지도 + 좌측 도구.
 */
export function BikeRoadSegmentDrawModal({
  open,
  routePrefix,
  nextIndex1,
  snapAnchors = [],
  existingSegments = [],
  onChangeExisting,
  onCommit,
  onClose,
}: Props) {
  const mapContext = useMapContext();
  const mapHostRef = useRef<HTMLDivElement>(null);
  const [olMap, setOlMap] = useState<OlMap | null>(null);
  const [drawSide, setDrawSide] = useState<BikeRoadDrawSideMode | null>(null);

  useEffect(() => {
    if (!open) {
      setDrawSide(null);
      setOlMap((prev) => {
        prev?.setTarget(undefined);
        return null;
      });
      return;
    }

    let cancelled = false;
    let map: OlMap | null = null;
    let t1 = 0;
    let t2 = 0;
    let t3 = 0;

    const mount = () => {
      const el = mapHostRef.current;
      if (!el || cancelled) return;
      if (map) return;

      const backgroundId =
        mapContext?.mapBackgroundMapIdRef?.current?.trim() ||
        FALLBACK_BACKGROUND_MAP_ID;
      const main = mapContext?.mapInstanceRef?.current;
      const mainView = main?.getView();
      const center = mainView?.getCenter() ?? [14187500, 4180000];
      const zoom = mainView?.getZoom() ?? 16;

      const bg = createPrintCaptureBackgroundLayer(backgroundId);
      map = new Map({
        target: el,
        layers: [bg],
        controls: defaultControls({
          zoom: true,
          rotate: false,
          attribution: false,
        }),
        interactions: defaultInteractions({
          doubleClickZoom: false,
          altShiftDragRotate: false,
          pinchRotate: false,
        }),
        view: new View({
          center: [...center] as [number, number],
          zoom,
          resolutions: [...RESOLUTIONS_3857],
          constrainResolution: true,
        }),
      });
      setOlMap(map);
      t1 = window.setTimeout(() => map?.updateSize(), 40);
      t2 = window.setTimeout(() => map?.updateSize(), 160);
      t3 = window.setTimeout(() => map?.updateSize(), 400);
    };

    const raf = window.requestAnimationFrame(() => {
      mount();
      if (!mapHostRef.current) {
        t1 = window.setTimeout(mount, 80);
      }
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      map?.setTarget(undefined);
      setOlMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const draw = useBikeRoadSegmentDraw({
    active: open && olMap != null,
    mode: drawSide,
    routePrefix,
    nextIndex1,
    mapOverride: olMap,
    snapAnchors,
    existingSegments,
    onCommit: (result) => {
      onCommit(result);
      setDrawSide(null);
      onClose();
    },
    onCancel: () => {
      setDrawSide(null);
      onClose();
    },
  });

  const draftRows = useMemo(() => draw.drafts, [draw.drafts]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) draw.cancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(94vh,900px)] w-[min(98vw,1680px)] max-w-[98vw] flex-col gap-0 overflow-hidden rounded-md border-border p-0 shadow-2xl sm:max-w-[98vw]"
        layerZIndex={80}
      >
        <DialogHeader className="flex h-9 shrink-0 flex-row items-center gap-2 border-b border-border px-3 py-0">
          <DialogTitle className="text-xs font-semibold">구간 추가</DialogTitle>
          <span className="hidden text-[10px] text-muted-foreground sm:inline">
            도로 따라 점 찍기 · 초안 쌓기 · 일괄 반영
          </span>
          {draw.netLoading ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              도로 불러오는 중
            </span>
          ) : null}
          <button
            type="button"
            className={cn(btn, "ml-auto")}
            onClick={() => draw.cancel()}
          >
            <X className="h-3.5 w-3.5" />
            닫기
          </button>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-muted/15">
            <div className="space-y-1.5 border-b border-border px-2.5 py-2">
              <div className="flex gap-1">
                {(
                  [
                    ["C", "편측"],
                    ["both", "양측"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={drawSide === id ? btnSideActive : btnSide}
                    disabled={draw.busy}
                    onClick={() => setDrawSide(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  className={cn(btn, "h-8 flex-1 justify-center")}
                  disabled={draw.busy || draw.pointCount === 0}
                  onClick={draw.undoLast}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  되돌리기
                </button>
                <button
                  type="button"
                  className={cn(btn, "h-8 flex-1 justify-center")}
                  disabled={draw.busy || draw.pointCount < 2 || drawSide == null}
                  onClick={() => void draw.confirmLine()}
                >
                  <Check className="h-3.5 w-3.5" />
                  확정
                </button>
              </div>
              <button
                type="button"
                className={cn(btnPrimary, "h-8 w-full justify-center")}
                disabled={draw.busy || draw.draftCount === 0}
                onClick={draw.commitAll}
              >
                <ListChecks className="h-3.5 w-3.5" />
                일괄 반영
              </button>
              <p className="text-[10px] leading-snug text-muted-foreground">
                {draw.notice ??
                  "편측·양측 → 도로 클릭 → 확정. 기존 기점·종점 근처면 같은 점으로 붙습니다."}
              </p>
              <p className="text-[10px] tabular-nums text-muted-foreground">
                점 {draw.pointCount}
                {drawSide ? ` · ${sideLabel(drawSide)}` : ""}
                {draftRows.length > 0 ? ` · 초안 ${draftRows.length}` : ""}
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2.5 py-2">
              {existingSegments.length > 0 ? (
                <div>
                  <p className="mb-1 text-[10px] font-semibold text-foreground">
                    등록됨 ({existingSegments.length})
                  </p>
                  <ul className="space-y-1">
                    {existingSegments.map((seg) => (
                      <li
                        key={seg.id}
                        className="rounded border border-border bg-background px-1.5 py-1 text-[10px]"
                      >
                        <p className="mb-0.5 truncate font-medium">
                          {sideLabel(seg.side ?? "C")} {seg.serialNo}
                        </p>
                        <label className="mb-0.5 block text-[9px] text-muted-foreground">
                          기점
                          <input
                            className="mt-0.5 h-6 w-full rounded border border-border bg-background px-1 text-[10px]"
                            value={seg.startName}
                            onChange={(e) =>
                              onChangeExisting?.(seg.id, "startName", e.target.value)
                            }
                          />
                        </label>
                        <label className="block text-[9px] text-muted-foreground">
                          종점
                          <input
                            className="mt-0.5 h-6 w-full rounded border border-border bg-background px-1 text-[10px]"
                            value={seg.endName}
                            onChange={(e) =>
                              onChangeExisting?.(seg.id, "endName", e.target.value)
                            }
                          />
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div>
                <p className="mb-1 text-[10px] font-semibold text-foreground">
                  초안 ({draftRows.length})
                </p>
                {draftRows.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">없음</p>
                ) : (
                  <ul className="space-y-1">
                    {draftRows.map((seg, i) => (
                      <li
                        key={seg.id}
                        className="rounded border border-border bg-background px-1.5 py-1 text-[10px]"
                      >
                        <div className="mb-0.5 flex items-center gap-1">
                          <p className="min-w-0 flex-1 truncate font-medium">
                            {sideLabel(seg.side ?? "C")} {seg.serialNo}
                          </p>
                          <button
                            type="button"
                            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                            title="제거"
                            onClick={() => draw.removeDraftAt(i)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                        <label className="mb-0.5 block text-[9px] text-muted-foreground">
                          기점
                          <input
                            className="mt-0.5 h-6 w-full rounded border border-border bg-background px-1 text-[10px]"
                            value={seg.startName}
                            onChange={(e) =>
                              draw.updateDraftField(i, "startName", e.target.value)
                            }
                          />
                        </label>
                        <label className="block text-[9px] text-muted-foreground">
                          종점
                          <input
                            className="mt-0.5 h-6 w-full rounded border border-border bg-background px-1 text-[10px]"
                            value={seg.endName}
                            onChange={(e) =>
                              draw.updateDraftField(i, "endName", e.target.value)
                            }
                          />
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </aside>

          <div className="relative min-h-0 min-w-0 flex-1 bg-slate-900">
            <div ref={mapHostRef} className="absolute inset-0" />
            {draw.netLoading ? (
              <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
                <span className="inline-flex items-center gap-1.5 rounded border border-border bg-background/95 px-2.5 py-1 text-[10px] shadow">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  도로구간 불러오는 중…
                </span>
              </div>
            ) : null}
            <BikeRoadPathLegend
              onMap
              className="pointer-events-none absolute bottom-3 right-3 z-10"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
