'use client';

import { useEffect, useRef } from 'react';
import type { PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

type Props = {
  getCamera: () => PerspectiveCamera | null;
  getOrbit: () => OrbitControls | null;
};

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * 뷰포트 카메라·시점 좌표 HUD — 초기 뷰 지정용.
 * 씬: +X=동, +Y=위, −Z=북
 */
export function ViewportCameraHud({ getCamera, getOrbit }: Props) {
  const camRef = useRef<HTMLSpanElement | null>(null);
  const tgtRef = useRef<HTMLSpanElement | null>(null);
  const metaRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      const cam = getCamera();
      const orbit = getOrbit();
      if (cam && orbit) {
        const p = cam.position;
        const t = orbit.target;
        const dist = p.distanceTo(t);
        const line = `${fmt(p.x)},${fmt(p.y)},${fmt(p.z)}|${fmt(t.x)},${fmt(t.y)},${fmt(t.z)}|${fmt(dist)}|${cam.fov}`;
        if (line !== last) {
          last = line;
          if (camRef.current) {
            camRef.current.textContent = `카메라  X ${fmt(p.x)}  Y ${fmt(p.y)}  Z ${fmt(p.z)}`;
          }
          if (tgtRef.current) {
            tgtRef.current.textContent = `시점    X ${fmt(t.x)}  Y ${fmt(t.y)}  Z ${fmt(t.z)}`;
          }
          if (metaRef.current) {
            metaRef.current.textContent = `거리 ${fmt(dist)}  FOV ${cam.fov}°`;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [getCamera, getOrbit]);

  return (
    <div
      className="pointer-events-none absolute left-2 top-2 z-10 rounded border border-border/80 bg-slate-900/80 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-slate-100 shadow-md"
      title="카메라·시점 (+X동 +Y위 −Z북)"
      aria-live="polite"
    >
      <p className="mb-0.5 text-[9px] text-slate-400">뷰 좌표 (초기 화면 지정용)</p>
      <span ref={camRef} className="block whitespace-pre">
        카메라  —
      </span>
      <span ref={tgtRef} className="block whitespace-pre">
        시점    —
      </span>
      <span ref={metaRef} className="mt-0.5 block text-amber-200/90">
        거리 —  FOV —
      </span>
    </div>
  );
}
