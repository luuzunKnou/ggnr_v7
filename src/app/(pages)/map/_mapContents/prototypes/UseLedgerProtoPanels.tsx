'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plus, Search, Trash2, X } from 'lucide-react'
import WKT from 'ol/format/WKT'
import Feature from 'ol/Feature'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style } from 'ol/style'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../_mapComponents/MapContext'
import {
  LAYER_ROW_NEW_ID,
  LayerParcelAddModal,
  LayerRowAddButton,
  LayerRowAttributeSection,
  LayerRowEditHeader,
  LayerRowEditFooter,
  LayerRowPanelButton,
  useLayerParcelNavigation,
  type LayerRowDetailAttr,
  type LayerRowParcelItem,
} from '../../_mapComponents/layerRowEdit'
import { LAYER_ROW_GEOM_CLEAR_SENTINEL } from '../../_mapComponents/layerRowEdit/LayerRowGeomEditHandler'
import {
  fitMapToLayerRowParcel,
  getParcelExtent3857,
} from '../../_mapComponents/layerRowEdit/layerRowParcelUtils'
import { resolveParcelGeoms } from '../../_mapComponents/layerRowEdit/resolveParcelGeoms'
import { ROAD_USE_LEDGER_JIJUK_WMS_LAYER_ID } from '../road/roadUseLedger/roadUseLedgerLayerId'
import { RoadUseLedgerAnalysisModal } from '../road/roadUseLedger/RoadUseLedgerAnalysisModal'
import {
  PROTO_LEDGERS,
  buildProtoParcelDetails,
  feesForLedger,
  formatProtoLedgerListPlace,
  ledgerTypeLabel,
  PROTO_PROPERTY_LONLAT,
  resolveProtoLedgerType,
  type ProtoFeeRow,
  type ProtoLedgerRow,
  type ProtoLedgerType,
  type ProtoParcelDetail,
} from './dummyData'
import { flyToProtoLedger } from './protoMapNavigation'

function emptyLedger(type: ProtoLedgerType): ProtoLedgerRow {
  return {
    id: 'NEW',
    type,
    manageCode: '',
    name: '',
    permitNo: '',
    permitDate: '',
    place: '',
    purpose: '',
    area: '',
    startDate: '',
    endDate: '',
    roadType: type === 'road' ? '' : undefined,
    routeNo: type === 'road' ? '' : undefined,
    riverType: type === 'river' ? '' : undefined,
    riverCode: type === 'river' ? '' : undefined,
    riverName: type === 'river' ? '' : undefined,
    riverGrade: type === 'river' ? '' : undefined,
    landCategory: type === 'publicLand' ? '' : undefined,
    publicKind: type === 'publicLand' ? '' : undefined,
    parcels: [],
    properties: [],
    mapped: true,
  }
}

/** 공통 + 유형별 상세 속성 (필드 정의) */
export function ledgerToAttributes(row: ProtoLedgerRow): LayerRowDetailAttr[] {
  const common: LayerRowDetailAttr[] = [
    { field: 'manageCode', label: '관리코드', value: row.manageCode },
    { field: 'permitNo', label: '허가번호', value: row.permitNo },
    { field: 'permitDate', label: '허가일', value: row.permitDate },
    { field: 'name', label: '점용명', value: row.name },
    { field: 'place', label: '점용장소', value: row.place },
    { field: 'area', label: '점용면적', value: row.area ? `${row.area} m²` : '' },
    { field: 'purpose', label: '점용목적', value: row.purpose },
    { field: 'startDate', label: '점용시작일', value: row.startDate },
    { field: 'endDate', label: '점용종료일', value: row.endDate },
  ]

  if (row.type === 'road') {
    return [
      ...common,
      { field: 'roadType', label: '도로종류', value: row.roadType ?? '' },
      { field: 'routeNo', label: '노선번호', value: row.routeNo ?? '' },
    ]
  }
  if (row.type === 'river') {
    return [
      ...common,
      { field: 'riverType', label: '하천유형', value: row.riverType ?? '' },
      { field: 'riverCode', label: '하천코드', value: row.riverCode ?? '' },
      { field: 'riverName', label: '하천명', value: row.riverName ?? '' },
      { field: 'riverGrade', label: '하천등급', value: row.riverGrade ?? '' },
    ]
  }
  return [
    ...common,
    { field: 'landCategory', label: '지목', value: row.landCategory ?? '' },
    { field: 'publicKind', label: '구분', value: row.publicKind ?? '' },
  ]
}

const PROTO_PROPERTY_POINTS_4326 = PROTO_PROPERTY_LONLAT

function toParcelItems(addresses: string[]): LayerRowParcelItem[] {
  return addresses.map((address) => ({ address, extent3857: null }))
}

