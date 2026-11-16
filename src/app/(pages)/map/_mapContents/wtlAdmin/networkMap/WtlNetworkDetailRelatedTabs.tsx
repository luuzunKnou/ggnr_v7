'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Gauge, History, Paperclip } from 'lucide-react'
import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style'
import { call } from '@/lib/api'
import { formatDefineFieldDisplayValue } from '@/lib/defineLayerCodeDisplay'
import { cn } from '@/lib/utils'
import { loadWimsStatus } from '@/app/(pages)/map/_mapComponents/landInfo/wimsClient'
import { useMapContext } from '../../../_mapComponents/MapContext'
import {
  getDefineFieldDisplayLabel,
  getRowValueByField,
  selectDefineLayerListFields,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import { WtlFacilityDataHistoryTab } from '../facility/WtlFacilityDataHistoryTab'
import {
  resolveWtlNetworkRowKeyTarget,
  WtlNetworkMapAttachmentSection,
} from './WtlNetworkMapAttachmentSection'
import {
  loadWtlDefineDisplayBundle,
  peekWtlDefineDisplayBundle,
  type WtlDefineDisplayBundle,
} from './wtlNetworkDefineDisplayCache'
import { flyToWtlNetworkGeom } from './wtlNetworkMapFly'
import {
  isWtlMetaPsLayer,
  WtlNetworkWimsHistoryTab,
} from './WtlNetworkWimsHistoryTab'
import type { WtlNetworkRow } from './wtlNetworkTypes'

export type WtlNetworkDetailRelatedOverlay = {
  table: string
  ftrIdn: string
} | null

type RelatedTabDef = {
  table: string
  defineTable: string
  label: string
}

type RelatedRow = {
  ogcFid: number | null
  record: Record<string, unknown>
  geom: unknown | null
}

type Props = {
  item: WtlNetworkRow
  fields: DefineFieldLike[]
  onRelatedMapLayer: (next: WtlNetworkDetailRelatedOverlay) => void
  /** 데이터 이력 되돌리기 후 상세·목록 갱신 */
  onHistoryReverted?: () => void
}

type ActiveTab = 'attach' | 'dataHistory' | 'wimsHistory' | string

function resolveOgcFid(item: WtlNetworkRow): number | null {
  const record = item.record
  if (record) {
    const fromRecord = getRowValueByField(record, 'ogc_fid')
    const n = Number(fromRecord)
    if (Number.isFinite(n)) return n
  }
  const raw = String(item.id ?? '').trim()
  const tail = raw.includes(':') ? Number(raw.slice(raw.lastIndexOf(':') + 1)) : Number.NaN
  return Number.isFinite(tail) ? tail : null
}

const RELATED_ROW_HIGHLIGHT = new Style({
  image: new CircleStyle({
    radius: 9,
    fill: new Fill({ color: 'rgba(37, 99, 235, 0.85)' }),
    stroke: new Stroke({ color: '#fff', width: 2 }),
  }),
  stroke: new Stroke({ color: 'rgba(37, 99, 235, 0.95)', width: 2 }),
  fill: new Fill({ color: 'rgba(37, 99, 235, 0.2)' }),
})

function resolveParentFtrIdn(item: WtlNetworkRow): string {
  const record = item.record
  if (record) {
    const fromRecord = getRowValueByField(record, 'ftr_idn')
    if (fromRecord != null && String(fromRecord).trim()) {
      return String(fromRecord).trim()
    }
  }
  const name = String(item.name ?? '').trim()
  return name
}

export function WtlNetworkDetailRelatedTabs({
  item,
  fields,
  onRelatedMapLayer,
  onHistoryReverted,
}: Props) {
  const mapContext = useMapContext()
  const parentKey = useMemo(() => {
    const fromLayer = String(item.layerKey ?? '')
      .trim()
      .toLowerCase()
    if (fromLayer === 'wtl_pres_ps' || fromLayer === 'wtl_puri_as') return fromLayer
    const fromFields = String(item.fieldsTable ?? '')
      .trim()
      .toLowerCase()
    if (fromFields === 'wtl_pres_ps' || fromFields === 'wtl_puri_as') return fromFields
    return fromLayer
  }, [item.layerKey, item.fieldsTable])

  const itemId = String(item.id ?? '')
  const ftrIdn = resolveParentFtrIdn(item)
  const [wimsEnabled, setWimsEnabled] = useState(false)
  const showWimsTab = isWtlMetaPsLayer(item) && wimsEnabled

  useEffect(() => {
    let alive = true
    void loadWimsStatus().then((status) => {
      if (!alive) return
      setWimsEnabled(status.enabled)
    })
    return () => {
      alive = false
    }
  }, [])

  const historySourceRow = useMemo(() => {
    const keyTarget = resolveWtlNetworkRowKeyTarget(item, fields)
    return {
      id: itemId,
      record: item.record ?? {},
      tableName: keyTarget?.table ?? item.fieldsTable ?? null,
      fieldsTable: item.fieldsTable ?? null,
      ogcFid: resolveOgcFid(item),
    }
  }, [item, itemId, fields])

  const onRelatedMapLayerRef = useRef(onRelatedMapLayer)
  onRelatedMapLayerRef.current = onRelatedMapLayer

  const [relatedTabs, setRelatedTabs] = useState<RelatedTabDef[]>([])
  const [active, setActive] = useState<ActiveTab>('')
  const [tabSelectEpoch, setTabSelectEpoch] = useState(0)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [listRows, setListRows] = useState<RelatedRow[]>([])
  const [listTotal, setListTotal] = useState(0)
  const [listBundle, setListBundle] = useState<WtlDefineDisplayBundle | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const highlightSourceRef = useRef<VectorSource | null>(null)

  const activeRelated = useMemo(
    () => relatedTabs.find((t) => t.table === active) ?? null,
    [relatedTabs, active]
  )
  const activeTable = activeRelated?.table ?? ''
  const activeDefineTable = activeRelated?.defineTable ?? ''

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      style: RELATED_ROW_HIGHLIGHT,
      zIndex: 920,
    })
    layer.set('wtlNetworkRelatedRowHighlight', true)
    map.addLayer(layer)
    highlightSourceRef.current = source
    return () => {
      map.removeLayer(layer)
      highlightSourceRef.current = null
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  const clearRowHighlight = useCallback(() => {
    highlightSourceRef.current?.clear()
    setSelectedIdx(null)
  }, [])

  const focusParentOnMap = useCallback(() => {
    const map = mapContext?.mapInstanceRef?.current
    flyToWtlNetworkGeom(
      map,
      item.geom,
      () => mapContext?.applyMapViewPaddingRef?.current?.()
    )
  }, [item.geom, mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef])

  const handleRowClick = useCallback(
    (row: RelatedRow, idx: number) => {
      if (selectedIdx === idx) {
        clearRowHighlight()
        focusParentOnMap()
        return
      }
      setSelectedIdx(idx)
      const map = mapContext?.mapInstanceRef?.current
      const source = highlightSourceRef.current
      source?.clear()
      if (row.geom && map && source) {
        try {
          const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857'
          const features = new GeoJSON().readFeatures(
            {
              type: 'FeatureCollection',
              features: [{ type: 'Feature', geometry: row.geom, properties: {} }],
            },
            { dataProjection: 'EPSG:4326', featureProjection: viewProj }
          )
          if (features.length > 0) source.addFeatures(features)
        } catch {
          /* ignore */
        }
        flyToWtlNetworkGeom(
          map,
          row.geom,
          () => mapContext?.applyMapViewPaddingRef?.current?.()
        )
      }
    },
    [
      clearRowHighlight,
      focusParentOnMap,
      mapContext?.applyMapViewPaddingRef,
      mapContext?.mapInstanceRef,
      selectedIdx,
    ]
  )

  useEffect(() => {
    let cancelled = false
    setRelatedTabs([])
    setActive('')
    setTabSelectEpoch((n) => n + 1)
    setListRows([])
    setListTotal(0)
    setListBundle(null)
    setListError(null)
    setListLoading(false)
    clearRowHighlight()
    onRelatedMapLayerRef.current(null)

    if (!parentKey || (parentKey !== 'wtl_pres_ps' && parentKey !== 'wtl_puri_as')) {
      return () => {
        cancelled = true
      }
    }

    void call('', 'POST', {
      service: 'wtlNetworkService',
      action: 'listWtlNetworkRelatedChildTables',
      params: { parentLayerKey: parentKey },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as { tabs?: RelatedTabDef[] } | undefined
        const raw = Array.isArray(data?.tabs) ? data.tabs : []
        const tabs = raw
          .map((t) => {
            const table = String(t.table ?? '')
              .trim()
              .toLowerCase()
            const defineTable =
              String(t.defineTable ?? '')
                .trim()
                .toLowerCase() || table
            return {
              table,
              defineTable,
              label: String(t.label ?? '').trim() || table,
            }
          })
          .filter((t) => t.table)
        setRelatedTabs(tabs)
        setTabSelectEpoch((n) => n + 1)
      })
      .catch(() => {
        if (!cancelled) {
          setRelatedTabs([])
          setTabSelectEpoch((n) => n + 1)
        }
      })

    return () => {
      cancelled = true
      onRelatedMapLayerRef.current(null)
    }
  }, [parentKey, itemId, clearRowHighlight])

  const tabItems = useMemo(() => {
    const out: { id: ActiveTab; label: string }[] = [
      { id: 'attach', label: '첨부파일' },
    ]
    for (const tab of relatedTabs) {
      out.push({ id: tab.table, label: tab.label })
    }
    if (showWimsTab) {
      out.push({ id: 'wimsHistory', label: 'WIMS 검침 이력' })
    }
    out.push({ id: 'dataHistory', label: '데이터 이력관리' })
    return out
  }, [relatedTabs, showWimsTab])

  useEffect(() => {
    const first = tabItems[0]?.id
    if (!first) return
    setActive(first)
    // 행·연관탭 전환(epoch) 시에만 첫 탭으로 맞춤
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tabSelectEpoch
  }, [tabSelectEpoch])

  useEffect(() => {
    const first = tabItems[0]?.id
    if (!first) return
    if (!tabItems.some((t) => t.id === active)) {
      setActive(first)
    }
  }, [tabItems, active])

  useEffect(() => {
    if (
      active === 'attach' ||
      active === 'dataHistory' ||
      active === 'wimsHistory' ||
      !activeTable ||
      !ftrIdn
    ) {
      onRelatedMapLayerRef.current(null)
      return
    }
    onRelatedMapLayerRef.current({ table: activeTable, ftrIdn })
  }, [active, activeTable, ftrIdn])

  useEffect(() => {
    clearRowHighlight()
    if (
      active === 'attach' ||
      active === 'dataHistory' ||
      active === 'wimsHistory' ||
      !activeTable ||
      !ftrIdn
    ) {
      setListRows((prev) => (prev.length === 0 ? prev : []))
      setListTotal((prev) => (prev === 0 ? prev : 0))
      setListBundle((prev) => (prev == null ? prev : null))
      setListError((prev) => (prev == null ? prev : null))
      setListLoading((prev) => (prev ? false : prev))
      return
    }

    let cancelled = false
    setListLoading(true)
    setListError(null)
    setListRows([])
    setListTotal(0)

    const defineTable = activeDefineTable || activeTable
    const peeked = peekWtlDefineDisplayBundle(defineTable, null)
    if (peeked) setListBundle(peeked)

    void Promise.all([
      call('', 'POST', {
        service: 'wtlNetworkService',
        action: 'listWtlNetworkRelatedChildRows',
        params: {
          table: activeTable,
          defineTable,
          ftrIdn,
          limit: 200,
        },
      }),
      peeked
        ? Promise.resolve(peeked)
        : loadWtlDefineDisplayBundle(defineTable, null),
    ])
      .then(([res, bundle]) => {
        if (cancelled) return
        const data = (res?.data ?? res) as
          | { rows?: RelatedRow[]; total?: number }
          | undefined
        const rows = Array.isArray(data?.rows)
          ? data.rows.map((r) => ({
              ogcFid:
                r.ogcFid != null && Number.isFinite(Number(r.ogcFid))
                  ? Number(r.ogcFid)
                  : null,
              record:
                r.record && typeof r.record === 'object'
                  ? (r.record as Record<string, unknown>)
                  : {},
              geom: r.geom ?? null,
            }))
          : []
        setListRows(rows)
        setListTotal(Number(data?.total ?? rows.length) || rows.length)
        setListBundle(bundle)
      })
      .catch(() => {
        if (cancelled) return
        setListRows([])
        setListTotal(0)
        setListError('목록을 불러오지 못했습니다.')
      })
      .finally(() => {
        if (!cancelled) setListLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [active, activeTable, activeDefineTable, ftrIdn, clearRowHighlight])

  const listFields = useMemo(() => {
    const all = listBundle?.fields ?? []
    const selected = selectDefineLayerListFields(all)
    if (selected.length > 0) return selected
    return all.filter((f) => {
      const name = String(f.define_field_name ?? '')
        .trim()
        .toLowerCase()
      return name && name !== 'geom' && name !== 'ogc_fid'
    })
  }, [listBundle])

  const codesByField = listBundle?.codesByField ?? {}

  return (
    <div className="flex shrink-0 flex-col border-t border-border">
      <div className="flex shrink-0 overflow-x-auto border-b border-border px-2">
        <button
          type="button"
          title="첨부파일"
          className={cn(
            'inline-flex h-9 w-[5.5rem] shrink-0 cursor-pointer items-center justify-center gap-1 border-b-2 px-2 text-[11px] font-medium pointer-events-auto',
            active === 'attach'
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
          onClick={() => setActive('attach')}
        >
          <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">첨부파일</span>
        </button>
        {relatedTabs.map((tab) => (
          <button
            key={tab.table}
            type="button"
            title={tab.label}
            className={cn(
              'inline-flex h-9 w-[5.5rem] shrink-0 cursor-pointer items-center justify-center gap-1 border-b-2 px-2 text-[11px] font-medium pointer-events-auto',
              active === tab.table
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            )}
            onClick={() => setActive(tab.table)}
          >
            <span className="truncate">{tab.label}</span>
          </button>
        ))}
        {showWimsTab ? (
          <button
            type="button"
            title="WIMS 검침 이력"
            className={cn(
              'inline-flex h-9 min-w-[7.5rem] shrink-0 cursor-pointer items-center justify-center gap-1 border-b-2 px-2 text-[11px] font-medium pointer-events-auto',
              active === 'wimsHistory'
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            )}
            onClick={() => setActive('wimsHistory')}
          >
            <Gauge className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">WIMS 검침 이력</span>
          </button>
        ) : null}
        <button
          type="button"
          title="데이터 이력관리"
          className={cn(
            'inline-flex h-9 min-w-[7.5rem] shrink-0 cursor-pointer items-center justify-center gap-1 border-b-2 px-2 text-[11px] font-medium pointer-events-auto',
            active === 'dataHistory'
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
          onClick={() => setActive('dataHistory')}
        >
          <History className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">데이터 이력관리</span>
        </button>
      </div>
      <div className="h-[250px] shrink-0 overflow-hidden px-3 pb-2 pt-1">
        {active === 'attach' ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
            <WtlNetworkMapAttachmentSection item={item} fields={fields} />
          </div>
        ) : active === 'wimsHistory' ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
            <WtlNetworkWimsHistoryTab item={item} />
          </div>
        ) : active === 'dataHistory' ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
            <WtlFacilityDataHistoryTab
              row={historySourceRow}
              fields={fields}
              serEng="wtlNetworkMap"
              onReverted={onHistoryReverted}
            />
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex shrink-0 items-center justify-end px-2 py-1">
              <span className="text-[11px] text-muted-foreground">
                {listLoading ? '조회 중…' : `${listTotal}건`}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {listLoading ? (
                <p className="standard-detail-loading px-2 py-3">목록 불러오는 중…</p>
              ) : listError ? (
                <p className="px-2 py-3 text-xs text-destructive">{listError}</p>
              ) : !ftrIdn ? (
                <p className="standard-table-empty">
                  관리번호를 찾을 수 없어 목록을 표시하지 않습니다.
                </p>
              ) : listRows.length === 0 ? (
                <p className="standard-table-empty">해당 현황 데이터가 없습니다.</p>
              ) : listFields.length === 0 ? (
                <p className="standard-table-empty">표시할 필드가 없습니다.</p>
              ) : (
                <table className="standard-list-table">
                  <thead className="standard-table-thead border-t border-border">
                    <tr>
                      {listFields.map((f, i) => {
                        const key = String(f.define_field_name ?? '').trim()
                        return (
                          <th
                            key={key || `h-${i}`}
                            className="standard-table-th standard-table-th-left"
                            title={getDefineFieldDisplayLabel(
                              key,
                              f.define_field_kor_name
                            )}
                          >
                            {getDefineFieldDisplayLabel(key, f.define_field_kor_name)}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {listRows.map((row, ri) => (
                      <tr
                        key={row.ogcFid ?? `r-${ri}`}
                        className={cn(
                          'standard-list-row',
                          selectedIdx === ri && 'standard-list-row-selected'
                        )}
                        title="지도에서 위치 확인"
                        onClick={() => handleRowClick(row, ri)}
                      >
                        {listFields.map((f, fi) => {
                          const key = String(f.define_field_name ?? '').trim()
                          const raw = getRowValueByField(row.record, key)
                          const value = formatDefineFieldDisplayValue(
                            raw,
                            f.define_field_type,
                            codesByField[key.toLowerCase()],
                            '—'
                          )
                          return (
                            <td
                              key={`${row.ogcFid ?? ri}-${key || fi}`}
                              className="standard-table-td-compact"
                              title={value}
                            >
                              {value}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
