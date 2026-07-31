'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { call } from '@/lib/api';
import {
  loadKakaoMapsSdk,
  type KakaoRoadview,
  type KakaoRoadviewClient,
} from './loadKakaoMapsSdk';
import { StreetViewRoadviewControls, type StreetViewCompassHandle } from './StreetViewRoadviewControls';
import {
  buildKakaoRoadviewLink,
  StreetViewKakaoMapLink,
} from './StreetViewKakaoMapLink';
import type { WalkerIconMode } from './OlMapWalker';

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
  /** 워커 아이콘 형태 (디폴트 / 모자 / GGNR) */
  walkerIconMode?: WalkerIconMode;
  onWalkerIconModeChange?: (mode: WalkerIconMode) => void;
};

function normalizePan(pan: number): number {
  return ((pan % 360) + 360) % 360;
}

function posKey(lng: number, lat: number): string {
  return `${lng.toFixed(5)},${lat.toFixed(5)}`;
}

function currentOrigin(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

/** 분할선 스트레치용 스냅샷 캐시 — 내용이 바뀌면 무효화 */
function emitRoadviewSnapInvalidate(host: HTMLElement | null) {
  host?.dispatchEvent(new Event('roadview-snap-invalidate'));
}

/** 로드뷰 화면이 안정화된 뒤 스냅샷 재캡처 요청 */
function emitRoadviewSnapReady(host: HTMLElement | null) {
  host?.dispatchEvent(new Event('roadview-snap-ready'));
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

function RoadviewAlertBox({
  children,
  onRestore,
}: {
  children: ReactNode;
  onRestore?: () => void;
}) {
  const restoreLabel = '이전 위치로 돌아가기';
  return (
    <div className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center px-4">
      <div
        className="flex max-w-md flex-col items-center gap-3 rounded-[12px] border-2 border-solid border-red-500 bg-black/70 px-4 py-3 text-center text-sm font-semibold leading-relaxed text-white shadow-lg"
        role="alert"
      >
        <div className="whitespace-pre-line">{children}</div>
        {onRestore ? (
          <button
            type="button"
            title={restoreLabel}
            className="pointer-events-auto cursor-pointer rounded-md border border-white/40 bg-white/15 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/25"
            onClick={onRestore}
          >
            {restoreLabel}
          </button>
        ) : null}
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
  walkerIconMode = 'hat',
  onWalkerIconModeChange,
}: StreetViewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const roadviewRef = useRef<KakaoRoadview | null>(null);
  const clientRef = useRef<KakaoRoadviewClient | null>(null);
  const skipEchoRef = useRef(false);
  const panFromRoadviewRef = useRef(false);
  const ignoreNextPropPosRef = useRef(false);
  const lastFetchKeyRef = useRef('');
  /** setPanoId 성공 시 보관 — 분할선 후 재생성 복원용 */
  const lastPanoIdRef = useRef<number | null>(null);
  /** teardown→mount 사이 복원 스냅샷 */
  const pendingRecreateRef = useRef<{
    panoId: number;
    lat: number;
    lng: number;
    pan: number;
    tilt: number;
    zoom: number;
  } | null>(null);
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
  const hudPanRef = useRef<HTMLParagraphElement>(null);
  const hudTiltRef = useRef<HTMLParagraphElement>(null);
  const hudLngRef = useRef<HTMLParagraphElement>(null);
  const hudLatRef = useRef<HTMLParagraphElement>(null);
  const relayoutRafRef = useRef(0);
  const viewpointRafRef = useRef(0);
  const pendingVpRef = useRef<{ pan: number; tilt: number } | null>(null);

  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noPano, setNoPano] = useState(false);
  const [panoReady, setPanoReady] = useState(false);
  /** 이전 파노라마가 실제로 열린 좌표 — 알림 시 복귀용 (호출 좌표 아님) */
  const [lastSuccessPos, setLastSuccessPos] = useState<{ lng: number; lat: number } | null>(null);
  const everPanoReadyRef = useRef(false);
  const snapReadyRaf1Ref = useRef(0);
  const snapReadyRaf2Ref = useRef(0);
  const viewpointDirtyRef = useRef(false);
  /** 재생성 직전·직후 ResizeObserver relayout 억제 */
  const skipRelayoutUntilRef = useRef(0);

  /** 이벤트 트리거 → 페인트 2프레임 후 ready-emit (지연 ms 없음) */
  const scheduleSnapReady = useCallback(() => {
    const host = containerRef.current;
    if (snapReadyRaf1Ref.current) {
      cancelAnimationFrame(snapReadyRaf1Ref.current);
      snapReadyRaf1Ref.current = 0;
    }
    if (snapReadyRaf2Ref.current) {
      cancelAnimationFrame(snapReadyRaf2Ref.current);
      snapReadyRaf2Ref.current = 0;
    }
    snapReadyRaf1Ref.current = requestAnimationFrame(() => {
      snapReadyRaf1Ref.current = 0;
      snapReadyRaf2Ref.current = requestAnimationFrame(() => {
        snapReadyRaf2Ref.current = 0;
        emitRoadviewSnapReady(host);
      });
    });
  }, []);
  const scheduleSnapReadyRef = useRef(scheduleSnapReady);
  scheduleSnapReadyRef.current = scheduleSnapReady;

  const reportFailure = (raw: unknown, fallback?: string) => {
    const explained = explainKakaoRoadviewFailure(raw);
    setError(explained ?? fallback ?? (raw instanceof Error ? raw.message : String(raw)));
    emitRoadviewSnapInvalidate(containerRef.current);
    scheduleSnapReadyRef.current();
  };

  const syncCompassPan = useCallback((pan: number) => {
    lastPanRef.current = pan;
    compassRef.current?.setPan(pan);
  }, []);

  const writeHud = useCallback(
    (opts: { pan?: number; tilt?: number; lngText?: string; latText?: string }) => {
      if (opts.pan != null && hudPanRef.current) {
        hudPanRef.current.textContent = `수평각 ${opts.pan.toFixed(1)}°`;
      }
      if (opts.tilt != null && hudTiltRef.current) {
        hudTiltRef.current.textContent = `수직각 ${opts.tilt.toFixed(1)}°`;
      }
      if (opts.lngText != null && hudLngRef.current) {
        hudLngRef.current.textContent = `경도 ${opts.lngText}`;
      }
      if (opts.latText != null && hudLatRef.current) {
        hudLatRef.current.textContent = `위도 ${opts.latText}`;
      }
    },
    []
  );
  const writeHudRef = useRef(writeHud);
  writeHudRef.current = writeHud;

  useEffect(() => {
    syncCompassPan(panDeg);
    writeHud({ pan: panDeg });
  }, [panDeg, syncCompassPan, writeHud]);

  useEffect(() => {
    const lngText = lng != null && Number.isFinite(lng) ? lng.toFixed(6) : '—';
    const latText = lat != null && Number.isFinite(lat) ? lat.toFixed(6) : '—';
    writeHud({ lngText, latText });
  }, [lng, lat, writeHud]);

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

    const flushViewpoint = () => {
      viewpointRafRef.current = 0;
      const pending = pendingVpRef.current;
      if (!pending) return;
      pendingVpRef.current = null;
      writeHudRef.current({ pan: pending.pan, tilt: pending.tilt });
      syncCompassPan(pending.pan);
      onTiltRef.current?.(pending.tilt);
      if (skipEchoRef.current) return;
      onPanRef.current?.(pending.pan);
    };

    const rememberLoadedRoadviewPos = () => {
      try {
        const pos = roadviewRef.current?.getPosition();
        if (!pos) return;
        const nextLng = pos.getLng();
        const nextLat = pos.getLat();
        if (!Number.isFinite(nextLng) || !Number.isFinite(nextLat)) return;
        setLastSuccessPos({ lng: nextLng, lat: nextLat });
      } catch {
        /* ignore */
      }
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
      // 호출 좌표가 아니라 실제로 열린 파노 위치
      rememberLoadedRoadviewPos();
      try {
        const tilt = roadviewRef.current?.getViewpoint()?.tilt ?? 0;
        writeHudRef.current({ tilt });
        onTiltRef.current?.(tilt);
      } catch {
        /* ignore */
      }
      scheduleSnapReadyRef.current();
    };

    const onPositionChanged = () => {
      // 화살표 이동 등으로 열린 파노 위치가 바뀌면 복귀 기준도 갱신
      rememberLoadedRoadviewPos();
      if (skipEchoRef.current) return;
      try {
        const pos = roadviewRef.current?.getPosition();
        if (!pos) return;
        ignoreNextPropPosRef.current = true;
        onPosRef.current?.(pos.getLng(), pos.getLat());
      } catch {
        /* ignore */
      }
      scheduleSnapReadyRef.current();
    };

    const onViewpointChanged = () => {
      try {
        const vp = roadviewRef.current?.getViewpoint();
        if (!vp) return;
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
      // 드래그 중에는 스케줄하지 않음 — pointerup에서만 최종 캡처
      viewpointDirtyRef.current = true;
    };

    const onViewpointPointerUp = () => {
      if (!viewpointDirtyRef.current) return;
      viewpointDirtyRef.current = false;
      scheduleSnapReadyRef.current();
    };

    const onError = (...args: unknown[]) => {
      reportFailure(args[0] ?? args, '로드뷰 오류가 발생했습니다.');
    };

    const bindRoadview = (rv: KakaoRoadview) => {
      maps.event.addListener(rv, 'init', onInit);
      maps.event.addListener(rv, 'position_changed', onPositionChanged);
      maps.event.addListener(rv, 'viewpoint_changed', onViewpointChanged);
      maps.event.addListener(rv, 'error', onError);
    };

    const unbindRoadview = (rv: KakaoRoadview) => {
      maps.event.removeListener(rv, 'init', onInit);
      maps.event.removeListener(rv, 'position_changed', onPositionChanged);
      maps.event.removeListener(rv, 'viewpoint_changed', onViewpointChanged);
      maps.event.removeListener(rv, 'error', onError);
    };

    const createRoadview = (): KakaoRoadview | null => {
      try {
        const rv = new maps.Roadview(el, { disableZoomControl: true });
        bindRoadview(rv);
        roadviewRef.current = rv;
        return rv;
      } catch (e) {
        reportFailure(e, '로드뷰 객체를 생성하지 못했습니다.');
        roadviewRef.current = null;
        return null;
      }
    };

    /** unlock 전: 파노·시점 보관 후 인스턴스 제거 */
    const recreateTeardown = () => {
      const old = roadviewRef.current;
      if (!old) {
        pendingRecreateRef.current = null;
        return;
      }

      if (relayoutRafRef.current) {
        cancelAnimationFrame(relayoutRafRef.current);
        relayoutRafRef.current = 0;
      }
      skipRelayoutUntilRef.current = performance.now() + 800;

      let panoId: number | null = lastPanoIdRef.current;
      let lat = 0;
      let lng = 0;
      let hasPos = false;
      let vp = {
        pan: normalizePan(lastPanRef.current),
        tilt: 0,
        zoom: 0,
      };
      try {
        const id = old.getPanoId();
        if (id != null && Number.isFinite(id)) panoId = id;
      } catch {
        /* ignore */
      }
      try {
        const position = old.getPosition();
        lat = position.getLat();
        lng = position.getLng();
        hasPos = Number.isFinite(lat) && Number.isFinite(lng);
      } catch {
        /* ignore */
      }
      try {
        const cur = old.getViewpoint();
        vp = {
          pan: normalizePan(cur.pan),
          tilt: cur.tilt ?? 0,
          zoom: cur.zoom ?? 0,
        };
      } catch {
        /* ignore */
      }

      pendingRecreateRef.current =
        panoId != null && hasPos
          ? {
              panoId,
              lat,
              lng,
              pan: vp.pan,
              tilt: vp.tilt,
              zoom: vp.zoom,
            }
          : null;

      unbindRoadview(old);
      emitRoadviewSnapInvalidate(el);
      setPanoReady(false);
      el.replaceChildren();
      roadviewRef.current = null;
    };

    /** unlock 후: 새 칸 크기로 인스턴스 생성·복원 */
    const recreateMount = () => {
      skipRelayoutUntilRef.current = performance.now() + 400;
      if (roadviewRef.current) return;

      const snap = pendingRecreateRef.current;
      pendingRecreateRef.current = null;
      const next = createRoadview();
      if (!next) return;

      if (!snap || !window.kakao?.maps) {
        lastFetchKeyRef.current = '';
        scheduleSnapReadyRef.current();
        return;
      }

      lastPanoIdRef.current = snap.panoId;
      const position = new window.kakao.maps.LatLng(snap.lat, snap.lng);
      skipEchoRef.current = true;
      try {
        next.setPanoId(snap.panoId, position);
        next.setViewpoint({
          pan: snap.pan,
          tilt: snap.tilt,
          zoom: snap.zoom,
        });
        syncCompassPan(snap.pan);
        if (initTimerRef.current) {
          clearTimeout(initTimerRef.current);
          initTimerRef.current = null;
        }
        initTimerRef.current = setTimeout(() => {
          initTimerRef.current = null;
          scheduleSnapReadyRef.current();
        }, PANO_INIT_TIMEOUT_MS);
      } catch (e) {
        reportFailure(e, '로드뷰 파노라마를 다시 열지 못했습니다.');
      } finally {
        queueMicrotask(() => {
          skipEchoRef.current = false;
        });
      }
    };

    if (!createRoadview()) return;
    const client = new maps.RoadviewClient();
    clientRef.current = client;

    const scheduleRelayout = () => {
      if (performance.now() < skipRelayoutUntilRef.current) return;
      if (relayoutRafRef.current) return;
      relayoutRafRef.current = requestAnimationFrame(() => {
        relayoutRafRef.current = 0;
        if (performance.now() < skipRelayoutUntilRef.current) return;
        const rv = roadviewRef.current;
        if (!rv) return;
        try {
          rv.relayout();
        } catch {
          /* ignore */
        }
        scheduleSnapReadyRef.current();
      });
    };
    const forceRelayout = () => {
      if (performance.now() < skipRelayoutUntilRef.current) return;
      if (relayoutRafRef.current) {
        cancelAnimationFrame(relayoutRafRef.current);
        relayoutRafRef.current = 0;
      }
      const rv = roadviewRef.current;
      if (!rv) return;
      try {
        rv.relayout();
      } catch {
        /* ignore */
      }
      scheduleSnapReadyRef.current();
    };
    const ro = new ResizeObserver(scheduleRelayout);
    ro.observe(el);
    el.addEventListener('roadview-relayout', forceRelayout);
    el.addEventListener('roadview-recreate-teardown', recreateTeardown);
    el.addEventListener('roadview-recreate-mount', recreateMount);
    // 캡처 단계에서 수신 — 카카오가 host에서 bubble을 막아도 드래그 종료 감지
    window.addEventListener('pointerup', onViewpointPointerUp, true);
    window.addEventListener('pointercancel', onViewpointPointerUp, true);

    return () => {
      ro.disconnect();
      el.removeEventListener('roadview-relayout', forceRelayout);
      el.removeEventListener('roadview-recreate-teardown', recreateTeardown);
      el.removeEventListener('roadview-recreate-mount', recreateMount);
      window.removeEventListener('pointerup', onViewpointPointerUp, true);
      window.removeEventListener('pointercancel', onViewpointPointerUp, true);
      if (relayoutRafRef.current) {
        cancelAnimationFrame(relayoutRafRef.current);
        relayoutRafRef.current = 0;
      }
      if (viewpointRafRef.current) {
        cancelAnimationFrame(viewpointRafRef.current);
        viewpointRafRef.current = 0;
      }
      pendingVpRef.current = null;
      viewpointDirtyRef.current = false;
      pendingRecreateRef.current = null;
      if (initTimerRef.current) {
        clearTimeout(initTimerRef.current);
        initTimerRef.current = null;
      }
      if (snapReadyRaf1Ref.current) {
        cancelAnimationFrame(snapReadyRaf1Ref.current);
        snapReadyRaf1Ref.current = 0;
      }
      if (snapReadyRaf2Ref.current) {
        cancelAnimationFrame(snapReadyRaf2Ref.current);
        snapReadyRaf2Ref.current = 0;
      }
      emitRoadviewSnapInvalidate(el);
      const current = roadviewRef.current;
      if (current) unbindRoadview(current);
      roadviewRef.current = null;
      clientRef.current = null;
      lastFetchKeyRef.current = '';
      lastPanoIdRef.current = null;
      everPanoReadyRef.current = false;
      setPanoReady(false);
      setLastSuccessPos(null);
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
    emitRoadviewSnapInvalidate(containerRef.current);
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
        emitRoadviewSnapInvalidate(containerRef.current);
        scheduleSnapReadyRef.current();
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
        if (cancelled) {
          return;
        }
        if (panoId == null) {
          setNoPano(true);
          setPanoReady(false);
          lastPanoIdRef.current = null;
          emitRoadviewSnapInvalidate(containerRef.current);
          scheduleSnapReadyRef.current();
          return;
        }
        setNoPano(false);
        skipEchoRef.current = true;
        try {
          roadview.setPanoId(panoId, position);
          lastPanoIdRef.current = panoId;
          const cur = roadview.getViewpoint();
          roadview.setViewpoint({
            pan: normalizePan(lastPanRef.current),
            tilt: cur?.tilt ?? 0,
            zoom: cur?.zoom ?? 0,
          });
          try {
            roadview.relayout();
          } catch {
            /* ignore */
          }
          if (initTimerRef.current) {
            clearTimeout(initTimerRef.current);
            initTimerRef.current = null;
          }
          everPanoReadyRef.current = true;
          setPanoReady(true);
          setError(null);
          scheduleSnapReadyRef.current();
          // lastSuccessPos는 init의 getPosition(실제 파노 좌표)에서 갱신
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
      scheduleSnapReadyRef.current();
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
      writeHudRef.current({ pan: 0 });
      onPanCommitRef.current?.(0);
      queueMicrotask(() => {
        skipEchoRef.current = false;
      });
    } catch {
      /* ignore */
    }
  }, [syncCompassPan]);

  /** 클릭 시점의 panoid·pan·tilt·zoom으로 카카오맵 URL 생성 */
  const getKakaoMapHref = useCallback(() => {
    const roadview = roadviewRef.current;
    if (!roadview) return null;
    try {
      let panoId: number | null = lastPanoIdRef.current;
      try {
        const id = roadview.getPanoId();
        if (id != null && Number.isFinite(id)) panoId = id;
      } catch {
        /* lastPanoId 폴백 */
      }
      if (panoId == null || !Number.isFinite(panoId)) return null;
      const vp = roadview.getViewpoint();
      return buildKakaoRoadviewLink({
        panoId,
        pan: normalizePan(vp.pan),
        tilt: vp.tilt ?? 0,
        zoom: vp.zoom ?? 0,
      });
    } catch {
      return null;
    }
  }, []);

  const alertMessage =
    error ??
    (noPano ? '이 위치 근처에는 로드뷰가 없습니다.' : null) ??
    (sdkReady && lng == null && lat == null ? '지도 위치를 확인할 수 없습니다.' : null);

  const canRestoreLastSuccess =
    !!alertMessage &&
    !!lastSuccessPos &&
    !!onRoadviewPosition &&
    (lng == null ||
      lat == null ||
      !Number.isFinite(lng) ||
      !Number.isFinite(lat) ||
      posKey(lng, lat) !== posKey(lastSuccessPos.lng, lastSuccessPos.lat));

  const onRestoreLastSuccess = useCallback(() => {
    if (!lastSuccessPos || !onRoadviewPosition) return;
    onRoadviewPosition(lastSuccessPos.lng, lastSuccessPos.lat);
  }, [lastSuccessPos, onRoadviewPosition]);

  const controlsEnabled = panoReady && !error && !noPano;
  const showControls = everPanoReadyRef.current || panoReady || noPano || !!error;
  const kakaoLinkDisabled = !panoReady || !!error || noPano;
  const lngText = lng != null && Number.isFinite(lng) ? lng.toFixed(6) : '—';
  const latText = lat != null && Number.isFinite(lat) ? lat.toFixed(6) : '—';

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#888888] text-white">
      <div data-roadview-stage className="relative min-h-0 flex-1 overflow-hidden bg-[#888888]">
        <div data-roadview-frame className="absolute inset-0 z-0">
          <div ref={containerRef} data-roadview-host className="absolute inset-0 h-full w-full bg-[#888888]" />
          {alertMessage ? (
            <RoadviewAlertBox onRestore={canRestoreLastSuccess ? onRestoreLastSuccess : undefined}>
              {alertMessage}
            </RoadviewAlertBox>
          ) : null}
          <div className="pointer-events-none absolute bottom-16 left-2 z-[2] rounded-md bg-black/45 px-2 py-1.5 text-[10px] tabular-nums text-white/75">
            <div className="pointer-events-auto mb-1.5 select-none">
              <p className="mb-0.5 font-semibold text-white/90">워커 아이콘</p>
              <div className="flex flex-col gap-0.5" role="radiogroup" aria-label="워커 아이콘">
                {(
                  [
                    { value: 'default' as const, label: '디폴트' },
                    { value: 'hat' as const, label: '모자' },
                    { value: 'ggnr' as const, label: 'GGNR 문구' },
                  ] as const
                ).map(({ value, label }) => (
                  <label
                    key={value}
                    title={label}
                    className="flex cursor-pointer items-center gap-1.5 text-white/80 hover:text-white"
                  >
                    <input
                      type="radio"
                      name="walker-icon-mode"
                      value={value}
                      checked={walkerIconMode === value}
                      onChange={() => onWalkerIconModeChange?.(value)}
                      className="cursor-pointer accent-sky-400"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <p ref={hudPanRef}>수평각 {panDeg.toFixed(1)}°</p>
            <p ref={hudTiltRef}>수직각 0.0°</p>
            <p ref={hudLngRef}>경도 {lngText}</p>
            <p ref={hudLatRef}>위도 {latText}</p>
            {panoReady ? <p className="text-emerald-300/90">로드뷰 연결됨</p> : null}
          </div>
        </div>
      </div>

      {showControls ? (
        <div
          data-roadview-controls
          className="pointer-events-none absolute inset-x-0 bottom-3 z-[3] box-border px-3 @container"
        >
          <div className="flex w-full flex-col items-center gap-1.5 @[26rem]:flex-row @[26rem]:items-center @[26rem]:justify-between">
            <div className="hidden h-8 w-[7.5rem] shrink-0 @[26rem]:block" aria-hidden />
            <div className="order-1 flex justify-center @[26rem]:order-3">
              <StreetViewKakaoMapLink getHref={getKakaoMapHref} disabled={kakaoLinkDisabled} />
            </div>
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
    </div>
  );
}
