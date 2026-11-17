'use client'

import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { useMapContext } from '../../_mapComponents/MapContext'
import { JIJUK_JIBUN_LABEL_MAX_SCALE_DENOMINATOR } from '../../_mapComponents/layerFactory/boundaryLayerFactory'
import {
  INDIVIDUAL_LAND_PRICE_SERVICE,
  formatWon,
  isStandardYn,
  parcelAddress,
  type LandPriceEmd,
  type LandPriceRow,
  type LandPriceSortKey,
  type LandPriceYear,
} from './individualLandPriceConfig'
import {
  markIndividualLandPriceSelectFromList,
  type MapViewBbox,
  useIndividualLandPriceMapClick,
  useIndividualLandPriceMapViewBbox,
  useOfficialLandPriceControlWhileOpen,
} from './useIndividualLandPriceLayer'

/** 공시지가·지번 라벨이 보이는 최대 해상도 — 읍면동 이동 시 이보다 축소하지 않음 */
const SEARCH_FIT_MAX_RESOLUTION = JIJUK_JIBUN_LABEL_MAX_SCALE_DENOMINATOR * 0.00028
/** 화면 범위 비교·반올림 단위(m) — 목록 높이 변화로 지도 픽셀이 흔들려도 재조회 루프가 안 나게 */
const BBOX_SNAP_M = 25
/** 지도 기준 목록 범위 반영 디바운스 — 연속 moveend·레이아웃 흔들림 흡수 */
const QUERY_BBOX_DEBOUNCE_MS = 350

const PAGE_SIZE = 200
const SCROLL_LOAD_THRESHOLD_PX = 240
const KEYWORD_DEBOUNCE_MS = 350
const ALL = ''

type SortSpec = { key: LandPriceSortKey; dir: 'asc' | 'desc' }

type ListRes = { total: number; rows: LandPriceRow[] }

async function callService<T>(action: string, params: Record<string, unknown>): Promise<T> {
  const res = await call('', 'POST', { service: INDIVIDUAL_LAND_PRICE_SERVICE, action, params })
  if (!res?.success) throw new Error(String((res as { error?: string })?.error ?? '조회하지 못했습니다.'))
  return (res.data ?? res) as T
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : '조회하지 못했습니다.'
}

function snapBbox(b: MapViewBbox, step = BBOX_SNAP_M): MapViewBbox {
  const snap = (n: number) => Math.round(n / step) * step
  return {
    minX: snap(b.minX),
    minY: snap(b.minY),
    maxX: snap(b.maxX),
    maxY: snap(b.maxY),
    srid: b.srid,
  }
}

function bboxClose(a: MapViewBbox, b: MapViewBbox, tol = BBOX_SNAP_M): boolean {
  return (
    a.srid === b.srid &&
    Math.abs(a.minX - b.minX) <= tol &&
    Math.abs(a.minY - b.minY) <= tol &&
    Math.abs(a.maxX - b.maxX) <= tol &&
    Math.abs(a.maxY - b.maxY) <= tol
  )
}

const LIST_COLUMNS: {
  key: LandPriceSortKey | null
  label: string
  title?: string
  className: string
  align: 'left' | 'right' | 'center'
}[] = [
  { key: 'pnu', label: '소재지·지번', className: 'w-[48%]', align: 'left' },
  { key: 'price', label: '공시지가(원/㎡)', title: '공시지가(원/㎡)', className: 'w-[32%]', align: 'right' },
  { key: null, label: '표준지', className: 'w-[20%]', align: 'center' },
]

type Props = {
  onClose: () => void
  selectedPnu: string | null
  onSelect: (pnu: string | null) => void
}

