'use client'

import { useEffect, useState } from 'react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { LayerRowEditHeader } from '../../_mapComponents/layerRowEdit'

type ListRow = {
  id: string
  status: string
  chargeNo: string
  year: string
  payer: string
  amount: string
  dueDate: string
}

type DetailAttr = {
  field: string
  label: string
  value: string
}

type DetailProps = {
  detailId: string
  onClose: () => void
}

const FEE_DETAIL_INITIAL_COUNT = 20

export function UseFeeDetailPanel({ detailId, onClose }: DetailProps) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attributes, setAttributes] = useState<DetailAttr[]>([])
  const [headerStatus, setHeaderStatus] = useState<string>('')

  useEffect(() => {
    setExpanded(false)
  }, [detailId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void call('', 'POST', {
      service: 'useFeeService',
      action: 'getUseFeeDetail',
      params: { id: detailId },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as {
          row?: ListRow | null
          attributes?: DetailAttr[]
          error?: string
        }
        if (data?.error) setError(data.error)
        setAttributes(Array.isArray(data?.attributes) ? data.attributes : [])
        setHeaderStatus(data?.row?.status ?? '')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setAttributes([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [detailId])

  const visibleAttributes = expanded
    ? attributes
    : attributes.slice(0, FEE_DETAIL_INITIAL_COUNT)
  const hiddenCount = Math.max(0, attributes.length - FEE_DETAIL_INITIAL_COUNT)
  const showMoreButton = attributes.length > FEE_DETAIL_INITIAL_COUNT

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <LayerRowEditHeader
        title={headerStatus ? `점사용료 상세 · ${headerStatus}` : '점사용료 상세'}
        isEditing={false}
        saving={false}
        onEdit={() => undefined}
        onSave={() => undefined}
        onCancel={onClose}
        onClose={onClose}
        editable={false}
      />

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 text-xs">
        {loading && attributes.length === 0 ? (
          <div className="px-1 py-6 text-center text-slate-500">불러오는 중…</div>
        ) : error && attributes.length === 0 ? (
          <div className="px-1 py-6 text-center text-red-600">{error}</div>
        ) : (
          <>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              상세 속성
            </div>
            <div className="divide-y divide-slate-100 rounded border border-slate-200 bg-slate-50/50">
              {visibleAttributes.map((row) => (
                <div
                  key={row.field}
                  className="grid grid-cols-[6.25rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 px-2 py-1.5"
                >
                  <dt className="w-[6.25rem] shrink-0 overflow-hidden whitespace-nowrap font-medium text-slate-600">
                    {row.label}
                  </dt>
                  <dd
                    className={cn(
                      'min-w-0 break-words text-slate-800',
                      row.field.startsWith('vrActno') && 'break-all tabular-nums'
                    )}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </div>
            {showMoreButton && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-2 w-full rounded border border-slate-200 bg-white py-1.5 text-[11px] font-medium text-primary hover:bg-slate-50"
              >
                {expanded ? '접기' : `더보기 (${hiddenCount}건)`}
              </button>
            )}
          </>
        )}

        <div className="mt-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            점용대장
          </div>
          <div className="rounded border border-dashed border-slate-200 bg-slate-50/80 px-2 py-4 text-center text-slate-500">
            연계된 점용대장이 없습니다.
          </div>
        </div>
      </div>
    </div>
  )
}
