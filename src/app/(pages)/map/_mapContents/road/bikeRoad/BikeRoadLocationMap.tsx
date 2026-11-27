"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BikeRoadRoute } from "./bikeRoadMock";

type Props = {
  route: BikeRoadRoute;
  /** 저장·등록 중 캡처 진행 표시 */
  capturing?: boolean;
  /** 위치도 클릭 시 확대 미리보기 (첨부 모달과 동일) */
  onPreview?: (dataUrl: string) => void;
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
 * 상세 위치도 — 저장된 이미지만 표시.
 * 다시 찍기는 상세 «저장»·«등록»에서만 한다.
 */
export function BikeRoadLocationMap({
  route,
  capturing = false,
  onPreview,
  className,
}: Props) {
  const saved = route.locationMapUrl?.trim() ?? "";
  const [displayUrl, setDisplayUrl] = useState(saved);

  useEffect(() => {
    setDisplayUrl(saved);
  }, [route.id, saved]);

  const hasGeom =
    route.lineCoords.length >= 2 ||
    route.segments.some(
      (s) =>
        (s.centerLineCoords?.length ?? 0) >= 2 ||
        (s.lineCoords?.length ?? 0) >= 2
    );

  const handleDownload = () => {
    if (!displayUrl) return;
    const safe = (route.title || "자전거도로")
      .replace(/[\/:*?"<>|]/g, "_")
      .slice(0, 40);
    downloadDataUrl(displayUrl, `${safe}_위치도.png`);
  };

  const handlePreview = () => {
    if (!displayUrl || capturing || !onPreview) return;
    onPreview(displayUrl);
  };

  if (!hasGeom && !displayUrl) {
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
        <button
          type="button"
          className={cn(
            "relative h-full w-full overflow-hidden bg-[#e8eef2] text-left",
            onPreview ? "cursor-zoom-in" : "cursor-default"
          )}
          title={onPreview ? "위치도 확대 보기" : "위치도"}
          disabled={!onPreview || capturing}
          onClick={handlePreview}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 캡처 data URL */}
          <img
            src={displayUrl}
            alt="위치도"
            className="h-full w-full object-contain object-center"
            draggable={false}
          />
        </button>
      ) : (
        <div className="flex h-full min-h-[10rem] items-center justify-center text-[11px] text-muted-foreground">
          {capturing
            ? "위치도 저장 중…"
            : "저장하면 위치도가 만들어집니다"}
        </div>
      )}

      <div className="pointer-events-none absolute right-1.5 top-1.5 z-[1] opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/95 text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground disabled:opacity-50"
          title="다운로드"
          disabled={!displayUrl || capturing}
          onClick={(e) => {
            e.stopPropagation();
            handleDownload();
          }}
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>

      {capturing && displayUrl ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40 text-[11px] text-muted-foreground">
          위치도 저장 중…
        </div>
      ) : null}
    </div>
  );
}
