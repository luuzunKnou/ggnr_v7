"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog"
import { call } from "@/lib/api"
import { Check, Loader2, X } from "lucide-react"

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

function ResultIcon({ result }: { result: string | null }) {
  if (result === "성공") {
    return <Check className="w-3.5 h-3.5 text-green-600 mx-auto" aria-label="성공" />
  }
  if (result === "실패") {
    return <X className="w-3.5 h-3.5 text-red-400 mx-auto" aria-label="실패" />
  }
  return <span className="text-muted-foreground mx-auto block text-center">—</span>
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
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden border rounded-md">
            <table className="w-full text-xs table-fixed">
              <colgroup>
                <col style={{ width: 72 }} />
                <col style={{ width: 76 }} />
                <col style={{ width: 52 }} />
                <col style={{ width: 88 }} />
                <col style={{ width: "calc(100% - 388px)" }} />
              </colgroup>
              <thead className="sticky top-0 bg-muted z-10">
                <tr className="text-left text-muted-foreground">
                  <th className="py-1.5 px-2">일시</th>
                  <th className="py-1.5 px-2">유형</th>
                  <th className="py-1.5 px-2 text-center">결과</th>
                  <th className="py-1.5 px-2 text-right">건수</th>
                  <th className="py-1.5 px-2">내용</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.dhKey} className="border-t hover:bg-muted/30">
                    <td className="py-1 px-2 whitespace-nowrap">{formatDate(r.lhCreateDate)}</td>
                    <td className="py-1 px-2 truncate" title={r.dhType ?? ""}>
                      {r.dhType ?? "—"}
                    </td>
                    <td className="py-1 px-2">
                      <ResultIcon result={r.dhResult} />
                    </td>
                    <td className="py-1 px-2 text-right whitespace-nowrap">
                      {r.dhOldData != null || r.dhNewData != null
                        ? `${r.dhOldData ?? "—"} → ${r.dhNewData ?? "—"}`
                        : "—"}
                    </td>
                    <td
                      className="py-1 px-2 text-muted-foreground break-words whitespace-normal"
                      title={r.dhContents ?? r.lhContents ?? ""}
                    >
                      {r.dhContents ?? r.lhContents ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
