'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronUp, X } from 'lucide-react'
import { call } from '@/lib/api'
import {
  formatBooleanYeobu,
  shouldUseBooleanCheckbox,
} from '@/lib/defineBooleanField'
import {
  formatDefineFieldDisplayValue,
  parseDefineBooleanValue,
} from '@/lib/defineLayerCodeDisplay'
import { cn } from '@/lib/utils'
import { MapFloatingPanel } from '../../../_mapComponents/MapFloatingPanel'
import { useMapContext } from '../../../_mapComponents/MapContext'
import { COMPLAINT_DETAIL_PANEL_DEFAULT_TOP } from '../../../_mapComponents/complaint/complaintPanelLayout'
import type { MapUiZLayer } from '@/lib/mapUiZIndex'
import {
  getDefineFieldDisplayLabel,
  getRowValueByField,
  isDefineFieldFlagTrue,
  selectDefineLayerDetailFields,
  uniqueDefineLayerFields,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import {
  loadWtlDefineDisplayBundle,
  peekWtlDefineDisplayBundle,
  type WtlDefineDisplayBundle,
} from '../networkMap/wtlNetworkDefineDisplayCache'
import { recordDataViewLog } from '@/lib/recordDataViewLog'

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
  /** 물리 테이블명 — BOOLEAN 체크박스용 DB 타입 조회 */
  table?: string | null
  schema?: string | null
  /** 데이터 이력관리 조회 서비스명 */
  serviceName?: string | null
  /** 겹침 방지용 위치·순서 오프셋(px) */
  stackOffset?: number
  /** 미지정 시 stackOffset>0 → detailRelated, 아니면 detailFloating */
  zLayer?: MapUiZLayer
  /** Search 아이콘 등 — 지정 시 해당 화면 좌표에 모달 배치 */
  anchorPosition?: { top: number; left: number } | null
  /** 다른 상세를 새로 열어도 접힘 유지 */
  collapsed: boolean
  onToggleCollapsed: () => void
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
  anchorPosition,
  zLayer,
  collapsed,
  onToggleCollapsed,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  stackOffset: number
  left: number
  anchorPosition?: { top: number; left: number } | null
  zLayer: MapUiZLayer
  collapsed: boolean
  onToggleCollapsed: () => void
  children: ReactNode
}) {
  return (
    <MapFloatingPanel
      viewport
      zLayer={zLayer}
      width="420px"
      maxHeight="70vh"
      className="bg-background backdrop-blur-none"
      defaultPosition={{
        top:
          anchorPosition?.top ??
          COMPLAINT_DETAIL_PANEL_DEFAULT_TOP + stackOffset,
        left: anchorPosition?.left ?? left,
      }}
      header={
        <>
          <button
            type="button"
            title={collapsed ? '펼치기' : '접기'}
            aria-label={collapsed ? '펼치기' : '접기'}
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
            className="standard-panel-close mr-2 cursor-pointer"
          >
            <ChevronUp
              className={cn('h-4 w-4', collapsed && 'rotate-180')}
              aria-hidden
            />
          </button>
          <div className="standard-detail-float-heading pr-2">
            <span className="standard-detail-float-layer" title={title}>
              {title}
            </span>
            {subtitle ? (
              <span className="standard-detail-float-title-below" title={subtitle}>
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
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-hidden bg-background',
          collapsed && 'hidden'
        )}
      >
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
  collapsed,
  onToggleCollapsed,
  anchorPosition = null,
  serviceName,
}: {
  target: WtlMappedFacilityTarget
  onClose: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Search 아이콘 화면 좌표 — 있으면 그 위치에 모달 오픈 */
  anchorPosition?: { top: number; left: number } | null
  /** 데이터 이력관리 조회 서비스명 */
  serviceName?: string | null
}) {
  /** 지도 기본 모달(LayerClickDetail)과 동일 티어 */
  const facilityInfoZLayer: MapUiZLayer = 'detailFloating'
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
        table={target.table}
        schema={target.schema}
        serviceName={serviceName}
        onClose={onClose}
        stackOffset={36}
        zLayer={facilityInfoZLayer}
        anchorPosition={anchorPosition}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
    )
  }

  return (
    <FloatingChrome
      title={target.title}
      onClose={onClose}
      stackOffset={36}
      left={floatingLeftPx}
      anchorPosition={anchorPosition}
      zLayer={facilityInfoZLayer}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
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
  table: tableProp,
  schema: schemaProp,
  serviceName,
  onClose,
  stackOffset = 0,
  zLayer: zLayerProp,
  anchorPosition = null,
  collapsed,
  onToggleCollapsed,
}: Props) {
  const mapContext = useMapContext()
  const floatingLeftPx = (mapContext?.mapPaddingLeft ?? 0) + 20 + stackOffset
  const zLayer: MapUiZLayer =
    zLayerProp ?? (stackOffset > 0 ? 'detailRelated' : 'detailFloating')
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({})
  const [columnTypesReady, setColumnTypesReady] = useState(false)

  const tableName = String(tableProp || bundle?.resolvedTable || '')
    .trim()
    .replace(/^.*\./, '')
    .toLowerCase()
  const schema =
    String(schemaProp ?? '')
      .trim()
      .toLowerCase() || 'layer'

  // 데이터 이력관리에 조회 저장을 위해 추가
  // 레이어명 = table prop. 키는 ogc_fid 우선( bundle 로딩으로 effect 재실행·중복 방지 )
  useEffect(() => {
    const logTable = String(tableProp ?? '')
      .trim()
      .replace(/^.*\./, '')
      .toLowerCase()
    if (!logTable) return
    let keyField = 'ogc_fid'
    let keyValue: string | null = null
    if (row.ogcFid != null && Number.isFinite(row.ogcFid)) {
      keyValue = String(row.ogcFid)
    } else if (row.record) {
      for (const f of ['ogc_fid', 'gid', 'id'] as const) {
        const v = getRowValueByField(row.record, f)
        if (v != null && String(v).trim()) {
          keyField = f
          keyValue = String(v).trim()
          break
        }
      }
    }
    if (!keyValue) return
    recordDataViewLog({
      tableName: logTable,
      keyField,
      keyValue,
      serviceName,
    })
  }, [tableProp, row.ogcFid, serviceName])

  useEffect(() => {
    if (!tableName) {
      setColumnTypes({})
      setColumnTypesReady(false)
      return
    }
    let cancelled = false
    setColumnTypesReady(false)
    void call('', 'POST', {
      service: 'layerRowService',
      action: 'listTableColumnTypes',
      params: { table: tableName, schema },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as
          | { columns?: Array<{ name?: string; dataType?: string }> }
          | undefined
        const next: Record<string, string> = {}
        for (const c of Array.isArray(data?.columns) ? data.columns : []) {
          const name = String(c?.name ?? '')
            .trim()
            .toLowerCase()
          const dataType = String(c?.dataType ?? '')
            .trim()
            .toLowerCase()
          if (name && dataType) next[name] = dataType
        }
        setColumnTypes(next)
        setColumnTypesReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setColumnTypes({})
        setColumnTypesReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [tableName, schema, row.ogcFid])

  const detailFields = useMemo(() => {
    const all = bundle?.fields ?? []
    const selected = selectDefineLayerDetailFields(all)
    if (selected.length > 0) return selected
    if (all.length > 0) {
      return uniqueDefineLayerFields(all).filter((f) => {
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
      anchorPosition={anchorPosition}
      zLayer={zLayer}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
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
              const useBoolCheck = shouldUseBooleanCheckbox(
                f.define_field_type,
                columnTypes[key.toLowerCase()],
                columnTypesReady
              )
              const boolChecked = parseDefineBooleanValue(raw)
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
                    title={
                      useBoolCheck ? formatBooleanYeobu(raw, '—') : value
                    }
                  >
                    {useBoolCheck ? (
                      <input
                        type="checkbox"
                        className="pointer-events-none h-3.5 w-3.5 accent-primary"
                        title={formatBooleanYeobu(raw, '—')}
                        aria-label={label}
                        aria-readonly="true"
                        checked={boolChecked}
                        readOnly
                        tabIndex={-1}
                        onChange={() => {}}
                      />
                    ) : (
                      value
                    )}
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