function parcelItemsFromRow(row: ProtoLedgerRow): LayerRowParcelItem[] {
  const details =
    row.parcelDetails?.length
      ? row.parcelDetails
      : buildProtoParcelDetails(row.parcels, row.extent3857)
  if (details?.length) {
    return details.map((d) => ({
      address: d.address,
      pnu: d.pnu,
      extent3857: d.extent3857 ?? null,
      geometry3857: d.geometry3857 ?? undefined,
      showMapGeom: d.showMapGeom,
    }))
  }
  return toParcelItems(row.parcels)
}

function parcelDetailsFromItems(items: LayerRowParcelItem[]): ProtoParcelDetail[] {
  return items.map((p) => ({
    address: p.address,
    pnu: p.pnu,
    extent3857: p.extent3857,
    geometry3857: p.geometry3857 ?? null,
    showMapGeom: p.showMapGeom,
  }))
}

function toPropertyItems(addresses: string[]): LayerRowParcelItem[] {
  return addresses.map((address, i) => {
    const pt = PROTO_PROPERTY_POINTS_4326[i % PROTO_PROPERTY_POINTS_4326.length]!
    return {
      address,
      extent3857: null,
      point4326: { x: pt.x, y: pt.y },
    }
  })
}

function extent3857FromWkt5181(
  wkt5181: string | null | undefined
): [number, number, number, number] | undefined {
  const wkt = String(wkt5181 ?? '').trim()
  if (!wkt) return undefined
  try {
    const geom = new WKT().readGeometry(wkt, {
      dataProjection: 'EPSG:5181',
      featureProjection: 'EPSG:3857',
    })
    const ext = geom.getExtent()
    if (ext.length === 4 && ext.every((v) => Number.isFinite(v))) {
      return ext as [number, number, number, number]
    }
  } catch {
    // ignore
  }
  return undefined
}

function resolveSavedGeomWkt5181(
  wktRef: MutableRefObject<string | null> | undefined
): string | undefined {
  const wktRaw = wktRef?.current
  if (wktRaw == null || wktRaw === LAYER_ROW_GEOM_CLEAR_SENTINEL) return undefined
  const wkt = String(wktRaw).trim()
  return wkt || undefined
}

const PROTO_LEDGER_GEOM_PREVIEW_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(239, 68, 68, 0.95)', width: 2.5 }),
  fill: new Fill({ color: 'rgba(239, 68, 68, 0.12)' }),
})

type ListProps = {
  onClose: () => void
  selectedId: string | null
  onSelectId: (id: string) => void
  onOpenAnalysis?: () => void
  onAdd?: () => void
  ledgers?: ProtoLedgerRow[]
}

