'use client'

/**
 * 급수전계량기 상세 — WIMS 검침 이력
 * 계량기기물번호(MET_NUM)·수용가번호(HOM_NUM)로 /api/wims/list 조회
 * 행 클릭 시 펌프현황과 동일 — 부모 모달 옆 플로팅 상세
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { ChevronUp, Download, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  downloadWimsExcel,
  loadWimsList,
  loadWimsStatus,
  WimsClientError,
} from '@/app/(pages)/map/_mapComponents/landInfo/wimsClient'
import { getRowValueByField } from '@/app/(pages)/map/_mapComponents/standard/defineLayerRowUtils'
import { MapFloatingPanel } from '@/app/(pages)/map/_mapComponents/MapFloatingPanel'
import { COMPLAINT_DETAIL_PANEL_DEFAULT_TOP } from '@/app/(pages)/map/_mapComponents/complaint/complaintPanelLayout'
import { computeRelatedChildModalBesideParent } from '@/app/(pages)/map/_mapContents/layerClickDetail/relatedChildModalPlacement'
import {
  WIMS_HISTORY_DETAIL_COLUMNS,
  WIMS_HISTORY_LIST_COLUMNS,
} from '@/lib/wimsHistoryColumns'
import {
  WIMS_GOJIKIND,
  WIMS_JOCODE,
  WIMS_PAGE_SIZE,
  type WimsHistoryRow,
} from '@/lib/wimsTypes'
import { WtlFacilityTableLoadingRow } from '../facility/WtlFacilityTableLoadingRow'
import type { WtlNetworkRow } from './wtlNetworkTypes'

const LIST_COLUMNS = WIMS_HISTORY_LIST_COLUMNS
const DETAIL_COLUMNS = WIMS_HISTORY_DETAIL_COLUMNS
const COL_COUNT = LIST_COLUMNS.length
/** 화면에 보이는 th 컬럼 키 — 통합검색 대상 */
const SEARCH_KEYS = LIST_COLUMNS.map((c) => c.key)

function trimId(value: unknown): string {
  return String(value ?? '').trim()
}

function cellText(value: string | null | undefined): string {
  const s = String(value ?? '').trim()
  return s || '—'
}

function formatYmd(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  }
  return raw.trim()
}

function formatNumber(raw: string): string {
  if (!raw.trim()) return ''
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  return n.toLocaleString('ko-KR')
}

function formatCell(
  row: WimsHistoryRow,
  key: keyof WimsHistoryRow,
  kind: string
): string {
  const raw = trimId(row[key])
  if (kind === 'code' && key === 'jocode') return WIMS_JOCODE[raw] ?? raw
  if (kind === 'code' && key === 'gojikind') return WIMS_GOJIKIND[raw] ?? raw
  if (kind === 'date') return formatYmd(raw)
  if (kind === 'number') return formatNumber(raw)
  return raw
}

function resolveMeterPair(item: WtlNetworkRow): {
  customerNo: string
  meterNo: string
} {
  const record = item.record ?? {}
  const customerNo =
    trimId(getRowValueByField(record, 'HOM_NUM')) ||
    trimId(getRowValueByField(record, 'hom_num'))
  const meterNo =
    trimId(getRowValueByField(record, 'MET_NUM')) ||
    trimId(getRowValueByField(record, 'met_num'))
  return { customerNo, meterNo }
}

function isSameHistoryRow(a: WimsHistoryRow, b: WimsHistoryRow): boolean {
  return (
    a.ymCustNo === b.ymCustNo &&
    a.meterDay === b.meterDay &&
    a.customerNo === b.customerNo &&
    a.meterNo === b.meterNo &&
    a.gojikind === b.gojikind &&
    a.useQty === b.useQty &&
    a.freeQty === b.freeQty
  )
}

export function isWtlMetaPsLayer(item: WtlNetworkRow): boolean {
  const keys = [item.layerKey, item.fieldsTable, item.fieldsTableFallback]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter(Boolean)
  return keys.some((k) => k === 'wtl_meta_ps' || k.endsWith('_wtl_meta_ps'))
}

