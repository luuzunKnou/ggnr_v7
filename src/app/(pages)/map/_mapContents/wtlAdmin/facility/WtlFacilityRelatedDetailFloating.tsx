'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronUp, X } from 'lucide-react'
import { call } from '@/lib/api'
import { formatDefineFieldDisplayValue } from '@/lib/defineLayerCodeDisplay'
import { cn } from '@/lib/utils'
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
import {
  loadWtlDefineDisplayBundle,
  peekWtlDefineDisplayBundle,
  type WtlDefineDisplayBundle,
} from '../networkMap/wtlNetworkDefineDisplayCache'

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
  /** 겹침 방지용 위치·순서 오프셋(px) */
  stackOffset?: number
}

export type WtlMappedFacilityTarget = {
  table: string
  schema: string
  title: string
  fieldsTable?: string | null
  ftrIdn: string
}

function FloatingChrome({
  title,
  subtitle,
  onClose,
  stackOffset,
  left,
  zIndex,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  stackOffset: number
  left: number
  zIndex: number
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <MapFloatingPanel
      viewport
      width="420px"
      maxHeight="70vh"
      className="bg-background backdrop-blur-none"
      style={{ zIndex }}
      defaultPosition={{
        top: COMPLAINT_DETAIL_PANEL_DEFAULT_TOP + stackOffset,
        left,
      }}
      header={
        <>
          <div className="min-w-0 flex-1 pr-2">
            <span className="block truncate text-xs font-medium text-foreground" title={title}>
              {title}
            </span>
            {subtitle ? (
              <span
                className="mt-0.5 block truncate text-[11px] text-muted-foreground"
                title={subtitle}
              >
                {subtitle}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            title="닫기"
            onClick={onClose}
            className="standard-panel-close cursor-pointer"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        {children}
        <div className="standard-detail-edit-footer">
          <button
            type="button"
            title="닫기"
            onClick={onClose}
            className="standard-detail-hdr-btn"
          >
            닫기
          </button>
        </div>
      </div>
    </MapFloatingPanel>
  )
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

export function WtlMappedFacilityFloating({
  target,
  onClose,
}: {
  target: WtlMappedFacilityTarget
  onClose: () => void
}) {
  const [row, setRow] = useState<WtlFacilityRelatedDetailRow | null>(null)
  const [bundle, setBundle] = useState<WtlDefineDisplayBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mapContext = useMapContext()
  const floatingLeftPx = (mapContext?.mapPaddingLeft ?? 0) + 56

  useEffect(() => {
    if (!target.ftrIdn) {
      setRow(null)
      setBundle(null)
      setError('관리번호를 찾을 수 없습니다.')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setRow(null)
    const fieldsTable = String(target.fieldsTable ?? target.table).trim() || target.table
    const peeked = peekWtlDefineDisplayBundle(fieldsTable, null)
    if (peeked) setBundle(peeked)
    else {
      void loadWtlDefineDisplayBundle(fieldsTable, null).then((b) => {
        if (!cancelled) setBundle(b)
      })
    }
    void call('', 'POST', {
      service: 'wtlFacilityService',
      action: 'listFacilityRows',
      params: {
        table: target.table,
        schema: target.schema || 'layer',
        ftrIdn: target.ftrIdn,
        limit: 1,
        offset: 0,
      },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as
          | { rows?: WtlFacilityRelatedDetailRow[] }
          | undefined
        const found = Array.isArray(data?.rows) ? data.rows[0] : undefined
        if (!found) {
          setRow(null)
          setError(`${target.title}을 찾을 수 없습니다.`)
          return
        }
        setRow(found)
      })
      .catch(() => {
        if (cancelled) return
        setRow(null)
        setError(`${target.title}을 불러오지 못했습니다.`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [target.ftrIdn, target.schema, target.table, target.title])

  if (!loading && row) {
    return (
      <WtlFacilityRelatedDetailFloating
        title={target.title}
        row={row}
        bundle={bundle}
        onClose={onClose}
        stackOffset={36}
      />
    )
  }

  return (
    <FloatingChrome
      title={target.title}
      onClose={onClose}
      stackOffset={36}
      left={floatingLeftPx}
      zIndex={COMPLAINT_DETAIL_PANEL_Z_INDEX + 2}
    >
      <div className="standard-detail-scroll">
        {loading ? (
          <p className="standard-detail-loading">조회 중…</p>
        ) : (
          <p className="standard-detail-error">{error}</p>
        )}
      </div>
    </FloatingChrome>
  )
}

/** 현황 행 상세 — 플로팅 모달 */
export function WtlFacilityRelatedDetailFloating({
  title,
  row,
  bundle,
  onClose,
  stackOffset = 0,
}: Props) {
  const mapContext = useMapContext()
  const floatingLeftPx = (mapContext?.mapPaddingLeft ?? 0) + 20 + stackOffset

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

  const subtitle = useMemo(() => {
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
      if (formatted.trim()) return formatted
    }
    if (row.ogcFid != null) return `#${row.ogcFid}`
    return ''
  }, [bundle?.fields, codesByField, row.ogcFid, row.record])

  return (
    <FloatingChrome
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      stackOffset={stackOffset}
      left={floatingLeftPx}
      zIndex={COMPLAINT_DETAIL_PANEL_Z_INDEX + (stackOffset > 0 ? 2 : 0)}
    >
      <div className="standard-detail-scroll">
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
                    className={cn(
                      'standard-detail-attr-value standard-detail-attr-cell-border text-foreground',
                      isDefineFieldFlagTrue(f.define_field_show_title) &&
                        'standard-detail-attr-value-title'
                    )}
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
    </FloatingChrome>
  )
}
