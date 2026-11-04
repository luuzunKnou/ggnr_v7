'use client'

import { useMemo } from 'react'
import { X } from 'lucide-react'
import { formatDefineFieldDisplayValue } from '@/lib/defineLayerCodeDisplay'
import { MapFloatingPanel } from '../../../_mapComponents/MapFloatingPanel'
import { useMapContext } from '../../../_mapComponents/MapContext'
import {
  COMPLAINT_DETAIL_PANEL_DEFAULT_TOP,
  COMPLAINT_DETAIL_PANEL_Z_INDEX,
} from '../../../_mapComponents/complaint/complaintPanelLayout'
import {
  getDefineFieldDisplayLabel,
  getRowValueByField,
  isDefineFieldFlagTrue,
  selectDefineLayerDetailFields,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import type { WtlDefineDisplayBundle } from '../networkMap/wtlNetworkDefineDisplayCache'

export type WtlFacilityRelatedDetailRow = {
  ogcFid: number | null
  record: Record<string, unknown>
  geom: unknown | null
}

type Props = {
  title: string
  row: WtlFacilityRelatedDetailRow
  bundle: WtlDefineDisplayBundle | null
  onClose: () => void
}

function fallbackDetailFields(record: Record<string, unknown>): DefineFieldLike[] {
  return Object.keys(record)
    .filter((k) => {
      const lower = k.toLowerCase()
      return lower !== 'geom' && lower !== 'geometry' && lower !== 'the_geom'
    })
    .map((name, idx) => ({
      define_field_name: name,
      define_field_kor_name: name,
      define_field_idx: idx,
      define_field_show_detail: true,
      define_field_type: 'TEXT',
    }))
}

/** 현황 행 상세 — 플로팅 모달 */
export function WtlFacilityRelatedDetailFloating({
  title,
  row,
  bundle,
  onClose,
}: Props) {
  const mapContext = useMapContext()
  const floatingLeftPx = (mapContext?.mapPaddingLeft ?? 0) + 20

  const detailFields = useMemo(() => {
    const all = bundle?.fields ?? []
    const selected = selectDefineLayerDetailFields(all)
    if (selected.length > 0) return selected
    if (all.length > 0) {
      return all.filter((f) => {
        const name = String(f.define_field_name ?? '')
          .trim()
          .toLowerCase()
        return name && name !== 'geom'
      })
    }
    return fallbackDetailFields(row.record)
  }, [bundle?.fields, row.record])

  const codesByField = bundle?.codesByField ?? {}

  const headerTitle = useMemo(() => {
    const titleField = (bundle?.fields ?? []).find((f) =>
      isDefineFieldFlagTrue(f.define_field_show_title)
    )
    const name = String(titleField?.define_field_name ?? '').trim()
    if (name) {
      const raw = getRowValueByField(row.record, name)
      const formatted = formatDefineFieldDisplayValue(
        raw,
        titleField?.define_field_type,
        codesByField[name.toLowerCase()],
        ''
      )
      if (formatted.trim()) return `${title} · ${formatted}`
    }
    if (row.ogcFid != null) return `${title} · #${row.ogcFid}`
    return title
  }, [bundle?.fields, codesByField, row.ogcFid, row.record, title])

  return (
    <MapFloatingPanel
      viewport
      width="420px"
      maxHeight="70vh"
      style={{ zIndex: COMPLAINT_DETAIL_PANEL_Z_INDEX }}
      defaultPosition={{ top: COMPLAINT_DETAIL_PANEL_DEFAULT_TOP, left: floatingLeftPx }}
      header={
        <>
          <span
            className="min-w-0 truncate text-xs font-medium text-muted-foreground"
            title={headerTitle}
          >
            {headerTitle}
          </span>
          <button
            type="button"
            title="닫기"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      }
    >
      <div className="standard-detail-scroll min-h-0 flex-1">
        {detailFields.length === 0 ? (
          <p className="standard-detail-attr-empty">표시할 상세 필드가 없습니다.</p>
        ) : (
          <div className="standard-detail-attr-table">
            {detailFields.map((f, i) => {
              const key = String(f.define_field_name ?? '').trim()
              const label = getDefineFieldDisplayLabel(key, f.define_field_kor_name)
              const raw = getRowValueByField(row.record, key)
              const value = formatDefineFieldDisplayValue(
                raw,
                f.define_field_type,
                codesByField[key.toLowerCase()],
                '—'
              )
              return (
                <div key={key || `d-${i}`} className="contents">
                  <div className="standard-detail-attr-label standard-detail-attr-cell-border">
                    {label}
                  </div>
                  <div
                    className="standard-detail-attr-value standard-detail-attr-cell-border text-foreground"
                    title={value}
                  >
                    {value}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </MapFloatingPanel>
  )
}
