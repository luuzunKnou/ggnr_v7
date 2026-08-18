"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Input } from "@/app/shadcnComponents/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/shadcnComponents/ui/table"
import { call } from "@/lib/api"
import { randomId } from "@/lib/randomId"
import { Plus, Trash2 } from "lucide-react"

type EnvRow = { id: string; key: string; value: string }
type Scope = "project" | "common"

function rowsFromServer(rows: { key: string; value: string }[]): EnvRow[] {
  return rows.map((r, i) => ({
    id: `loaded-${i}`,
    key: r.key,
    value: r.value,
  }))
}

export function RuntimeEnvEditor() {
  const [scope, setScope] = useState<Scope>("project")
  const [rows, setRows] = useState<EnvRow[]>([])
  const [meta, setMeta] = useState<{ project: string; path: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const skipNextSave = useRef(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (nextScope: Scope) => {
    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      const res = await call("", "POST", {
        service: "configService",
        action: nextScope === "common" ? "getCommonRuntimeEnvRows" : "getRuntimeEnvRows",
        params: {},
      })
      if (!res.success) throw new Error(res.error ?? "조회 실패")
      const data = res.data as { project?: string; path?: string; rows?: { key: string; value: string }[] }
      setMeta({
        project: String(data.project ?? ""),
        path: String(data.path ?? ""),
      })
      setRows(rowsFromServer(Array.isArray(data.rows) ? data.rows : []))
      skipNextSave.current = true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "조회 실패")
      setRows([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(scope)
  }, [load, scope])

  const persist = useCallback(
    async (nextRows: EnvRow[], nextScope: Scope) => {
      setSaving(true)
      setError(null)
      setStatus(null)
      try {
        const payload = nextRows.map(({ key, value }) => ({ key, value }))
        const res = await call("", "POST", {
          service: "configService",
          action: nextScope === "common" ? "saveCommonRuntimeEnvRows" : "saveRuntimeEnvRows",
          params: { rows: payload },
        })
        if (!res.success) throw new Error(res.error ?? "저장 실패")
        setStatus("파일에 반영되었습니다.")
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "저장 실패")
      } finally {
        setSaving(false)
      }
    },
    []
  )

  useEffect(() => {
    if (loading || !meta) return
    if (skipNextSave.current) {
      skipNextSave.current = false
      return
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      void persist(rows, scope)
    }, 550)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [rows, loading, meta, persist, scope])

  const updateRow = (id: string, patch: Partial<Pick<EnvRow, "key" | "value">>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const addRow = () => {
    setRows((prev) => [...prev, { id: `new-${randomId()}`, key: "", value: "" }])
  }

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  const switchScope = (next: Scope) => {
    if (next === scope) return
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    skipNextSave.current = true
    setScope(next)
  }

  if (loading && !meta) {
    return <p className="text-sm text-muted-foreground">불러오는 중…</p>
  }

  if (error && !meta) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void load(scope)} title="다시 시도">
          다시 시도
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 min-h-0 w-full">
      <div className="flex shrink-0 gap-1 border-b text-sm">
        <button
          type="button"
          title="프로젝트"
          className={`cursor-pointer border-b-2 px-3 py-2 ${
            scope === "project"
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground"
          }`}
          onClick={() => switchScope("project")}
        >
          프로젝트
        </button>
        <button
          type="button"
          title="공용"
          className={`cursor-pointer border-b-2 px-3 py-2 ${
            scope === "common"
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground"
          }`}
          onClick={() => switchScope("common")}
        >
          공용
        </button>
      </div>

      {meta ? (
        <div className="text-xs text-muted-foreground space-y-0.5 font-mono break-all">
          <div>
            {scope === "common" ? "범위" : "프로젝트"}:{" "}
            <span className="text-foreground/90">
              {scope === "common" ? "전체 프로젝트 내 공용 사용되는 값 관리" : meta.project}
            </span>
          </div>
          <div>{meta.path}</div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={addRow} className="gap-1" title="행 추가">
          <Plus className="h-4 w-4" />
          행 추가
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving}
          title="파일에서 다시 읽기"
          onClick={() => {
            skipNextSave.current = true
            void load(scope)
          }}
        >
          파일에서 다시 읽기
        </Button>
        {saving ? <span className="text-xs text-muted-foreground">저장 중…</span> : null}
        {status && !saving ? <span className="text-xs text-emerald-600 dark:text-emerald-400">{status}</span> : null}
      </div>

      {error && meta ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="rounded-md border border-border overflow-auto max-h-[calc(100vh-16rem)]">
        <Table className="">
          <TableHeader className="">
            <TableRow>
              <TableHead className="w-[min(15%)]">변수명</TableHead>
              <TableHead>값</TableHead>
              <TableHead className="w-12"> </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-sm text-muted-foreground py-5 text-center">
                  항목이 없습니다. 「행 추가」로 변수를 추가하세요.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className="max-h-5">
                  <TableCell className="align-middle p-0">
                    <Input
                      value={r.key}
                      onChange={(e) => updateRow(r.id, { key: e.target.value })}
                      placeholder="KEY"
                      className="text-[11px] h-7 border-none shadow-none"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </TableCell>
                  <TableCell className="align-middle py-0">
                    <Input
                      value={r.value}
                      onChange={(e) => updateRow(r.id, { value: e.target.value })}
                      placeholder="값"
                      className="text-[11px] h-7 border-none shadow-none m-0 p-0"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </TableCell>
                  <TableCell className="align-middle py-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-9 text-muted-foreground hover:text-destructive"
                      onClick={() => removeRow(r.id)}
                      aria-label="행 삭제"
                      title="행 삭제"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        입력 후 잠시 두면 자동으로 디스크에 저장됩니다. 서버는 매 요청마다 파일을 다시 읽으므로 재시작 없이 반영됩니다.
        {scope === "common"
          ? " 공용 탭 저장 시 파일의 주석 줄은 유지되지 않을 수 있습니다."
          : null}
      </p>
    </div>
  )
}
