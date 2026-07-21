"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog"
import { call } from "@/lib/api"
import { Loader2 } from "lucide-react"

type HistoryRow = {
  dhKey: number
  dhLhKey: number | null
  dhGroup: string | null
  dhName: string | null
  dhKorName: string | null
  dhType: string | null
  dhOldData: number | null
  dhNewData: number | null
  dhAppendCount: number | null
  dhConflictCount: number | null
  dhRemoveCount: number | null
  dhContents: string | null
  dhResult: string | null
  dhShpPath: string | null
  lhCreateDate: string | null
  lhContents: string | null
}

type LayerManagerRowHistoryDialogProps = {
  open: boolean
  tableName: string
  korName?: string
  onClose: () => void
}

function formatCount(n: number | null | undefined): string {
  if (n == null) return "—"
  return n.toLocaleString("ko-KR")
}

function formatDate(raw: string | null | undefined): string {
  if (!raw) return "—"
  const isoDate = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoDate) {
    const yy = isoDate[1].slice(-2)
    return `${yy}.${isoDate[2]}.${isoDate[3]}`
  }
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  const yy = String(d.getFullYear()).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yy}.${mm}.${dd}`
}

function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  const lineColor = (result: string | null) => {
    if (result === "성공") return "before:bg-green-500"
    if (result === "실패") return "before:bg-red-400"
    return "before:bg-border"
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden border rounded-md">
      <table className="w-full text-xs table-fixed">
        <colgroup>
          <col style={{ width: 76 }} />
          <col style={{ width: 84 }} />
          <col style={{ width: 165 }} />
          <col style={{ width: "calc(100% - 325px)" }} />
        </colgroup>
        <thead className="sticky top-0 bg-background z-10 border-b">
          <tr className="text-left text-foreground">
            <th className="py-2 pl-4 pr-3 font-medium">일시</th>
            <th className="py-2 px-3 font-medium">유형</th>
            <th className="py-2 px-3 font-medium text-right">건수</th>
            <th className="py-2 px-3 font-medium">내용</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.dhKey} className="border-b last:border-b-0 hover:bg-muted/30">
              <td
                className={`relative py-2 pl-4 pr-3 whitespace-nowrap text-muted-foreground before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] ${lineColor(r.dhResult)}`}
              >
                {formatDate(r.lhCreateDate)}
              </td>
              <td className="py-2 px-3 truncate" title={r.dhType ?? ""}>
                {r.dhType ?? "—"}
              </td>
              <td className="py-2 px-3 text-right whitespace-normal break-words overflow-hidden tabular-nums">
                {r.dhOldData != null || r.dhNewData != null
                  ? `${formatCount(r.dhOldData)} → ${formatCount(r.dhNewData)}`
                  : "—"}
              </td>
              <td
                className="py-2 px-3 text-muted-foreground break-words whitespace-normal"
                title={r.dhContents ?? r.lhContents ?? ""}
              >
                {r.dhContents ?? r.lhContents ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function LayerManagerRowHistoryDialog({
  open,
  tableName,
  korName,
  onClose,
}: LayerManagerRowHistoryDialogProps) {
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchHistory = useCallback(async () => {
    if (!tableName) return
    setLoading(true)
    setError(null)
    try {
      const res = await call("", "POST", {
        service: "layerHistoryService",
        action: "getLayerDetailHistoryByTable",
        params: { tableName, limit: 100 },
      })
      const data = res?.data ?? res
      if (data?.success) {
        setRows(Array.isArray(data.data) ? data.data : [])
      } else {
        setError(data?.error ?? "이력을 불러올 수 없습니다.")
        setRows([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "이력을 불러올 수 없습니다.")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [tableName])

  useEffect(() => {
    if (open && tableName) void fetchHistory()
    if (!open) {
      setRows([])
      setError(null)
    }
  }, [open, tableName, fetchHistory])

  const title = korName?.trim() ? `${tableName} (${korName})` : tableName

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(96rem,98vw)] w-[98vw] max-h-[85vh] flex flex-col gap-3 overflow-hidden sm:max-w-[min(96rem,98vw)]">
        <DialogHeader className="shrink-0">
          <DialogTitle>수정 이력 — {title}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            로딩 중…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive py-4">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">수정 이력이 없습니다.</p>
        ) : (
          <HistoryTable rows={rows} />
        )}
      </DialogContent>
    </Dialog>
  )
}
