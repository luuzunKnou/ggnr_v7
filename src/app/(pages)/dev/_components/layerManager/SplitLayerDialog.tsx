"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog"
import { Input } from "@/app/shadcnComponents/ui/input"
import { call } from "@/lib/api"
import { getGeoServerBase } from "@/lib/geoserverUrl"
import { splitChildLayerName, splitEtcLayerName, splitLayerColumn, splitLayerColumnLabel } from "@/lib/splitLayerTargets"
import { SearchClearButton } from "./SearchClearButton"

type CodeOption = { code: string; korName: string }

type PreviewRow = {
  layerName: string
  code: string
  codeKor: string
  korName: string
  etc?: boolean
}

type Props = {
  parent: string | null
  tables: Array<Record<string, unknown>>
  onOpenChange: (open: boolean) => void
  onDone: (message: string) => void
}

function selectedFromTables(parent: string, tables: Array<Record<string, unknown>>, codes: CodeOption[]) {
  const prefix = `${parent.toLowerCase()}_`
  const bySuffix = new Map(codes.map((item) => [item.code.toLowerCase(), item.code]))
  const selected = new Set<string>()
  for (const row of tables) {
    if (String(row.define_table_parents_layer ?? "").trim().toLowerCase() !== parent.toLowerCase()) continue
    const name = String(row.define_table_name ?? "").trim().toLowerCase()
    if (!name.startsWith(prefix)) continue
    const code = bySuffix.get(name.slice(prefix.length))
    if (code) selected.add(code)
  }
  return selected
}

function existingKor(tables: Array<Record<string, unknown>>, layerName: string): string {
  const row = tables.find((item) => String(item.define_table_name ?? "").trim().toLowerCase() === layerName)
  return String(row?.define_table_kor_name ?? "").trim()
}

