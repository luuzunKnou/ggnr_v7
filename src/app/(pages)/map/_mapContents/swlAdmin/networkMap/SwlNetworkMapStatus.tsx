'use client'

import { useEffect, useRef, useState } from 'react'
import { call } from '@/lib/api'
import type { SwlNetworkStatus } from './swlNetworkTypes'

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

function LengthTable({
  title,
  rows,
  progress,
}: {
  title: string
  rows: { label: string; meters: number }[]
  progress: number
}) {
  if (rows.length === 0) return null
  return (
    <section className="overflow-hidden rounded border border-border bg-background">
      <SectionTitle>{title}</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-max min-w-full border-collapse text-center text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {rows.map((row) => (
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

const EMPTY: SwlNetworkStatus = { byDiameter: [], byMaterial: [], byYear: [], facilities: [] }

export function SwlNetworkMapStatus() {
  const { progress, rootRef } = useRise()
  const [status, setStatus] = useState<SwlNetworkStatus>(EMPTY)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await call('', 'POST', {
          service: 'swlNetworkService',
          action: 'getSwlNetworkStatus',
          params: {},
        })
        const data = (res?.data ?? res) as SwlNetworkStatus | undefined
        if (!cancelled && data) setStatus(data)
      } catch {
        /* 현황 없음 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const empty =
    status.byDiameter.length === 0 &&
    status.byMaterial.length === 0 &&
    status.byYear.length === 0 &&
    status.facilities.length === 0

  return (
    <div
      ref={rootRef}
      className="flex min-h-0 flex-1 flex-col gap-[13px] overflow-auto border-t border-border px-3 pb-2 pt-[13px]"
    >
      {empty ? (
        <p className="text-[11px] text-muted-foreground">현황을 집계할 자료가 없습니다.</p>
      ) : (
        <>
          <LengthTable title="관경별 관로 연장" rows={status.byDiameter} progress={progress} />
          <LengthTable title="관재질별 관로 연장" rows={status.byMaterial} progress={progress} />
          <LengthTable title="연도별 관로 연장" rows={status.byYear} progress={progress} />
          {status.facilities.length > 0 && (
            <section className="overflow-hidden rounded border border-border bg-background">
              <SectionTitle>시설 개수</SectionTitle>
              <div className="grid grid-cols-3 gap-1 p-1.5">
                {status.facilities.map((item) => (
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
          )}
        </>
      )}
    </div>
  )
}
