'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { call } from '@/lib/api'
import { MeterNumberSuggestInput } from './MeterNumberSuggestInput'

export type MeterBulkCandidate = {
  meterNo: string
  address: string
  point: [number, number] | null
}

type CodeOpt = { code: string; name: string }
type BlockOpt = { value: string; label: string }

type Props = {
  open: boolean
  onClose: () => void
  onAdd: (meters: MeterBulkCandidate[]) => void
  /** 이미 목록에 있는 계량기번호(중복 표시용) */
  existingKeys: Set<string>
}

/**
 * 계량기위치 — 읍면동·리·급수블록으로 일괄 추가하는 플로팅 모달.
 */
export function MeterBulkAddModal({ open, onClose, onAdd, existingKeys }: Props) {
  const [pos, setPos] = useState({ x: 120, y: 80 })
  const [size, setSize] = useState({ width: 560, height: 480 })
  const dragRef = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null)
  const resizeRef = useRef<{ ox: number; oy: number; w: number; h: number } | null>(null)

  const [emdOptions, setEmdOptions] = useState<CodeOpt[]>([])
  const [riOptions, setRiOptions] = useState<CodeOpt[]>([])
  const [blockOptions, setBlockOptions] = useState<BlockOpt[]>([])
  const [emdSelected, setEmdSelected] = useState('')
  const [riSelected, setRiSelected] = useState('')
  const [blockSelected, setBlockSelected] = useState('')

  const [rows, setRows] = useState<MeterBulkCandidate[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [error, setError] = useState('')
  const listReqRef = useRef(0)

  // 다시 열 때 조건·목록을 유지한다. 닫을 때 진행 중 요청만 무효화.
  useEffect(() => {
    if (!open) {
      listReqRef.current += 1
      return
    }
    setSize({ width: 560, height: 480 })
  }, [open])

  const handleResetFilters = () => {
    listReqRef.current += 1
    setEmdSelected('')
    setRiSelected('')
    setBlockSelected('')
    setRows([])
    setChecked(new Set())
    setSearchText('')
    setError('')
    setLoading(false)
    setSearching(false)
  }

  /** 계량기번호 검색 → 모달 목록에 추가(체크). 입력 중에는 목록 필터도 동작. */
  const handleSearchAdd = async () => {
    const q = searchText.replace(/\u00a0/g, ' ').trim()
    if (!q) {
      setError('계량기 번호 또는 주소를 입력해주세요.')
      return
    }
    const key = q.replace(/\s+/g, '')
    const already = rows.find((r) => r.meterNo.replace(/\s+/g, '') === key)
    if (already) {
      setChecked((prev) => new Set(prev).add(already.meterNo))
      setSearchText('')
      setError('')
      return
    }
    setSearching(true)
    setError('')
    try {
      const res = await call('', 'POST', {
        service: 'wtlMeterLocationService',
        action: 'locateMetersByNumbers',
        params: { numbers: [q] },
      })
      const body = (res as { data?: { rows?: Array<Record<string, unknown>> } })?.data ?? res
      const hit = Array.isArray((body as { rows?: unknown[] })?.rows)
        ? ((body as { rows: Array<Record<string, unknown>> }).rows[0] ?? null)
        : null
      const meterNo = String(hit?.meterNo ?? q).trim() || q
      const address = String(hit?.address ?? '').trim()
      let validPoint: [number, number] | null = null
      const rawPoint = hit?.point
      if (Array.isArray(rawPoint) && rawPoint.length >= 2) {
        const lon = Number(rawPoint[0])
        const lat = Number(rawPoint[1])
        if (Number.isFinite(lon) && Number.isFinite(lat)) validPoint = [lon, lat]
      }
      const found = Boolean(hit && (hit.found === true || validPoint))
      const next: MeterBulkCandidate = {
        meterNo,
        address: address || (found ? '' : q),
        point: found ? validPoint : null,
      }
      setRows((prev) => {
        if (prev.some((r) => r.meterNo.replace(/\s+/g, '') === meterNo.replace(/\s+/g, ''))) {
          return prev
        }
        return [...prev, next]
      })
      setChecked((prev) => new Set(prev).add(meterNo))
      setSearchText('')
      if (!found) {
        setError(
          '계량기 위치를 찾지 못했지만 목록에 추가했습니다. 주소만으로 찾으려면 메인 화면 입력을 이용하세요.'
        )
      }
    } catch {
      setError('계량기 검색에 실패했습니다.')
    } finally {
      setSearching(false)
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void call('', 'POST', {
      service: 'devTestService',
      action: 'getEmdRiOptions',
      params: {},
    })
      .then((res) => {
        if (cancelled) return
        const data = (res as { data?: { emd?: CodeOpt[] } })?.data ?? res
        setEmdOptions(Array.isArray((data as { emd?: CodeOpt[] })?.emd) ? (data as { emd: CodeOpt[] }).emd : [])
      })
      .catch(() => {
        if (!cancelled) setEmdOptions([])
      })
    void call('', 'POST', {
      service: 'wtlNetworkService',
      action: 'listWtlSupplyBlockOptions',
      params: {},
    })
      .then((res) => {
        if (cancelled) return
        const data = (res as { data?: { options?: BlockOpt[] } })?.data ?? res
        setBlockOptions(
          Array.isArray((data as { options?: BlockOpt[] })?.options)
            ? (data as { options: BlockOpt[] }).options
            : []
        )
      })
      .catch(() => {
        if (!cancelled) setBlockOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (!emdSelected) {
      setRiOptions([])
      setRiSelected('')
      return
    }
    let cancelled = false
    void call('', 'POST', {
      service: 'devTestService',
      action: 'getRiOptionsByEmd',
      params: { emdCode: emdSelected },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res as { data?: { ri?: CodeOpt[] } })?.data ?? res
        setRiOptions(Array.isArray((data as { ri?: CodeOpt[] })?.ri) ? (data as { ri: CodeOpt[] }).ri : [])
        setRiSelected('')
      })
      .catch(() => {
        if (!cancelled) {
          setRiOptions([])
          setRiSelected('')
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, emdSelected])

  useEffect(() => {
    if (!open) return
    const emd = emdSelected.trim()
    const ri = riSelected.trim()
    const block = blockSelected.trim()
    if (!emd && !ri && !block) {
      setRows([])
      setChecked(new Set())
      setError('')
      setLoading(false)
      return
    }
    const reqId = listReqRef.current + 1
    listReqRef.current = reqId
    setLoading(true)
    setError('')
    void call('', 'POST', {
      service: 'wtlMeterLocationService',
      action: 'listMetersByArea',
      params: {
        emdCode: emd || null,
        riCode: ri || null,
        block: block || null,
      },
    })
      .then((res) => {
        if (listReqRef.current !== reqId) return
        const data =
          (res as { data?: { rows?: MeterBulkCandidate[]; error?: string } })?.data ?? res
        const body = data as { rows?: MeterBulkCandidate[]; error?: string }
        const next = Array.isArray(body?.rows)
          ? body.rows
              .map((r) => {
                const meterNo = String(r.meterNo ?? '').trim()
                const address = String(r.address ?? '').trim()
                const rawPoint = (r as MeterBulkCandidate).point
                let point: [number, number] | null = null
                if (
                  Array.isArray(rawPoint) &&
                  rawPoint.length >= 2 &&
                  Number.isFinite(Number(rawPoint[0])) &&
                  Number.isFinite(Number(rawPoint[1]))
                ) {
                  point = [Number(rawPoint[0]), Number(rawPoint[1])]
                }
                return { meterNo, address, point }
              })
              .filter((r) => r.meterNo)
          : []
        setRows(next)
        setChecked(new Set(next.map((r) => r.meterNo)))
        setError(typeof body?.error === 'string' && body.error.trim() ? body.error : '')
      })
      .catch(() => {
        if (listReqRef.current !== reqId) return
        setRows([])
        setChecked(new Set())
        setError('계량기 목록을 불러오지 못했습니다.')
      })
      .finally(() => {
        if (listReqRef.current === reqId) setLoading(false)
      })
  }, [open, emdSelected, riSelected, blockSelected])

  useEffect(() => {
    if (!open) return
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const d = dragRef.current
        setPos({
          x: Math.max(0, d.px + e.clientX - d.ox),
          y: Math.max(0, d.py + e.clientY - d.oy),
        })
      }
      if (resizeRef.current) {
        const r = resizeRef.current
        setSize({
          width: Math.max(420, r.w + e.clientX - r.ox),
          height: Math.max(320, r.h + e.clientY - r.oy),
        })
      }
    }
    const onUp = () => {
      dragRef.current = null
      resizeRef.current = null
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [open])

  const filteredRows = useMemo(() => {
    const q = searchText.replace(/\u00a0/g, ' ').trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const no = r.meterNo.toLowerCase()
      const addr = r.address.toLowerCase()
      return no.includes(q) || addr.includes(q)
    })
  }, [rows, searchText])

  const allChecked =
    filteredRows.length > 0 && filteredRows.every((r) => checked.has(r.meterNo))
  const checkedCount = useMemo(
    () => rows.filter((r) => checked.has(r.meterNo)).length,
    [rows, checked]
  )

  const toggleAll = () => {
    if (allChecked) {
      setChecked((prev) => {
        const next = new Set(prev)
        for (const r of filteredRows) next.delete(r.meterNo)
        return next
      })
    } else {
      setChecked((prev) => {
        const next = new Set(prev)
        for (const r of filteredRows) next.add(r.meterNo)
        return next
      })
    }
  }

  const toggleOne = (meterNo: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(meterNo)) next.delete(meterNo)
      else next.add(meterNo)
      return next
    })
  }

  const handleAdd = () => {
    const selected = rows.filter((r) => checked.has(r.meterNo))
    if (selected.length === 0) {
      setError('추가할 계량기를 선택하세요.')
      return
    }
    onAdd(selected)
    onClose()
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[80] flex flex-col overflow-hidden rounded-md border border-border bg-card shadow-xl"
      style={{ left: pos.x, top: pos.y, width: size.width, height: size.height }}
      role="dialog"
      aria-label="일괄 입력"
    >
      <div
        className="flex h-10 shrink-0 cursor-move items-center justify-between gap-2 border-b border-border bg-muted/40 px-3"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          dragRef.current = { ox: e.clientX, oy: e.clientY, px: pos.x, py: pos.y }
          document.body.style.userSelect = 'none'
          document.body.style.cursor = 'move'
        }}
      >
        <span className="truncate text-[13px] font-semibold text-foreground">일괄 입력</span>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-foreground/90"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-1.5">
          <div className="grid min-w-0 flex-1 grid-cols-3 gap-1.5">
            <select
              value={emdSelected}
              onChange={(e) => setEmdSelected(e.target.value)}
              className="standard-detail-input h-8 min-w-0 cursor-pointer px-1 text-[11px]"
              title="읍면동"
              aria-label="읍면동"
            >
              <option value="">읍면동</option>
              {emdOptions.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.name}
                </option>
              ))}
            </select>
            <select
              value={riSelected}
              onChange={(e) => setRiSelected(e.target.value)}
              disabled={!emdSelected}
              className="standard-detail-input h-8 min-w-0 cursor-pointer px-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-60"
              title={emdSelected ? '리' : '읍면동을 먼저 선택하세요'}
              aria-label="리"
            >
              <option value="">리</option>
              {riOptions.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.name}
                </option>
              ))}
            </select>
            <select
              value={blockSelected}
              onChange={(e) => setBlockSelected(e.target.value)}
              className="standard-detail-input h-8 min-w-0 cursor-pointer px-1 text-[11px]"
              title="급수블록"
              aria-label="급수블록"
            >
              <option value="">급수블록</option>
              {blockOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            title="조건 초기화"
            onClick={handleResetFilters}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          >
            초기화
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <MeterNumberSuggestInput
            value={searchText}
            onChange={setSearchText}
            onSubmit={() => void handleSearchAdd()}
            disabled={loading || searching}
            className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-xs text-slate-800 outline-none focus:border-slate-400 disabled:opacity-50"
            placeholder="계량기 번호 또는 주소 검색"
          />
          <button
            type="button"
            title="목록에 추가"
            disabled={loading || searching}
            onClick={() => void handleSearchAdd()}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded border border-primary bg-primary px-2.5 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {searching ? '검색 중' : '목록에 추가'}
          </button>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-600">
          <span>
            {loading
              ? '조회 중…'
              : rows.length > 0
                ? `${checkedCount} / ${rows.length}건 선택` +
                  (searchText.trim() && filteredRows.length !== rows.length
                    ? ` (표시 ${filteredRows.length})`
                    : '')
                : '조건 선택 또는 번호 검색으로 목록을 만드세요.'}
          </span>
          {filteredRows.length > 0 && (
            <button
              type="button"
              title={allChecked ? '전체 해제' : '전체 선택'}
              onClick={toggleAll}
              className="cursor-pointer text-primary hover:underline"
            >
              {allChecked ? '전체 해제' : '전체 선택'}
            </button>
          )}
        </div>

        {error && <p className="text-[11px] text-red-600">{error}</p>}

        <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th className="w-9 px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    disabled={filteredRows.length === 0}
                    onChange={toggleAll}
                    title="전체 선택"
                    aria-label="전체 선택"
                    className="cursor-pointer"
                  />
                </th>
                <th className="px-2 py-1.5 font-medium">계량기번호</th>
                <th className="px-2 py-1.5 font-medium">주소</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-2 py-8 text-center text-slate-400">
                    {loading
                      ? '조회 중…'
                      : rows.length > 0
                        ? '검색 결과가 없습니다.'
                        : '목록이 없습니다.'}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const dup = existingKeys.has(row.meterNo.replace(/\s+/g, ''))
                  const isOn = checked.has(row.meterNo)
                  return (
                    <tr
                      key={row.meterNo}
                      title={isOn ? '선택 해제' : '선택'}
                      onClick={() => toggleOne(row.meterNo)}
                      className={cn(
                        'cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50',
                        isOn && 'bg-slate-50',
                        dup && 'bg-amber-50/60 hover:bg-amber-50'
                      )}
                    >
                      <td className="px-2 py-1">
                        <input
                          type="checkbox"
                          checked={isOn}
                          onChange={() => toggleOne(row.meterNo)}
                          onClick={(e) => e.stopPropagation()}
                          title={row.meterNo}
                          aria-label={row.meterNo}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="px-2 py-1 font-medium text-slate-800">
                        {row.meterNo}
                        {dup ? (
                          <span className="ml-1 text-[10px] font-normal text-amber-700">
                            (목록에 있음)
                          </span>
                        ) : null}
                      </td>
                      <td className="truncate px-2 py-1 text-slate-500">{row.address || '—'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5">
          <button
            type="button"
            title="취소"
            onClick={onClose}
            className="inline-flex h-8 cursor-pointer items-center rounded border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            취소
          </button>
          <button
            type="button"
            title="추가"
            disabled={loading || checkedCount === 0}
            onClick={handleAdd}
            className="inline-flex h-8 cursor-pointer items-center rounded border border-primary bg-primary px-3 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            추가 ({checkedCount})
          </button>
        </div>
      </div>

      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
        onMouseDown={(e) => {
          e.preventDefault()
          resizeRef.current = {
            ox: e.clientX,
            oy: e.clientY,
            w: size.width,
            h: size.height,
          }
          document.body.style.userSelect = 'none'
          document.body.style.cursor = 'se-resize'
        }}
        aria-hidden
      />
    </div>,
    document.body
  )
}
