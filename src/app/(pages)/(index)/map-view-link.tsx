"use client"

import { Layers, Mouse } from "lucide-react"
import { useEffect, useRef } from "react"
import { withBasePathNav } from "@/lib/basePath"

export function MapViewLink() {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.muted = true
    el.defaultMuted = true

    const tryPlay = () => {
      void el.play().catch(() => {})
    }
    tryPlay()

    const onVisible = () => {
      if (document.visibilityState === "visible") tryPlay()
    }

    const onEnded = () => {
      el.currentTime = 0
      tryPlay()
    }

    /** loop 속성이 일부 환경에서 끊길 때 보강 */
    const onWaiting = () => {
      if (!document.hidden) tryPlay()
    }

    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("pageshow", onVisible)
    el.addEventListener("ended", onEnded)
    el.addEventListener("waiting", onWaiting)

    /** 탭은 보이는데 브라우저가 절전 등으로 멈춘 경우 간헐 복구 */
    const watchdog = window.setInterval(() => {
      if (document.hidden) return
      if (el.paused && !el.ended && el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        tryPlay()
      }
    }, 4000)

    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("pageshow", onVisible)
      el.removeEventListener("ended", onEnded)
      el.removeEventListener("waiting", onWaiting)
      window.clearInterval(watchdog)
    }
  }, [])

  return (
    <button
      type="button"
      title="지도보기"
      onClick={() => {
        window.location.assign(withBasePathNav("/map"))
      }}
      className="group relative block min-h-[280px] w-full cursor-pointer overflow-hidden rounded-[5px] bg-slate-900 p-8 text-center text-white transition-opacity hover:opacity-95 flex flex-col items-center justify-center"
    >
      <video
        ref={videoRef}
        src="/image/indexImage/backgroundVideo_02.mp4"
        className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
        muted
        loop
        autoPlay
        playsInline
        preload="auto"
        aria-hidden
      />
      <div
        className="absolute inset-0 z-[1] bg-blue-950/45 transition-colors group-hover:bg-blue-900/55"
        aria-hidden
      />
      <div className="relative z-10 flex flex-col items-center justify-center">
        <div className="mb-4 mt-4 flex h-24 w-24 items-center justify-center">
          <Layers className="h-full w-full" strokeWidth={1.5} />
        </div>
        <h2 className="mb-4 mt-4 text-2xl font-bold">지도보기</h2>
        <p className="text-sm leading-relaxed text-gray-100">
          사용자가 원하는 위치를 직관적으로 확인하고
          <br />
          데이터를 시각화합니다.
        </p>
        <Mouse className="mt-10 h-5 w-5" />
      </div>
    </button>
  )
}