export function SplitLayerDialog({ parent, tables, onOpenChange, onDone }: Props) {
  const column = parent ? splitLayerColumn(parent) : null
  const columnLabel = column ? splitLayerColumnLabel(column) : ""
  const tablesRef = useRef(tables)
  tablesRef.current = tables
  const [step, setStep] = useState<"pick" | "preview">("pick")
  const [codes, setCodes] = useState<CodeOption[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!parent || !column) return
    let cancelled = false
    setStep("pick")
    setPreview([])
    setLoading(true)
    setError(null)
    setQuery("")
    setCodes([])
    setSelected(new Set())
    void call("", "POST", {
      service: "splitLayerService",
      action: "listSplitLayerCodes",
      params: { parent },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as { success?: boolean; error?: string; codes?: CodeOption[] }
        if (!data?.success || !Array.isArray(data.codes)) {
          setError(data?.error ?? "코드를 불러오지 못했습니다.")
          return
        }
        setCodes(data.codes)
        setSelected(selectedFromTables(parent, tablesRef.current, data.codes))
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "코드를 불러오지 못했습니다.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [parent, column])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return codes
    return codes.filter(
      (item) => item.code.toLowerCase().includes(q) || item.korName.toLowerCase().includes(q)
    )
  }, [codes, query])

  const toggle = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const goPreview = () => {
    if (!parent) return
    const parentRow = tablesRef.current.find(
      (row) => String(row.define_table_name ?? "").trim().toLowerCase() === parent.toLowerCase()
    )
    const parentKor = String(parentRow?.define_table_kor_name ?? parent).trim() || parent
    const kept = new Map(preview.map((row) => [row.layerName, row.korName]))
    const rows: PreviewRow[] = codes
      .filter((item) => selected.has(item.code))
      .map((item) => {
        const layerName = splitChildLayerName(parent, item.code)
        const fallback = item.korName ? `${parentKor}(${item.korName})` : `${parentKor}(${item.code})`
        return {
          layerName,
          code: item.code,
          codeKor: item.korName,
          korName: kept.get(layerName) || existingKor(tablesRef.current, layerName) || fallback,
        }
      })
    const etcName = splitEtcLayerName(parent)
    rows.push({
      layerName: etcName,
      code: "",
      codeKor: "기타",
      korName: kept.get(etcName) || existingKor(tablesRef.current, etcName) || `${parentKor}(기타)`,
      etc: true,
    })
    setPreview(rows)
    setError(null)
    setStep("preview")
  }

  const apply = async () => {
    if (!parent) return
    const missing = preview.find((row) => !row.korName.trim())
    if (missing) {
      setError("한글명을 모두 입력하세요.")
      return
    }
    setApplying(true)
    setError(null)
    try {
      const korNames: Record<string, string> = {}
      for (const row of preview) korNames[row.layerName] = row.korName.trim()
      const res = await call("", "POST", {
        service: "splitLayerService",
        action: "applySplitLayers",
        params: {
          parent,
          codes: preview.filter((row) => !row.etc).map((row) => row.code),
          korNames,
          url: getGeoServerBase(),
        },
      })
      const data = (res?.data ?? res) as {
        success?: boolean
        error?: string
        published?: string[]
        removed?: string[]
      }
      if (!data?.success) {
        setError(data?.error ?? "분할 발행 실패")
        return
      }
      const published = data.published?.length ?? 0
      const removed = data.removed?.length ?? 0
      onDone(`분할 발행 ${published}건${removed > 0 ? `, 제거 ${removed}건` : ""}`)
      onOpenChange(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "분할 발행 실패")
    } finally {
      setApplying(false)
    }
  }

  const columnTitle = column ? (columnLabel ? `${column} (${columnLabel})` : column) : ""

  return (
    <Dialog open={!!parent} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {step === "pick" ? "분할 코드 선택" : "분할 미리보기"}: {parent}
          </DialogTitle>
        </DialogHeader>
        {columnTitle ? <p className="text-sm font-medium">{columnTitle}</p> : null}
        {step === "pick" ? (
          <>
            <p className="text-sm text-muted-foreground">
              분할로 쓸 코드를 고르세요. 고르지 않은 값과 빈 값은 기타로 묶입니다.
            </p>
            <div className="relative">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="코드·한글명 검색"
                className={`h-8 ${query ? "pr-8" : ""}`}
              />
              <SearchClearButton value={query} onClear={() => setQuery("")} />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <button
                type="button"
                className="text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
                disabled={loading || applying || codes.length === 0}
                onClick={() => setSelected(new Set(codes.map((item) => item.code)))}
              >
                전체 선택
              </button>
              <span className="text-muted-foreground">|</span>
              <button
                type="button"
                className="text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
                disabled={loading || applying || selected.size === 0}
                onClick={() => setSelected(new Set())}
              >
                선택 해제
              </button>
              <span className="ml-auto text-xs text-muted-foreground">선택 {selected.size}</span>
            </div>
            <div className="h-80 overflow-auto rounded border">
              {loading ? (
                <p className="p-3 text-sm text-muted-foreground">코드를 불러오는 중...</p>
              ) : visible.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">표시할 코드가 없습니다.</p>
              ) : (
                visible.map((item) => (
                  <label
                    key={item.code}
                    className="flex items-center gap-2 border-b px-2 py-1.5 text-sm last:border-b-0 hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(item.code)}
                      disabled={applying}
                      onChange={() => toggle(item.code)}
                    />
                    <span className="font-mono">{item.code}</span>
                    <span className="text-muted-foreground">{item.korName}</span>
                  </label>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              아래 형태로 레이어가 분할됩니다. 한글명 확인 후 발행해주세요.
            </p>
            <div className="max-h-80 overflow-auto rounded border">
              <div className="grid grid-cols-[1fr_9.5rem_1.2fr] gap-2 border-b bg-muted/50 px-2 py-1.5 text-xs font-medium">
                <span>레이어명</span>
                <span>코드</span>
                <span>한글명</span>
              </div>
              {preview.map((row) => (
                <div
                  key={row.layerName}
                  className="grid grid-cols-[1fr_9.5rem_1.2fr] items-center gap-2 border-b px-2 py-1.5 text-sm last:border-b-0"
                >
                  <span className="truncate font-mono text-xs" title={row.layerName}>
                    {row.layerName}
                  </span>
                  <span className="truncate" title={row.etc ? "선택하지 않은 값·빈 값" : row.codeKor}>
                    {row.etc ? "기타" : row.code}
                    {!row.etc && row.codeKor ? (
                      <span className="ml-1 text-muted-foreground">{row.codeKor}</span>
                    ) : null}
                  </span>
                  <Input
                    value={row.korName}
                    disabled={applying}
                    className="h-7 text-sm"
                    onChange={(e) => {
                      const value = e.target.value
                      setPreview((prev) =>
                        prev.map((item) => (item.layerName === row.layerName ? { ...item, korName: value } : item))
                      )
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        )}
        {error ? <p className="whitespace-pre-wrap text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          {step === "preview" ? (
            <Button type="button" variant="outline" disabled={applying} onClick={() => setStep("pick")}>
              이전
            </Button>
          ) : (
            <Button type="button" variant="outline" disabled={applying} onClick={() => onOpenChange(false)}>
              취소
            </Button>
          )}
          {step === "pick" ? (
            <Button type="button" disabled={loading || selected.size === 0} onClick={goPreview}>
              다음
            </Button>
          ) : (
            <Button type="button" disabled={applying} onClick={() => void apply()}>
              {applying ? "발행 중..." : "발행"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