export function UseLedgerProtoListPanel({
  onClose,
  selectedId,
  onSelectId,
  onOpenAnalysis,
  onAdd,
  ledgers = PROTO_LEDGERS,
}: ListProps) {
  const searchParams = useSearchParams()
  const mapContext = useMapContext()
  const ledgerType = resolveProtoLedgerType(searchParams.get('system') ?? '')
  const listTitle = ledgerTypeLabel(ledgerType)
  const [keyword, setKeyword] = useState('')
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [movingRowId, setMovingRowId] = useState<string | null>(null)

  const handleRowClick = useCallback(
    (row: ProtoLedgerRow) => {
      onSelectId(row.id)
      if (row.id === LAYER_ROW_NEW_ID) return
      const map = mapContext?.mapInstanceRef?.current
      if (!map || !row.extent3857) return
      setMovingRowId(row.id)
      const moved = flyToProtoLedger(map, row, mapContext?.applyMapViewPaddingRef?.current ?? null)
      if (!moved) {
        setMovingRowId(null)
        return
      }
      window.setTimeout(() => setMovingRowId(null), 600)
    },
    [mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef, onSelectId]
  )

  const rows = useMemo(() => {
    const typed = ledgers.filter((r) => r.type === ledgerType)
    const k = keyword.trim().toLowerCase()
    if (!k) return typed
    return typed.filter((r) =>
      [r.name, r.place, r.startDate, r.endDate].join(' ').toLowerCase().includes(k)
    )
  }, [keyword, ledgerType, ledgers])

  return (
    <>
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <span className="text-sm font-semibold text-foreground">{listTitle}</span>
          <div className="flex items-center gap-1">
            <LayerRowAddButton
              onClick={() => {
                if (onAdd) onAdd()
                else onSelectId(LAYER_ROW_NEW_ID)
              }}
              disabled={selectedId === LAYER_ROW_NEW_ID}
            />
            {ledgerType === 'road' && (
              <LayerRowPanelButton
                onClick={() => {
                  setAnalysisOpen(true)
                  onOpenAnalysis?.()
                }}
              >
                점용분석
              </LayerRowPanelButton>
            )}
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              title="닫기"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="shrink-0 border-b border-border px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="검색 (점용명, 장소, 시작일, 종료일)"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-border focus:ring-2 focus:ring-border"
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-auto scrollbar-hide">
            <table className="w-full min-w-[466px] table-fixed border-collapse text-left text-xs">
              <colgroup>
                <col className="w-[120px]" />
                <col className="w-[170px]" />
                <col className="w-[88px]" />
                <col className="w-[88px]" />
              </colgroup>
              <thead className="sticky top-0 z-[1] bg-muted/30 shadow-[0_1px_0_0_rgb(226_232_240)]">
                <tr>
                  <th className="whitespace-nowrap border-b border-border px-2 py-2 font-semibold text-foreground">
                    점용명
                  </th>
                  <th className="whitespace-nowrap border-b border-border px-2 py-2 font-semibold text-foreground">
                    점용장소
                  </th>
                  <th className="whitespace-nowrap border-b border-border px-2 py-2 font-semibold text-foreground">
                    점용시작일
                  </th>
                  <th className="whitespace-nowrap border-b border-border px-2 py-2 font-semibold text-foreground">
                    점용종료일
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isSelected = selectedId === row.id
                  const isMoving = movingRowId === row.id
                  return (
                    <tr
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleRowClick(row)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleRowClick(row)
                        }
                      }}
                      className={cn(
                        'cursor-pointer border-b border-border transition-colors hover:bg-muted/50',
                        isSelected && 'bg-primary/10'
                      )}
                    >
                      <td
                        className="truncate whitespace-nowrap px-2 py-1.5 text-foreground"
                        title={row.name}
                      >
                        {row.name}
                        {isMoving && (
                          <span className="ml-1 text-[11px] text-muted-foreground">이동 중…</span>
                        )}
                      </td>
                      <td
                        className="truncate whitespace-nowrap px-2 py-1.5 text-foreground"
                        title={row.place}
                      >
                        {formatProtoLedgerListPlace(row.place)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-foreground">
                        {row.startDate}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-foreground">
                        {row.endDate}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            {rows.length.toLocaleString()}건 · 더미데이터
          </div>
        </div>
      </div>
      {ledgerType === 'road' && (
        <RoadUseLedgerAnalysisModal open={analysisOpen} onClose={() => setAnalysisOpen(false)} />
      )}
    </>
  )
}

