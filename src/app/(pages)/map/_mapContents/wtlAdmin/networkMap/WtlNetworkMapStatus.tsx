'use client'

import { useEffect, useRef, useState } from 'react'
import {
  WTL_FACILITY_COUNTS,
  WTL_PIPE_LENGTH_BY_DIAMETER,
  WTL_PIPE_LENGTH_BY_MATERIAL,
  WTL_PIPE_LENGTH_BY_YEAR,
} from './wtlNetworkMapBoardData'

function useRise(duration = 1600) {
  const [progress, setProgress] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = rootRef.current
    let frame = 0
    let started = false

    const play = () => {
      if (started) return
      started = true
      setProgress(0)
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        setProgress(1 - (1 - t) ** 3)
        if (t < 1) frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    }

    if (!node) {
      play()
      return () => cancelAnimationFrame(frame)
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) play()
    })
    observer.observe(node)
    const fallback = window.setTimeout(play, 500)

    return () => {
      observer.disconnect()
      window.clearTimeout(fallback)
      cancelAnimationFrame(frame)
    }
  }, [duration])

  return { progress, rootRef }
}

function risen(value: number, progress: number) {
  return Math.round(value * progress)
}

function formatLength(meters: number) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`
  return `${meters.toLocaleString()} m`
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border bg-muted/40 px-2 py-1 text-[11px] font-semibold text-foreground">
      {children}
    </div>
  )
}

function LengthTable({
  title,
  rows,
  progress,
}: {
  title: string
  rows: readonly { label: string; meters: number }[]
  progress: number
}) {
  return (
    <section className="overflow-hidden rounded border border-border bg-background">
      <SectionTitle>{title}</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full min-w-0 border-collapse text-left text-[11px]">
          <thead>
            <tr className="bg-muted/30 text-muted-foreground">
              {rows.map((row) => (
                <th
                  key={row.label}
                  className="whitespace-nowrap border-l border-border px-2 py-1 font-medium first:border-l-0"
                >
                  {row.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {rows.map((row) => (
                <td
                  key={row.label}
                  className="whitespace-nowrap border-l border-border px-2 py-1 tabular-nums text-foreground first:border-l-0"
                >
                  {formatLength(risen(row.meters, progress))}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function WtlNetworkMapStatus() {
  const { progress, rootRef } = useRise()

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div
        ref={rootRef}
        className="min-h-0 flex-1 space-y-[13px] overflow-x-hidden overflow-y-auto px-3 pb-2 pt-[13px]"
        style={{
          borderTop: '3px double var(--border)',
        }}
      >
        <LengthTable title="관경별 관로 연장" rows={WTL_PIPE_LENGTH_BY_DIAMETER} progress={progress} />
        <LengthTable title="관재질별 관로 연장" rows={WTL_PIPE_LENGTH_BY_MATERIAL} progress={progress} />
        <LengthTable title="연도별 관로 연장" rows={WTL_PIPE_LENGTH_BY_YEAR} progress={progress} />
        <section className="overflow-hidden rounded border border-border bg-background">
          <SectionTitle>시설 개수</SectionTitle>
          <div className="grid grid-cols-3 gap-1 p-1.5">
            {(WTL_FACILITY_COUNTS ?? []).map((item) => (
              <div
                key={item.label}
                className="flex min-w-0 items-center justify-between gap-1 rounded border border-border px-1.5 py-1"
              >
                <span className="min-w-0 truncate text-xs text-muted-foreground">{item.label}</span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                  {risen(item.count, progress).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
