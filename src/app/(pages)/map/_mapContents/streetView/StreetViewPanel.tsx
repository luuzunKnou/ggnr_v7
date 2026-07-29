'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { call } from '@/lib/api';
import {
  loadKakaoMapsSdk,
  type KakaoRoadview,
  type KakaoRoadviewClient,
} from './loadKakaoMapsSdk';
import { StreetViewRoadviewControls, type StreetViewCompassHandle } from './StreetViewRoadviewControls';
import { StreetViewKakaoMapLink } from './StreetViewKakaoMapLink';

/** setPanoId 후 init 대기 */
const PANO_INIT_TIMEOUT_MS = 8000;
/** 카카오 로드뷰 zoom 범위 */
const ROADVIEW_ZOOM_MIN = -3;
const ROADVIEW_ZOOM_MAX = 3;
/** getNearestPanoId 폴백 반경(m) */
const PANO_SEARCH_RADIUS_FALLBACK_M = 100;

type StreetViewPanelProps = {
  /** 시야각(도) — 카카오 로드뷰 pan */
  panDeg: number;
  /** WGS84 경도 */
  lng: number | null;
  /** WGS84 위도 */
  lat: number | null;
  /** 조회 시점 시야원→지상 거리(m). 없으면 폴백 */
  getPanoSearchRadiusM?: () => number;
  /** 로드뷰 화살표 이동 등 → 지도/워커 반영 */
  onRoadviewPosition?: (lng: number, lat: number) => void;
  /** 로드뷰 시야 변경 → 워커 pan (스트리밍, React 상태 생략) */
  onRoadviewPan?: (panDeg: number) => void;
  /** 정북 등 확정 pan → React panDeg 동기화 */
  onRoadviewPanCommit?: (panDeg: number) => void;
  /** 로드뷰 수직각 변경 → 워커 tilt */
  onRoadviewTilt?: (tiltDeg: number) => void;
};

function normalizePan(pan: number): number {
  return ((pan % 360) + 360) % 360;
}

