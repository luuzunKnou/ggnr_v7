"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Maximize2, Minimize2, Minus, Pause, Play, Plus, X } from "lucide-react";
import "pannellum/build/pannellum.css";
import { cn } from "@/lib/utils";
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
  getYaw?: () => number;
};

type PannellumGlobal = {
  viewer: (container: HTMLElement, config: Record<string, unknown>) => PannellumVideoViewer;
};

type Props = {
  items: RoadLedgerVideoItem[];
  initialIndex?: number;
  /** 제목줄·정보 카드 제목 (도로명) */
  roadName?: string;
  onClose: () => void;
  onIndexChange?: (index: number) => void;
  /** 재생 중 약 0.1초마다, 탐색·정지 시 한 번 */
  onTimeChange?: (time: number, duration: number) => void;
  /** seq 가 바뀔 때마다 그 시각으로 이동 */
  seekRequest?: { time: number; seq: number } | null;
  /** 보는 방향(도, 영상 가운데 0·오른쪽 +)·가로 시야각 — 바뀔 때만 */
  onViewChange?: (yaw: number, hfov: number) => void;
};

type WindowRect = { x: number; y: number; w: number; h: number };

const MIN_W = 420;
const MIN_H = 300;
const TITLE_H = 36;
const TIME_NOTIFY_MS = 100;
const VIEW_POLL_MS = 120;

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

/** 왼쪽 메뉴에서 조금 띄운 자리, 세로 가운데 */
function initialRect(): WindowRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const aside = document.querySelector("aside");
  const left = aside ? Math.round(aside.getBoundingClientRect().right) : 0;
  const gap = Math.round(vw * 0.06);
  const w = Math.max(MIN_W, Math.min(Math.round(vw * 0.39), vw - left - gap - 16));
  const h = Math.max(MIN_H, Math.min(Math.round(w * 0.56) + TITLE_H + 40, vh - 32));
  return { x: left + gap, y: Math.max(8, Math.round((vh - h) / 2)), w, h };
}

function clampRect(r: WindowRect): WindowRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(MIN_W, r.w), vw);
  const h = Math.min(Math.max(MIN_H, r.h), vh);
  return {
    w,
    h,
    x: Math.min(Math.max(0, r.x), Math.max(0, vw - 120)),
    y: Math.min(Math.max(0, r.y), Math.max(0, vh - TITLE_H)),
  };
}

const NAV_BTN =
  "inline-flex h-7 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-35";
const TITLE_BTN =
  "inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted/70 hover:text-foreground";

/**
 * 도로영상(360° equirectangular mp4) 뷰어 — 지도 위에 뜨는 이동·크기 조절 창.
 * Pannellum dynamic 텍스처로 영상 프레임을 구에 입힌다.
 */
export function RoadLedgerVideoViewer({
  items,
  initialIndex = 0,
  roadName,
  onClose,
  onIndexChange,
  onTimeChange,
  seekRequest,
  onViewChange,
}: Props) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1))
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewerRef = useRef<PannellumVideoViewer | null>(null);
  const onTimeChangeRef = useRef(onTimeChange);
  const onViewChangeRef = useRef(onViewChange);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [placedRect, setRect] = useState<WindowRect>(initialRect);

  const current = items[index];

  useEffect(() => {
    onTimeChangeRef.current = onTimeChange;
    onViewChangeRef.current = onViewChange;
  }, [onTimeChange, onViewChange]);

  useEffect(() => {
    if (!ready) return;
    let last = "";
    const id = window.setInterval(() => {
      const v = viewerRef.current;
      if (!v?.getYaw || !v.getHfov) return;
      const yaw = v.getYaw();
      const hfov = v.getHfov();
      const key = `${yaw.toFixed(1)}|${hfov.toFixed(1)}`;
      if (key === last) return;
      last = key;
      onViewChangeRef.current?.(yaw, hfov);
    }, VIEW_POLL_MS);
    return () => window.clearInterval(id);
  }, [ready]);

  const selectIndex = useCallback(
    (i: number) => {
      setIndex(i);
      onIndexChange?.(i);
    },
    [onIndexChange]
  );

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

    let raf = 0;
    let lastNotify = 0;
    const notify = () => onTimeChangeRef.current?.(video.currentTime, video.duration || 0);
    const tick = (now: number) => {
      if (now - lastNotify >= TIME_NOTIFY_MS) {
        lastNotify = now;
        notify();
      }
      raf = requestAnimationFrame(tick);
    };
    const onTime = () => setCurrentTime(video.currentTime);
    const onMeta = () => {
      setDuration(video.duration);
      notify();
    };
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      notify();
    };
    const onSeeked = () => notify();
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
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onVideoError);
    video.addEventListener("loadeddata", onLoadedData);
    setBuffering(true);
    video.load();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("durationchange", onMeta);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
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
  }, [current]);

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

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(t)) return;
    v.currentTime = Math.max(0, Math.min(t, v.duration || t));
    setCurrentTime(v.currentTime);
  }, []);

  useEffect(() => {
    if (!seekRequest || !ready) return;
    seek(seekRequest.time);
  }, [seekRequest, ready, seek]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
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

  const startPointerTrack = useCallback(
    (e: React.PointerEvent, mode: "move" | "resize") => {
      if (e.button !== 0 || fullscreen) return;
      if (mode === "move" && (e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      const start = { px: e.clientX, py: e.clientY, rect: placedRect };
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - start.px;
        const dy = ev.clientY - start.py;
        setRect(
          clampRect(
            mode === "move"
              ? { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy }
              : { ...start.rect, w: start.rect.w + dx, h: start.rect.h + dy }
          )
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [placedRect, fullscreen]
  );

  if (typeof document === "undefined" || !current) return null;

  const title = roadName?.trim() || current.fileName.replace(/\.[^.]+$/, "");

  return createPortal(
    <div
      ref={rootRef}
      className="fixed z-[30] flex flex-col overflow-hidden rounded-md border border-border bg-background shadow-xl"
      style={{
        left: placedRect.x,
        top: placedRect.y,
        width: placedRect.w,
        height: placedRect.h,
      }}
    >
      <div
        className="flex shrink-0 cursor-move select-none items-center gap-2 border-b border-border bg-muted/40 px-2"
        style={{ height: TITLE_H }}
        onPointerDown={(e) => startPointerTrack(e, "move")}
      >
        <span className="min-w-0 truncate text-[12px] font-semibold text-foreground">{title} 도로영상</span>
        <div className="ml-auto flex shrink-0 items-center">
          <button type="button" onClick={onClose} className={TITLE_BTN} title="닫기" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

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
          workName={title}
          dateLabel="파일일자"
          shotDate={formatModifiedDate(current.modified)}
          fullscreen={fullscreen}
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
      </div>

      <div className="shrink-0 border-t border-border bg-background">
        <div className="flex items-center gap-1 py-1 pl-1 pr-3">
          {items.length > 1 ? (
            <div className="flex shrink-0 items-center gap-0.5 border-r border-border pr-1">
              {items.map((it, i) => (
                <button
                  key={it.url}
                  type="button"
                  onClick={() => selectIndex(i)}
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

      {!fullscreen ? (
        <div
          className="absolute bottom-0 right-0 z-20 h-3.5 w-3.5 cursor-se-resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 50%, rgba(100,116,139,0.6) 50%, rgba(100,116,139,0.6) 60%, transparent 60%, transparent 75%, rgba(100,116,139,0.6) 75%)",
          }}
          onPointerDown={(e) => startPointerTrack(e, "resize")}
          aria-hidden
        />
      ) : null}
    </div>,
    document.body
  );
}
