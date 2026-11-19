"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { FALLBACK_BACKGROUND_MAP_ID } from "../../../_mapComponents/mapControlPanel/backgroundMapSelector";
import { captureBikeRoadLocationMap } from "./bikeRoadLocationCapture";
import {
  pathStyleFromPathType,
  type BikeRoadRoute,
} from "./bikeRoadMock";

type Props = {
  route: BikeRoadRoute;
  /** 위치도 이미지 저장 (노선에 반영) */
  onSaveImage?: (dataUrl: string) => void;
  className?: string;
};

/** 캡처 로직·범례·확대 바뀌면 올려 옛 이미지 폐기 */
const CAPTURE_VERSION = 10;

function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 구간 종류·색·버전이 바뀌면 다시 찍기 */
function routeCaptureKey(route: BikeRoadRoute): string {
  const types = route.segments
    .map((s) => {
      const pt = s.pathType ?? "";
      const hasGeom =
        (s.centerLineCoords?.length ?? 0) >= 2 ||
        (s.lineCoords?.length ?? 0) >= 2
          ? "1"
          : "0";
      return `${s.id}:${pt}:${pathStyleFromPathType(pt)}:${hasGeom}`;
    })
    .join("|");
  return `v${CAPTURE_VERSION}::${route.id}::${types}`;
}

/**
 * 상세 위치도 — 구간 전체·종류별 색으로 오프스크린 캡처.
 * 저장된 옛(초록) 이미지를 키 불일치 시 절대 다시 보여 주지 않음.
 */
export function BikeRoadLocationMap({ route, onSaveImage, className }: Props) {
  const mapContext = useMapContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayUrl, setDisplayUrl] = useState("");
  const capturingRef = useRef(false);
  const pendingRecaptureRef = useRef(false);
  const lastKeyRef = useRef<string | null>(null);
  const failCountRef = useRef(0);
  const routeRef = useRef(route);
  routeRef.current = route;
  const onSaveImageRef = useRef(onSaveImage);
  onSaveImageRef.current = onSaveImage;

  const hasGeom =
    route.lineCoords.length >= 2 ||
    route.segments.some(
      (s) =>
        (s.centerLineCoords?.length ?? 0) >= 2 ||
        (s.lineCoords?.length ?? 0) >= 2
    );
  const captureKey = routeCaptureKey(route);

  const captureAndSave = useCallback(async () => {
    const save = onSaveImageRef.current;
    if (!save || !hasGeom) return;
    if (capturingRef.current) {
      pendingRecaptureRef.current = true;
      return;
    }

    capturingRef.current = true;
    pendingRecaptureRef.current = false;
    setBusy(true);
    setError(null);
    setDisplayUrl("");

    const src = routeRef.current;
    const snapshot: BikeRoadRoute = {
      ...src,
      segments: src.segments.map((s) => ({ ...s })),
    };
    const keyAtStart = routeCaptureKey(snapshot);
    let shouldRetry = false;

    try {
      const backgroundId =
        mapContext?.mapBackgroundMapIdRef?.current?.trim() ||
        FALLBACK_BACKGROUND_MAP_ID;
      const dataUrl = await captureBikeRoadLocationMap(snapshot, backgroundId);

      const keyNow = routeCaptureKey(routeRef.current);
      if (keyNow !== keyAtStart || pendingRecaptureRef.current) {
        pendingRecaptureRef.current = false;
        shouldRetry = true;
        return;
      }

      if (!dataUrl) {
        failCountRef.current += 1;
        if (failCountRef.current < 2) shouldRetry = true;
        else setError("위치도를 담지 못했습니다.");
        return;
      }
      failCountRef.current = 0;
      lastKeyRef.current = keyAtStart;
      setDisplayUrl(dataUrl);
      setError(null);
      save(dataUrl);
    } catch {
      failCountRef.current += 1;
      if (failCountRef.current < 2) shouldRetry = true;
      else setError("위치도를 담지 못했습니다.");
    } finally {
      capturingRef.current = false;
      setBusy(false);
      if (shouldRetry || pendingRecaptureRef.current) {
        pendingRecaptureRef.current = false;
        window.setTimeout(() => {
          void captureAndSave();
        }, 400);
      }
    }
  }, [hasGeom, mapContext]);

  /** 키가 바뀌면 재캡처 — 저장된 옛 URL 유무와 무관 */
  useEffect(() => {
    if (!hasGeom || !onSaveImage) return;
    if (lastKeyRef.current === captureKey) return;
    const t = window.setTimeout(() => {
      void captureAndSave();
    }, 200);
    return () => window.clearTimeout(t);
  }, [captureKey, hasGeom, onSaveImage, captureAndSave]);

  const handleDownload = () => {
    if (!displayUrl) return;
    const safe = (route.title || "자전거도로")
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 40);
    downloadDataUrl(displayUrl, `${safe}_위치도.png`);
  };

  if (!hasGeom) {
    return (
      <div
        className={cn(
          "flex h-full min-h-[10rem] items-center justify-center rounded border border-dashed border-border bg-muted/30 text-[11px] text-muted-foreground",
          className
        )}
      >
        위치도 없음
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex h-full min-h-0 flex-col overflow-hidden rounded border border-border bg-muted/20",
        className
      )}
    >
      {displayUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- 캡처 data URL
        <img
          src={displayUrl}
          alt="위치도"
          className="h-full w-full object-contain object-center bg-[#e8eef2]"
        />
      ) : (
        <div className="flex h-full min-h-[10rem] items-center justify-center text-[11px] text-muted-foreground">
          {busy ? "위치도 저장 중…" : error ?? "위치도 준비 중…"}
        </div>
      )}

      <div className="pointer-events-none absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/95 text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground disabled:opacity-50"
          title="다운로드"
          disabled={!displayUrl || busy}
          onClick={handleDownload}
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>

      {busy && displayUrl ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40 text-[11px] text-muted-foreground">
          캡처 중…
        </div>
      ) : null}
    </div>
  );
}
