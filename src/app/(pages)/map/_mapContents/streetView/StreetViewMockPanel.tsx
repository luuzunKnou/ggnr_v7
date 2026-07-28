'use client';

import type { WalkerScaleInfo } from './OlMapWalker';

/** 필지분석 «분석 중»과 동일 회전 위젯 */
const ROADVIEW_LOADING_SPINNER =
  'size-[46px] shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600';

type StreetViewMockPanelProps = {
  panDeg: number;
  mapScale?: WalkerScaleInfo | null;
  /** 좌표 변경 중 안내 */
  relocating?: boolean;
};

/** 로드뷰 목업 — 실제 카카오 SDK 없음 */
export function StreetViewMockPanel({
  panDeg,
  mapScale = null,
  relocating = false,
}: StreetViewMockPanelProps) {
  const zoomLabel =
    mapScale?.zoom != null && Number.isFinite(mapScale.zoom)
      ? mapScale.zoom.toFixed(2)
      : '—';
  const resolutionLabel =
    mapScale?.resolution != null && Number.isFinite(mapScale.resolution)
      ? mapScale.resolution.toFixed(2)
      : '—';
  return (
    <div className="relative flex h-full w-full flex-col bg-slate-900 text-white">
      <div className="relative flex flex-1 flex-col items-center justify-center gap-4 overflow-hidden bg-gradient-to-b from-sky-800/40 to-slate-900">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(255,255,255,0.06) 40px, rgba(255,255,255,0.06) 41px)',
            transform: `perspective(400px) rotateY(${(panDeg - 180) * 0.15}deg)`,
          }}
        />
        <p className="relative z-[1] px-4 text-center text-sm text-white/80">
          거리뷰 영역 (목업)
          <br />
          <span className="text-xs text-white/50">실제 로드뷰 SDK는 연동하지 않습니다</span>
        </p>
        <p className="relative z-[1] text-lg font-semibold tabular-nums">
          시야 {panDeg.toFixed(0)}°
        </p>
        <div className="relative z-[1] rounded-md bg-black/35 px-3 py-2 text-center text-xs tabular-nums text-white/70">
          <p>지도 줌 {zoomLabel}</p>
          <p>해상도 {resolutionLabel}</p>
        </div>

        {relocating && (
          <div
            className="absolute inset-0 z-[2] flex items-center justify-center bg-white/85"
            aria-busy="true"
            aria-live="polite"
          >
            <div className={ROADVIEW_LOADING_SPINNER} aria-hidden />
            <span className="sr-only">로드뷰 이동중</span>
          </div>
        )}
      </div>
    </div>
  );
}
