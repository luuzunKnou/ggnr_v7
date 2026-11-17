'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MapBrowserEvent } from 'ol'
import { unByKey } from 'ol/Observable'
import {
  Calendar,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  ClipboardList,
  MapPin,
  Plus,
  Search,
  User,
  Users,
  Wrench,
  CheckCircle2,
  X,
} from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/app/shadcnComponents/ui/button'
import { Input } from '@/app/shadcnComponents/ui/input'
import { useSerWriteAccess } from '@/hooks/useSerWriteAccess'
import { useMapContext } from '../../_mapComponents/MapContext'
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults'
import { COMPLAINT_STATE_OPTIONS, getStateStyle as getStateStyleBase } from '../../_mapComponents/complaint/state-options'
import type { WaterComplaintRow } from '@/service/waterAdminComplaintService'
import { focusFromIdentifyGeom, type WaterPlaceFocus } from './waterComplaintMapFly'

function getStateStyle(state: string) {
  const style = getStateStyleBase(state)
  const iconMap: Record<string, ReactNode> = {
    접수: <ClipboardList className="h-3 w-3 text-[#1D6AE3]" />,
    점검: <ClipboardCheck className="h-3 w-3 text-violet-600" />,
    처리중: <Wrench className="h-3 w-3 text-orange-600" />,
    완료: <CheckCircle2 className="h-3 w-3 text-green-600" />,
  }
  return { ...style, icon: iconMap[state] ?? <CircleDot className="h-3 w-3 text-muted-foreground" /> }
}

function zoomToBuffer(zoom: number): number {
  return 300_000 * Math.pow(0.54, zoom)
}

type Props = {
  title: string
  tableName: string
  mapLayers: string[]
  refreshKey: number
  selectedKey: number | null
  onSelectKey: (key: number | null, fly: boolean, focus?: WaterPlaceFocus | null) => void
  onRequestAdd: () => void
  onClose: () => void
}

