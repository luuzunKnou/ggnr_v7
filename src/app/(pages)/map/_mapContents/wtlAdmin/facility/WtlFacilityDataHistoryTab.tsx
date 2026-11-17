'use client'

/**
 * 해당 행의 data_log 이력 조회 (시설관리·관망조회 등 공용)
 */
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Loader2, Undo2 } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useSerWriteAccess } from '@/hooks/useSerWriteAccess'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog'
import {
  getRowKey,
  getRowValueByField,
  isDefineFieldFlagTrue,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import { WtlFacilityTableLoadingRow } from './WtlFacilityTableLoadingRow'

const DEFAULT_SER_ENG = 'wtlFacility'

type DetailAttr = {
  name: string
  before?: string
  after?: string
  value?: string
  colName?: string
  ddKey?: number
  canRevert?: boolean
}

type HistoryRow = {
  id: string
  date: string
  userId: string
  userName: string
  category: string
  groupName: string
  layerName: string
  keyField: string
  keyValue: string
  workType: string
  canDetail: boolean
  canRevertAll?: boolean
  details?: DetailAttr[]
}

/** 시설·관망 등 이력 조회에 필요한 최소 행 정보 */
export type WtlDataHistorySourceRow = {
  id: string
  record: Record<string, unknown>
  tableName?: string | null
  fieldsTable?: string | null
  ogcFid?: number | null
}

type Props = {
  row: WtlDataHistorySourceRow
  fields: DefineFieldLike[]
  /** 메뉴별 쓰기 권한 키. 기본 시설관리 */
  serEng?: string
  /** 되돌리기 성공 후 상세·목록 갱신 */
  onReverted?: () => void
}

const PAGE_SIZE = 30

function cellText(v: string | null | undefined): string {
  const s = String(v ?? '').trim()
  return s || '—'
}

function collectKeyValues(
  row: WtlDataHistorySourceRow,
  fields: DefineFieldLike[]
): string[] {
  const out = new Set<string>()
  const keyField =
    fields.find((f) =>
      isDefineFieldFlagTrue(
        (f as DefineFieldLike & { define_field_is_key?: unknown }).define_field_is_key
      )
    ) ?? null
  const keyName = String(keyField?.define_field_name ?? '').trim() || null
  const fromKey = getRowKey(row.record, keyName)
  if (fromKey != null && String(fromKey).trim()) out.add(String(fromKey).trim())

  const ftr = getRowValueByField(row.record, 'ftr_idn')
  if (ftr != null && String(ftr).trim()) out.add(String(ftr).trim())

  if (row.ogcFid != null && Number.isFinite(row.ogcFid)) {
    out.add(String(row.ogcFid))
  }
  const ogc = getRowValueByField(row.record, 'ogc_fid')
  if (ogc != null && String(ogc).trim()) out.add(String(ogc).trim())

  return [...out]
}

/** 목록에서 되돌리기 후보 — 상세 가능한 추가·수정(되돌리기 이력 자체는 제외) */
function canShowRevert(row: HistoryRow): boolean {
  if (!row.canDetail) return false
  return row.workType === '추가' || row.workType === '수정'
}

export function WtlFacilityDataHistoryTab({
  row,
  fields,
  serEng = DEFAULT_SER_ENG,
  onReverted,
}: Props) {
  const canWrite = useSerWriteAccess(serEng)
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailRow, setDetailRow] = useState<HistoryRow | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const tableName = useMemo(
    () =>
      String(row.tableName || row.fieldsTable || '')
        .trim()
        .replace(/^.*\./, '')
        .toLowerCase(),
    [row.tableName, row.fieldsTable]
  )

  const keyValues = useMemo(() => collectKeyValues(row, fields), [row, fields])

  const loadList = useCallback(async () => {
    if (!tableName || keyValues.length === 0) {
      setRows([])
      setTotal(0)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await call('', 'POST', {
        service: 'dataHistoryService',
        action: 'getDataHistoryList',
        params: {
          tableName,
          keyValue: keyValues,
          page: 1,
          limit: PAGE_SIZE,
          excludeWorkTypes: ['조회'],
        },
      })
      const data = res?.data ?? res
      if (!data?.success) {
        setRows([])
        setTotal(0)
        setError(String(data?.error ?? '이력을 불러오지 못했습니다.'))
        return
      }
      setRows((data.data as HistoryRow[]) ?? [])
      setTotal(Number(data.total ?? 0))
    } catch (e: unknown) {
      setRows([])
      setTotal(0)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tableName, keyValues])

  useEffect(() => {
    setDetailRow(null)
    void loadList()
  }, [loadList, row.id])

  const openDetail = async (item: HistoryRow) => {
    if (!item.canDetail) return
    setDetailLoading(true)
    setDetailRow({ ...item, details: [] })
    try {
      const res = await call('', 'POST', {
        service: 'dataHistoryService',
        action: 'getDataHistoryDetail',
        params: { id: item.id },
      })
      const data = res?.data ?? res
      if (!data?.success || !data?.data) {
        setDetailRow({ ...item, details: [] })
        return
      }
      const d = data.data as HistoryRow
      setDetailRow({
        ...item,
        ...d,
        details: Array.isArray(d.details) ? d.details : [],
      })
    } catch {
      setDetailRow({ ...item, details: [] })
    } finally {
      setDetailLoading(false)
    }
  }

  const handleRevertRow = async (item: HistoryRow, e?: MouseEvent) => {
    e?.stopPropagation()
    if (!canWrite || !canShowRevert(item)) return
    if (
      !window.confirm(
        item.workType === '추가'
          ? '되돌리기를 실행합니다.\n이 이력으로 추가된 행을 삭제합니다. 계속할까요?'
          : '되돌리기를 실행합니다.\n이 이력의 속성을 변경 전 값으로 되돌립니다. 계속할까요?'
      )
    ) {
      return
    }
    setActionLoading(true)
    setError(null)
    try {
      const res = await call('', 'POST', {
        service: 'dataHistoryService',
        action: 'revertDataHistoryRow',
        params: { id: item.id },
      })
      const data = res?.data ?? res
      if (!data?.success) {
        setError(String(data?.error ?? '되돌리기에 실패했습니다.'))
        return
      }
      const n = Number(data.revertedCount ?? 0)
      window.alert(
        item.workType === '추가'
          ? '추가된 행을 삭제했습니다.'
          : n > 0
            ? `되돌리기 완료 (${n}개 속성)`
            : '되돌리기를 완료했습니다.'
      )
      setDetailRow(null)
      void loadList()
      onReverted?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading(false)
    }
  }

  const isCompare =
    detailRow?.workType === '수정' || detailRow?.workType === '되돌리기'

  if (!tableName || keyValues.length === 0) {
    return (
      <p className="standard-table-empty px-3 py-3">
        행 키를 찾을 수 없어 이력을 표시하지 않습니다.
      </p>
    )
  }

  const histColCount = canWrite ? 4 : 3

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="standard-list-scroll">
        <table className="standard-detail-tab-table">
          <colgroup>
            <col style={{ width: '9.5rem' }} />
            <col />
            <col style={{ width: '5.5rem' }} />
            {canWrite ? <col style={{ width: '5rem' }} /> : null}
          </colgroup>
          <thead className="standard-detail-table-thead">
            <tr>
              <th className="standard-detail-table-th standard-table-th-left" title="일자">
                일자
              </th>
              <th className="standard-detail-table-th standard-table-th-left" title="사용자">
                사용자
              </th>
              <th
                className="standard-detail-table-th standard-table-th-left max-w-none whitespace-nowrap"
                title="작업"
              >
                작업
              </th>
              {canWrite ? (
                <th
                  className="standard-detail-table-th text-center max-w-none whitespace-nowrap"
                  title="되돌리기"
                >
                  되돌리기
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <WtlFacilityTableLoadingRow colSpan={histColCount} />
            ) : error ? (
              <tr>
                <td colSpan={histColCount} className="standard-table-empty text-destructive">
                  {error}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={histColCount} className="standard-table-empty">
                  이 데이터의 이력이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const userLabel =
                  [r.userName, r.userId].filter((s) => String(s ?? '').trim()).join(' / ') ||
                  '—'
                const showRevert = canWrite && canShowRevert(r)
                return (
                  <tr
                    key={r.id}
                    className={cn(
                      'standard-list-row',
                      r.canDetail && 'cursor-pointer'
                    )}
                    title={r.canDetail ? '상세보기' : undefined}
                    onClick={() => {
                      if (r.canDetail) void openDetail(r)
                    }}
                  >
                    <td className="standard-detail-tab-td whitespace-nowrap" title={r.date}>
                      {cellText(r.date)}
                    </td>
                    <td className="standard-detail-tab-td" title={userLabel}>
                      {userLabel}
                    </td>
                    <td
                      className="standard-detail-tab-td max-w-none whitespace-nowrap"
                      title={r.workType}
                    >
                      {cellText(r.workType)}
                    </td>
                    {canWrite ? (
                      <td className="standard-detail-tab-td max-w-none text-center">
                        {showRevert ? (
                          <button
                            type="button"
                            className="inline-flex cursor-pointer text-muted-foreground hover:text-foreground disabled:opacity-50"
                            title="되돌리기"
                            disabled={actionLoading}
                            onClick={(e) => void handleRevertRow(r, e)}
                          >
                            {actionLoading ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Undo2 className="h-3.5 w-3.5" aria-hidden />
                            )}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    ) : null}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="standard-list-footer">
        {loading ? '조회 중…' : `총 ${total}건${total > rows.length ? ` (최근 ${rows.length}건)` : ''}`}
      </div>

      <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailRow(null)}>
        <DialogContent className="flex max-h-[80vh] flex-col gap-2 overflow-hidden sm:max-w-2xl">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-base">데이터 이력 상세</DialogTitle>
            {detailRow ? (
              <p className="break-words text-xs text-muted-foreground">
                {cellText(detailRow.date)} · {cellText(detailRow.workType)} ·{' '}
                {cellText(detailRow.category)} · {cellText(detailRow.keyField)} |{' '}
                {cellText(detailRow.keyValue)}
              </p>
            ) : null}
            {canWrite &&
            detailRow &&
            (detailRow.canRevertAll ||
              (detailRow.details ?? []).some((d) => d.canRevert && d.ddKey)) ? (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  className="standard-detail-hdr-btn"
                  title="전체 되돌리기"
                  disabled={actionLoading || detailLoading}
                  onClick={() => void handleRevertRow(detailRow)}
                >
                  <Undo2 className="h-3 w-3" aria-hidden />
                  전체 되돌리기
                </button>
              </div>
            ) : null}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {detailLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 불러오는 중…
              </div>
            ) : !(detailRow?.details?.length) ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                변경된 속성이 없습니다.
              </p>
            ) : (
              <div className="overflow-hidden rounded border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted">
                      <th className="border-b border-border px-2 py-1.5 text-left font-medium">
                        속성
                      </th>
                      {isCompare ? (
                        <>
                          <th className="border-b border-border px-2 py-1.5 text-left font-medium">
                            변경 전
                          </th>
                          <th className="border-b border-border px-2 py-1.5 text-left font-medium">
                            변경 후
                          </th>
                        </>
                      ) : (
                        <th className="border-b border-border px-2 py-1.5 text-left font-medium">
                          값
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {detailRow!.details!.map((d, i) => (
                      <tr key={`${d.name}-${i}`} className="border-t border-border">
                        <td
                          className="px-2 py-1.5 align-top text-muted-foreground"
                          title={d.name}
                        >
                          {cellText(d.name)}
                        </td>
                        {isCompare ? (
                          <>
                            <td
                              className="break-all px-2 py-1.5 align-top"
                              title={d.before}
                            >
                              {cellText(d.before)}
                            </td>
                            <td
                              className="break-all px-2 py-1.5 align-top"
                              title={d.after}
                            >
                              {cellText(d.after)}
                            </td>
                          </>
                        ) : (
                          <td
                            className="break-all px-2 py-1.5 align-top"
                            title={d.value ?? d.after}
                          >
                            {cellText(d.value ?? d.after)}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
