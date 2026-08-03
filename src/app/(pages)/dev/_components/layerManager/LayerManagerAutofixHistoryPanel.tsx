"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog"
import { call } from "@/lib/api"
import { RefreshCw } from "lucide-react"
import type { LayerSetupAutofixLogRow } from "@/service/devTestService"
import { ExcelProcessLogLines } from "../exl/ExcelProcessLogLines"

const PAGE_SIZE = 20

type Props = {
  /** 상위(자동 수정 등)에서 이력 새로고침을 트리거할 때 증가 */
  refreshToken?: number
}

export function LayerManagerAutofixHistoryPanel({ refreshToken = 0 }: Props) {
  const [logs, setLogs] = useState<LayerSetupAutofixLogRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [logOpen, setLogOpen] = useState(false)
  const [logLoading, setLogLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [logPath, setLogPath] = useState<string | null>(null)
  const [logContent, setLogContent] = useState<string | null>(null)
  const [logError, setLogError] = useState<string | null>(null)

  const fetchList = useCallback(async (pageArg: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "listLayerSetupAutofixLogs",
        params: { page: pageArg, limit: PAGE_SIZE },
      })
      const data = res?.data ?? res
      if (!data?.success) {
        setError(data?.error ?? "이력 목록을 불러올 수 없습니다.")
        setLogs([])
        setTotal(0)
        return
      }
      setLogs(Array.isArray(data.logs) ? (data.logs as LayerSetupAutofixLogRow[]) : [])
      setTotal(Number(data.total ?? 0))
      const serverPage = Number(data.page ?? pageArg)
      if (Number.isFinite(serverPage) && serverPage >= 1 && serverPage !== pageArg) {
        setPage(serverPage)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "이력 목록을 불러올 수 없습니다.")
      setLogs([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setPage(1)
  }, [refreshToken])

  useEffect(() => {
    void fetchList(page)
  }, [fetchList, page, refreshToken])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1)

  const openLog = useCallback(async (row: LayerSetupAutofixLogRow) => {
    setSelectedFile(row.fileName)
    setLogPath(row.relativePath)
    setLogContent(null)
    setLogError(null)
    setLogOpen(true)
    setLogLoading(true)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "getLayerSetupAutofixLog",
        params: { fileName: row.fileName },
      })
      const data = res?.data ?? res
      if (data?.logPath) setLogPath(String(data.logPath))
      if (!data?.success) {
        setLogError(data?.error ?? "로그 조회 실패")
        setLogContent(null)
        return
      }
      setLogContent(typeof data.content === "string" ? data.content : "")
    } catch (e) {
      setLogError(e instanceof Error ? e.message : String(e))
      setLogContent(null)
    } finally {
      setLogLoading(false)
    }
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex items-center gap-2 shrink-0 px-0.5">
        <span className="text-sm font-medium">자동 수정 이력</span>
        <span className="text-xs text-muted-foreground flex-1">
          총 {total}건 · 행 클릭 시 로그 보기
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 rounded-md gap-1"
          onClick={() => void fetchList(page)}
          disabled={loading}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          새로고침
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto border rounded-none bg-muted/20">
        {loading ? (
          <p className="p-2 text-xs text-muted-foreground">이력 로딩 중…</p>
        ) : error ? (
          <p className="p-2 text-xs text-destructive">{error}</p>
        ) : logs.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">자동 수정 이력이 없습니다.</p>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-muted border-b">
              <tr>
                <th className="py-1 px-2 text-left font-medium w-[150px]">일시</th>
                <th className="py-1 px-2 text-left font-medium">테이블명</th>
                <th className="py-1 px-2 text-left font-medium w-[72px]">결과</th>
                <th className="py-1 px-2 text-left font-medium">파일</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => (
                <tr
                  key={row.fileName}
                  className={`border-b cursor-pointer hover:bg-green-50/30 dark:hover:bg-green-950/10 ${
                    selectedFile === row.fileName && logOpen ? "bg-muted/60" : ""
                  }`}
                  onClick={() => void openLog(row)}
                >
                  <td className="py-1 px-2 whitespace-nowrap">{row.stampedAt}</td>
                  <td className="py-1 px-2 font-mono truncate max-w-[12rem]" title={row.tableName}>
                    {row.tableName}
                  </td>
                  <td className="py-1 px-2">
                    {row.result === "성공" ? (
                      <span className="text-green-700 dark:text-green-400">성공</span>
                    ) : row.result === "실패" ? (
                      <span className="text-red-600 dark:text-red-400">실패</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td
                    className="py-1 px-2 text-muted-foreground font-mono truncate max-w-[20rem]"
                    title={row.relativePath}
                  >
                    {row.fileName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-center gap-2 text-xs">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            이전
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            다음
          </Button>
        </div>
      )}

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-4xl sm:max-w-4xl w-[90vw] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="truncate">{selectedFile ?? "자동 수정 로그"}</DialogTitle>
            <DialogDescription className="font-mono text-xs truncate">
              {logPath ?? "—"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto rounded border bg-muted/30 p-3">
            {logLoading ? (
              <p className="text-xs text-muted-foreground">로그 불러오는 중…</p>
            ) : logError ? (
              <p className="text-xs text-destructive">{logError}</p>
            ) : (
              <ExcelProcessLogLines text={logContent} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
