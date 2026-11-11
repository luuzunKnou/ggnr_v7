'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/app/shadcnComponents/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog'
import { Input } from '@/app/shadcnComponents/ui/input'
import { cn } from '@/lib/utils'
import type { LayerManagerRow } from './types'
import { downloadLayersCad } from './layerListDownload'

type CadFormat = 'dxf' | 'dwg'

type DefineField = {
  define_field_name?: string
  define_field_kor_name?: string
}

interface LayerManagerCadDownloadModalProps {
  open: boolean
  onClose: () => void
  rows: LayerManagerRow[]
}

function layerLabel(row: LayerManagerRow): string {
  return row.define_table_kor_name?.trim() || row.define_table_name?.trim() || '(이름 없음)'
}

function fieldLabel(f: DefineField): string {
  const kor = String(f.define_field_kor_name ?? '').trim()
  const name = String(f.define_field_name ?? '').trim()
  if (kor && name && kor !== name) return `${kor} (${name})`
  return kor || name
}

export function LayerManagerCadDownloadModal({
  open,
  onClose,
  rows,
}: LayerManagerCadDownloadModalProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [labelFieldByTable, setLabelFieldByTable] = useState<Record<string, string>>({})
  const [fieldsByTable, setFieldsByTable] = useState<Record<string, DefineField[]>>({})
  const [fieldsLoading, setFieldsLoading] = useState<Set<string>>(() => new Set())
  const fieldsFetchedRef = useRef<Set<string>>(new Set())
  const [format, setFormat] = useState<CadFormat>('dxf')
  const [dwgAvailable, setDwgAvailable] = useState(false)
  const [maxLayers, setMaxLayers] = useState(10)
  const [loadingCaps, setLoadingCaps] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const vectorRows = useMemo(
    () => rows.filter((r) => Boolean(String(r.define_table_name ?? '').trim())),
    [rows]
  )

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return vectorRows
    return vectorRows.filter(
      (r) =>
        r.define_table_kor_name.toLowerCase().includes(q) ||
        r.define_table_name.toLowerCase().includes(q) ||
        r.define_table_group.toLowerCase().includes(q)
    )
  }, [vectorRows, search])

  const selectedRows = useMemo(
    () => vectorRows.filter((r) => selected.has(r.define_table_name)),
    [vectorRows, selected]
  )

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setLabelFieldByTable({})
    setFormat('dxf')
    setError(null)
    setSearch('')
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingCaps(true)
    fetch('/api/download/cad', { credentials: 'include' })
      .then((r) => r.json())
      .then((body: { dwgConverterAvailable?: boolean; maxLayers?: number }) => {
        if (cancelled) return
        setDwgAvailable(Boolean(body?.dwgConverterAvailable))
        if (typeof body?.maxLayers === 'number' && body.maxLayers > 0) {
          setMaxLayers(body.maxLayers)
        }
      })
      .catch(() => {
        if (!cancelled) setDwgAvailable(false)
      })
      .finally(() => {
        if (!cancelled) setLoadingCaps(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!dwgAvailable && format === 'dwg') setFormat('dxf')
  }, [dwgAvailable, format])

  /** 선택된 레이어의 필드 목록 로드 */
  useEffect(() => {
    if (!open) return
    let cancelled = false
    for (const name of selected) {
      if (fieldsFetchedRef.current.has(name)) continue
      fieldsFetchedRef.current.add(name)
      setFieldsLoading((prev) => new Set(prev).add(name))
      void fetch(`/api/config/defineLayer/fields/${encodeURIComponent(name)}`, {
        credentials: 'include',
      })
        .then((r) => r.json())
        .then((body: { data?: DefineField[] }) => {
          const list = Array.isArray(body?.data) ? body.data : []
          if (!cancelled) setFieldsByTable((prev) => ({ ...prev, [name]: list }))
        })
        .catch(() => {
          fieldsFetchedRef.current.delete(name)
          if (!cancelled) setFieldsByTable((prev) => ({ ...prev, [name]: [] }))
        })
        .finally(() => {
          if (cancelled) {
            fieldsFetchedRef.current.delete(name)
            return
          }
          setFieldsLoading((prev) => {
            const next = new Set(prev)
            next.delete(name)
            return next
          })
        })
    }
    return () => {
      cancelled = true
    }
  }, [open, selected])

  const toggle = (name: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) {
        if (next.size >= maxLayers && !next.has(name)) {
          setError(`한 번에 최대 ${maxLayers}개까지 선택할 수 있습니다.`)
          return prev
        }
        next.add(name)
      } else {
        next.delete(name)
        setLabelFieldByTable((m) => {
          if (!(name in m)) return m
          const copy = { ...m }
          delete copy[name]
          return copy
        })
      }
      setError(null)
      return next
    })
  }

  const handleDownload = async () => {
    if (downloading) return
    if (selected.size === 0) {
      setError('레이어를 한 개 이상 선택하세요.')
      return
    }
    const layers = vectorRows
      .filter((r) => selected.has(r.define_table_name))
      .map((r) => ({
        tableName: r.define_table_name,
        schema:
          r.define_table_schema === 'public_layer'
            ? ('public_layer' as const)
            : ('layer' as const),
        labelField: labelFieldByTable[r.define_table_name]?.trim() || null,
      }))

    setDownloading(true)
    setProgress('CAD 변환 시작…')
    setError(null)
    try {
      await downloadLayersCad(layers, format, (msg) => setProgress(msg))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDownloading(false)
      setProgress(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !downloading && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b shrink-0">
          <DialogTitle>CAD 다운로드</DialogTitle>
          <p className="text-xs text-muted-foreground font-normal">
            선택한 레이어를 하나의 DXF/DWG로 받습니다. 라벨 속성을 고르면 QGIS와 같이 같은 레이어에 선 방향 글자로 들어갑니다.
          </p>
        </DialogHeader>

        <div className="px-4 pt-3 shrink-0 space-y-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="그룹명·테이블명·한글명 검색"
            className="h-8 text-sm"
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <button
              type="button"
              className="rounded border px-2 py-1 hover:bg-muted"
              onClick={() => {
                setSelected(new Set())
                setLabelFieldByTable({})
                setError(null)
              }}
            >
              선택 해제
            </button>
            <span className="ml-auto">
              {selected.size}/{maxLayers} 선택
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-4 py-2">
          <ul className="space-y-1">
            {filteredRows.map((row) => {
              const name = row.define_table_name
              const checked = selected.has(name)
              const fields = fieldsByTable[name] ?? []
              const loadingFields = fieldsLoading.has(name)
              return (
                <li
                  key={row.rowKey}
                  className={cn(
                    'rounded-md border border-transparent px-2 py-1.5',
                    checked && 'border-border bg-primary/5'
                  )}
                >
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggle(name, e.target.checked)}
                      className="accent-primary shrink-0"
                    />
                    <span className="min-w-0 truncate font-medium">{layerLabel(row)}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {name}
                    </span>
                  </label>
                  {checked && (
                    <div className="mt-1.5 ml-6 flex items-center gap-2">
                      <span className="shrink-0 text-[11px] text-muted-foreground">라벨</span>
                      <select
                        className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-[11px]"
                        value={labelFieldByTable[name] ?? ''}
                        disabled={loadingFields}
                        onChange={(e) =>
                          setLabelFieldByTable((prev) => ({
                            ...prev,
                            [name]: e.target.value,
                          }))
                        }
                      >
                        <option value="">없음 (도형만)</option>
                        {fields.map((f) => {
                          const fname = String(f.define_field_name ?? '').trim()
                          if (!fname) return null
                          return (
                            <option key={fname} value={fname}>
                              {fieldLabel(f)}
                            </option>
                          )
                        })}
                      </select>
                      {loadingFields && (
                        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0" />
                      )}
                    </div>
                  )}
                </li>
              )
            })}
            {filteredRows.length === 0 && (
              <li className="py-6 text-center text-xs text-muted-foreground">검색 결과가 없습니다.</li>
            )}
          </ul>
        </div>

        {selectedRows.some((r) => labelFieldByTable[r.define_table_name]) && (
          <p className="px-4 pb-1 text-[11px] text-muted-foreground shrink-0">
            라벨은 도형과 같은 레이어에 TEXT로 들어가고, 선은 진행 방향으로 기울입니다.
          </p>
        )}

        <div className="shrink-0 border-t px-4 py-3 space-y-3">
          <div className="flex items-center gap-4 text-xs">
            <span className="text-muted-foreground">형식</span>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="layer-mgr-cad-format"
                checked={format === 'dxf'}
                onChange={() => setFormat('dxf')}
              />
              DXF
            </label>
            <label
              className={cn(
                'inline-flex items-center gap-1.5',
                dwgAvailable ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
              )}
              title={dwgAvailable ? undefined : 'DWG 변환 환경이 없습니다'}
            >
              <input
                type="radio"
                name="layer-mgr-cad-format"
                checked={format === 'dwg'}
                disabled={!dwgAvailable || loadingCaps}
                onChange={() => setFormat('dwg')}
              />
              DWG
            </label>
          </div>
          {progress && !error && (
            <p className="text-xs text-muted-foreground">{progress}</p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={downloading}>
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleDownload()}
              disabled={downloading || selected.size === 0}
            >
              {downloading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : (
                <Download className="w-3.5 h-3.5 mr-1.5" />
              )}
              {downloading ? '변환 중…' : '다운로드'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
