"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Map, View } from "ol";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import type Feature from "ol/Feature";
import type { Geometry } from "ol/geom";
import { defaults as defaultControls } from "ol/control";
import { defaults as defaultInteractions } from "ol/interaction";
import Projection from "ol/proj/Projection";
import { getCenter } from "ol/extent";
import type { Extent } from "ol/extent";
import { Style, Stroke, Fill, Circle as CircleStyle, Text as OlText } from "ol/style";
import { Loader2, X, ZoomIn, ZoomOut, Maximize2, Download } from "lucide-react";
import {
  dxfStringToOlFeatures,
  padExtent,
  DXF_LABEL,
  DXF_TEXT_HEIGHT,
  DXF_ROTATION,
  DXF_TEXT_ALIGN,
  DXF_TEXT_BASELINE,
  DXF_STROKE,
  DXF_FILL,
  DXF_STROKE_WIDTH,
} from "@/lib/dxfToOpenLayers";
import { downloadServiceFilePreviewBlob } from "@/app/(pages)/map/_mapComponents/standard/ServiceFileImagePreview";
import "ol/ol.css";

type Props = {
  url: string;
  fileName: string;
  onClose: () => void;
};

type DxfPayload = {
  features: Feature<Geometry>[];
  paddedExtent: Extent;
};

function toolbarBtnClass(disabled?: boolean): string {
  return [
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-background/10",
    disabled ? "pointer-events-none opacity-35" : "",
  ].join(" ");
}