export function WaterComplaintListPanel({
  title,
  tableName,
  mapLayers,
  refreshKey,
  selectedKey,
  onSelectKey,
  onRequestAdd,
  onClose,
}: Props) {
  const mapContext = useMapContext()
  const canWrite = useSerWriteAccess()
  const mapContextRef = useRef(mapContext)
  mapContextRef.current = mapContext
  const onSelectRef = useRef(onSelectKey)
  onSelectRef.current = onSelectKey
  const [rows, setRows] = useState<WaterComplaintRow[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterState, setFilterState] = useState<string | null>(null)
  const layerKey = mapLayers.join(',')

  useEffect(() => {
    const ctx = mapContextRef.current
    const ids = layerKey.split(',').map((id) => id.trim().toLowerCase()).filter(Boolean)
    if (!ctx?.setVisibleLayerNames || ids.length === 0) return
    ctx.setVisibleLayerNames((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
    let cancelled = false
    void call('', 'POST', {
      service: 'waterAdminComplaintService',
      action: 'getLayerExtent3857',
      params: { tableName },
    })
      .then((res) => {
        if (cancelled) return
        const extent = (res?.data ?? res)?.extent3857 as number[] | null | undefined
        const map = mapContextRef.current?.mapInstanceRef?.current
        if (!map || !Array.isArray(extent) || extent.length !== 4) return
        if (!extent.every((v) => Number.isFinite(Number(v)))) return
        window.setTimeout(() => {
          if (cancelled) return
          scheduleFitMapToExtent3857(map, extent.map(Number), {
            maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
            applyMapViewPadding: () => mapContextRef.current?.applyMapViewPaddingRef?.current?.(),
          })
        }, 80)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      const current = mapContextRef.current
      if (!current?.setVisibleLayerNames) return
      current.setVisibleLayerNames((prev) => {
        const next = new Set(prev)
        let changed = false
        for (const id of ids) {
          if (next.delete(id)) changed = true
        }
        return changed ? next : prev
      })
    }
  }, [layerKey, tableName])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await call('', 'POST', {
        service: 'waterAdminComplaintService',
        action: 'list',
        params: { tableName, limit: 200, offset: 0 },
      })
      const data = res?.data ?? res
      setRows(Array.isArray(data?.rows) ? data.rows : [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [tableName])

  useEffect(() => {
    void loadList()
  }, [loadList, refreshKey])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!mapContext?.mapReady || !map) return
    const handleClick = async (evt: MapBrowserEvent<PointerEvent>) => {
      if (mapContext?.spatialDrawRequest) return
      if (mapContext?.mapMeasureTool) return
      if (mapContext?.mapDrawInputSuspended) return
      if (mapContext?.layerRowGeomEdit) return
      const zoom = evt.map.getView().getZoom() ?? 10
      const [x, y] = evt.coordinate as [number, number]
      try {
        const res = await call('', 'POST', {
          service: 'standardService',
          action: 'identifyFeatures',
          params: {
            x,
            y,
            buffer: zoomToBuffer(zoom),
            tables: layerKey.split(',').map((id) => id.trim()).filter(Boolean),
            schema: 'layer',
          },
        })
        const data = res?.data ?? res
        const results = Array.isArray(data?.results) ? data.results : []
        const first = results[0] as
          | { tableName?: string; features?: { data?: Record<string, unknown> }[] }
          | undefined
        const table = String(first?.tableName ?? '').trim().toLowerCase()
        const raw = first?.features?.[0]?.data
        if (table === 'complaint_dre_detail') {
          const parent = Number(raw?.dre_key ?? raw?.dreKey ?? raw?.DRE_KEY)
          if (!Number.isInteger(parent) || parent < 1) return
          const detailKey = Number(raw?.dre_detail_key ?? raw?.dreDetailKey ?? raw?.DRE_DETAIL_KEY)
          const geomKey = raw ? Object.keys(raw).find((name) => name.toLowerCase() === 'geom') : undefined
          const place = focusFromIdentifyGeom(geomKey && raw ? raw[geomKey] : null)
          onSelectRef.current(
            parent,
            false,
            place && Number.isInteger(detailKey) && detailKey > 0
              ? { detailKey, ...place }
              : null
          )
          return
        }
        if (table !== tableName) return
        const key = Number(raw?.comp_key ?? raw?.compKey ?? raw?.COMP_KEY)
        if (!Number.isInteger(key) || key < 1) return
        onSelectRef.current(key, false)
      } catch {
        /* 식별 실패는 무시 */
      }
    }
    const key = map.on('singleclick', handleClick as never)
    return () => {
      if (key) unByKey(key)
    }
  }, [
    mapContext?.layerRowGeomEdit,
    mapContext?.mapDrawInputSuspended,
    mapContext?.mapInstanceRef,
    mapContext?.mapMeasureTool,
    mapContext?.mapReady,
    mapContext?.spatialDrawRequest,
    tableName,
    layerKey,
  ])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return rows.filter((row) => {
      const state = row.latestState ?? ''
      const matchesSearch =
        !q ||
        row.compName?.toLowerCase().includes(q) ||
        row.compAdr?.toLowerCase().includes(q) ||
        row.compContent?.toLowerCase().includes(q) ||
        String(row.compKey).includes(q)
      const matchesFilter = !filterState || state === filterState
      return matchesSearch && matchesFilter
    })
  }, [filterState, rows, searchQuery])

  if (loading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background text-sm text-muted-foreground">
        로딩 중...
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex-shrink-0 border-b border-border">
        <div className="flex items-center justify-between px-3 pb-2 pt-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/5">
              <Users className="h-4 w-4 text-primary/80" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-foreground/90">{title}</h1>
              <p className="text-[11px] text-muted-foreground">
                전체 <span className="font-medium text-foreground/80">{rows.length}</span>건
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {canWrite ? (
              <Button
                size="sm"
                className="h-[26px] min-h-[26px] gap-1 rounded-lg border border-border bg-muted/50 px-2.5 text-[12px] font-light text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary"
                onClick={onRequestAdd}
              >
                <Plus className="h-3 w-3" />
                민원 추가
              </Button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="닫기"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="접수번호, 민원인, 주소 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 rounded-lg border-transparent bg-muted/50 pl-8 text-xs focus:border-border focus:bg-background"
            />
          </div>
        </div>
        <div className="px-3 pb-2">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setFilterState(null)}
              className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-normal transition-colors',
                filterState === null
                  ? 'border-transparent bg-foreground text-background'
                  : 'border-transparent bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              전체
            </button>
            {COMPLAINT_STATE_OPTIONS.map((state) => {
              const style = getStateStyle(state)
              const isActive = filterState === state
              return (
                <button
                  key={state}
                  type="button"
                  onClick={() => setFilterState(isActive ? null : state)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-normal transition-colors',
                    isActive
                      ? `${style.bg} ${style.text} ${style.border}`
                      : 'border-transparent bg-muted text-muted-foreground hover:bg-muted/80'
                  )}
                >
                  {state}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="flex flex-col gap-2 py-3 pl-3 pr-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 pr-3 text-muted-foreground/80">
              <Search className="mb-3 h-10 w-10 opacity-25" />
              <p className="text-sm font-medium text-foreground/70">검색 결과가 없습니다</p>
              <p className="mt-1 text-xs">다른 검색어를 입력해보세요</p>
            </div>
          ) : null}
          {filtered.map((row) => {
            const stateLabel = row.latestState || '미지정'
            const stateStyle = getStateStyle(stateLabel)
            const isSelected = selectedKey === row.compKey
            return (
              <button
                key={row.compKey}
                type="button"
                onClick={() => onSelectKey(isSelected ? null : row.compKey, !isSelected, null)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                  isSelected
                    ? 'border-primary/30 bg-primary/[0.03] ring-1 ring-primary/15'
                    : 'border-border/80 bg-card hover:border-border hover:bg-muted/20'
                )}
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground/90">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                          stateStyle.bg,
                          stateStyle.text,
                          stateStyle.border
                        )}
                      >
                        {stateStyle.icon}
                        {stateLabel}
                      </span>
                      <span className="shrink-0 font-mono text-[11px]">#{row.compKey}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px]">
                        <User className="h-3 w-3" />
                        <span className="max-w-[4rem] truncate">{row.compName || '-'}</span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px]">
                        <Calendar className="h-3 w-3" />
                        {row.compDate ? row.compDate.slice(0, 10) : '-'}
                      </span>
                    </div>
                    <ChevronRight
                      className={cn('h-4 w-4 shrink-0', isSelected ? 'text-primary/80' : 'text-muted-foreground/40')}
                    />
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] leading-snug">
                    <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/90" />
                    <span className="shrink-0 text-muted-foreground/90">{row.compAdr || '-'}</span>
                    <span className="shrink-0 text-muted-foreground/35" aria-hidden>
                      ·
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground/90">{row.compContent || '-'}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
