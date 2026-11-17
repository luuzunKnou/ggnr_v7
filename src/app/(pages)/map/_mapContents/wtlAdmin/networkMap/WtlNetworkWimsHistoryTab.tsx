'use client'

/**
 * 급수전계량기 상세 — WIMS 검침 이력
 * 계량기기물번호(MET_NUM)·수용가번호(HOM_NUM)로 /api/wims/list 조회
 * UI는 «데이터 이력관리» 탭(standard-detail-tab-table)과 동일 골격
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  downloadWimsExcel,
  loadWimsList,
  loadWimsStatus,
  WimsClientError,
} from '@/app/(pages)/map/_mapComponents/landInfo/wimsClient'
import { getRowValueByField } from '@/app/(pages)/map/_mapComponents/standard/defineLayerRowUtils'
import {
  WIMS_GOJIKIND,
  WIMS_PAGE_SIZE,
  type WimsHistoryRow,
} from '@/lib/wimsTypes'
import { WtlFacilityTableLoadingRow } from '../facility/WtlFacilityTableLoadingRow'
import type { WtlNetworkRow } from './wtlNetworkTypes'

/**
 * 컬럼 정의 · 너비(%) 조절
 * - widthPct: 표 전체 대비 비율. 합계 100 권장.
 * - 조절 위치: 이 파일 상단 COLUMNS 배열의 widthPct
 */
const COLUMNS: {
  key: keyof WimsHistoryRow
  label: string
  kind: 'code' | 'date' | 'number' | 'text'
  /** 테이블 열 너비 (%) */
  widthPct: number
}[] = [
  { key: 'gojikind', label: '종류', kind: 'code', widthPct: 8 },
  { key: 'meterDay', label: '검침일', kind: 'date', widthPct: 15 },
  { key: 'nabgiDate', label: '납기마감일', kind: 'date', widthPct: 15 },
  { key: 'meterNo', label: '계량기번호', kind: 'text', widthPct: 15 },
  { key: 'useQty', label: '사용량', kind: 'number', widthPct: 12 },
  { key: 'freeQty', label: '사용료', kind: 'number', widthPct: 12 },
  { key: 'induty', label: '업종', kind: 'text', widthPct: 10 },
  { key: 'delYn', label: '상태', kind: 'text', widthPct: 12 },
]

const COL_COUNT = COLUMNS.length
/** 화면에 보이는 th 컬럼 키 — 통합검색 대상 */
const SEARCH_KEYS = COLUMNS.map((c) => c.key)

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

export function isWtlMetaPsLayer(item: WtlNetworkRow): boolean {
  const keys = [item.layerKey, item.fieldsTable, item.fieldsTableFallback]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter(Boolean)
  return keys.some((k) => k === 'wtl_meta_ps' || k.endsWith('_wtl_meta_ps'))
}

type Props = {
  item: WtlNetworkRow
}

export function WtlNetworkWimsHistoryTab({ item }: Props) {
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
    if (statusLoading) return
    void fetchPage(1, '')
    // pair 변경 시에만 초기 조회 — keyword/fetchPage 순환 방지
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pairKey·statusLoading만
  }, [pairKey, statusLoading])

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
            {COLUMNS.map((col) => (
              <col key={col.key} style={{ width: `${col.widthPct}%` }} />
            ))}
          </colgroup>
          <thead className="standard-detail-table-thead">
            <tr>
              {COLUMNS.map((col) => (
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
              rows.map((row, i) => (
                <tr
                  key={`${row.ymCustNo}-${row.meterDay}-${row.meterNo}-${i}`}
                  className="standard-list-row"
                >
                  {COLUMNS.map((col) => {
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
              ))
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
    </div>
  )
}
