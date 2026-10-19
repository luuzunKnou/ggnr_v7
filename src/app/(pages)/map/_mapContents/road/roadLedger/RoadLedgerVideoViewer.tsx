"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Maximize2, Minimize2, Minus, Pause, Play, Plus, X } from "lucide-react";
import "pannellum/build/pannellum.css";
import { cn } from "@/lib/utils";
import { useVisibleMapBox } from "../../aerialView/AerialPanoPointViewer";
import { AerialViewerMetaChip } from "../../aerialView/AerialViewerMetaChip";

export type RoadLedgerVideoItem = {
  url: string;
  fileName: string;
  /** 첨부파일 수정일 (촬영일 메타 없음) */
  modified?: string;
};

type PannellumVideoViewer = {
  destroy: () => void;
  resize?: () => void;
  getHfov?: () => number;
  setHfov?: (hfov: number) => void;
};

type PannellumGlobal = {
  viewer: (container: HTMLElement, config: Record<string, unknown>) => PannellumVideoViewer;
};

type Props = {
  items: RoadLedgerVideoItem[];
  initialIndex?: number;
  /** 왼쪽 위 정보 카드 제목 (도로명) */
  roadName?: string;
  onClose: () => void;
};

function formatModifiedDate(raw: string | undefined): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function videoTabLabel(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  if (base.includes("상행")) return "상행";
  if (base.includes("하행")) return "하행";
  return base;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const NAV_BTN =
  "inline-flex h-7 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-35";

/**
 * 도로영상(360° equirectangular mp4) 뷰어 — 항공뷰처럼 왼쪽 메뉴를 뺀 지도 칸을 덮는다.
 * Pannellum dynamic 텍스처로 영상 프레임을 구에 입힌다.
 */
export function RoadLedgerVideoViewer({ items, initialIndex = 0, roadName, onClose }: Props) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1))
  );
  const box = useVisibleMapBox();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewerRef = useRef<PannellumVideoViewer | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const current = items[index];
  /** 지도 칸 측정 전에는 컨테이너가 없어 뷰어를 만들 수 없다 */
  const hasBox = box != null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const onChange = () => {
      setFullscreen(document.fullscreenElement === rootRef.current);
      requestAnimationFrame(() => {
        try {
          viewerRef.current?.resize?.();
        } catch {
          /* ignore */
        }
      });
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!current || !container) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    const video = document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;
    video.src = current.url;
    videoRef.current = video;

    const onTime = () => setCurrentTime(video.currentTime);
    const onMeta = () => setDuration(video.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onVideoError = () => {
      if (!cancelled) setError("영상을 불러오지 못했습니다.");
    };

    const onLoadedData = async () => {
      if (cancelled || viewerRef.current) return;
      try {
        await import("pannellum/build/pannellum.js");
      } catch {
        if (!cancelled) setError("360° 뷰어를 불러오지 못했습니다.");
        return;
      }
      const pannellum = (window as unknown as { pannellum?: PannellumGlobal }).pannellum;
      if (cancelled || !pannellum) {
        if (!cancelled) setError("360° 뷰어를 불러오지 못했습니다.");
        return;
      }
      try {
        viewerRef.current = pannellum.viewer(container, {
          type: "equirectangular",
          panorama: video,
          dynamic: true,
          dynamicUpdate: true,
          autoLoad: true,
          showControls: false,
          mouseZoom: true,
          compass: false,
          hfov: 100,
          minHfov: 40,
          maxHfov: 120,
        });
        setBuffering(false);
        setReady(true);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "360° 영상을 표시할 수 없습니다.");
        }
      }
    };

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("durationchange", onMeta);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onVideoError);
    video.addEventListener("loadeddata", onLoadedData);
    setBuffering(true);
    video.load();

    return () => {
      cancelled = true;
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("durationchange", onMeta);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("loadeddata", onLoadedData);
      try {
        viewerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      viewerRef.current = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
      videoRef.current = null;
    };
  }, [current, hasBox]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !ready || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      try {
        viewerRef.current?.resize?.();
      } catch {
        /* ignore */
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(t)) return;
    v.currentTime = t;
    setCurrentTime(t);
  }, []);

  const zoom = useCallback((delta: number) => {
    const viewer = viewerRef.current;
    if (!viewer?.getHfov || !viewer.setHfov) return;
    viewer.setHfov(Math.min(120, Math.max(40, viewer.getHfov() + delta)));
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
  }, []);

  if (!box || typeof document === "undefined" || !current) return null;

  return createPortal(
    <div ref={rootRef} className="fixed z-[5] flex flex-col overflow-hidden bg-slate-900" style={box}>
      <div className="relative min-h-0 flex-1 bg-slate-900">
        <div key={current.url} ref={containerRef} className="h-full w-full" />
        {error ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70 px-4 text-center text-[12px] text-rose-200">
            {error}
          </div>
        ) : !ready || buffering ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-[12px] text-white/75">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            영상 불러오는 중…
          </div>
        ) : null}

        <AerialViewerMetaChip
          kindLabel={`도로영상 · ${videoTabLabel(current.fileName)}`}
          workName={roadName?.trim() || current.fileName.replace(/\.[^.]+$/, "")}
          dateLabel="파일일자"
          shotDate={formatModifiedDate(current.modified)}
        />

        {fullscreen ? (
          <button
            type="button"
            onClick={onClose}
            className="pointer-events-auto absolute right-4 top-4 z-40 inline-flex items-center gap-1 rounded-md bg-black/60 px-2.5 py-1.5 text-[12px] font-medium text-white shadow-md hover:bg-black/75"
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
            닫기
          </button>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-3 pb-3 pr-24">
          <div className="pointer-events-auto flex w-full max-w-[min(100%,40rem)] items-center gap-1 rounded-md border border-border bg-background px-1 py-1 shadow-sm">
            {items.length > 1 ? (
              <div className="flex shrink-0 items-center gap-0.5 border-r border-border pr-1">
                {items.map((it, i) => (
                  <button
                    key={it.url}
                    type="button"
                    onClick={() => setIndex(i)}
                    title={it.fileName}
                    className={cn(
                      "h-7 rounded px-2.5 text-[11px] transition-colors",
                      i === index
                        ? "bg-primary/[0.12] font-medium text-foreground ring-1 ring-inset ring-primary/30"
                        : "text-muted-foreground hover:bg-muted/60"
                    )}
                  >
                    {videoTabLabel(it.fileName)}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={togglePlay}
              disabled={!ready}
              className={cn(NAV_BTN, "w-7 shrink-0")}
              title={playing ? "일시정지" : "재생"}
              aria-label={playing ? "일시정지" : "재생"}
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onChange={(e) => seek(Number(e.target.value))}
              disabled={!ready || !duration}
              className="h-1 min-w-0 flex-1 accent-primary"
              aria-label="재생 위치"
            />
            <span className="shrink-0 px-1 text-[11px] tabular-nums text-muted-foreground">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <div className="flex h-7 shrink-0 items-center gap-0.5 border-l border-border pl-1">
              <button
                type="button"
                onClick={() => zoom(10)}
                disabled={!ready}
                className={cn(NAV_BTN, "w-7")}
                title="축소"
                aria-label="축소"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => zoom(-10)}
                disabled={!ready}
                className={cn(NAV_BTN, "w-7")}
                title="확대"
                aria-label="확대"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                className={cn(NAV_BTN, "w-7")}
                title={fullscreen ? "전체화면 종료" : "전체화면"}
                aria-label={fullscreen ? "전체화면 종료" : "전체화면"}
              >
                {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