export function IndividualLandPriceListPanel({ onClose, selectedPnu, onSelect }: Props) {
  /** 파일의 최신 기준연도만 쓴다 */
  const [year, setYear] = useState('')
  const [emd, setEmd] = useState(ALL)
  const [emdRows, setEmdRows] = useState<LandPriceEmd[]>([])
  const [initError, setInitError] = useState<string | null>(null)

  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [standardOnly, setStandardOnly] = useState(false)
  /** 기본 ON — 현재 지도 화면 기준. 해제 시 조건만으로 전체 목록 */
  const [mapScoped, setMapScoped] = useState(true)
  const [sort, setSort] = useState<SortSpec>({ key: 'pnu', dir: 'asc' })
  /** 목록 조회에 쓰는 화면 범위 — 지도 기준 ON이면 지도 이동 시 바로 갱신 */
  const [queryBbox, setQueryBbox] = useState<MapViewBbox | null>(null)
  const [listResult, setListResult] = useState<{
    key: string
    rows: LandPriceRow[]
    total: number
    error: string | null
  } | null>(null)

  /** 읍면동 선택으로 지도를 옮긴 뒤 다음 화면 범위를 목록 범위로 받아들인다 */
  const adoptNextLiveAsQueryRef = useRef(false)
  const queryBboxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useIndividualLandPriceMapClick(onSelect)
  useOfficialLandPriceControlWhileOpen()
  const mapContext = useMapContext()
  const {
    bbox: liveBbox,
    zoomOk: mapZoomOk,
    listStaleSuppressed,
    suppressListStaleUntilUserInteract,
  } = useIndividualLandPriceMapViewBbox()

  const selectFromList = (pnu: string) => {
    /** 목록 선택으로 지도만 움직일 때는 목록 재조회하지 않음 */
    suppressListStaleUntilUserInteract()
    markIndividualLandPriceSelectFromList(pnu)
    onSelect(pnu)
  }

  const mapReady = mapContext?.mapReady
  const mapRef = mapContext?.mapInstanceRef
  const applyPaddingRef = mapContext?.applyMapViewPaddingRef

  /**
   * 읍면동 선택 시 해당 범위로 이동하고, 공시지가가 보이는 축척까지 확대한다.
   * 검색어는 지도에 쓰지 않고 목록 필터만 한다.
   */
  const navigateToEmd = (nextEmd: string) => {
    if (!year || !nextEmd) return
    const map = mapRef?.current
    if (!map || !mapReady) return
    adoptNextLiveAsQueryRef.current = true
    callService<{ extent: [number, number, number, number] | null }>('searchExtent', {
      year,
      emd: nextEmd,
      keyword: '',
    })
      .then((d) => {
        if (!d.extent) {
          adoptNextLiveAsQueryRef.current = false
          return
        }
        const [minX, minY, maxX, maxY] = d.extent
        setQueryBbox(snapBbox({ minX, minY, maxX, maxY, srid: 3857 }))
        /** maxResolution: 공시지가·지번 라벨이 보이는 축척(이보다 축소 안 함). OL fit 미지원이라 내비 유틸에서 직접 클램프 */
        scheduleFitMapToExtent3857(map, d.extent, {
          maxZoom: 19,
          maxResolution: SEARCH_FIT_MAX_RESOLUTION,
          fitPadding: [80, 80, 80, 80],
          applyMapViewPadding: () => applyPaddingRef?.current?.(),
        })
      })
      .catch(() => {
        adoptNextLiveAsQueryRef.current = false
      })
  }

  /**
   * 지도 기준 ON이면 화면 범위로 목록을 맞춤.
   * 반올림·디바운스로 «표준지만» 등 목록 높이 변화에 따른 재조회 루프를 막는다.
   * 목록 행 선택 이동(listStaleSuppressed)은 제외.
   */
  useEffect(() => {
    if (!mapScoped) return
    if (!mapZoomOk || !liveBbox) return

    const next = snapBbox(liveBbox)

    if (adoptNextLiveAsQueryRef.current) {
      adoptNextLiveAsQueryRef.current = false
      if (queryBboxTimerRef.current) {
        clearTimeout(queryBboxTimerRef.current)
        queryBboxTimerRef.current = null
      }
      setQueryBbox((prev) => (prev && bboxClose(next, prev) ? prev : next))
      return
    }

    if (listStaleSuppressed) return

    if (queryBboxTimerRef.current) clearTimeout(queryBboxTimerRef.current)
    queryBboxTimerRef.current = setTimeout(() => {
      queryBboxTimerRef.current = null
      setQueryBbox((prev) => (prev && bboxClose(next, prev) ? prev : next))
    }, QUERY_BBOX_DEBOUNCE_MS)

    return () => {
      if (queryBboxTimerRef.current) {
        clearTimeout(queryBboxTimerRef.current)
        queryBboxTimerRef.current = null
      }
    }
  }, [mapScoped, liveBbox, mapZoomOk, listStaleSuppressed])

  /** 현재 지도 기준이 켜져 있을 때만 읍면동 선택으로 지도 이동. 해제 시 목록 필터만 */
  useEffect(() => {
    if (!mapScoped || !year || !emd) return
    navigateToEmd(emd)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 지도 기준 ON + 읍면동 변경 시에만 이동
  }, [mapScoped, year, emd])

  useEffect(() => {
    let cancelled = false
    callService<{ years: LandPriceYear[] }>('years', {})
      .then((d) => {
        if (cancelled) return
        if (!d.years?.length) setInitError('공시지가 파일 자료가 없습니다. 연계 작업이 끝났는지 확인하세요.')
        else setYear(d.years[0]!.year)
      })
      .catch((e) => {
        if (!cancelled) setInitError(errorText(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!year) return
    let cancelled = false
    callService<{ rows: LandPriceEmd[] }>('emds', { year })
      .then((d) => {
        if (!cancelled) setEmdRows(d.rows ?? [])
      })
      .catch(() => {
        if (!cancelled) setEmdRows([])
      })
    return () => {
      cancelled = true
    }
  }, [year])

  const listParams = useMemo(() => {
    if (!year) return null
    if (!mapScoped) {
      return {
        year,
        emd,
        keyword,
        standardOnly,
        sort: sort.key,
        dir: sort.dir,
        mapScoped: false,
      }
    }
    if (!queryBbox) return null
    return {
      year,
      emd,
      keyword,
      standardOnly,
      sort: sort.key,
      dir: sort.dir,
      mapScoped: true,
      minX: queryBbox.minX,
      minY: queryBbox.minY,
      maxX: queryBbox.maxX,
      maxY: queryBbox.maxY,
      srid: queryBbox.srid,
    }
  }, [year, emd, keyword, standardOnly, sort, mapScoped, queryBbox])

  /** 응답을 조건 키와 함께 보관 — 조건이 바뀌면 키가 달라져 첫 묶음부터 다시 받는다 */
  const requestKey = listParams ? JSON.stringify(listParams) : ''
  const requestKeyRef = useRef(requestKey)
  const loadingMoreRef = useRef(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
  const scrollTargetPnuRef = useRef<string | null>(null)

  useEffect(() => {
    requestKeyRef.current = requestKey
    if (!listParams || !requestKey) return
    let cancelled = false
    callService<ListRes>('list', { ...listParams, page: 1, pageSize: PAGE_SIZE })
      .then((d) => {
        if (!cancelled) setListResult({ key: requestKey, rows: d.rows ?? [], total: d.total, error: null })
      })
      .catch((e) => {
        if (!cancelled) setListResult({ key: requestKey, rows: [], total: 0, error: errorText(e) })
      })
    return () => {
      cancelled = true
    }
  }, [listParams, requestKey])

  const current = listResult?.key === requestKey ? listResult : null
  const rows = current?.rows ?? []
  const total = current?.total ?? 0
  const listLoading = Boolean(listParams) && !current
  const listError = current?.error ?? null
  const needZoomFirst = mapScoped && Boolean(year) && !queryBbox && !mapZoomOk
  const emptyMessage = needZoomFirst
    ? '공시지가가 보이는 축척까지 지도를 확대해 주세요'
    : listError ?? '조회된 필지가 없습니다.'

  const loadMore = () => {
    if (!listParams || !current || loadingMoreRef.current || rows.length >= total) return
    const key = requestKey
    loadingMoreRef.current = true
    setLoadingMore(true)
    callService<ListRes>('list', { ...listParams, page: Math.floor(rows.length / PAGE_SIZE) + 1, pageSize: PAGE_SIZE })
      .then((d) => {
        if (requestKeyRef.current !== key) return
        setListResult((prev) => {
          if (!prev || prev.key !== key) return prev
          const seen = new Set(prev.rows.map((r) => r.pnu))
          return { ...prev, rows: [...prev.rows, ...(d.rows ?? []).filter((r) => !seen.has(r.pnu))], total: d.total }
        })
      })
      .catch((e) => window.alert(errorText(e)))
      .finally(() => {
        loadingMoreRef.current = false
        setLoadingMore(false)
      })
  }

  /** 지도에서 고른 필지 행으로 스크롤. 아직 안 불러온 쪽이면 이어서 받는다 */
  useEffect(() => {
    if (!selectedPnu) {
      scrollTargetPnuRef.current = null
      return
    }
    scrollTargetPnuRef.current = selectedPnu
    if (!current) return

    const scrollToRow = () => {
      if (scrollTargetPnuRef.current !== selectedPnu) return
      const row = rowRefs.current.get(selectedPnu)
      if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }

    if (rowRefs.current.has(selectedPnu) || rows.some((r) => r.pnu === selectedPnu)) {
      requestAnimationFrame(scrollToRow)
      return
    }
    if (rows.length < total) loadMore()
  }, [selectedPnu, current, rows, total])

  const handleListScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_LOAD_THRESHOLD_PX) loadMore()
  }

  const sortedEmdNames = useMemo(
    () => [...emdRows].sort((a, b) => a.emdName.localeCompare(b.emdName, 'ko')),
    [emdRows]
  )

  const toggleSort = (key: LandPriceSortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'pnu' ? 'asc' : 'desc' }
    )
  }

  useEffect(() => {
    const next = keywordInput.replace(/\s+/g, '').replace(/-$/, '')
    const timer = setTimeout(() => setKeyword(next), KEYWORD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [keywordInput])

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">
          개별공시지가
          {year ? <span className="ml-1 text-xs font-normal text-muted-foreground">{year}년 기준</span> : null}
        </span>
        <button type="button" onClick={onClose} className="standard-panel-close" title="닫기" aria-label="닫기">
          <X className="h-4 w-4" />
        </button>
      </div>

      {initError ? (
        <div className="standard-detail-empty-dashed m-3">{initError}</div>
      ) : (
        <>
          <div className="standard-filter-section">
            <div className="flex items-center gap-1.5">
              <select
                className="standard-filter-select max-w-none min-w-0 flex-1"
                value={emd}
                onChange={(e) => setEmd(e.target.value)}
                aria-label="읍면동"
              >
                <option value={ALL}>전체 읍면동</option>
                {sortedEmdNames.map((r) => (
                  <option key={r.emdCd} value={r.emdCd}>
                    {r.emdName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={cn('standard-filter-chip shrink-0', standardOnly && 'standard-filter-chip-active')}
                onClick={() => setStandardOnly((v) => !v)}
                aria-pressed={standardOnly}
                title="표준지만 보기"
              >
                표준지만
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <div className="standard-search-wrap min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  placeholder="소재지·지번"
                  title="목록에서 소재지(읍면동·리) 또는 지번으로 거릅니다 (예: 삼산동, 12-3, 산5)"
                  className="w-full rounded-md border border-border bg-background py-1 pl-7 pr-2 text-xs text-foreground outline-none ring-offset-2 focus:border-border focus:ring-2 focus:ring-ring scheme-light dark:scheme-dark"
                />
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-foreground whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={mapScoped}
                  onChange={(e) => {
                    const on = e.target.checked
                    setMapScoped(on)
                    if (on && liveBbox && mapZoomOk) setQueryBbox(snapBbox(liveBbox))
                  }}
                  className="h-3.5 w-3.5 shrink-0 rounded border-border text-violet-600 focus:ring-violet-500"
                />
                <span title="켜면 현재 지도 화면 안 필지만(이동 시 바로 조회), 끄면 읍면동·검색 조건으로 전체 목록">
                  현재 지도 기준
                </span>
              </label>
            </div>
          </div>

          <div className="standard-list-body mt-2">
            <div
              key={requestKey || 'empty'}
              className="standard-list-scroll scrollbar-thin"
              onScroll={handleListScroll}
            >
              <table className="standard-list-table">
                <thead className="standard-table-thead">
                  <tr>
                    {LIST_COLUMNS.map((col) => {
                      const sortKey = col.key
                      const active = sortKey != null && sort.key === sortKey
                      const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
                      const thAlign =
                        col.align === 'left'
                          ? 'standard-table-th-left'
                          : col.align === 'right'
                            ? 'text-right'
                            : 'standard-table-th-center'
                      const sortAlign =
                        col.align === 'left'
                          ? 'standard-sort-button-left'
                          : col.align === 'right'
                            ? 'ml-auto justify-end'
                            : 'standard-sort-button-center'
                      return (
                        <th
                          key={col.label}
                          title={col.title}
                          className={cn('standard-table-th max-w-none whitespace-nowrap', thAlign, col.className)}
                        >
                          {sortKey ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(sortKey)}
                              className={cn(
                                'standard-sort-button max-w-none whitespace-nowrap',
                                sortAlign,
                                active && 'standard-sort-button-active'
                              )}
                              title={`${col.title ?? col.label} 정렬`}
                            >
                              <span>{col.label}</span>
                              <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                            </button>
                          ) : (
                            <span>{col.label}</span>
                          )}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={LIST_COLUMNS.length} className="standard-table-empty">
                        {listLoading ? '' : emptyMessage}
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr
                        key={r.pnu}
                        ref={(node) => {
                          if (node) rowRefs.current.set(r.pnu, node)
                          else rowRefs.current.delete(r.pnu)
                        }}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectFromList(r.pnu)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            selectFromList(r.pnu)
                          }
                        }}
                        className={cn('standard-list-row', selectedPnu === r.pnu && 'standard-list-row-selected')}
                      >
                        <td className="standard-table-td-text w-[48%]" title={`${parcelAddress(r)} (${r.pnu})`}>
                          {parcelAddress(r) || r.pnu}
                        </td>
                        <td className="standard-table-td-date w-[32%] whitespace-nowrap text-right">
                          {formatWon(r.price)}
                        </td>
                        <td className="standard-table-td-date w-[20%] text-center">
                          {isStandardYn(r.standardYn) ? (
                            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
                              표준
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="standard-list-footer flex items-center justify-between gap-2">
              <span className="tabular-nums">
                {current ? `${rows.length.toLocaleString()} / ${total.toLocaleString()}건` : '—'}
              </span>
              <span className="text-muted-foreground">
                {loadingMore ? '더 불러오는 중' : mapScoped ? '지도 기준' : '전체 목록'}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
