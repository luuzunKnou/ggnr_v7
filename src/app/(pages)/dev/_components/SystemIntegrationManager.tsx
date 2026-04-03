"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/app/shadcnComponents/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/app/shadcnComponents/ui/table"
import { call } from "@/lib/api"

type SystemKey = "KAIS" | "KRAS" | "KORPES" | "SEUMTEO" | "SAEOL"

type LogRow = {
  ijl_key: number
  ijl_system: string
  ijl_started_at: string | null
  ijl_finished_at: string | null
  ijl_status: string
  ijl_message: string | null
}

function formatDt(v: unknown): string {
  const s = String(v ?? "")
  if (!s) return ""
  return s.replace("T", " ").replace("Z", "")
}

function formatApiError(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === "object" && e !== null) {
    const o = e as Record<string, unknown>
    const code = o.code != null ? String(o.code) : ""
    const parts = [
      typeof o.error === "string" ? o.error : "",
      typeof o.detail === "string" ? o.detail : "",
      typeof o.message === "string" ? o.message : "",
    ].filter(Boolean)
    if (parts.length) return code ? `[${code}] ${parts[0]}` : parts[0]
  }
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

export function SystemIntegrationManager() {
  const systems = useMemo(
    () =>
      [
        { key: "KAIS", label: "KAIS" },
        { key: "KRAS", label: "KRAS" },
        { key: "KORPES", label: "KORPES" },
        { key: "SEUMTEO", label: "세움터" },
        { key: "SAEOL", label: "새올" },
      ] as const,
    []
  )

  const [active, setActive] = useState<SystemKey>("KAIS")
  const [loading, setLoading] = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)
  const [error, setError] = useState<string>("")
  const [rows, setRows] = useState<LogRow[]>([])

  const fetchLogs = async (system: SystemKey) => {
    setLogsLoading(true)
    setError("")
    try {
      const res = await call("", "POST", {
        service: "integrationService",
        action: "listIntegrationLogs",
        params: { system, limit: 50 },
      })
      const r = (res?.data?.rows ?? []) as LogRow[]
      setRows(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLogsLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs(active)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      await call("", "POST", {
        service: "integrationService",
        action: "runIntegration",
        params: { system: active, mode: "daily" },
      })
      await fetchLogs(active)
    } catch (e) {
      setError(formatApiError(e))
      await fetchLogs(active)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
      <div className="flex gap-2 flex-wrap">
        {systems.map((s) => (
          <Button
            key={s.key}
            type="button"
            variant={active === s.key ? "default" : "outline"}
            size="sm"
            onClick={() => setActive(s.key)}
          >
            {s.label}
          </Button>
        ))}
      </div>

      <Card className="min-h-0 flex flex-col">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">시스템 연계 - {active}</CardTitle>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={run} disabled={loading}>
              {loading ? "연계 중…" : "연계 시작"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => fetchLogs(active)} disabled={logsLoading}>
              {logsLoading ? "새로고침…" : "새로고침"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 overflow-auto">
          {error ? <p className="text-sm text-red-600 mb-2">{error}</p> : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>키</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>시작</TableHead>
                <TableHead>종료</TableHead>
                <TableHead>메시지</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    {logsLoading ? "불러오는 중…" : "로그가 없습니다."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.ijl_key}>
                    <TableCell>{r.ijl_key}</TableCell>
                    <TableCell>{r.ijl_status}</TableCell>
                    <TableCell>{formatDt(r.ijl_started_at)}</TableCell>
                    <TableCell>{formatDt(r.ijl_finished_at)}</TableCell>
                    <TableCell className="whitespace-normal break-all">{r.ijl_message ?? ""}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

