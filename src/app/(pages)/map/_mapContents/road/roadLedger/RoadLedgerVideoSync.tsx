"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { call } from "@/lib/api";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { RoadLedgerVideoViewer, type RoadLedgerVideoItem } from "./RoadLedgerVideoViewer";
import {
  groupRoadLedgerVideoPlaylists,
  mergeRoadLedgerVideoPartTracks,
  roadVideoGlobalToPart,
  type RoadLedgerVideoPlaylist,
} from "./roadLedgerVideoPlaylist";
import {
  buildRoadLedgerVideoRoute,
  roadLedgerVideoFallbackReverse,
  roadLedgerVideoFracAtTime,
  roadLedgerVideoFrontAtTime,
  roadLedgerVideoShortestDeg,
  roadLedgerVideoTimeAtFrac,
  type RoadLedgerVideoManualLandmark,
  type RoadLedgerVideoTrack,
} from "./roadLedgerVideoTrack";
import { useRoadLedgerVideoCarLayer } from "./useRoadLedgerVideoCarLayer";

type TrackState = { track: RoadLedgerVideoTrack | null; error?: string; at: number };

/** 분석 요청이 걸린 영상은 이 간격으로 위치 자료를 다시 확인 (스케줄러가 끝내면 반영) */
const PENDING_RECHECK_MS = 8_000;

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
  const { data: session } = useSession();
  // 수동 기준점·다시 분석: su 만 (admin 은 isSuperUser 여도 비표시)
  const showLandmarkTools = String(session?.user?.id ?? "").trim() === "su";
  const [index, setIndex] = useState(0);
  const [time, setTime] = useState({ t: 0, d: 0 });
  const [view, setView] = useState<{ yaw: number; hfov: number } | null>(null);
  const [tracks, setTracks] = useState<Record<string, TrackState>>({});
  const [seekRequest, setSeekRequest] = useState<{ time: number; seq: number } | null>(null);
  const [landmarkMode, setLandmarkMode] = useState(false);
  const [pending, setPending] = useState<{ routeM: number; timeSec: number } | null>(null);
  const [reanalyzeBusy, setReanalyzeBusy] = useState(false);
  const setRoadLedgerVideoOpen = useMapContext()?.setRoadLedgerVideoOpen;

  useEffect(() => {
    setRoadLedgerVideoOpen?.(true);
    return () => setRoadLedgerVideoOpen?.(false);
  }, [setRoadLedgerVideoOpen]);

  const basePlaylists = useMemo(() => groupRoadLedgerVideoPlaylists(items), [items]);

  const playlists = useMemo((): RoadLedgerVideoPlaylist[] => {
    return basePlaylists.map((pl) => ({
      ...pl,
      durationHints: pl.parts.map((p) => {
        const t = tracks[p.fileName]?.track;
        return t?.durationSec && t.durationSec > 0 ? t.durationSec : 0;
      }),
    }));
  }, [basePlaylists, tracks]);

  const currentPlaylist = playlists[index];
  const partNames = useMemo(
    () => currentPlaylist?.parts.map((p) => p.fileName) ?? [],
    [currentPlaylist]
  );

  const loadTrack = useCallback(
    (name: string, isCancelled: () => boolean, requestAnalysis: boolean) => {
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

  /** 현재 방향(상행·하행)의 분할 파일을 모두 불러·분석 요청 */
  useEffect(() => {
    if (partNames.length === 0) return;
    let cancelled = false;
    for (const name of partNames) {
      if (tracks[name] !== undefined) continue;
      loadTrack(name, () => cancelled, true);
    }
    return () => {
      cancelled = true;
    };
    // tracks 키 유무만 보면 됨 — 객체 전체 deps 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partNames.join("\0"), loadTrack]);

  const anyQueued = partNames.some((n) => tracks[n]?.track?.queued);
  useEffect(() => {
    if (!anyQueued) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      for (const name of partNames) loadTrack(name, () => cancelled, false);
    }, PENDING_RECHECK_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [anyQueued, partNames, loadTrack]);

  const mergedTrack = useMemo(() => {
    if (!currentPlaylist) return null;
    return mergeRoadLedgerVideoPartTracks(
      currentPlaylist.parts.map((p, i) => {
        const st = tracks[p.fileName]?.track ?? null;
        const hint = currentPlaylist.durationHints?.[i] ?? 0;
        return {
          track: st,
          durationSec: hint || st?.durationSec || 0,
        };
      })
    );
  }, [currentPlaylist, tracks]);

  const landmarks = useMemo((): RoadLedgerVideoManualLandmark[] => {
    const out: RoadLedgerVideoManualLandmark[] = [];
    for (const name of partNames) {
      const list = tracks[name]?.track?.landmarks;
      if (list?.length) out.push(...list);
    }
    return out.sort((a, b) => a.timeSec - b.timeSec || a.id - b.id);
  }, [partNames, tracks]);

  const route = useMemo(
    () => (mergedTrack ? buildRoadLedgerVideoRoute(mergedTrack.line) : null),
    [mergedTrack]
  );
  const fileNameForFallback = currentPlaylist?.parts[0]?.fileName ?? "";
  const fallbackReverse = roadLedgerVideoFallbackReverse(fileNameForFallback);
  const duration = time.d || mergedTrack?.durationSec || 0;
  const overallReverse =
    mergedTrack?.status === "done" ? mergedTrack.direction === "reverse" : fallbackReverse;

  const frac = roadLedgerVideoFracAtTime(mergedTrack, time.t, duration, fallbackReverse);
  const ahead = roadLedgerVideoFracAtTime(mergedTrack, time.t + 2, duration, fallbackReverse);
  const routeLengthM = mergedTrack?.routeLengthM ?? 0;
  const travelReverse = Math.abs(ahead - frac) * routeLengthM > 1 ? ahead < frac : overallReverse;
  // 영상 yaw − 차 정면 = 진행 방향 기준 시야(오른쪽 +). ±180으로 감아 부채꼴이 반대로 튀지 않게
  const viewRelDeg = view
    ? roadLedgerVideoShortestDeg(view.yaw - roadLedgerVideoFrontAtTime(mergedTrack, time.t))
    : null;

  const partDurations = useMemo(() => {
    if (!currentPlaylist) return [] as number[];
    return currentPlaylist.parts.map((p, i) => {
      const hint = currentPlaylist.durationHints?.[i] ?? 0;
      const st = tracks[p.fileName]?.track;
      return hint || st?.durationSec || 0;
    });
  }, [currentPlaylist, tracks]);

  // 핀은 저장한 노선 거리(m) 그대로 — 영상 시각→차위치 환산하면 찍은 점이 자동차로 붙음
  const landmarkFracs = useMemo(() => {
    if (!routeLengthM) return [] as number[];
    return landmarks.map((lm) => Math.min(1, Math.max(0, lm.routeM / routeLengthM)));
  }, [landmarks, routeLengthM]);

  const pendingFrac =
    pending && routeLengthM > 0 ? Math.min(1, Math.max(0, pending.routeM / routeLengthM)) : null;

  const handlePickFrac = useCallback(
    (f: number) => {
      if (landmarkMode) return;
      const t = roadLedgerVideoTimeAtFrac(mergedTrack, f, duration, fallbackReverse);
      setTime((prev) => ({ ...prev, t }));
      setSeekRequest({ time: t, seq: Date.now() });
    },
    [mergedTrack, duration, fallbackReverse, landmarkMode]
  );

  const handleLandmarkPick = useCallback(
    (f: number) => {
      if (!routeLengthM) return;
      setPending({
        routeM: Math.round(f * routeLengthM * 10) / 10,
        timeSec: time.t,
      });
    },
    [routeLengthM, time.t]
  );

  useRoadLedgerVideoCarLayer({
    route,
    frac,
    travelReverse,
    passedFromEnd: overallReverse,
    viewRelDeg,
    viewFovDeg: view?.hfov ?? 100,
    onPickFrac: handlePickFrac,
    landmarkPickMode: landmarkMode,
    onLandmarkPick: handleLandmarkPick,
    landmarkFracs,
    pendingLandmarkFrac: pendingFrac,
  });

  const handleIndexChange = useCallback((i: number) => {
    setIndex(i);
    setTime({ t: 0, d: 0 });
    setSeekRequest(null);
    setPending(null);
    setLandmarkMode(false);
    setView(null);
  }, []);

  const handleTimeChange = useCallback((t: number, d: number) => {
    setTime((prev) => (prev.t === t && prev.d === d ? prev : { t, d }));
  }, []);

  const handleViewChange = useCallback((yaw: number, hfov: number) => {
    setView({ yaw, hfov });
  }, []);

  const handleSaveLandmark = useCallback(async () => {
    if (!pending || !currentPlaylist) return;
    const durs = partDurations.some((d) => d > 0) ? partDurations : currentPlaylist.parts.map(() => 0);
    const { partIndex, localSec } = roadVideoGlobalToPart(pending.timeSec, durs.length ? durs : [0]);
    const fileName = currentPlaylist.parts[partIndex]?.fileName;
    if (!fileName) return;
    const res = await call("", "POST", {
      service: "roadVideoTrackService",
      action: "saveRoadVideoLandmark",
      params: {
        roadKey,
        fileName,
        timeSec: localSec,
        routeM: pending.routeM,
      },
    });
    const data = res?.data ?? res;
    if (data?.error) {
      window.alert(String(data.error));
      return;
    }
    setPending(null);
    // 트랙 리로드 시 예전 지도시크 요청이 다시 적용되지 않게
    setSeekRequest(null);
    let cancelled = false;
    loadTrack(fileName, () => cancelled, false);
  }, [pending, currentPlaylist, partDurations, roadKey, loadTrack]);

  const handleDeleteLandmark = useCallback(
    async (id: number) => {
      const res = await call("", "POST", {
        service: "roadVideoTrackService",
        action: "deleteRoadVideoLandmark",
        params: { id },
      });
      const data = res?.data ?? res;
      if (data?.error) {
        window.alert(String(data.error));
        return;
      }
      for (const name of partNames) loadTrack(name, () => false, false);
    },
    [partNames, loadTrack]
  );

  const handleReanalyze = useCallback(async () => {
    if (!partNames.length || reanalyzeBusy) return;
    setReanalyzeBusy(true);
    setLandmarkMode(false);
    setPending(null);
    try {
      const res = await call("", "POST", {
        service: "roadVideoTrackService",
        action: "reanalyzeRoadVideoTrack",
        params: { roadKey, fileNames: partNames },
      });
      const data = res?.data ?? res;
      if (data?.error) {
        window.alert(String(data.error));
      }
      // 성공 시 수동점은 서버에서 삭제됨 — 트랙·목록 다시 읽기
      for (const name of partNames) loadTrack(name, () => false, false);
    } finally {
      setReanalyzeBusy(false);
    }
  }, [partNames, roadKey, loadTrack, reanalyzeBusy]);

  const landmarkRows = useMemo(() => {
    const offsets: number[] = [0];
    for (let i = 0; i < partDurations.length; i += 1) {
      offsets.push(offsets[i]! + Math.max(0, partDurations[i] ?? 0));
    }
    return landmarks.map((lm) => {
      const pi = partNames.indexOf(lm.fileName);
      const off = pi >= 0 ? offsets[pi]! : 0;
      return {
        id: lm.id,
        timeSec: off + lm.timeSec,
        routeM: lm.routeM,
        label: partNames.length > 1 ? lm.fileName.replace(/^.*전방위영상-?/, "") : undefined,
      };
    });
  }, [landmarks, partNames, partDurations]);

  if (playlists.length === 0) return null;

  return (
    <RoadLedgerVideoViewer
      playlists={playlists}
      roadName={roadName}
      onClose={onClose}
      onIndexChange={handleIndexChange}
      onTimeChange={handleTimeChange}
      onViewChange={handleViewChange}
      seekRequest={seekRequest}
      showLandmarkTools={showLandmarkTools}
      landmarkMode={landmarkMode}
      onToggleLandmarkMode={() => {
        setLandmarkMode((v) => !v);
        setPending(null);
      }}
      pendingLandmark={pending}
      onPendingTimeChange={(sec) => setPending((p) => (p ? { ...p, timeSec: sec } : p))}
      onSaveLandmark={() => void handleSaveLandmark()}
      onCancelPending={() => setPending(null)}
      landmarks={landmarkRows}
      onDeleteLandmark={(id) => void handleDeleteLandmark(id)}
      onReanalyze={() => void handleReanalyze()}
      reanalyzeBusy={reanalyzeBusy || anyQueued}
    />
  );
}