type Props = {
  item: WtlNetworkRow
  /** 지도 기본 모달 루트 — 있으면 상세를 그 옆(공간 없으면 위)에 배치 */
  relatedModalAnchorHostRef?: RefObject<HTMLElement | null>
}

export function WtlNetworkWimsHistoryTab({
  item,
  relatedModalAnchorHostRef,
}: Props) {
  const pair = useMemo(() => resolveMeterPair(item), [item])
  const pairKey = `${pair.customerNo}\0${pair.meterNo}`
  const reqRef = useRef(0)

  const [enabled, setEnabled] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [listLoading, setListLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<WimsHistoryRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [excelBusy, setExcelBusy] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [selectedRow, setSelectedRow] = useState<WimsHistoryRow | null>(null)
  const [detailCollapsed, setDetailCollapsed] = useState(false)
  const [detailAnchor, setDetailAnchor] = useState<{
    top: number
    left: number
  } | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / WIMS_PAGE_SIZE))
  const loading = statusLoading || listLoading

  useEffect(() => {
    let cancelled = false
    setStatusLoading(true)
    void loadWimsStatus()
      .then((st) => {
        if (cancelled) return
        setEnabled(st.enabled)
        setConnected(st.connected)
      })
      .catch(() => {
        if (cancelled) return
        setEnabled(false)
        setConnected(null)
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const fetchPage = useCallback(
    async (nextPage: number, word?: string) => {
      if (!pair.customerNo || !pair.meterNo) {
        setRows([])
        setTotal(0)
        setError('수용가번호·계량기기물번호가 없어 조회할 수 없습니다.')
        return
      }
      if (!enabled || connected === false) {
        setRows([])
        setTotal(0)
        return
      }
      const searchWord = String(word ?? keyword).trim()
      const req = ++reqRef.current
      setListLoading(true)
      setError(null)
      try {
        const res = await loadWimsList({
          customerNo: pair.customerNo,
          meterNo: pair.meterNo,
          pairs: [{ customerNo: pair.customerNo, meterNo: pair.meterNo }],
          page: nextPage,
          pageSize: WIMS_PAGE_SIZE,
          ...(searchWord
            ? { searchKeyword: searchWord, searchKeys: [...SEARCH_KEYS] }
            : { searchKeys: [...SEARCH_KEYS] }),
        })
        if (req !== reqRef.current) return
        setRows(res.dataList ?? [])
        setTotal(Number(res.totalCount) || 0)
        setPage(nextPage)
      } catch (err) {
        if (req !== reqRef.current) return
        setRows([])
        setTotal(0)
        setError(
          err instanceof WimsClientError
            ? err.message
            : 'WIMS 검침 이력을 불러오지 못했습니다.'
        )
      } finally {
        if (req === reqRef.current) setListLoading(false)
      }
    },
    [pair.customerNo, pair.meterNo, enabled, connected, keyword]
  )

  useEffect(() => {
    setPage(1)
    setRows([])
    setTotal(0)
    setError(null)
    setSearchInput('')
    setKeyword('')
    setSelectedRow(null)
    setDetailAnchor(null)
    setDetailCollapsed(false)
    if (statusLoading) return
    void fetchPage(1, '')
    // pair 변경 시에만 초기 조회 — keyword/fetchPage 순환 방지
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pairKey·statusLoading만
  }, [pairKey, statusLoading])

  const openDetail = useCallback(
    (row: WimsHistoryRow) => {
      setSelectedRow(row)
      setDetailCollapsed(false)
      const host = relatedModalAnchorHostRef?.current
      if (host) {
        const rect = host.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          setDetailAnchor(computeRelatedChildModalBesideParent(rect))
          return
        }
      }
      setDetailAnchor(null)
    },
    [relatedModalAnchorHostRef]
  )

  const closeDetail = useCallback(() => {
    setSelectedRow(null)
    setDetailAnchor(null)
  }, [])

  const onSearch = () => {
    const next = searchInput.trim()
    setKeyword(next)
    void fetchPage(1, next)
  }

  const onReset = () => {
    setSearchInput('')
    setKeyword('')
    void fetchPage(1, '')
  }

  const onExcel = async () => {
    if (!pair.customerNo || !pair.meterNo || excelBusy) return
    setExcelBusy(true)
    try {
      const searchWord = keyword.trim()
      await downloadWimsExcel({
        customerNo: pair.customerNo,
        meterNo: pair.meterNo,
        pairs: [{ customerNo: pair.customerNo, meterNo: pair.meterNo }],
        ...(searchWord
          ? { searchKeyword: searchWord, searchKeys: [...SEARCH_KEYS] }
          : { searchKeys: [...SEARCH_KEYS] }),
      })
    } catch (err) {
      setError(
        err instanceof WimsClientError
          ? err.message
          : '엑셀 내려받기에 실패했습니다.'
      )
    } finally {
      setExcelBusy(false)
    }
  }

  if (!statusLoading && !enabled) {
    return (
      <p className="standard-table-empty px-3 py-3">
        WIMS 연결 정보가 설정되어 있지 않습니다.
      </p>
    )
  }

  if (!statusLoading && connected === false) {
    return (
      <p className="standard-table-empty px-3 py-3 text-destructive">
        WIMS DB에 접속할 수 없습니다.
      </p>
    )
  }

  if (!statusLoading && (!pair.customerNo || !pair.meterNo)) {
    return (
      <p className="standard-table-empty px-3 py-3">
        수용가번호·계량기기물번호가 없어 이력을 표시하지 않습니다.
      </p>
    )
  }

  const detailSubtitle = selectedRow
    ? `${cellText(formatYmd(selectedRow.meterDay))} / ${cellText(selectedRow.meterNo)}`
    : ''

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <label className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-muted-foreground">
          <span className="shrink-0">통합검색</span>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              onSearch()
            }}
            title="통합검색"
            placeholder="종류·검침일·사용량 등"
            className="h-7 min-w-0 flex-1 cursor-text rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
          />
        </label>
        <button
          type="button"
          title="검색"
          disabled={loading}
          onClick={onSearch}
          className="inline-flex h-7 shrink-0 cursor-pointer items-center rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          검색
        </button>
        <button
          type="button"
          title="초기화"
          disabled={loading}
          onClick={onReset}
          className="inline-flex h-7 shrink-0 cursor-pointer items-center rounded border border-border px-2 text-[11px] font-medium text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          초기화
        </button>
      </div>
      <div className="standard-list-scroll">
        <table className="standard-detail-tab-table" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            {LIST_COLUMNS.map((col) => (
              <col key={col.key} style={{ width: `${col.widthPct ?? 0}%` }} />
            ))}
          </colgroup>
          <thead className="standard-detail-table-thead">
            <tr>
              {LIST_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="standard-detail-table-th standard-table-th-left max-w-none whitespace-nowrap"
                  title={col.label}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <WtlFacilityTableLoadingRow colSpan={COL_COUNT} />
            ) : error ? (
              <tr>
                <td
                  colSpan={COL_COUNT}
                  className="standard-table-empty text-destructive"
                >
                  {error}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COL_COUNT} className="standard-table-empty">
                  검침 이력이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const selected =
                  selectedRow != null && isSameHistoryRow(selectedRow, row)
                return (
                  <tr
                    key={`${row.ymCustNo}-${row.meterDay}-${row.meterNo}-${i}`}
                    className={cn(
                      'standard-list-row',
                      selected && 'standard-list-row-selected'
                    )}
                    title="상세보기"
                    onClick={() => openDetail(row)}
                  >
                    {LIST_COLUMNS.map((col) => {
                      const text = cellText(formatCell(row, col.key, col.kind))
                      return (
                        <td
                          key={col.key}
                          className={cn(
                            'standard-detail-tab-td',
                            (col.kind === 'date' || col.key === 'gojikind') &&
                              'whitespace-nowrap'
                          )}
                          title={text}
                        >
                          {text}
                        </td>
                      )
                    })}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="standard-list-footer flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate">
          {loading ? '조회 중…' : `총 ${total}건`}
        </span>
        {totalPages > 1 ? (
          <span className="inline-flex shrink-0 items-center gap-1">
            <button
              type="button"
              title="이전"
              disabled={page <= 1 || loading}
              onClick={() => void fetchPage(page - 1)}
              className="inline-flex h-6 cursor-pointer items-center rounded border border-border px-1.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              이전
            </button>
            <span className="text-[10px] text-muted-foreground">
              {page}/{totalPages}
            </span>
            <button
              type="button"
              title="다음"
              disabled={page >= totalPages || loading}
              onClick={() => void fetchPage(page + 1)}
              className="inline-flex h-6 cursor-pointer items-center rounded border border-border px-1.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              다음
            </button>
          </span>
        ) : null}
        <button
          type="button"
          title="전체 내려받기"
          disabled={excelBusy || total === 0 || loading}
          onClick={() => void onExcel()}
          className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-0.5 rounded border border-border px-1.5 text-[10px] font-medium text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {excelBusy ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <Download className="h-3 w-3" aria-hidden />
          )}
          전체 내려받기
        </button>
      </div>

      {selectedRow ? (
        <MapFloatingPanel
          key={`wims-${selectedRow.ymCustNo}-${selectedRow.meterDay}-${detailAnchor?.left ?? 'd'}-${detailAnchor?.top ?? 'd'}`}
          viewport
          zLayer="detailRelated"
          width="420px"
          maxHeight="70vh"
          className="bg-background backdrop-blur-none"
          defaultPosition={{
            top: detailAnchor?.top ?? COMPLAINT_DETAIL_PANEL_DEFAULT_TOP,
            left: detailAnchor?.left ?? 56,
          }}
          header={
            <>
              <button
                type="button"
                title={detailCollapsed ? '펼치기' : '접기'}
                aria-label={detailCollapsed ? '펼치기' : '접기'}
                aria-expanded={!detailCollapsed}
                onClick={() => setDetailCollapsed((v) => !v)}
                className="standard-panel-close mr-2 cursor-pointer"
              >
                <ChevronUp
                  className={cn('h-4 w-4', detailCollapsed && 'rotate-180')}
                  aria-hidden
                />
              </button>
              <div className="standard-detail-float-heading pr-2">
                <span
                  className="standard-detail-float-layer"
                  title="WIMS 검침 이력 상세"
                >
                  WIMS 검침 이력 상세
                </span>
                {detailSubtitle ? (
                  <span
                    className="standard-detail-float-title-below"
                    title={detailSubtitle}
                  >
                    {detailSubtitle}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                title="닫기"
                onClick={closeDetail}
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
              detailCollapsed && 'hidden'
            )}
          >
            <div className="standard-detail-scroll">
              <div className="standard-detail-attr-table">
                {DETAIL_COLUMNS.map((col) => {
                  const text = cellText(
                    formatCell(selectedRow, col.key, col.kind)
                  )
                  return (
                    <div key={col.key} className="contents">
                      <div className="standard-detail-attr-label standard-detail-attr-cell-border">
                        {col.label}
                      </div>
                      <div
                        className={cn(
                          'standard-detail-attr-value standard-detail-attr-cell-border text-foreground',
                          col.title && 'standard-detail-attr-value-title'
                        )}
                        title={text}
                      >
                        {text}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="standard-detail-edit-footer">
              <button
                type="button"
                title="닫기"
                onClick={closeDetail}
                className="standard-detail-hdr-btn"
              >
                닫기
              </button>
            </div>
          </div>
        </MapFloatingPanel>
      ) : null}
    </div>
  )
}