function currentOrigin(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

/** 카카오 오류 문구 → 사용자 안내 */
export function explainKakaoRoadviewFailure(raw: unknown): string | null {
  const text =
    typeof raw === 'string'
      ? raw
      : raw instanceof Error
        ? `${raw.message}\n${raw.stack ?? ''}`
        : (() => {
            try {
              return JSON.stringify(raw);
            } catch {
              return String(raw);
            }
          })();

  if (/domain mismatched/i.test(text) || /check out registered web domains/i.test(text)) {
    const callerMatch = text.match(/caller=([^\s,"}]+)/i);
    const caller = callerMatch?.[1]?.replace(/\.$/, '') || currentOrigin();
    return [
      'JavaScript SDK 도메인이 등록되지 않았습니다.',
      `현재 접속 주소: ${caller}`,
      '',
      '카카오 디벨로퍼스 → 앱 → 플랫폼 키 → JavaScript 키',
      '→ JavaScript SDK 도메인에 위 주소를 등록하세요.',
      '(예: http://localhost:3000)',
    ].join('\n');
  }

  if (/invalid.?app.?key|appkey.*(invalid|denied)|인증.*실패/i.test(text)) {
    return '카카오 지도 API 키(JavaScript 키)가 올바르지 않거나 사용할 수 없습니다.\nruntime.env 의 KAKAO_MAP_API_KEY 를 확인하세요.';
  }

  if (/code["\s:=]+-?401|-401|AccessDenied/i.test(text)) {
    return [
      '카카오 API 접근이 거부되었습니다. (401)',
      `현재 접속 주소: ${currentOrigin()}`,
      '',
      '도메인 미등록 또는 앱키 오류일 수 있습니다.',
      '플랫폼 키 → JavaScript SDK 도메인을 확인하세요.',
    ].join('\n');
  }

  return null;
}

function RoadviewAlertBox({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center px-4">
      <div
        className="max-w-md rounded-3xl border-2 border-solid border-red-500 bg-black/70 px-4 py-3 text-center text-sm font-semibold leading-relaxed text-white shadow-lg whitespace-pre-line"
        role="alert"
      >
        {children}
      </div>
    </div>
  );
}

/** 카카오 로드뷰 패널 */
export function StreetViewPanel({
  panDeg,
  lng,
  lat,
  getPanoSearchRadiusM,
  onRoadviewPosition,
  onRoadviewPan,
  onRoadviewPanCommit,
  onRoadviewTilt,
}: StreetViewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const roadviewRef = useRef<KakaoRoadview | null>(null);
  const clientRef = useRef<KakaoRoadviewClient | null>(null);
  const skipEchoRef = useRef(false);
  const panFromRoadviewRef = useRef(false);
  const ignoreNextPropPosRef = useRef(false);
  const lastFetchKeyRef = useRef('');
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPosRef = useRef(onRoadviewPosition);
  const onPanRef = useRef(onRoadviewPan);
  const onPanCommitRef = useRef(onRoadviewPanCommit);
  const onTiltRef = useRef(onRoadviewTilt);
  const getPanoSearchRadiusMRef = useRef(getPanoSearchRadiusM);
  onPosRef.current = onRoadviewPosition;
  onPanRef.current = onRoadviewPan;
  onPanCommitRef.current = onRoadviewPanCommit;
  onTiltRef.current = onRoadviewTilt;
  getPanoSearchRadiusMRef.current = getPanoSearchRadiusM;

  const compassRef = useRef<StreetViewCompassHandle>(null);
  const lastPanRef = useRef(panDeg);
  const relayoutRafRef = useRef(0);
  const viewpointRafRef = useRef(0);
  const pendingVpRef = useRef<{ pan: number; tilt: number } | null>(null);

  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noPano, setNoPano] = useState(false);
  const [panoReady, setPanoReady] = useState(false);
  const everPanoReadyRef = useRef(false);

  const reportFailure = (raw: unknown, fallback?: string) => {
    const explained = explainKakaoRoadviewFailure(raw);
    setError(explained ?? fallback ?? (raw instanceof Error ? raw.message : String(raw)));
  };

  const syncCompassPan = useCallback((pan: number) => {
    lastPanRef.current = pan;
    compassRef.current?.setPan(pan);
  }, []);

  useEffect(() => {
    syncCompassPan(panDeg);
  }, [panDeg, syncCompassPan]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'configService',
          action: 'getMapConfig',
          params: {},
        });
        const data = res?.data ?? res;
        const key = String(data?.KAKAO_MAP_API_KEY ?? '').trim();
        if (!key) {
          if (!cancelled) {
            setError(
              '카카오 지도 API 키가 없습니다.\nruntime.env 에 KAKAO_MAP_API_KEY 를 설정하세요.'
            );
          }
          return;
        }
        await loadKakaoMapsSdk(key);
        if (!cancelled) {
          setError(null);
          setSdkReady(true);
        }
      } catch (e) {
        if (!cancelled) {
          reportFailure(e, '카카오 지도 SDK 로드에 실패했습니다.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  useEffect(() => {
    if (!sdkReady || !containerRef.current || !window.kakao?.maps) return;
    const maps = window.kakao.maps;
    const el = containerRef.current;
    let roadview: KakaoRoadview;
    try {
      roadview = new maps.Roadview(el, { disableZoomControl: true });
    } catch (e) {
      reportFailure(e, '로드뷰 객체를 생성하지 못했습니다.');
      return;
    }
    const client = new maps.RoadviewClient();
    roadviewRef.current = roadview;
    clientRef.current = client;

    const flushViewpoint = () => {
      viewpointRafRef.current = 0;
      const pending = pendingVpRef.current;
      if (!pending) return;
      pendingVpRef.current = null;
      syncCompassPan(pending.pan);
      onTiltRef.current?.(pending.tilt);
      if (skipEchoRef.current) return;
      onPanRef.current?.(pending.pan);
    };

    const onInit = () => {
      if (initTimerRef.current) {
        clearTimeout(initTimerRef.current);
        initTimerRef.current = null;
      }
      everPanoReadyRef.current = true;
      setPanoReady(true);
      setNoPano(false);
      setError(null);
      try {
        const tilt = roadview.getViewpoint()?.tilt ?? 0;
        onTiltRef.current?.(tilt);
      } catch {
        /* ignore */
      }
    };

    const onPositionChanged = () => {
      if (skipEchoRef.current) return;
      try {
        const pos = roadview.getPosition();
        ignoreNextPropPosRef.current = true;
        onPosRef.current?.(pos.getLng(), pos.getLat());
      } catch {
        /* ignore */
      }
    };

    const onViewpointChanged = () => {
      try {
        const vp = roadview.getViewpoint();
        pendingVpRef.current = {
          pan: normalizePan(vp.pan),
          tilt: vp.tilt ?? 0,
        };
        if (!viewpointRafRef.current) {
          viewpointRafRef.current = requestAnimationFrame(flushViewpoint);
        }
      } catch {
        /* ignore */
      }
    };

    const onError = (...args: unknown[]) => {
      reportFailure(args[0] ?? args, '로드뷰 오류가 발생했습니다.');
    };

    maps.event.addListener(roadview, 'init', onInit);
    maps.event.addListener(roadview, 'position_changed', onPositionChanged);
    maps.event.addListener(roadview, 'viewpoint_changed', onViewpointChanged);
    maps.event.addListener(roadview, 'error', onError);

    const scheduleRelayout = () => {
      if (relayoutRafRef.current) return;
      relayoutRafRef.current = requestAnimationFrame(() => {
        relayoutRafRef.current = 0;
        try {
          roadview.relayout();
        } catch {
          /* ignore */
        }
      });
    };
    const forceRelayout = () => {
      if (relayoutRafRef.current) {
        cancelAnimationFrame(relayoutRafRef.current);
        relayoutRafRef.current = 0;
      }
      try {
        roadview.relayout();
      } catch {
        /* ignore */
      }
    };
    const ro = new ResizeObserver(scheduleRelayout);
    ro.observe(el);
    el.addEventListener('roadview-relayout', forceRelayout);

    return () => {
      ro.disconnect();
      el.removeEventListener('roadview-relayout', forceRelayout);
      if (relayoutRafRef.current) {
        cancelAnimationFrame(relayoutRafRef.current);
        relayoutRafRef.current = 0;
      }
      if (viewpointRafRef.current) {
        cancelAnimationFrame(viewpointRafRef.current);
        viewpointRafRef.current = 0;
      }
      pendingVpRef.current = null;
      if (initTimerRef.current) {
        clearTimeout(initTimerRef.current);
        initTimerRef.current = null;
      }
      maps.event.removeListener(roadview, 'init', onInit);
      maps.event.removeListener(roadview, 'position_changed', onPositionChanged);
      maps.event.removeListener(roadview, 'viewpoint_changed', onViewpointChanged);
      maps.event.removeListener(roadview, 'error', onError);
      roadviewRef.current = null;
      clientRef.current = null;
      lastFetchKeyRef.current = '';
      everPanoReadyRef.current = false;
      setPanoReady(false);
      el.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per sdkReady
  }, [sdkReady, syncCompassPan]);

  useEffect(() => {
    if (!sdkReady || !window.kakao?.maps) return;
    const roadview = roadviewRef.current;
    const client = clientRef.current;
    if (!roadview || !client) return;
    if (lng == null || lat == null || !Number.isFinite(lng) || !Number.isFinite(lat)) return;

    if (ignoreNextPropPosRef.current) {
      ignoreNextPropPosRef.current = false;
      lastFetchKeyRef.current = `${lng.toFixed(5)},${lat.toFixed(5)}`;
      return;
    }

    const fetchKey = `${lng.toFixed(5)},${lat.toFixed(5)}`;
    if (fetchKey === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = fetchKey;

    let cancelled = false;
    setNoPano(false);
    if (initTimerRef.current) {
      clearTimeout(initTimerRef.current);
      initTimerRef.current = null;
    }
    if (!everPanoReadyRef.current) {
      initTimerRef.current = setTimeout(() => {
        initTimerRef.current = null;
        if (everPanoReadyRef.current) return;
        setError((prev) => {
          if (prev) return prev;
          return [
            '로드뷰를 표시하지 못했습니다.',
            `현재 접속 주소: ${currentOrigin()}`,
            '',
            '도메인 미등록·앱키 오류일 수 있습니다.',
            '카카오 디벨로퍼스 → 플랫폼 키 → JavaScript 키',
            '→ JavaScript SDK 도메인을 확인하세요.',
          ].join('\n');
        });
      }, PANO_INIT_TIMEOUT_MS);
    }

    const position = new window.kakao.maps.LatLng(lat, lng);
    try {
      const radiusM = (() => {
        try {
          const n = getPanoSearchRadiusMRef.current?.();
          return n != null && Number.isFinite(n) && n > 0 ? n : PANO_SEARCH_RADIUS_FALLBACK_M;
        } catch {
          return PANO_SEARCH_RADIUS_FALLBACK_M;
        }
      })();
      client.getNearestPanoId(position, radiusM, (panoId) => {
        if (cancelled) return;
        if (panoId == null) {
          setNoPano(true);
          setPanoReady(false);
          return;
        }
        setNoPano(false);
        skipEchoRef.current = true;
        try {
          roadview.setPanoId(panoId, position);
          const cur = roadview.getViewpoint();
          roadview.setViewpoint({
            pan: normalizePan(lastPanRef.current),
            tilt: cur?.tilt ?? 0,
            zoom: cur?.zoom ?? 0,
          });
          roadview.relayout();
          if (initTimerRef.current) {
            clearTimeout(initTimerRef.current);
            initTimerRef.current = null;
          }
          everPanoReadyRef.current = true;
          setPanoReady(true);
          setError(null);
        } catch (e) {
          reportFailure(e, '로드뷰 파노라마를 열지 못했습니다.');
        } finally {
          queueMicrotask(() => {
            skipEchoRef.current = false;
          });
        }
      });
    } catch (e) {
      reportFailure(e, '근처 로드뷰 조회에 실패했습니다.');
    }

    return () => {
      cancelled = true;
      if (initTimerRef.current) {
        clearTimeout(initTimerRef.current);
        initTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- panDeg intentionally omitted
  }, [sdkReady, lng, lat]);

  useEffect(() => {
    if (!sdkReady) return;
    const roadview = roadviewRef.current;
    if (!roadview) return;
    if (panFromRoadviewRef.current) {
      panFromRoadviewRef.current = false;
      return;
    }
    try {
      const cur = roadview.getViewpoint();
      const next = normalizePan(panDeg);
      if (Math.abs(normalizePan(cur.pan) - next) < 0.5) return;
      skipEchoRef.current = true;
      roadview.setViewpoint({
        pan: next,
        tilt: cur.tilt,
        zoom: cur.zoom,
      });
      queueMicrotask(() => {
        skipEchoRef.current = false;
      });
    } catch {
      /* pano 미로드 시 ignore */
    }
  }, [sdkReady, panDeg]);

  const bumpZoom = useCallback((delta: number) => {
    const roadview = roadviewRef.current;
    if (!roadview) return;
    try {
      const cur = roadview.getViewpoint();
      const nextZoom = Math.min(
        ROADVIEW_ZOOM_MAX,
        Math.max(ROADVIEW_ZOOM_MIN, (cur.zoom ?? 0) + delta)
      );
      if (nextZoom === cur.zoom) return;
      skipEchoRef.current = true;
      roadview.setViewpoint({
        pan: cur.pan,
        tilt: cur.tilt,
        zoom: nextZoom,
      });
      queueMicrotask(() => {
        skipEchoRef.current = false;
      });
    } catch {
      /* ignore */
    }
  }, []);

  const onZoomIn = useCallback(() => bumpZoom(1), [bumpZoom]);
  const onZoomOut = useCallback(() => bumpZoom(-1), [bumpZoom]);

  const onResetNorth = useCallback(() => {
    const roadview = roadviewRef.current;
    if (!roadview) return;
    try {
      const cur = roadview.getViewpoint();
      skipEchoRef.current = true;
      panFromRoadviewRef.current = true;
      roadview.setViewpoint({
        pan: 0,
        tilt: cur.tilt,
        zoom: cur.zoom,
      });
      syncCompassPan(0);
      onPanCommitRef.current?.(0);
      queueMicrotask(() => {
        skipEchoRef.current = false;
      });
    } catch {
      /* ignore */
    }
  }, [syncCompassPan]);

  const alertMessage =
    error ??
    (noPano ? '이 위치 근처에는 로드뷰가 없습니다.' : null) ??
    (sdkReady && lng == null && lat == null ? '지도 위치를 확인할 수 없습니다.' : null);

  const controlsEnabled = panoReady && !error && !noPano;
  const showControls = everPanoReadyRef.current || panoReady;

  return (
    <div className="relative flex h-full w-full flex-col bg-[#888888] text-white">
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#888888]">
        <div ref={containerRef} data-roadview-host className="absolute inset-0 h-full w-full bg-[#888888]" />

        {showControls && !noPano ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[3] box-border px-3 @container">
            <div className="flex w-full flex-col items-center gap-1.5 @[26rem]:flex-row @[26rem]:items-center @[26rem]:justify-between">
              <div className="hidden h-8 w-[7.5rem] shrink-0 @[26rem]:block" aria-hidden />
              {lng != null && lat != null && Number.isFinite(lng) && Number.isFinite(lat) ? (
                <div className="order-1 flex justify-center @[26rem]:order-3">
                  <StreetViewKakaoMapLink lat={lat} lng={lng} />
                </div>
              ) : (
                <div className="hidden h-8 w-[7.5rem] shrink-0 @[26rem]:order-3 @[26rem]:block" aria-hidden />
              )}
              <div className="order-2 flex justify-center">
                <StreetViewRoadviewControls
                  ref={(handle) => {
                    compassRef.current = handle;
                    handle?.setPan(lastPanRef.current);
                  }}
                  disabled={!controlsEnabled}
                  onZoomOut={onZoomOut}
                  onZoomIn={onZoomIn}
                  onResetNorth={onResetNorth}
                />
              </div>
            </div>
          </div>
        ) : null}

        {alertMessage ? <RoadviewAlertBox>{alertMessage}</RoadviewAlertBox> : null}
      </div>
    </div>
  );
}