function nextManageCode(type: ProtoLedgerType, existing: ProtoLedgerRow[]): string {
  const prefix = type === 'river' ? 'RV' : type === 'publicLand' ? 'PL' : 'RD'
  let max = 0
  for (const r of existing) {
    if (r.type !== type) continue
    const m = r.manageCode.match(new RegExp(`^${prefix}-(\\d+)$`, 'i'))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`
}

function draftToLedgerRow(
  draft: Record<string, string>,
  type: ProtoLedgerType,
  id: string,
  manageCode: string,
  parcels: LayerRowParcelItem[],
  properties: LayerRowParcelItem[],
  extent3857?: [number, number, number, number],
  geomWkt5181?: string | null
): ProtoLedgerRow {
  const areaRaw = (draft.area ?? '').replace(/\s*m²\s*$/i, '').trim()
  const base: ProtoLedgerRow = {
    id,
    type,
    manageCode,
    name: (draft.name ?? '').trim() || '(이름없음)',
    permitNo: (draft.permitNo ?? '').trim(),
    permitDate: draft.permitDate ?? '',
    place: (draft.place ?? '').trim(),
    purpose: (draft.purpose ?? '').trim(),
    area: areaRaw,
    startDate: draft.startDate ?? '',
    endDate: draft.endDate ?? '',
    parcels: parcels.map((p) => p.address),
    parcelDetails: parcelDetailsFromItems(parcels),
    properties: properties.map((p) => p.address),
    mapped: true,
  }
  if (extent3857) base.extent3857 = extent3857
  if (geomWkt5181 !== undefined) base.geomWkt5181 = geomWkt5181
  if (type === 'road') {
    base.roadType = draft.roadType ?? ''
    base.routeNo = draft.routeNo ?? ''
  } else if (type === 'river') {
    base.riverType = draft.riverType ?? ''
    base.riverCode = draft.riverCode ?? ''
    base.riverName = draft.riverName ?? ''
    base.riverGrade = draft.riverGrade ?? ''
  } else {
    base.landCategory = draft.landCategory ?? ''
    base.publicKind = draft.publicKind ?? ''
  }
  return base
}

type DetailProps = {
  detailId: string
  onClose: () => void
  onSelectFee?: (fee: ProtoFeeRow) => void
  selectedFeeId?: string | null
  ledgers?: ProtoLedgerRow[]
  onCreated?: (row: ProtoLedgerRow) => void
  onUpdated?: (row: ProtoLedgerRow) => void
}

export function UseLedgerProtoDetailPanel({
  detailId,
  onClose,
  onSelectFee,
  selectedFeeId,
  ledgers = PROTO_LEDGERS,
  onCreated,
  onUpdated,
}: DetailProps) {
  const searchParams = useSearchParams()
  const systemType = resolveProtoLedgerType(searchParams.get('system') ?? '')
  const mapContext = useMapContext()
  const vworldApiKey = mapContext?.vworldApiKey ?? ''
  const setLayerRowGeomEdit = mapContext?.setLayerRowGeomEdit
  const layerRowGeomEditWktRef = mapContext?.layerRowGeomEditWktRef
  const layerRowParcelApplyRef = mapContext?.layerRowParcelApplyRef
  const layerRowParcelRemoveRef = mapContext?.layerRowParcelRemoveRef
  const setLayerRowDraftParcels = mapContext?.setLayerRowDraftParcels
  const { navigateToParcel, movingParcelIdx } = useLayerParcelNavigation(
    ROAD_USE_LEDGER_JIJUK_WMS_LAYER_ID
  )
  const { navigateToParcel: navigateToProperty, movingParcelIdx: movingPropertyIdx } =
    useLayerParcelNavigation()

  const isCreateMode = detailId === LAYER_ROW_NEW_ID
  const row = ledgers.find((r) => r.id === detailId) ?? null
  const activeType = row?.type ?? systemType
  const detailTitle = `${ledgerTypeLabel(activeType)} 상세`

  const [isEditing, setIsEditing] = useState(isCreateMode)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [parcels, setParcels] = useState<LayerRowParcelItem[]>(() =>
    row ? parcelItemsFromRow(row) : []
  )
  const [draftParcels, setDraftParcels] = useState<LayerRowParcelItem[]>([])
  const [properties, setProperties] = useState<LayerRowParcelItem[]>(() =>
    row ? toPropertyItems(row.properties) : []
  )
  const [draftProperties, setDraftProperties] = useState<LayerRowParcelItem[]>([])
  const prevEditingRef = useRef(false)
  const [toast, setToast] = useState<string | null>(null)
  const [parcelModalOpen, setParcelModalOpen] = useState(false)
  const [propertyModalOpen, setPropertyModalOpen] = useState(false)

  const stopGeomEdit = useCallback(() => {
    setLayerRowGeomEdit?.(null)
    if (layerRowGeomEditWktRef) layerRowGeomEditWktRef.current = null
  }, [layerRowGeomEditWktRef, setLayerRowGeomEdit])

  const startGeomEdit = useCallback(() => {
    if (!setLayerRowGeomEdit) return
    mapContext?.clearMapDrawInteractionsRef?.current?.('layerRowGeomEdit')
    mapContext?.setSpatialDrawRequest?.(null)
    const seed = isCreateMode ? null : row?.geomWkt5181 ?? null
    if (layerRowGeomEditWktRef) {
      layerRowGeomEditWktRef.current = seed
    }
    setLayerRowGeomEdit({
      layerName: 'road_use_ledger',
      schema: 'layer',
      keyField: 'id',
      keyValue: isCreateMode ? '' : String(row?.id ?? ''),
      mode: isCreateMode ? 'draw' : 'modify',
      seedWkt5181: seed,
      protoGeom: true,
    })
  }, [
    isCreateMode,
    layerRowGeomEditWktRef,
    mapContext?.clearMapDrawInteractionsRef,
    mapContext?.setSpatialDrawRequest,
    row?.geomWkt5181,
    row?.id,
    setLayerRowGeomEdit,
  ])

  useEffect(() => {
    setIsEditing(isCreateMode)
    setToast(null)
    setParcelModalOpen(false)
    setPropertyModalOpen(false)
    if (isCreateMode) {
      const empty = emptyLedger(systemType)
      const next: Record<string, string> = {}
      for (const a of ledgerToAttributes(empty)) {
        next[a.field] = a.field === 'area' ? '' : a.value
      }
      setDraft(next)
      setParcels([])
      setDraftParcels([])
      setProperties([])
      setDraftProperties([])
      return
    }
    setDraft({})
    if (row) {
      setParcels(parcelItemsFromRow(row))
      setDraftParcels([])
      setProperties(toPropertyItems(row.properties))
      setDraftProperties([])
    } else {
      setParcels([])
      setDraftParcels([])
      setProperties([])
      setDraftProperties([])
    }
  }, [detailId, isCreateMode, row, systemType])

  useEffect(() => {
    if (isEditing || isCreateMode || !row) return
    const base = parcelItemsFromRow(row)
    setParcels(base)
    if (base.some((p) => !getParcelExtent3857(p))) {
      void resolveParcelGeoms(base).then(setParcels)
    }
  }, [isCreateMode, isEditing, row])

  useEffect(() => {
    if (isEditing && !prevEditingRef.current) {
      if (isCreateMode) {
        setDraftParcels([])
        setDraftProperties([])
      } else if (row) {
        const base = parcelItemsFromRow(row)
        setDraftParcels(base)
        setDraftProperties(toPropertyItems(row.properties))
        if (base.some((p) => !getParcelExtent3857(p))) {
          void resolveParcelGeoms(base).then(setDraftParcels)
        }
      }
    }
    if (!isEditing) {
      setDraftParcels([])
      setDraftProperties([])
    }
    prevEditingRef.current = isEditing
  }, [isCreateMode, isEditing, row])

  useLayoutEffect(() => {
    if (!isEditing || !layerRowParcelApplyRef) return
    layerRowParcelApplyRef.current = (items, options) => {
      setDraftParcels((prev) => {
        const autoItems = items.map((item) => ({ ...item, showMapGeom: false as const }))
        if (options?.replaceAuto) {
          const manual = prev.filter((p) => p.showMapGeom === true)
          const seen = new Set(manual.map((p) => p.address.toLowerCase()))
          const merged = [...manual]
          for (const item of autoItems) {
            const key = item.address.toLowerCase()
            if (seen.has(key)) continue
            seen.add(key)
            merged.push(item)
          }
          return merged
        }
        const seen = new Set(prev.map((p) => p.address.toLowerCase()))
        const merged = [...prev]
        for (const item of autoItems) {
          const key = item.address.toLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          merged.push(item)
        }
        return merged
      })
    }
    return () => {
      layerRowParcelApplyRef.current = null
    }
  }, [isEditing, layerRowParcelApplyRef])

  useLayoutEffect(() => {
    if (isEditing) {
      startGeomEdit()
      return () => stopGeomEdit()
    }
    stopGeomEdit()
  }, [isEditing, startGeomEdit, stopGeomEdit])

  useEffect(() => () => stopGeomEdit(), [stopGeomEdit])

  useEffect(() => {
    setLayerRowDraftParcels?.(isEditing ? draftParcels : [])
  }, [draftParcels, isEditing, setLayerRowDraftParcels])

  const handleAddParcel = useCallback(
    (item: LayerRowParcelItem) => {
      const key = item.address.toLowerCase()
      const nextItem: LayerRowParcelItem = { ...item, showMapGeom: true }
      setDraftParcels((prev) =>
        prev.some((p) => p.address.toLowerCase() === key) ? prev : [...prev, nextItem]
      )
      void resolveParcelGeoms([nextItem]).then(([resolved]) => {
        if (!resolved?.geometry3857 && !resolved?.extent3857) return
        const merged: LayerRowParcelItem = {
          ...nextItem,
          extent3857: resolved.extent3857 ?? nextItem.extent3857,
          geometry3857: resolved.geometry3857 ?? nextItem.geometry3857,
          showMapGeom: true,
        }
        setDraftParcels((prev) =>
          prev.map((p) => (p.address.toLowerCase() === key ? merged : p))
        )
        const map = mapContext?.mapInstanceRef?.current
        if (map) {
          fitMapToLayerRowParcel(map, merged, {
            wmsLayerId: ROAD_USE_LEDGER_JIJUK_WMS_LAYER_ID,
            setVisibleLayerNames: mapContext?.setVisibleLayerNames,
            applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current,
          })
        }
      })
    },
    [
      mapContext?.applyMapViewPaddingRef,
      mapContext?.mapInstanceRef,
      mapContext?.setVisibleLayerNames,
    ]
  )

  const handleRemoveParcel = useCallback(
    (index: number) => {
      setDraftParcels((prev) => {
        const removed = prev[index]
        if (removed) void layerRowParcelRemoveRef?.current?.(removed)
        return prev.filter((_, i) => i !== index)
      })
    },
    [layerRowParcelRemoveRef]
  )

  const handleAddProperty = useCallback((item: LayerRowParcelItem) => {
    const key = item.address.toLowerCase()
    setDraftProperties((prev) =>
      prev.some((p) => p.address.toLowerCase() === key) ? prev : [...prev, item]
    )
    void resolveParcelGeoms([item]).then(([resolved]) => {
      if (!resolved?.extent3857 && !resolved?.geometry3857) return
      setDraftProperties((prev) =>
        prev.map((p) =>
          p.address.toLowerCase() === key
            ? {
                ...p,
                extent3857: resolved.extent3857 ?? p.extent3857,
                geometry3857: resolved.geometry3857 ?? p.geometry3857,
                point4326: resolved.point4326 ?? p.point4326,
              }
            : p
        )
      )
    })
  }, [])

  useEffect(() => {
    if (isEditing || isCreateMode) return
    const map = mapContext?.mapInstanceRef?.current
    const wkt = row?.geomWkt5181?.trim()
    if (!map || !wkt) return

    const source = new VectorSource()
    try {
      const geom = new WKT().readGeometry(wkt, {
        dataProjection: 'EPSG:5181',
        featureProjection: 'EPSG:3857',
      })
      source.addFeature(new Feature(geom))
    } catch {
      return
    }

    const layer = new VectorLayer({
      source,
      style: PROTO_LEDGER_GEOM_PREVIEW_STYLE,
      zIndex: 890,
    })
    layer.set('protoLedgerGeomPreview', true)
    map.addLayer(layer)

    return () => {
      map.removeLayer(layer)
      source.clear()
    }
  }, [detailId, isCreateMode, isEditing, mapContext?.mapInstanceRef, row?.geomWkt5181])

  useEffect(() => {
    const shouldActivate =
      !isCreateMode && !isEditing && !!row && !!selectedFeeId
    window.dispatchEvent(
      new CustomEvent('ggnr-map-control-set', {
        detail: { id: 'official-land-price', active: shouldActivate },
      })
    )
  }, [detailId, isCreateMode, isEditing, row, selectedFeeId])

  useEffect(() => {
    return () => {
      window.dispatchEvent(
        new CustomEvent('ggnr-map-control-set', {
          detail: { id: 'official-land-price', active: false },
        })
      )
    }
  }, [])

  const attributes = useMemo(() => {
    if (isCreateMode) {
      return ledgerToAttributes(emptyLedger(systemType)).map((a) => ({
        ...a,
        value: draft[a.field] ?? a.value,
      }))
    }
    if (!row) return []
    if (isEditing) {
      return ledgerToAttributes(row).map((a) => ({
        ...a,
        value: draft[a.field] ?? (a.field === 'area' ? String(row.area ?? '') : a.value),
      }))
    }
    return ledgerToAttributes(row)
  }, [draft, isCreateMode, isEditing, row, systemType])

  const fees = row ? feesForLedger(row.manageCode) : []
  const readOnlyFields = useMemo(() => new Set(['managecode']), [])
  const dateFields = useMemo(() => new Set(['permitdate', 'startdate', 'enddate']), [])

  const handleEdit = useCallback(() => {
    if (!row) return
    const next: Record<string, string> = {}
    for (const a of ledgerToAttributes(row)) {
      next[a.field] = a.field === 'area' ? String(row.area ?? '') : a.value
    }
    setDraft(next)
    setIsEditing(true)
  }, [row])

  const handleSave = useCallback(() => {
    const geomWkt5181 = resolveSavedGeomWkt5181(layerRowGeomEditWktRef) ?? null
    const extent3857 =
      extent3857FromWkt5181(geomWkt5181 ?? undefined) ?? row?.extent3857
    stopGeomEdit()
    const savedParcels = draftParcels
    const savedProperties = draftProperties
    if (isCreateMode) {
      const manageCode = nextManageCode(systemType, ledgers)
      const newId = `L-${Date.now()}`
      const created = draftToLedgerRow(
        draft,
        systemType,
        newId,
        manageCode,
        savedParcels,
        savedProperties,
        extent3857,
        geomWkt5181 || undefined
      )
      onCreated?.(created)
      setParcels(savedParcels)
      setToast('등록되었습니다. (프로토 · 메모리)')
      window.setTimeout(() => setToast(null), 2000)
      return
    }
    if (row) {
      const updated = draftToLedgerRow(
        draft,
        row.type,
        row.id,
        row.manageCode,
        savedParcels,
        savedProperties,
        extent3857,
        geomWkt5181
      )
      onUpdated?.(updated)
      setParcels(savedParcels)
      setProperties(savedProperties)
    }
    setIsEditing(false)
    setToast('저장되었습니다. (프로토 · 메모리)')
    window.setTimeout(() => setToast(null), 2000)
  }, [
    draft,
    draftParcels,
    draftProperties,
    isCreateMode,
    layerRowGeomEditWktRef,
    ledgers,
    onCreated,
    onUpdated,
    row,
    stopGeomEdit,
    systemType,
  ])

  const handleCancel = useCallback(() => {
    stopGeomEdit()
    if (isCreateMode) {
      onClose()
      return
    }
    setIsEditing(false)
    if (row) {
      setParcels(parcelItemsFromRow(row))
      setProperties(toPropertyItems(row.properties))
    }
  }, [isCreateMode, onClose, row, stopGeomEdit])

  const handleDelete = useCallback(() => {
    setToast('삭제되었습니다. (더미 · 반영 없음)')
    window.setTimeout(() => {
      setToast(null)
      onClose()
    }, 800)
  }, [onClose])

  const editToolbarProps = useMemo(
    () => ({
      isEditing,
      isCreateMode,
      saving: false,
      onEdit: handleEdit,
      onSave: handleSave,
      onCancel: handleCancel,
      onDelete: isCreateMode ? undefined : handleDelete,
    }),
    [handleCancel, handleDelete, handleEdit, handleSave, isCreateMode, isEditing]
  )

  if (!isCreateMode && !row) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <LayerRowEditHeader
          title={detailTitle}
          isEditing={false}
          saving={false}
          onEdit={() => undefined}
          onSave={() => undefined}
          onCancel={onClose}
          onClose={onClose}
          editable={false}
        />
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">선택한 대장을 찾을 수 없습니다.</div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <LayerRowEditHeader
        title={detailTitle}
        actionsPlacement="footer"
        onClose={onClose}
        {...editToolbarProps}
      />

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 text-xs">
        {toast && (
          <div className="mb-2 rounded border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-emerald-700">
            {toast}
          </div>
        )}

        <LayerRowAttributeSection
          attributes={attributes}
          isEditing={isEditing}
          draft={draft}
          readOnlyFields={readOnlyFields}
          dateFields={dateFields}
          onDraftChange={(field, value) => setDraft((prev) => ({ ...prev, [field]: value }))}
        />

        <ProtoAddressList
          title="필지목록"
          isEditing={isEditing}
          items={isEditing ? draftParcels : parcels}
          movingIdx={movingParcelIdx}
          onAdd={() => setParcelModalOpen(true)}
          onRemove={handleRemoveParcel}
          onClick={(item, idx) => void navigateToParcel(item, idx)}
          emptyHintEdit="도형을 그리거나 수정하면 필지목록이 자동으로 채워집니다. 「추가」로 직접 등록할 수도 있습니다."
        />

        <ProtoAddressList
          title="물건지목록"
          isEditing={isEditing}
          items={isEditing ? draftProperties : properties}
          movingIdx={movingPropertyIdx}
          onAdd={() => setPropertyModalOpen(true)}
          onRemove={(idx) => setDraftProperties((prev) => prev.filter((_, i) => i !== idx))}
          onClick={(item, idx) => void navigateToProperty(item, idx)}
          emptyHintEdit="「추가」로 주소를 검색해 물건지를 등록합니다."
        />

        {!isCreateMode && !isEditing && (
          <>
            <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              점사용료 이력
            </div>
            {row && !row.mapped ? (
              <div className="rounded border border-dashed border-border bg-muted/30 px-2 py-6 text-center text-muted-foreground">
                연계된 점사용료 이력이 없습니다.
                <br />
                (과거 데이터는 매핑 불가)
              </div>
            ) : fees.length === 0 ? (
              <div className="rounded border border-dashed border-border bg-muted/30 px-2 py-6 text-center text-muted-foreground">
                연계된 점사용료 이력이 없습니다.
              </div>
            ) : (
              <div className="overflow-auto rounded border border-border">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="border-b border-border px-2 py-2 font-semibold text-foreground">상태</th>
                      <th className="border-b border-border px-2 py-2 font-semibold text-foreground">부과번호</th>
                      <th className="border-b border-border px-2 py-2 font-semibold text-foreground">금액</th>
                      <th className="border-b border-border px-2 py-2 font-semibold text-foreground">납기일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fees.map((f) => (
                      <tr
                        key={f.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectFee?.(f)}
                        className={cn(
                          'cursor-pointer border-b border-border hover:bg-muted/50',
                          selectedFeeId === f.id && 'bg-primary/10'
                        )}
                      >
                        <td className="px-2 py-1.5">
                          <span
                            className={cn(
                              'inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold',
                              f.status === '미납'
                                ? 'bg-red-50 text-red-700'
                                : 'bg-emerald-50 text-emerald-700'
                            )}
                          >
                            {f.status}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-foreground">{f.chargeNo}</td>
                        <td className="px-2 py-1.5 tabular-nums text-foreground">{f.amount}</td>
                        <td className="px-2 py-1.5 tabular-nums text-foreground">{f.dueDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <LayerRowEditFooter {...editToolbarProps} />

      <LayerParcelAddModal
        open={parcelModalOpen}
        onOpenChange={setParcelModalOpen}
        vworldApiKey={vworldApiKey}
        title="필지 추가"
        onAdd={handleAddParcel}
      />
      <LayerParcelAddModal
        open={propertyModalOpen}
        onOpenChange={setPropertyModalOpen}
        vworldApiKey={vworldApiKey}
        title="물건지 추가"
        onAdd={handleAddProperty}
      />
    </div>
  )
}

function ProtoAddressList({
  title,
  isEditing,
  items,
  movingIdx = null,
  onAdd,
  onRemove,
  onClick,
  emptyHintEdit,
  emptyHintView,
}: {
  title: string
  isEditing: boolean
  items: LayerRowParcelItem[]
  movingIdx?: number | null
  onAdd: () => void
  onRemove: (idx: number) => void
  onClick: (item: LayerRowParcelItem, idx: number) => void
  emptyHintEdit: string
  emptyHintView?: string
}) {
  const emptyLabel =
    emptyHintView ?? `등록된 ${title.replace('목록', '')}가 없습니다.`

  return (
    <>
      <div className="mb-1 mt-4 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        {isEditing && (
          <LayerRowPanelButton className="h-6 px-2 text-[10px]" onClick={onAdd}>
            <Plus className="h-3 w-3 shrink-0" aria-hidden />
            추가
          </LayerRowPanelButton>
        )}
      </div>
      {isEditing && (
        <div className="mb-2 rounded border border-dashed border-border bg-muted/30 px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {emptyHintEdit}
        </div>
      )}
      {items.length === 0 ? (
        !isEditing ? (
          <div className="rounded border border-dashed border-border bg-muted/30 px-2 py-3 text-muted-foreground">
            {emptyLabel}
          </div>
        ) : null
      ) : (
        <ul className="list-none space-y-0 rounded border border-border bg-background">
          {items.map((item, i) => (
            <li
              key={`${title}-${i}-${item.address}`}
              className="flex items-start gap-1 border-b border-border px-2 py-2 text-foreground last:border-b-0"
            >
              <button
                type="button"
                className="min-w-0 flex-1 break-words text-left text-xs text-foreground hover:text-primary"
                onClick={() => onClick(item, i)}
                title="클릭 시 위치 이동"
              >
                <span className="mr-2 tabular-nums text-muted-foreground">{i + 1}.</span>
                {item.address}
                {movingIdx === i && (
                  <span className="ml-2 text-[11px] text-muted-foreground">이동 중…</span>
                )}
              </button>
              {isEditing && (
                <button
                  type="button"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-red-50 hover:text-red-600"
                  onClick={() => onRemove(i)}
                  aria-label="삭제"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

type LinkedLedgerProps = {
  ledger: ProtoLedgerRow
  onClose: () => void
}

export function UseLedgerProtoLinkedPanel({ ledger, onClose }: LinkedLedgerProps) {
  const { navigateToParcel, movingParcelIdx } = useLayerParcelNavigation(
    ROAD_USE_LEDGER_JIJUK_WMS_LAYER_ID
  )
  const { navigateToParcel: navigateToProperty, movingParcelIdx: movingPropertyIdx } =
    useLayerParcelNavigation()
  const attributes = ledgerToAttributes(ledger)
  const [parcelItems, setParcelItems] = useState<LayerRowParcelItem[]>(() =>
    parcelItemsFromRow(ledger)
  )
  const propertyItems = toPropertyItems(ledger.properties)

  useEffect(() => {
    const base = parcelItemsFromRow(ledger)
    setParcelItems(base)
    if (base.some((p) => !getParcelExtent3857(p))) {
      void resolveParcelGeoms(base).then(setParcelItems)
    }
  }, [ledger])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <LayerRowEditHeader
        title={`${ledgerTypeLabel(ledger.type)} 상세`}
        isEditing={false}
        saving={false}
        onEdit={() => undefined}
        onSave={() => undefined}
        onCancel={onClose}
        onClose={onClose}
        editable={false}
      />
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 text-xs">
        <LayerRowAttributeSection
          attributes={attributes}
          isEditing={false}
          draft={{}}
          readOnlyFields={new Set()}
          dateFields={new Set()}
          onDraftChange={() => undefined}
        />
        <ProtoAddressList
          title="필지목록"
          isEditing={false}
          items={parcelItems}
          movingIdx={movingParcelIdx}
          onAdd={() => undefined}
          onRemove={() => undefined}
          onClick={(item, idx) => void navigateToParcel(item, idx)}
          emptyHintEdit=""
        />
        <ProtoAddressList
          title="물건지목록"
          isEditing={false}
          items={propertyItems}
          movingIdx={movingPropertyIdx}
          onAdd={() => undefined}
          onRemove={() => undefined}
          onClick={(item, idx) => void navigateToProperty(item, idx)}
          emptyHintEdit=""
        />
      </div>
    </div>
  )
}
