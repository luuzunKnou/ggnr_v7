'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  groundwaterPermitStatusClass,
  type GroundwaterPermitStatusCode,
} from '@/lib/groundwaterPermitStatus'
import { GROUNDWATER_PERMIT_DETAIL_SECTIONS } from './groundwaterPermitSections'
import { useGroundwaterPermitMapHighlight } from './useGroundwaterPermitMapHighlight'
import { MapSideDetailScroll } from "../../_mapComponents/MapSideDetailScroll";

type Props = {
  detailId: string
  onClose: () => void
}

type DetailRow = {
  id: string
  nameOrTrade: string
  developLocation: string
  statusCode: GroundwaterPermitStatusCode
  statusLabel: string
}

type DetailFields = Record<string, string>

const DEFAULT_OPEN_SECTION_IDS = new Set(['basic'])

export function GroundwaterPermitDetailPanel({ detailId, onClose }: Props) {
  const [row, setRow] = useState<DetailRow | null>(null)
  const [fields, setFields] = useState<DetailFields | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openSectionIds, setOpenSectionIds] = useState<Set<string>>(
    () => new Set(DEFAULT_OPEN_SECTION_IDS)
  )
  const { highlightById, clearHighlight } = useGroundwaterPermitMapHighlight()

  const handleClose = useCallback(() => {
    clearHighlight()
    onClose()
  }, [clearHighlight, onClose])

  useEffect(() => {
    setOpenSectionIds(new Set(DEFAULT_OPEN_SECTION_IDS))
  }, [detailId])

  /** 상세 진입 시 데이터조회와 동일한 포인트 레이더 강조 */
  useEffect(() => {
    if (!detailId) return
    void highlightById(detailId)
    return () => {
      clearHighlight()
    }
  }, [detailId, highlightById, clearHighlight])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setRow(null)
    setFields(null)
    void call('', 'POST', {
      service: 'groundwaterPermitService',
      action: 'getGroundwaterPermitDetail',
      params: { id: detailId },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as {
          row?: DetailRow | null
          fields?: DetailFields | null
          error?: string
        }
        if (data?.error) {
          setError(data.error)
          setRow(null)
          setFields(null)
          return
        }
        setRow(data?.row ?? null)
        setFields(data?.fields ?? null)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setRow(null)
        setFields(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [detailId])

  const toggleSection = (sectionId: string) => {
    setOpenSectionIds((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <div className="min-w-0 flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-800">지하수 개발허가 상세</span>
          {row && (
            <span
              className={cn(
                'inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                groundwaterPermitStatusClass(row.statusCode)
              )}
            >
              {row.statusLabel}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <MapSideDetailScroll className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-2 text-xs">
        {loading && !row ? (
          <div className="px-1 py-8 text-center text-slate-500">불러오는 중…</div>
        ) : error && !row ? (
          <div className="px-1 py-8 text-center text-red-600">{error}</div>
        ) : row && fields ? (
          <>
            {GROUNDWATER_PERMIT_DETAIL_SECTIONS.map((section) => {
              const isOpen = openSectionIds.has(section.id)
              return (
                <section key={section.id} className="rounded border border-slate-200 bg-white">
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="text-[11px] font-semibold tracking-wide text-slate-700">
                      {section.title}
                      <span className="ml-1.5 font-normal text-slate-400">
                        ({section.fields.length})
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500">
                      {isOpen ? '접기' : '펼치기'}
                      <ChevronDown
                        className={cn(
                          'h-3.5 w-3.5 shrink-0 transition-transform',
                          isOpen && 'rotate-180'
                        )}
                      />
                    </span>
                  </button>
                  {isOpen && (
                    <div className="divide-y divide-slate-100 border-t border-slate-100 bg-slate-50/50">
                      {section.fields.map((field) => {
                        const value = String(fields[field.key] ?? '').trim()
                        return (
                          <div
                            key={field.key}
                            className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-2 px-2 py-1.5"
                          >
                            <dt className="shrink-0 overflow-hidden whitespace-nowrap font-medium text-slate-600">
                              {field.label}
                            </dt>
                            <dd className="min-w-0 break-words text-slate-800">{value || '—'}</dd>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              )
            })}
          </>
        ) : (
          <div className="px-1 py-8 text-center text-slate-500">항목을 찾을 수 없습니다.</div>
        )}
      </MapSideDetailScroll>
    </div>
  )
}
