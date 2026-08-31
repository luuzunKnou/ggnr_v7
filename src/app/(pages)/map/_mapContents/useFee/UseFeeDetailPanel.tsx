'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { call } from '@/lib/api'
import { recordDataViewLog } from '@/lib/recordDataViewLog'
import { LayerRowEditHeader, DetailAttrRow, DetailAttrSectionTitle, DetailAttrTable } from '../../_mapComponents/layerRowEdit'
import { MapHitOverlapSelect } from '../../_mapComponents/MapHitOverlapSelect'
import { useMapContext } from '../../_mapComponents/MapContext'
import { getUseFeeBinding } from '@/lib/useFeeBinding'
import { USE_FEE_DETAIL_PRIMARY_COUNT } from './useFeeFieldLabels'
import { MapSideDetailScroll } from "../../_mapComponents/MapSideDetailScroll";

type ListRow = {
  id: string
  status: string
  ledgerNo: string
  dptNm: string
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
  onSelectId?: (id: string) => void
  serEng: string
}

export function UseFeeDetailPanel({ detailId, onClose, onSelectId, serEng }: DetailProps) {
  const searchParams = useSearchParams()
  const system = String(searchParams.get('system') ?? '').trim()
  const mapContext = useMapContext()
  const hitOptions = mapContext?.useFeeMapHitOptions ?? []
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
      params: { id: detailId, system: system || undefined, serEng: serEng || undefined },
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
  }, [detailId, system, serEng])

  // 데이터 이력관리에 조회 저장을 위해 추가
  useEffect(() => {
    const id = String(detailId ?? '').trim()
    if (!id) return
    const binding = getUseFeeBinding({ serEng, system })
    recordDataViewLog({
      tableName: binding.mainTable,
      keyField: 'id',
      keyValue: id,
      serviceName: '점사용료',
    })
  }, [detailId, serEng, system])

  const visibleAttributes = expanded
    ? attributes
    : attributes.slice(0, USE_FEE_DETAIL_PRIMARY_COUNT)
  const hiddenCount = Math.max(0, attributes.length - USE_FEE_DETAIL_PRIMARY_COUNT)
  const showMoreButton = attributes.length > USE_FEE_DETAIL_PRIMARY_COUNT

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <LayerRowEditHeader
        title={headerStatus ? `점사용료 상세 · ${headerStatus}` : '점사용료 상세'}
        isEditing={false}
        saving={false}
        onEdit={() => undefined}
        onSave={() => undefined}
        onCancel={onClose}
        onClose={() => {
          mapContext?.setUseFeeMapHitOptions?.([])
          onClose()
        }}
        editable={false}
      />
      <MapHitOverlapSelect
        fieldLabel="대장번호"
        options={hitOptions}
        value={detailId}
        onChange={(id) => onSelectId?.(id)}
      />

      <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
        {loading && attributes.length === 0 ? (
          <div className="px-1 py-6 text-center text-muted-foreground">불러오는 중…</div>
        ) : error && attributes.length === 0 ? (
          <div className="px-1 py-6 text-center text-destructive">{error}</div>
        ) : (
          <>
            <DetailAttrSectionTitle>상세 속성</DetailAttrSectionTitle>
            <DetailAttrTable
              empty={visibleAttributes.length === 0 ? '표시할 속성이 없습니다.' : null}
            >
              {visibleAttributes.map((row, idx) => (
                <DetailAttrRow
                  key={row.field}
                  label={row.label}
                  isLast={idx === visibleAttributes.length - 1}
                  valueClassName={row.field.startsWith('vrActno') ? 'break-all tabular-nums' : undefined}
                >
                  {row.value}
                </DetailAttrRow>
              ))}
            </DetailAttrTable>
            {showMoreButton && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-2 w-full rounded border border-border bg-background py-1.5 text-[11px] font-medium text-primary hover:bg-muted/50"
              >
                {expanded ? '접기' : `더보기 (${hiddenCount}건)`}
              </button>
            )}
          </>
        )}

        <div className="mt-4">
          <DetailAttrSectionTitle>점용대장</DetailAttrSectionTitle>
          <div className="rounded border border-dashed border-border bg-muted/50 px-2 py-4 text-center text-muted-foreground">
            연계된 점용대장이 없습니다.
          </div>
        </div>
      </MapSideDetailScroll>
    </div>
  )
}