export function ServiceFileDxfPreview({ url, fileName, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<"loading" | "error" | "idle">("loading");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [payload, setPayload] = useState<DxfPayload | null>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const attachBusyRef = useRef(false);
  const [attachBusy, setAttachBusy] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setPhase("loading");
      setErrorText(null);
      setPayload(null);
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`파일을 불러오지 못했습니다. (${res.status})`);
        const text = await res.text();
        if (cancelled) return;
        const { features, extent, parseError } = dxfStringToOlFeatures(text);
        if (!features.length || !extent) {
          setPhase("error");
          setErrorText(parseError ?? "DXF에서 도형을 읽지 못했습니다. ASCII DXF를 권장합니다.");
          return;
        }
        setPayload({ features, paddedExtent: padExtent(extent) });
        setPhase("idle");
      } catch (e) {
        if (!cancelled) {
          setPhase("error");
          setErrorText(e instanceof Error ? e.message : String(e));
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useLayoutEffect(() => {
    if (!payload || !mapDivRef.current) return;

    const { features, paddedExtent } = payload;
    const projection = new Projection({
      code: "dxf-drawing",
      units: "m",
      extent: paddedExtent,
    });

    const source = new VectorSource({ features });
    const vectorLayer = new VectorLayer({
      source,
      style: (feat, resolution) => {
        const g = feat.getGeometry();
        if (!g) return undefined;
        const res = resolution ?? 1;
        const t = g.getType();
        const label = feat.get(DXF_LABEL) as string | undefined;
        const strokeCss = feat.get(DXF_STROKE) as string | undefined;
        const fillRgba = feat.get(DXF_FILL) as string | undefined;
        const lineW = feat.get(DXF_STROKE_WIDTH) as number | undefined;
        if (label != null && (t === "Point" || t === "MultiPoint")) {
          const th = (feat.get(DXF_TEXT_HEIGHT) as number) ?? 10;
          const fontPx = Math.min(220, Math.max(3, th / res));
          const rot = (feat.get(DXF_ROTATION) as number) ?? 0;
          const textAlign = (feat.get(DXF_TEXT_ALIGN) as CanvasTextAlign) ?? "left";
          const textBaseline = (feat.get(DXF_TEXT_BASELINE) as CanvasTextBaseline) ?? "alphabetic";
          const fillColor = strokeCss ?? "rgb(248,250,252)";
          const thinOutline = Math.min(2, Math.max(0.25, fontPx * 0.018));
          const fontStack = `"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Nanum Gothic", Gulim, sans-serif`;
          return new Style({
            text: new OlText({
              text: label,
              font: `500 ${fontPx}px ${fontStack}`,
              fill: new Fill({ color: fillColor }),
              stroke: new Stroke({ color: "rgba(0,0,0,0.22)", width: thinOutline }),
              rotation: rot,
              textAlign,
              textBaseline,
              overflow: true,
            }),
          });
        }
        if (t === "Point" || t === "MultiPoint") {
          const dot = strokeCss ?? "rgb(56, 189, 248)";
          return new Style({
            image: new CircleStyle({
              radius: 3,
              fill: new Fill({ color: dot }),
              stroke: new Stroke({ color: "rgba(255,255,255,0.35)", width: 1 }),
            }),
          });
        }
        if (t === "Polygon" || t === "MultiPolygon") {
          const sc = strokeCss ?? "rgb(226, 232, 240)";
          const fc = fillRgba ?? "rgba(148, 163, 184, 0.12)";
          const w = lineW ?? 1.15;
          return new Style({
            stroke: new Stroke({ color: sc, width: w }),
            fill: new Fill({ color: fc }),
          });
        }
        const sc = strokeCss ?? "rgb(226, 232, 240)";
        const w = lineW ?? 1.15;
        return new Style({
          stroke: new Stroke({ color: sc, width: w }),
        });
      },
    });

    const map = new Map({
      target: mapDivRef.current,
      pixelRatio: typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2.25) : 1,
      layers: [vectorLayer],
      view: new View({
        projection,
        center: getCenter(paddedExtent),
        zoom: 1,
        extent: paddedExtent,
      }),
      controls: defaultControls({ zoom: false, attribution: false }),
      interactions: defaultInteractions({ doubleClickZoom: false }),
    });
    mapRef.current = map;

    const fit = () => {
      map.updateSize();
      map.getView().fit(source.getExtent(), {
        padding: [24, 24, 24, 24],
        maxZoom: 28,
        duration: 0,
      });
    };
    requestAnimationFrame(fit);

    const ro = new ResizeObserver(() => {
      map.updateSize();
      fit();
    });
    ro.observe(mapDivRef.current);

    return () => {
      ro.disconnect();
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, [payload]);

  const zoomBy = useCallback((delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    const view = map.getView();
    const z = view.getZoom();
    if (z == null) return;
    view.setZoom(z + delta);
  }, []);

  const fitView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const layer = map.getLayers().getArray()[0] as VectorLayer<VectorSource> | undefined;
    const source = layer?.getSource();
    if (!source) return;
    map.getView().fit(source.getExtent(), {
      padding: [32, 32, 32, 32],
      maxZoom: 28,
      duration: 200,
    });
  }, []);

  const handleDownload = useCallback(async () => {
    if (attachBusyRef.current) return;
    attachBusyRef.current = true;
    setAttachBusy(true);
    try {
      await downloadServiceFilePreviewBlob(url, fileName);
    } catch {
      window.alert("다운로드에 실패했습니다.");
    } finally {
      attachBusyRef.current = false;
      setAttachBusy(false);
    }
  }, [url, fileName]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  if (!mounted || typeof document === "undefined") return null;

  const mapReady = payload != null && phase === "idle";

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex flex-col bg-black/92"
      role="dialog"
      aria-modal="true"
      aria-label="DXF 미리보기"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-white sm:px-4">
        <span className="min-w-0 flex-1 truncate text-xs font-medium sm:text-sm" title={fileName}>
          {fileName}
          <span className="ml-2 font-normal text-white/50">· DXF (OpenLayers)</span>
        </span>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={attachBusy}
            className={toolbarBtnClass(attachBusy)}
            title="다운로드"
            aria-label="다운로드"
          >
            {attachBusy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Download className="h-5 w-5" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-background/10"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-[#0f1419]">
        {phase === "loading" ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm text-white/70">
            <Loader2 className="h-8 w-8 animate-spin text-white/50" aria-hidden />
            도면 불러오는 중…
          </div>
        ) : null}
        {phase === "error" ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center px-4 text-center text-sm text-red-300">
            {errorText ?? "오류가 발생했습니다."}
          </div>
        ) : null}
        {mapReady ? (
          <div ref={mapDivRef} className="absolute inset-0 touch-none" />
        ) : null}
      </div>

      <div
        className="flex shrink-0 flex-wrap items-center justify-center gap-1 border-t border-white/10 px-2 py-2 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={toolbarBtnClass(!mapReady)}
          onClick={() => zoomBy(1)}
          disabled={!mapReady}
          title="확대"
          aria-label="확대"
        >
          <ZoomIn className="h-5 w-5" />
        </button>
        <button
          type="button"
          className={toolbarBtnClass(!mapReady)}
          onClick={() => zoomBy(-1)}
          disabled={!mapReady}
          title="축소"
          aria-label="축소"
        >
          <ZoomOut className="h-5 w-5" />
        </button>
        <button type="button" className={toolbarBtnClass(!mapReady)} onClick={fitView} disabled={!mapReady} title="전체 보기" aria-label="전체 보기">
          <Maximize2 className="h-5 w-5" />
        </button>
      </div>
      <p className="shrink-0 px-3 pb-2 text-center text-[10px] text-white/45">
        휠로 확대·축소 · 드래그로 이동 · 바이너리 DXF는 미지원일 수 있음
      </p>
    </div>,
    document.body
  );
}
