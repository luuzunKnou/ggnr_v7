'use client';

import { useEffect, useState } from 'react';
import type { PerspectiveCamera } from 'three';
import * as THREE from 'three';

type Props = {
  /** 매 프레임 갱신용 — camera ref getter */
  getCamera: () => PerspectiveCamera | null;
};

/**
 * 뷰포트 코너 나침반 — 월드 −Z=북, +X=동 기준.
 * 카메라 yaw에 맞춰 장미가 회전해 북이 항상 월드 북을 가리킴.
 */
export function ViewportCompass({ getCamera }: Props) {
  const [deg, setDeg] = useState(0);

  useEffect(() => {
    let raf = 0;
    const dir = new THREE.Vector3();
    const tick = () => {
      const cam = getCamera();
      if (cam) {
        cam.getWorldDirection(dir);
        // 수평면: 북(−Z) 기준 시계방향 각도 → 장미는 반대로 돌려 N이 화면상 북 방향
        const yaw = Math.atan2(dir.x, -dir.z);
        setDeg((-yaw * 180) / Math.PI);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [getCamera]);

  return (
    <div
      className="pointer-events-none absolute bottom-2 right-2 z-10 flex h-14 w-14 items-center justify-center rounded-full border border-amber-400/70 bg-slate-900/75 shadow-md"
      title="나침반 (북=−Z)"
      aria-hidden
    >
      <div
        className="relative h-11 w-11"
        style={{ transform: `rotate(${deg}deg)` }}
      >
        <span className="absolute left-1/2 top-0 -translate-x-1/2 text-[11px] font-bold leading-none text-amber-300">
          북
        </span>
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[9px] font-medium leading-none text-slate-300">
          남
        </span>
        <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[9px] font-medium leading-none text-slate-300">
          동
        </span>
        <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[9px] font-medium leading-none text-slate-300">
          서
        </span>
        <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400" />
      </div>
    </div>
  );
}
