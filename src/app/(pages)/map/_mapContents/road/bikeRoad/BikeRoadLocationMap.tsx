"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { FALLBACK_BACKGROUND_MAP_ID } from "../../../_mapComponents/mapControlPanel/backgroundMapSelector";
import { captureBikeRoadLocationMap } from "./bikeRoadLocationCapture";
import type { BikeRoadRoute } from "./bikeRoadMock";

type Props = {
  route: BikeRoadRoute;
  /** 위치도 이미지 저장 (노선에 반영) */
  onSaveImage?: (dataUrl: string) => void;
  className?: string;
};

function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * 상세 위치도 — 오프스크린 캡처(기점~종점) 저장·표시.
 * 호버 시 우상단 다운로드만.
 */
export function BikeRoadLocationMap({ route, onSaveImage, className }: Props) {
  const mapContext = useMapContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const capturingRef = useRef(false);
  const lastCapturedIdRef = useRef<string | null>(null);

  const imageUrl = route.locationMapUrl?.trim() || "";
  const hasGeom = route.lineCoords.length >= 2;

  const captureAndSave = useCallback(async () => {
    if (!onSaveImage || !hasGeom) return;
    if (capturingRef.current) return;

    capturingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const backgroundId =
        mapContext?.mapBackgroundMapIdRef?.current?.trim() || FALLBACK_BACKGROUND_MAP_ID;
      const dataUrl = await captureBikeRoadLocationMap(route, backgroundId);
      if (!dataUrl) {
        setError("위치도를 담지 못했습니다.");
        return;
      }
      lastCapturedIdRef.current = route.id;
      onSaveImage(dataUrl);
    } catch {
      setError("위치도를 담지 못했습니다.");
    } finally {
      capturingRef.current = false;
      setBusy(false);
    }
  }, [onSaveImage, hasGeom, route, mapContext]);

  /** 노선 선택 시 기점·종점 보이게 다시 캡처 (재캡처 버튼 없음) */
  useEffect(() => {
    if (!hasGeom || !onSaveImage) return;
    if (lastCapturedIdRef.current === route.id) return;
    const t = window.setTimeout(() => {
      void captureAndSave();
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.id, hasGeom]);

  const handleDownload = () => {
    if (!imageUrl) return;
    const safe = (route.title || "자전거도로").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
    downloadDataUrl(imageUrl, `${safe}_위치도.png`);
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
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- 캡처 data URL
        <img
          src={imageUrl}
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
          disabled={!imageUrl || busy}
          onClick={handleDownload}
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>

      {busy && imageUrl ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40 text-[11px] text-muted-foreground">
          캡처 중…
        </div>
      ) : null}
    </div>
  );
}
