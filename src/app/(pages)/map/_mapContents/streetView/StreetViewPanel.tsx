'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { call } from '@/lib/api';
import {
  loadKakaoMapsSdk,
  type KakaoRoadview,
  type KakaoRoadviewClient,
} from './loadKakaoMapsSdk';
import { StreetViewRoadviewControls } from './StreetViewRoadviewControls';

/** 근처 파노라마 검색 반경(m) — 읍면 지역 여유 */
const PANO_SEARCH_RADIUS_M = 100;
/** setPanoId 후 init 대기 */
const PANO_INIT_TIMEOUT_MS = 8000;
/** 카카오 로드뷰 zoom 범위 */
const ROADVIEW_ZOOM_MIN = -3;
const ROADVIEW_ZOOM_MAX = 3;

type StreetViewPanelProps = {
  /** 시야각(도) — 카카오 로드뷰 pan */
  panDeg: number;
  /** WGS84 경도 */
  lng: number | null;
  /** WGS84 위도 */
  lat: number | null;
  /** 로드뷰 화살표 이동 등 → 지도/워커 반영 */
  onRoadviewPosition?: (lng: number, lat: number) => void;
  /** 로드뷰 시야 변경 → 워커 pan */
  onRoadviewPan?: (panDeg: number) => void;
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
        className="max-w-md rounded-xl border-2 border-dashed border-red-500 bg-black/70 px-4 py-3 text-center text-sm font-semibold leading-relaxed text-white shadow-lg whitespace-pre-line"
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
  onRoadviewPosition,
  onRoadviewPan,
  onRoadviewTilt,
}: StreetViewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const roadviewRef = useRef<KakaoRoadview | null>(null);
  const clientRef = useRef<KakaoRoadviewClient | null>(null);
  const skipEchoRef = useRef(false);
  const panFromRoadviewRef = useRef(false);
  /** 로드뷰→지도 반영 후 props 좌표가 돌아와도 파노 재조회 생략 */
  const ignoreNextPropPosRef = useRef(false);
  const lastFetchKeyRef = useRef('');
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPosRef = useRef(onRoadviewPosition);
  const onPanRef = useRef(onRoadviewPan);
  const onTiltRef = useRef(onRoadviewTilt);
  onPosRef.current = onRoadviewPosition;
  onPanRef.current = onRoadviewPan;
  onTiltRef.current = onRoadviewTilt;

  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noPano, setNoPano] = useState(false);
  const [panoReady, setPanoReady] = useState(false);
  /** 첫 파노 연결 여부 — 이후 좌표 이동 시 init 미발화해도 컨트롤 유지 */
  const everPanoReadyRef = useRef(false);
  /** 카카오 Viewpoint.tilt — 수직 각(-90~90) */
  const [tiltDeg, setTiltDeg] = useState(0);

  const lngLabel = lng != null && Number.isFinite(lng) ? lng.toFixed(6) : '—';
  const latLabel = lat != null && Number.isFinite(lat) ? lat.toFixed(6) : '—';

  const reportFailure = (raw: unknown, fallback?: string) => {
    const explained = explainKakaoRoadviewFailure(raw);
    setError(explained ?? fallback ?? (raw instanceof Error ? raw.message : String(raw)));
  };

  /** 콘솔·전역 오류·카카오 fetch 응답에서 도메인 미등록 등 감지 */
  useEffect(() => {
    const onMsg = (raw: unknown) => {
      const explained = explainKakaoRoadviewFailure(raw);
      if (explained) setError(explained);
    };

    const origError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      origError(...args);
      for (const a of args) onMsg(a);
    };

    const onWindowError = (e: ErrorEvent) => onMsg(e.message || e.error);
    const onRejection = (e: PromiseRejectionEvent) => onMsg(e.reason);

    const origFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await origFetch(input, init);
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (/dapi\.kakao\.com|map\.kakao\.com/i.test(url) && !res.ok) {
          const clone = res.clone();
          const body = await clone.text().catch(() => '');
          onMsg(body || `HTTP ${res.status} ${url}`);
        } else if (/dapi\.kakao\.com|map\.kakao\.com/i.test(url)) {
          const clone = res.clone();
          const body = await clone.text().catch(() => '');
          if (body && /domain mismatched|-401|AccessDenied/i.test(body)) onMsg(body);
        }
      } catch {
        /* ignore sniff errors */
      }
      return res;
    };

    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      console.error = origError;
      window.fetch = origFetch;
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

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
        setTiltDeg(tilt);
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
        const tilt = vp.tilt ?? 0;
        setTiltDeg(tilt);
        onTiltRef.current?.(tilt);
        if (skipEchoRef.current) return;
        panFromRoadviewRef.current = true;
        onPanRef.current?.(normalizePan(vp.pan));
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

    const ro = new ResizeObserver(() => {
      try {
        roadview.relayout();
      } catch {
        /* ignore */
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reportFailure stable enough
  }, [sdkReady]);

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
    // 좌표 이동 시 panoReady를 끄지 않음 — init이 재발화되지 않아 커스텀 UI가 사라지는 문제 방지
    if (initTimerRef.current) {
      clearTimeout(initTimerRef.current);
      initTimerRef.current = null;
    }
    // 첫 파노만 미표시 타임아웃
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
      client.getNearestPanoId(position, PANO_SEARCH_RADIUS_M, (panoId) => {
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
            pan: normalizePan(panDeg),
            tilt: cur?.tilt ?? 0,
            zoom: cur?.zoom ?? 0,
          });
          roadview.relayout();
          // setPanoId 후 init이 안 올 수 있음 — 즉시 ready 유지(좌표 이동 시 커스텀 UI 유지)
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
    // panDeg는 시점만 별도 effect — 좌표 변경 시에만 파노 재조회
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
      onPanRef.current?.(0);
      queueMicrotask(() => {
        skipEchoRef.current = false;
      });
    } catch {
      /* ignore */
    }
  }, []);

  const alertMessage =
    error ??
    (noPano ? '이 위치 근처에는 로드뷰가 없습니다.' : null) ??
    (sdkReady && lng == null && lat == null ? '지도 위치를 확인할 수 없습니다.' : null);

  const controlsEnabled = panoReady && !error && !noPano;
  const showControls = everPanoReadyRef.current || panoReady;

  return (
    <div className="relative flex h-full w-full flex-col bg-slate-900 text-white">
      <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-950">
        <div ref={containerRef} className="absolute inset-0 h-full w-full" />

        <div className="pointer-events-none absolute bottom-16 left-2 z-[2] rounded-md bg-black/45 px-2 py-1 text-[10px] tabular-nums text-white/75">
          <p>수평각 {panDeg.toFixed(1)}°</p>
          <p>수직각 {tiltDeg.toFixed(1)}°</p>
          <p>경도 {lngLabel}</p>
          <p>위도 {latLabel}</p>
          {panoReady ? <p className="text-emerald-300/90">로드뷰 연결됨</p> : null}
        </div>

        {showControls && !noPano ? (
          <StreetViewRoadviewControls
            panDeg={panDeg}
            disabled={!controlsEnabled}
            onZoomOut={onZoomOut}
            onZoomIn={onZoomIn}
            onResetNorth={onResetNorth}
          />
        ) : null}

        {alertMessage ? <RoadviewAlertBox>{alertMessage}</RoadviewAlertBox> : null}
      </div>
    </div>
  );
}
