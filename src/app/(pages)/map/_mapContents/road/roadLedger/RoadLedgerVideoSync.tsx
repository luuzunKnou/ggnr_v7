"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { call } from "@/lib/api";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { RoadLedgerVideoViewer, type RoadLedgerVideoItem } from "./RoadLedgerVideoViewer";
import {
  buildRoadLedgerVideoRoute,
  roadLedgerVideoFallbackReverse,
  roadLedgerVideoFracAtTime,
  roadLedgerVideoFrontAtTime,
  roadLedgerVideoTimeAtFrac,
  type RoadLedgerVideoTrack,
} from "./roadLedgerVideoTrack";
import { useRoadLedgerVideoCarLayer } from "./useRoadLedgerVideoCarLayer";

type TrackState = { track: RoadLedgerVideoTrack | null; error?: string; at: number };

/** 분석 요청이 걸린 영상은 이 간격으로 위치 자료를 다시 확인 (스케줄러가 끝내면 바로 반영) */
const PENDING_RECHECK_MS = 60_000;

function fetchTrack(roadKey: string | number, fileName: string) {
  return call("", "POST", {
    service: "roadVideoTrackService",
    action: "getRoadVideoTrack",
    params: { roadKey, fileName },
  });
}

type Props = {
  items: RoadLedgerVideoItem[];
  /** 첨부 폴더 키 (rdid, 없으면 ogc_fid) */
  roadKey: string | number;
  roadName?: string;
  onClose: () => void;
};

/** 도로영상 창 + 지도 노선 위 자동차·보는 방향 — 재생 위치 ⇄ 지도 위치 */
export function RoadLedgerVideoSync({ items, roadKey, roadName, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [time, setTime] = useState({ t: 0, d: 0 });
  const [view, setView] = useState<{ yaw: number; hfov: number } | null>(null);
  const [tracks, setTracks] = useState<Record<string, TrackState>>({});
  const [seekRequest, setSeekRequest] = useState<{ time: number; seq: number } | null>(null);
  const setRoadLedgerVideoOpen = useMapContext()?.setRoadLedgerVideoOpen;

  useEffect(() => {
    setRoadLedgerVideoOpen?.(true);
    return () => setRoadLedgerVideoOpen?.(false);
  }, [setRoadLedgerVideoOpen]);

  const current = items[index];
  const fileName = current?.fileName ?? "";
  const trackState = tracks[fileName];

  const loadTrack = useCallback(
    (name: string, isCancelled: () => boolean, requestAnalysis: boolean) => {
      // 분석 요청은 서버가 슈퍼 계정(su·admin)일 때만 받음 — 다른 계정은 결과 조회만
      const request = requestAnalysis
        ? call("", "POST", {
            service: "roadVideoTrackService",
            action: "requestRoadVideoTrack",
            params: { roadKey, fileName: name },
          }).catch(() => null)
        : Promise.resolve(null);
      request
        .then(() => fetchTrack(roadKey, name))
        .then((res) => {
          if (isCancelled()) return;
          const data = res?.data ?? res;
          setTracks((prev) => ({
            ...prev,
            [name]: { track: (data?.track as RoadLedgerVideoTrack | null) ?? null, error: data?.error, at: Date.now() },
          }));
        })
        .catch((e: unknown) => {
          if (isCancelled()) return;
          setTracks((prev) => ({
            ...prev,
            [name]: {
              track: null,
              error: e instanceof Error ? e.message : "위치 자료를 불러오지 못했습니다.",
              at: Date.now(),
            },
          }));
        });
    },
    [roadKey]
  );

  useEffect(() => {
    if (!fileName || trackState !== undefined) return;
    let cancelled = false;
    loadTrack(fileName, () => cancelled, true);
    return () => {
      cancelled = true;
    };
  }, [fileName, trackState, loadTrack]);

  useEffect(() => {
    if (!fileName || !trackState?.track?.queued) return;
    let cancelled = false;
    const id = window.setTimeout(() => loadTrack(fileName, () => cancelled, false), PENDING_RECHECK_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [fileName, trackState, loadTrack]);

  const track = trackState?.track ?? null;
  const route = useMemo(() => (track ? buildRoadLedgerVideoRoute(track.line) : null), [track]);
  const fallbackReverse = roadLedgerVideoFallbackReverse(fileName);
  const duration = time.d || track?.durationSec || 0;
  const overallReverse = track?.status === "done" ? track.direction === "reverse" : fallbackReverse;

  const frac = roadLedgerVideoFracAtTime(track, time.t, duration, fallbackReverse);
  const ahead = roadLedgerVideoFracAtTime(track, time.t + 2, duration, fallbackReverse);
  const routeLengthM = track?.routeLengthM ?? 0;
  const travelReverse = Math.abs(ahead - frac) * routeLengthM > 1 ? ahead < frac : overallReverse;
  const viewRelDeg = view ? view.yaw - roadLedgerVideoFrontAtTime(track, time.t) : null;

  const handlePickFrac = useCallback(
    (f: number) => {
      const t = roadLedgerVideoTimeAtFrac(track, f, duration, fallbackReverse);
      setTime((prev) => ({ ...prev, t }));
      setSeekRequest({ time: t, seq: Date.now() });
    },
    [track, duration, fallbackReverse]
  );

  useRoadLedgerVideoCarLayer({
    route,
    frac,
    travelReverse,
    passedFromEnd: overallReverse,
    viewRelDeg,
    viewFovDeg: view?.hfov ?? 100,
    onPickFrac: handlePickFrac,
  });

  const handleIndexChange = useCallback((i: number) => {
    setIndex(i);
    setTime({ t: 0, d: 0 });
    setSeekRequest(null);
  }, []);

  const handleTimeChange = useCallback((t: number, d: number) => {
    setTime((prev) => (prev.t === t && prev.d === d ? prev : { t, d }));
  }, []);

  const handleViewChange = useCallback((yaw: number, hfov: number) => {
    setView({ yaw, hfov });
  }, []);

  if (items.length === 0) return null;

  return (
    <RoadLedgerVideoViewer
      items={items}
      roadName={roadName}
      onClose={onClose}
      onIndexChange={handleIndexChange}
      onTimeChange={handleTimeChange}
      onViewChange={handleViewChange}
      seekRequest={seekRequest}
    />
  );
}
