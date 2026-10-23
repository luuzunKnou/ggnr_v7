'use client'

import { useEffect, useRef, useState } from 'react'
import {
  WTL_FACILITY_COUNTS,
  WTL_PIPE_LENGTH_BY_DIAMETER,
  WTL_PIPE_LENGTH_BY_MATERIAL,
  WTL_PIPE_LENGTH_BY_YEAR,
} from './wtlNetworkMapStatusSample'

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

function risen(target: number, progress: number) {
  if (progress >= 1) return target
  return Math.round(target * progress)
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-2 py-1 text-xs font-medium text-foreground">
      <span className="h-3 w-0.5 shrink-0 rounded-sm bg-primary" aria-hidden />
      {children}
    </div>
  )
}
function formatLength(meters: number) {
  if (meters >= 1000) {
    const km = meters / 1000
    const text = Number.isInteger(km) ? String(km) : km.toFixed(1)
    return `${text}㎞`
  }
  return `${meters}m`
}

function topRows(rows: { label: string; meters: number }[], limit = 6) {
  const named = rows.filter((row) => row.label !== '기타')
  const otherAlready = rows
    .filter((row) => row.label === '기타')
    .reduce((sum, row) => sum + row.meters, 0)
  const sorted = [...named].sort((a, b) => b.meters - a.meters)
  const top = sorted.slice(0, limit)
  const rest = sorted.slice(limit).reduce((sum, row) => sum + row.meters, 0) + otherAlready
  if (rest > 0) top.push({ label: '기타', meters: rest })
  return top
}

function LengthTable({
  title,
  rows,
  progress,
}: {
  title: string
  rows: { label: string; meters: number }[]
  progress: number
}) {
  const shown = topRows(rows)
  return (
    <section className="overflow-hidden rounded border border-border bg-background">
      <SectionTitle>{title}</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-max min-w-full border-collapse text-center text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {shown.map((row) => (
                <th
                  key={row.label}
                  className="whitespace-nowrap border-l border-border px-2 py-1 font-medium text-foreground first:border-l-0"
                >
                  {row.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {shown.map((row) => (
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
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col gap-[13px] overflow-auto border-t border-border px-3 pb-2 pt-[13px]">
      <LengthTable title="관경별 관로 연장" rows={WTL_PIPE_LENGTH_BY_DIAMETER} progress={progress} />
      <LengthTable title="관재질별 관로 연장" rows={WTL_PIPE_LENGTH_BY_MATERIAL} progress={progress} />
      <LengthTable title="연도별 관로 연장" rows={WTL_PIPE_LENGTH_BY_YEAR} progress={progress} />
      <section className="overflow-hidden rounded border border-border bg-background">
        <SectionTitle>시설 개수</SectionTitle>
        <div className="grid grid-cols-3 gap-1 p-1.5">
          {WTL_FACILITY_COUNTS.map((item) => (
            <div key={item.label} className="flex min-w-0 items-center justify-between gap-1 rounded border border-border px-1.5 py-1">
              <span className="min-w-0 truncate text-xs text-muted-foreground">{item.label}</span>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                {risen(item.count, progress).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
