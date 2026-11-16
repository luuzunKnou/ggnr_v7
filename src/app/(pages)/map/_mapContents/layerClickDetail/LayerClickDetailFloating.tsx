'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Crosshair } from 'lucide-react'
import { formatDefineFieldDisplayValue } from '@/lib/defineLayerCodeDisplay'
import { MapDetailFloatingPanel } from '../../_mapComponents/MapDetailFloatingPanel'
import {
  MAP_DETAIL_FLOAT_MINIMIZED_WIDTH,
  computeMapDetailDockPin,
} from '../../_mapComponents/mapDetailFloatingDock'
import {
  getDefineFieldDisplayLabel,
  getRowValueByField,
  isGeomLikeDefineFieldName,
  selectDefineLayerListFields,
  type DefineFieldLike,
} from '../../_mapComponents/standard/defineLayerRowUtils'
import { useDefineLayerCodes } from '../../_mapComponents/standard/useDefineLayerCodes'
import { useMapContext } from '../../_mapComponents/MapContext'
import { centerMapOnWtlNetworkGeom } from '../wtlAdmin/networkMap/wtlNetworkMapFly'
import type { LayerClickHit } from './useLayerClickDetail'
import { claimMapLayerClickDetailHighlight } from '@/lib/mapLayerClickDetailHighlight'
import {
  pickLayerClickHitGeom,
  useLayerClickDetailMapHighlight,
} from './useLayerClickDetailMapHighlight'

const DETAIL_WIDTH = 'min(420px, calc(100vw - 2rem))'
const DETAIL_MAX_HEIGHT = '70vh'

type Props = {
  open: boolean
  hits: LayerClickHit[]
  selected: LayerClickHit | null
  minimized: boolean
  onMinimizedChange: (minimized: boolean) => void
  focusToken?: number
  /** 클릭 화면 좌표 (없으면 좌측 기본) */
  anchorLeftPx: number
  anchorTopPx?: number
  viewportW: number
  viewportH: number
  onSelectHit: (key: string) => void
  onClose: () => void
  onActivate?: () => void
}

function hitLabel(hit: LayerClickHit): string {
  const title = hit.titleValue || '—'
  return hit.korName ? `${hit.korName} — ${title}` : title
}

