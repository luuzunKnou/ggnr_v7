'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { call } from '@/lib/api'
import { recordDataViewLog } from '@/lib/recordDataViewLog'
import { GROUNDWATER_PERMIT_DETAIL_SECTIONS } from './groundwaterPermitSections'
import { useGroundwaterPermitMapHighlight } from './useGroundwaterPermitMapHighlight'
import {
  DetailAttrRow,
  DetailAttrTable,
  LayerRowEditHeader,
  type LayerRowDetailAttr,
} from '../../_mapComponents/layerRowEdit'

type Props = {
  detailId: string
  onClose: () => void
}

type DetailFields = Record<string, string>

const NOOP = () => undefined

const DEFAULT_OPEN_SECTION_ID = GROUNDWATER_PERMIT_DETAIL_SECTIONS[0]?.id ?? 'basic'

export function GroundwaterPermitDetailPanel({ detailId, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<DetailFields | null>(null)
  const [openSectionIds, setOpenSectionIds] = useState<Set<string>>(
    () => new Set([DEFAULT_OPEN_SECTION_ID])
  )
  const { highlightById, clearHighlight } = useGroundwaterPermitMapHighlight()

  const handleClose = useCallback(() => {
    clearHighlight()
    onClose()
  }, [clearHighlight, onClose])

  useEffect(() => {
    setOpenSectionIds(new Set([DEFAULT_OPEN_SECTION_ID]))
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
    setFields(null)
    void call('', 'POST', {
      service: 'groundwaterPermitService',
      action: 'getGroundwaterPermitDetail',
      params: { id: detailId },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as {
          fields?: DetailFields | null
          error?: string
        }
        if (data?.error) {
          setError(data.error)
          setFields(null)
          return
        }
        setFields(data?.fields ?? null)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setFields(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [detailId])

  // 데이터 이력관리에 조회 저장을 위해 추가
  useEffect(() => {
    const id = String(detailId ?? '').trim()
    if (!id) return
    recordDataViewLog({
      tableName: 'SOINN00001',
      keyField: 'soinn_key',
      keyValue: id,
      serviceName: '지하수개발허가',
    })
  }, [detailId])

  const sectionAttributes = useMemo(() => {
    if (!fields) return []
    return GROUNDWATER_PERMIT_DETAIL_SECTIONS.map((section) => ({
      id: section.id,
      title: section.title,
      attributes: section.fields.map((field) => {
        const value = String(fields[field.key] ?? '').trim()
        return {
          field: field.key,
          label: field.label,
          value: value || '—',
        } satisfies LayerRowDetailAttr
      }),
    }))
  }, [fields])

  const toggleSection = (sectionId: string) => {
    setOpenSectionIds((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }

  const showBody = !loading && !error && fields != null

  return (
    <div className="flex min-h-0 h-full flex-col bg-background">
      <LayerRowEditHeader
        title="지하수 개발허가 상세"
        isEditing={false}
        saving={false}
        actionsPlacement="footer"
        onEdit={NOOP}
        onSave={NOOP}
        onCancel={handleClose}
        onClose={handleClose}
        editable={false}
      />

      <div className="min-h-0 flex-1 overflow-auto py-2 text-xs scrollbar-thin">
        {loading && (
          <div className="flex items-center gap-2 px-3 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            불러오는 중…
          </div>
        )}
        {!loading && error && (
          <div className="mx-3 rounded border border-destructive/20 bg-destructive/10 px-2 py-2 text-destructive">
            {error}
          </div>
        )}
        {showBody &&
          sectionAttributes.map((section) => {
            const isOpen = openSectionIds.has(section.id)
            return (
              <section key={section.id} className="standard-detail-section shrink-0">
                <div className="standard-detail-section-header">
                  <button
                    type="button"
                    className="standard-detail-section-toggle"
                    onClick={() => toggleSection(section.id)}
                    title={isOpen ? `${section.title} 접기` : `${section.title} 펼치기`}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? (
                      <ChevronDown className="standard-detail-section-chevron" />
                    ) : (
                      <ChevronRight className="standard-detail-section-chevron" />
                    )}
                    <span className="standard-detail-section-toggle-label">{section.title}</span>
                  </button>
                </div>
                {isOpen ? (
                  <div className="standard-detail-section-body">
                    <DetailAttrTable
                      empty={section.attributes.length === 0 ? '표시할 속성이 없습니다.' : null}
                    >
                      {section.attributes.map((row, idx) => (
                        <DetailAttrRow
                          key={row.field}
                          label={row.label}
                          isLast={idx === section.attributes.length - 1}
                        >
                          {row.value}
                        </DetailAttrRow>
                      ))}
                    </DetailAttrTable>
                  </div>
                ) : null}
              </section>
            )
          })}
        {!loading && !error && fields == null && (
          <div className="mx-3 rounded border border-dashed border-border bg-muted/50 px-2 py-3 text-muted-foreground">
            항목을 찾을 수 없습니다.
          </div>
        )}
      </div>
    </div>
  )
}
