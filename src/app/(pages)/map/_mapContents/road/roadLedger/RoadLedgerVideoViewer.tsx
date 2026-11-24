"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Maximize2, Minimize2, Minus, Pause, Play, Plus, X } from "lucide-react";
import "pannellum/build/pannellum.css";
import { cn } from "@/lib/utils";
import { AerialViewerMetaChip } from "../../aerialView/AerialViewerMetaChip";
import {
  roadVideoGlobalToPart,
  roadVideoPartOffsets,
  type RoadLedgerVideoPlaylist,
} from "./roadLedgerVideoPlaylist";

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
  getPitch?: () => number;
};

type PersistedView = { yaw: number; pitch: number; hfov: number };

type PannellumGlobal = {
  viewer: (container: HTMLElement, config: Record<string, unknown>) => PannellumVideoViewer;
};

export type RoadLedgerVideoLandmarkRow = {
  id: number;
  timeSec: number;
  routeM: number;
  label?: string;
};

type Props = {
  /** 상행·하행 등 — 분할 파일은 한 목록으로 이어 재생 */
  playlists: RoadLedgerVideoPlaylist[];
  initialIndex?: number;
  /** 제목줄·정보 카드 제목 (도로명) */
  roadName?: string;
  onClose: () => void;
  onIndexChange?: (index: number) => void;
  /** 이어붙인 타임라인 기준 시각·전체 길이 */
  onTimeChange?: (time: number, duration: number) => void;
  /** seq 가 바뀔 때마다 이어붙인 타임라인 시각으로 이동 */
  seekRequest?: { time: number; seq: number } | null;
  /** 보는 방향(도, 영상 가운데 0·오른쪽 +)·가로 시야각 — 바뀔 때만 */
  onViewChange?: (yaw: number, hfov: number) => void;
  /** 슈퍼계정 — 수동 기준점·다시 분석 */
  showLandmarkTools?: boolean;
  landmarkMode?: boolean;
  onToggleLandmarkMode?: () => void;
  pendingLandmark?: { routeM: number; timeSec: number } | null;
  onPendingTimeChange?: (sec: number) => void;
  onSaveLandmark?: () => void;
  onCancelPending?: () => void;
  landmarks?: RoadLedgerVideoLandmarkRow[];
  onDeleteLandmark?: (id: number) => void;
  onReanalyze?: () => void;
  reanalyzeBusy?: boolean;
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

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "1:12" · "1:12:30" · "72.5" → 초. 실패 시 NaN */
function parseTimeInput(raw: string): number {
  const s = raw.trim();
  if (!s) return NaN;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(":").map((p) => p.trim());
  if (parts.some((p) => p === "" || !/^\d+(\.\d+)?$/.test(p))) return NaN;
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  return NaN;
}

/** 왼쪽 메뉴 바로 옆, 세로 가운데 (목록·상세와 겹쳐도 왼쪽 우선) */
function initialRect(): WindowRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const aside = document.querySelector("aside");
  const left = aside ? Math.round(aside.getBoundingClientRect().right) : 0;
  const gap = 50;
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
 * 상행1·2 등은 한 탭에서 끊김 없이 이어 재생한다.
 */
export function RoadLedgerVideoViewer({
  playlists,
  initialIndex = 0,
  roadName,
  onClose,
  onIndexChange,
  onTimeChange,
  seekRequest,
  onViewChange,
  showLandmarkTools = false,
  landmarkMode = false,
  onToggleLandmarkMode,
  pendingLandmark = null,
  onPendingTimeChange,
  onSaveLandmark,
  onCancelPending,
  landmarks = [],
  onDeleteLandmark,
  onReanalyze,
  reanalyzeBusy = false,
}: Props) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), Math.max(0, playlists.length - 1))
  );
  const [partIndex, setPartIndex] = useState(0);
  const [partDurations, setPartDurations] = useState<number[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewerRef = useRef<PannellumVideoViewer | null>(null);
  const onTimeChangeRef = useRef(onTimeChange);
  const onViewChangeRef = useRef(onViewChange);
  const resumePlayRef = useRef(false);
  const pendingLocalSeekRef = useRef<number | null>(null);
  const partIndexRef = useRef(partIndex);
  /** 파트 전환 중에도 타임라인 표시가 0으로 튀지 않게 */
  const holdGlobalTimeRef = useRef(0);
  /** 이어붙인 다음 편에서도 바라보던 방향·줌 유지 */
  const viewPersistRef = useRef<PersistedView | null>(null);
  /** 상행↔하행 등 플레이리스트 바꿀 때는 뷰 초기화 */
  const resetViewOnNextInitRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [localTime, setLocalTime] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [placedRect, setRect] = useState<WindowRect>(initialRect);

  const playlist = playlists[index];
  const parts = playlist?.parts ?? [];
  const current = parts[partIndex] ?? parts[0];

  const effectiveDurations = useMemo(() => {
    const hints = playlist?.durationHints ?? [];
    return parts.map((_, i) => {
      const measured = partDurations[i];
      if (measured != null && measured > 0) return measured;
      const hint = hints[i];
      return hint != null && hint > 0 ? hint : 0;
    });
  }, [parts, partDurations, playlist?.durationHints]);

  const offsets = useMemo(() => roadVideoPartOffsets(effectiveDurations), [effectiveDurations]);
  const totalDuration = offsets[offsets.length - 1] ?? 0;
  const globalTimeRaw = (offsets[partIndex] ?? 0) + localTime;
  const globalTime = ready ? globalTimeRaw : holdGlobalTimeRef.current;
  const offsetsRef = useRef(offsets);
  const durationsRef = useRef(effectiveDurations);
  offsetsRef.current = offsets;
  durationsRef.current = effectiveDurations;

  useEffect(() => {
    partIndexRef.current = partIndex;
  }, [partIndex]);

  useEffect(() => {
    if (ready && Number.isFinite(globalTimeRaw)) holdGlobalTimeRef.current = globalTimeRaw;
  }, [ready, globalTimeRaw]);

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

  const captureViewerView = useCallback((): PersistedView | null => {
    const v = viewerRef.current;
    if (!v?.getYaw || !v.getHfov) return null;
    const yaw = v.getYaw();
    const hfov = v.getHfov();
    const pitch = v.getPitch?.() ?? 0;
    if (![yaw, pitch, hfov].every(Number.isFinite)) return null;
    return { yaw, pitch, hfov };
  }, []);

  const selectIndex = useCallback(
    (i: number) => {
      setIndex(i);
      setPartIndex(0);
      setPartDurations([]);
      resumePlayRef.current = false;
      pendingLocalSeekRef.current = null;
      viewPersistRef.current = null;
      resetViewOnNextInitRef.current = true;
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
    let initStarted = false;
    setReady(false);
    setError(null);
    setPlaying(false);
    setLocalTime(0);
    setBuffering(true);

    const video = document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;
    video.src = current.url;
    videoRef.current = video;

    let raf = 0;
    let lastNotify = 0;
    const advanceToNextPart = (resume: boolean, localSeek = 0) => {
      const pi = partIndexRef.current;
      if (pi >= parts.length - 1) {
        setPlaying(false);
        notify();
        return;
      }
      resumePlayRef.current = resume;
      pendingLocalSeekRef.current = localSeek;
      setPartIndex(pi + 1);
    };
    const notify = () => {
      const local = video.currentTime;
      const off = offsetsRef.current[partIndexRef.current] ?? 0;
      const durHint = durationsRef.current.reduce((s, x) => s + x, 0);
      const total = Math.max(durHint, off + (video.duration || 0));
      onTimeChangeRef.current?.(off + local, total);
    };
    const tick = (now: number) => {
      if (now - lastNotify >= TIME_NOTIFY_MS) {
        lastNotify = now;
        notify();
        // ended 이벤트가 안 오는 경우(코덱·버퍼) — 끝 0.35초 이내면 다음 편으로
        const dur = video.duration;
        if (
          Number.isFinite(dur) &&
          dur > 1 &&
          !video.paused &&
          dur - video.currentTime <= 0.35 &&
          partIndexRef.current < parts.length - 1
        ) {
          video.pause();
          advanceToNextPart(true, 0);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    const onTime = () => setLocalTime(video.currentTime);
    const onMeta = () => {
      const d = video.duration;
      if (Number.isFinite(d) && d > 0) {
        setPartDurations((prev) => {
          const next = [...prev];
          while (next.length < parts.length) next.push(0);
          next[partIndexRef.current] = d;
          return next;
        });
      }
      notify();
    };
    const onPlay = () => {
      setPlaying(true);
      setBuffering(false);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      notify();
    };
    const onSeeked = () => {
      setBuffering(false);
      notify();
    };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onCanPlay = () => setBuffering(false);
    const onVideoError = () => {
      if (!cancelled) setError("영상을 불러오지 못했습니다.");
    };
    const onEnded = () => {
      advanceToNextPart(true, 0);
    };

    const onLoadedData = async () => {
      if (cancelled || initStarted) return;
      initStarted = true;
      // 이전 파트의 pannellum 이 남아 있으면 방향 저장 후 다시 붙임
      if (viewerRef.current) {
        const snapped = captureViewerView();
        if (snapped && !resetViewOnNextInitRef.current) {
          viewPersistRef.current = snapped;
        }
        try {
          viewerRef.current.destroy();
        } catch {
          /* ignore */
        }
        viewerRef.current = null;
      }
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
        // 컨테이너에 이전 캔버스가 남으면 뷰어 생성이 실패할 수 있음
        container.replaceChildren();
        const resetView = resetViewOnNextInitRef.current;
        resetViewOnNextInitRef.current = false;
        const saved = resetView ? null : viewPersistRef.current;
        if (resetView) viewPersistRef.current = null;
        viewerRef.current = pannellum.viewer(container, {
          type: "equirectangular",
          panorama: video,
          dynamic: true,
          dynamicUpdate: true,
          autoLoad: true,
          showControls: false,
          mouseZoom: true,
          compass: false,
          yaw: saved?.yaw ?? 0,
          pitch: saved?.pitch ?? 0,
          hfov: saved?.hfov ?? 100,
          minHfov: 40,
          maxHfov: 120,
        });
        setBuffering(false);
        setReady(true);
        const seekTo = pendingLocalSeekRef.current;
        pendingLocalSeekRef.current = null;
        if (seekTo != null && Number.isFinite(seekTo)) {
          const cap = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : seekTo;
          video.currentTime = Math.max(0, Math.min(seekTo, cap));
          setLocalTime(video.currentTime);
        }
        if (resumePlayRef.current) {
          resumePlayRef.current = false;
          void video.play().catch(() => undefined);
        }
        notify();
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
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("error", onVideoError);
    video.addEventListener("ended", onEnded);
    video.addEventListener("loadeddata", onLoadedData);
    video.load();
    // 캐시로 loadeddata 가 이미 지난 경우
    if (video.readyState >= 2) void onLoadedData();

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
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("loadeddata", onLoadedData);
      const snapped = captureViewerView();
      if (snapped && !resetViewOnNextInitRef.current) {
        viewPersistRef.current = snapped;
      }
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
    // parts.length·offsets 는 notify 용 — 파트 URL 이 바뀔 때만 재생성
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 파트 전환은 current.url 기준
  }, [current?.url, index]);

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

  const seekLocal = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(t)) return;
    v.currentTime = Math.max(0, Math.min(t, v.duration || t));
    setLocalTime(v.currentTime);
  }, []);

  const seekGlobal = useCallback(
    (globalSec: number) => {
      const durs =
        effectiveDurations.some((d) => d > 0)
          ? effectiveDurations
          : parts.map(() => 0);
      let { partIndex: pi, localSec } = roadVideoGlobalToPart(globalSec, durs.length ? durs : [0]);
      // 1편 끝(8:02 등)에 걸리면 2편 시작으로 — ended 대기 없이 바로 전환
      const partDur = durs[pi] ?? 0;
      if (pi < durs.length - 1 && partDur > 0 && localSec >= partDur - 0.15) {
        pi += 1;
        localSec = 0;
      }
      if (pi !== partIndexRef.current) {
        resumePlayRef.current = !(videoRef.current?.paused ?? true);
        pendingLocalSeekRef.current = localSec;
        holdGlobalTimeRef.current = globalSec;
        setPartIndex(pi);
        return;
      }
      seekLocal(localSec);
    },
    [effectiveDurations, parts, seekLocal]
  );

  // seq 가 바뀔 때만 시크 — 트랙 리로드로 seekGlobal 참조가 바뀌어도 옛 요청을 다시 적용하지 않음
  useEffect(() => {
    if (!seekRequest || !ready) return;
    seekGlobal(seekRequest.time);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seq·ready 만
  }, [seekRequest?.seq, ready]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) {
      v.pause();
      return;
    }
    // 전체 타임라인 끝에서 재생 → 1편 0초부터
    const onLastPart = partIndexRef.current >= Math.max(0, parts.length - 1);
    const atPartEnd =
      v.ended ||
      (Number.isFinite(v.duration) &&
        v.duration > 0 &&
        v.currentTime >= v.duration - 0.05);
    if (onLastPart && atPartEnd) {
      if (partIndexRef.current > 0) {
        resumePlayRef.current = true;
        pendingLocalSeekRef.current = 0;
        holdGlobalTimeRef.current = 0;
        setPartIndex(0);
        return;
      }
      v.currentTime = 0;
      setLocalTime(0);
    }
    void v.play().catch(() => undefined);
  }, [parts.length]);

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

  if (typeof document === "undefined" || !playlist || !current) return null;

  const title = roadName?.trim() || playlist.label;
  const chipLabel = playlist.label;

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
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {showLandmarkTools ? (
            <>
              <button
                type="button"
                onClick={onToggleLandmarkMode}
                className={cn(
                  "h-7 rounded px-2 text-[11px]",
                  landmarkMode
                    ? "bg-amber-500/20 font-medium text-amber-800 ring-1 ring-inset ring-amber-500/40"
                    : "text-muted-foreground hover:bg-muted/70"
                )}
                title="지도에서 위치 찍고 시간 입력"
              >
                수동 기준점
              </button>
              <button
                type="button"
                onClick={onReanalyze}
                disabled={reanalyzeBusy}
                className="h-7 rounded px-2 text-[11px] text-muted-foreground hover:bg-muted/70 disabled:opacity-40"
                title="수동 기준점을 반영해 다시 맞춤"
              >
                {reanalyzeBusy ? "분석 요청…" : "다시 분석"}
              </button>
            </>
          ) : null}
          <button type="button" onClick={onClose} className={TITLE_BTN} title="닫기" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showLandmarkTools && (landmarkMode || pendingLandmark || landmarks.length > 0) ? (
        <div className="shrink-0 space-y-1.5 border-b border-border bg-amber-50/80 px-2 py-1.5 text-[11px] text-foreground">
          {landmarkMode && !pendingLandmark ? (
            <p className="text-amber-900">지도에서 노선 위 위치를 클릭하세요.</p>
          ) : null}
          {pendingLandmark ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">위치 {Math.round(pendingLandmark.routeM)}m</span>
              <label className="inline-flex items-center gap-1">
                시간
                <input
                  type="text"
                  className="h-6 w-[72px] rounded border border-border bg-background px-1.5 text-[11px]"
                  defaultValue={formatTime(pendingLandmark.timeSec)}
                  key={`pending-${pendingLandmark.routeM}-${Math.round(pendingLandmark.timeSec * 10)}`}
                  onBlur={(e) => {
                    const sec = parseTimeInput(e.target.value);
                    if (Number.isFinite(sec)) onPendingTimeChange?.(sec);
                    else e.target.value = formatTime(pendingLandmark.timeSec);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const sec = parseTimeInput((e.target as HTMLInputElement).value);
                    if (Number.isFinite(sec)) onPendingTimeChange?.(sec);
                  }}
                  placeholder="1:12"
                />
              </label>
              <button
                type="button"
                className="h-6 rounded bg-primary px-2 text-[11px] text-primary-foreground"
                onClick={onSaveLandmark}
              >
                저장
              </button>
              <button
                type="button"
                className="h-6 rounded px-2 text-muted-foreground hover:bg-muted/70"
                onClick={onCancelPending}
              >
                취소
              </button>
            </div>
          ) : null}
          {landmarks.length > 0 ? (
            <ul className="max-h-16 space-y-0.5 overflow-y-auto">
              {landmarks.map((lm) => (
                <li key={lm.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {formatTime(lm.timeSec)} · {Math.round(lm.routeM)}m
                    {lm.label ? ` (${lm.label})` : ""}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-rose-600 hover:underline"
                    onClick={() => onDeleteLandmark?.(lm.id)}
                  >
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 bg-slate-900">
        <div key={`${index}-${current.url}`} ref={containerRef} className="h-full w-full" />
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
          kindLabel={`도로영상 · ${chipLabel}`}
          workName={title}
          dateLabel="파일일자"
          shotDate={formatModifiedDate(current.modified)}
          fullscreen={fullscreen}
          tightTop
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
          {playlists.length > 1 ? (
            <div className="flex shrink-0 items-center gap-0.5 border-r border-border pr-1">
              {playlists.map((pl, i) => (
                <button
                  key={`${pl.group}-${pl.label}`}
                  type="button"
                  onClick={() => selectIndex(i)}
                  title={pl.parts.map((p) => p.fileName).join(" → ")}
                  className={cn(
                    "h-7 rounded px-2.5 text-[11px] transition-colors",
                    i === index
                      ? "bg-primary/[0.12] font-medium text-foreground ring-1 ring-inset ring-primary/30"
                      : "text-muted-foreground hover:bg-muted/60"
                  )}
                >
                  {pl.label}
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
            max={totalDuration || 0}
            step={0.1}
            value={Math.min(globalTime, totalDuration || 0)}
            onChange={(e) => seekGlobal(Number(e.target.value))}
            disabled={!totalDuration}
            className="h-1 min-w-0 flex-1 accent-primary"
            aria-label="재생 위치"
          />
          <span className="shrink-0 px-1 text-[11px] tabular-nums text-muted-foreground">
            {formatTime(globalTime)} / {formatTime(totalDuration)}
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