export function LayerClickDetailFloating({
  open,
  hits,
  selected,
  minimized,
  onMinimizedChange,
  focusToken = 0,
  anchorLeftPx,
  anchorTopPx = 72,
  viewportW,
  viewportH,
  onSelectHit,
  onClose,
  onActivate,
}: Props) {
  const mapContext = useMapContext()
  useLayerClickDetailMapHighlight(open ? selected : null)

  const handleActivate = () => {
    const map = mapContext?.mapInstanceRef?.current
    if (map) claimMapLayerClickDetailHighlight(map, 'layerClickDetail')
    onActivate?.()
  }

  const tableName = selected ? String(selected.tableName ?? '').trim() : ''
  const fieldsTableKey = selected
    ? String(selected.fieldsTable ?? selected.tableName ?? '').trim()
    : ''
  const [fields, setFields] = useState<DefineFieldLike[]>([])
  const [fieldsLoading, setFieldsLoading] = useState(false)
  const [fieldsTable, setFieldsTable] = useState('')

  useEffect(() => {
    if (!open || !fieldsTableKey) {
      setFields([])
      setFieldsTable('')
      setFieldsLoading(false)
      return
    }
    let cancelled = false
    setFieldsLoading(true)
    setFieldsTable(fieldsTableKey)
    void fetch(`/api/config/defineLayer/fields/${encodeURIComponent(fieldsTableKey)}`)
      .then((r) => r.json())
      .then((body: { data?: DefineFieldLike[] }) => {
        if (cancelled) return
        setFields(Array.isArray(body?.data) ? body.data : [])
      })
      .catch(() => {
        if (!cancelled) setFields([])
      })
      .finally(() => {
        if (!cancelled) setFieldsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, fieldsTableKey])

  const listFields = useMemo(() => selectDefineLayerListFields(fields), [fields])
  const codeFallback =
    tableName && fieldsTable && tableName.toLowerCase() !== fieldsTable.toLowerCase()
      ? tableName
      : null
  const codesByField = useDefineLayerCodes(
    fieldsTable || null,
    (listFields.length > 0 ? listFields : fields) as Array<{
      define_field_name?: string
      define_field_type?: unknown
    }>,
    { fallbackTableName: codeFallback }
  )

  const pinPosition = useMemo(() => {
    if (!minimized) return null
    return computeMapDetailDockPin({
      dockIndex: 0,
      dockLeftStart: Math.max(8, anchorLeftPx),
      viewportW,
      viewportH,
    })
  }, [minimized, anchorLeftPx, viewportW, viewportH])

  const attrRows = useMemo(() => {
    if (!selected) return [] as { key: string; label: string; value: string }[]
    const record = selected.data
    if (listFields.length > 0) {
      return listFields.map((f, i) => {
        const key = String(f.define_field_name ?? '').trim() || `f-${i}`
        const label = getDefineFieldDisplayLabel(key, f.define_field_kor_name)
        const raw = getRowValueByField(record, key)
        const value = formatDefineFieldDisplayValue(
          raw,
          f.define_field_type,
          codesByField[key.toLowerCase()],
          '—'
        )
        return { key, label, value }
      })
    }
    if (fieldsLoading) return []
    return Object.entries(record)
      .filter(([k]) => !isGeomLikeDefineFieldName(k) && k.toLowerCase() !== 'gid')
      .map(([k, v], i) => ({
        key: k || `auto-${i}`,
        label: getDefineFieldDisplayLabel(k),
        value: formatDefineFieldDisplayValue(v, undefined, undefined, '—'),
      }))
  }, [selected, listFields, codesByField, fieldsLoading])

  const handleGoToLocation = () => {
    if (!selected) return
    const map = mapContext?.mapInstanceRef?.current
    const geom = pickLayerClickHitGeom(selected.data)
    centerMapOnWtlNetworkGeom(map, geom, () =>
      mapContext?.applyMapViewPaddingRef?.current?.()
    )
  }

  if (!open || !selected) return null

  const multi = hits.length > 1
  const hitIndex = multi ? hits.findIndex((h) => h.key === selected.key) : -1
  const multiHitMinimized = minimized && multi
  const firstHitLayerKor = multiHitMinimized
    ? String(hits[0]?.korName ?? '').trim() || selected.korName || '레이어'
    : ''
  const titleLine = multiHitMinimized
    ? `${firstHitLayerKor || '레이어'} 외 ${hits.length - 1}건`
    : selected.titleValue || selected.korName || '상세보기'
  const showLayer =
    !multiHitMinimized && Boolean(selected.korName && selected.korName !== titleLine)

  const selectHitByKey = (nextKey: string | undefined) => {
    if (!nextKey || nextKey === selected.key) return
    onSelectHit(nextKey)
  }

  return (
    <MapDetailFloatingPanel
      layer={showLayer ? selected.korName : null}
      title={titleLine}
      minimized={minimized}
      onMinimizedChange={onMinimizedChange}
      allowMinimize={false}
      onClose={onClose}
      pinPosition={pinPosition}
      focusToken={focusToken}
      onActivate={handleActivate}
      width={DETAIL_WIDTH}
      minimizedWidth={MAP_DETAIL_FLOAT_MINIMIZED_WIDTH}
      maxHeight={DETAIL_MAX_HEIGHT}
      defaultPosition={{ top: anchorTopPx, left: anchorLeftPx }}
      hideHeading={multi}
      headerLeading={
        multi ? (
          <>
            <select
              className="h-7 min-w-0 max-w-[14rem] flex-1 cursor-pointer rounded border border-border bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-primary"
              value={selected.key}
              title="상세보기 선택"
              aria-label="상세보기 선택"
              onChange={(e) => {
                selectHitByKey(e.target.value)
              }}
            >
              {hits.map((hit) => (
                <option key={hit.key} value={hit.key}>
                  {hitLabel(hit)}
                </option>
              ))}
            </select>
            <button
              type="button"
              title="이전"
              aria-label="이전 상세"
              disabled={hitIndex <= 0}
              onClick={() => selectHitByKey(hits[hitIndex - 1]?.key)}
              className="standard-panel-close cursor-pointer disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              title="다음"
              aria-label="다음 상세"
              disabled={hitIndex < 0 || hitIndex >= hits.length - 1}
              onClick={() => selectHitByKey(hits[hitIndex + 1]?.key)}
              className="standard-panel-close cursor-pointer disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </>
        ) : null
      }
      headerActions={
        multi ? (
          <span
            className="shrink-0 px-1 text-[11px] tabular-nums text-muted-foreground"
            title={`${hits.length}건 선택됨`}
          >
            {hits.length}건 선택됨
          </span>
        ) : null
      }
    >
      <div className="standard-detail-scroll">
        {fieldsLoading ? (
          <p className="standard-detail-loading">필드 설정 불러오는 중…</p>
        ) : attrRows.length === 0 ? (
          <p className="standard-detail-attr-empty">표시할 속성이 없습니다.</p>
        ) : (
          <table className="standard-detail-attr-table">
            <tbody>
              {attrRows.map((row) => (
                <tr key={row.key}>
                  <th
                    scope="row"
                    className="standard-detail-attr-label standard-detail-attr-cell-border"
                    title={row.label}
                  >
                    {row.label}
                  </th>
                  <td
                    className="standard-detail-attr-value standard-detail-attr-cell-border text-foreground"
                    title={row.value}
                  >
                    {row.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="standard-detail-edit-footer justify-start">
        <button
          type="button"
          title="위치 이동"
          aria-label="위치 이동"
          onClick={handleGoToLocation}
          className="standard-detail-hdr-btn cursor-pointer"
        >
          <Crosshair className="h-3.5 w-3.5" aria-hidden />
          위치 이동
        </button>
      </div>
    </MapDetailFloatingPanel>
  )
}