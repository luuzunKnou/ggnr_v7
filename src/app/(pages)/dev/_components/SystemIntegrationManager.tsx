"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/app/shadcnComponents/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/app/shadcnComponents/ui/table"
import { call } from "@/lib/api"

type SystemKey = "KAIS" | "KRAS" | "KORPES" | "SEUMTEO" | "SAEOL" | "SAFETYDATA" | "FMS"

type LogRow = {
  ijl_key: number
  ijl_system: string
  ijl_started_at: string | null
  ijl_finished_at: string | null
  ijl_status: string
  ijl_message: string | null
}

type SafetydataDatasetRow = {
  id: string
  tableNameKo: string
  tableNameEn: string
  hasApiKey: boolean
}

type SafetydataDetailLogRow = {
  log_safetydata_key: number
  log_safetydata_dataset_id: string
  log_safetydata_name: string
  log_safetydata_date: string
  log_safetydata_request_date: string | null
  log_safetydata_result_code: string | null
  log_safetydata_response_code: string | null
  log_safetydata_response_msg: string | null
  log_safetydata_status: string
}

type ParsedDetail = {
  table: string
  fetched: number | null
  inserted: number | null
  filteredOut: number | null
  pages: number | null
  raw: string
}

type ParsedJob = {
  phase: string
  progress: string
  dataset: string
  table: string
  metrics: string
  raw: string
}

const INTEGRATION_POLL_MS = 2000

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

function parseNum(v: string | undefined): number | null {
  if (!v || !v.trim()) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function parseDetail(msg: string | null): ParsedDetail {
  const raw = String(msg ?? "").trim()
  if (!raw) return { table: "-", fetched: null, inserted: null, filteredOut: null, pages: null, raw: "" }
  const pick = (k: string) => raw.match(new RegExp(`${k}=([^\\s]+)`))?.[1]
  return {
    table: pick("table") ?? "-",
    fetched: parseNum(pick("fetched")),
    inserted: parseNum(pick("inserted")),
    filteredOut: parseNum(pick("filteredOut")),
    pages: parseNum(pick("pages")),
    raw,
  }
}

function parseJob(msg: string | null): ParsedJob {
  const raw = String(msg ?? "").trim()
  if (!raw) return { phase: "-", progress: "-", dataset: "-", table: "-", metrics: "-", raw: "" }
  const first = raw.split(/\r?\n/)[0]?.trim() ?? raw
  const parts = first.split("|").map((s) => s.trim())
  const phaseProgress = parts[0] ?? ""
  const dataset = parts[1] ?? "-"
  const table = parts[2] ?? "-"
  const tokens = phaseProgress.split(/\s+/).filter(Boolean)
  const phase = tokens[0] ?? "-"
  const progress = tokens.slice(1).join(" ") || "-"
  const metrics = [first.match(/fetched=\d+/)?.[0], first.match(/inserted=\d+/)?.[0], first.match(/filteredOut=\d+/)?.[0]]
    .filter(Boolean)
    .join(", ")
  return { phase, progress, dataset, table, metrics: metrics || "-", raw }
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
        { key: "SAFETYDATA", label: "재난안전데이터" },
        { key: "FMS", label: "FMS" },
      ] as const,
    []
  )

  const [active, setActive] = useState<SystemKey>("KAIS")
  const [loading, setLoading] = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)
  const [detailLogsLoading, setDetailLogsLoading] = useState(false)
  const [error, setError] = useState<string>("")
  const [rows, setRows] = useState<LogRow[]>([])
  const [safetyDatasets, setSafetyDatasets] = useState<SafetydataDatasetRow[]>([])
  const [safetyDatasetsLoading, setSafetyDatasetsLoading] = useState(false)
  const [safetyDatasetId, setSafetyDatasetId] = useState<string>("__ALL__")
  const [safetyDetailRows, setSafetyDetailRows] = useState<SafetydataDetailLogRow[]>([])

  const latestJob = rows[0]
  const latestParsedJob = parseJob(latestJob?.ijl_message ?? "")
  const parsedDetails = safetyDetailRows.map((r) => ({ row: r, parsed: parseDetail(r.log_safetydata_response_msg) }))

  const fetchLogs = async (system: SystemKey, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLogsLoading(true)
    if (!opts?.silent) setError("")
    try {
      const res = await call("", "POST", {
        service: "integrationService",
        action: "listIntegrationLogs",
        params: { system, limit: 50 },
      })
      setRows((res?.data?.rows ?? []) as LogRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!opts?.silent) setLogsLoading(false)
    }
  }

  const fetchSafetydataDatasets = async () => {
    setSafetyDatasetsLoading(true)
    try {
      const res = await call("", "POST", {
        service: "integrationService",
        action: "listSafetydataDatasets",
        params: {},
      })
      setSafetyDatasets((res?.data?.rows ?? []) as SafetydataDatasetRow[])
    } catch {
      setSafetyDatasets([])
    } finally {
      setSafetyDatasetsLoading(false)
    }
  }

  const fetchSafetydataDetailLogs = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setDetailLogsLoading(true)
    try {
      const res = await call("", "POST", {
        service: "integrationService",
        action: "listSafetydataDetailLogs",
        params: { limit: 100 },
      })
      setSafetyDetailRows((res?.data?.rows ?? []) as SafetydataDetailLogRow[])
    } catch {
      setSafetyDetailRows([])
    } finally {
      if (!opts?.silent) setDetailLogsLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs(active)
    if (active === "SAFETYDATA") {
      fetchSafetydataDatasets()
      fetchSafetydataDetailLogs()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  /** 연계 실행 중에는 로그를 주기적으로 당겨와 진행 상황이 멈춰 보이지 않게 함 */
  useEffect(() => {
    if (!loading) return
    const id = window.setInterval(() => {
      void fetchLogs(active, { silent: true })
      if (active === "SAFETYDATA") {
        void fetchSafetydataDetailLogs({ silent: true })
      }
    }, INTEGRATION_POLL_MS)
    return () => {
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, active])

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const params: Record<string, unknown> = { system: active, mode: "daily" }
      if (active === "SAFETYDATA") {
        if (safetyDatasetId === "__ALL__") {
          params.runAll = true
          params.datasetId = "__ALL__"
        } else {
          params.datasetId = safetyDatasetId
        }
      }
      const runPromise = call("", "POST", {
        service: "integrationService",
        action: "runIntegration",
        params,
      })
      // STARTED 로그가 찍힐 시간을 조금 준 뒤 즉시 1회 동기화
      await new Promise((resolve) => window.setTimeout(resolve, 250))
      await fetchLogs(active)
      if (active === "SAFETYDATA") await fetchSafetydataDetailLogs()
      await runPromise
      await fetchLogs(active)
      if (active === "SAFETYDATA") await fetchSafetydataDetailLogs()
    } catch (e) {
      setError(formatApiError(e))
      await fetchLogs(active)
      if (active === "SAFETYDATA") await fetchSafetydataDetailLogs()
    } finally {
      setLoading(false)
    }
  }

  const refreshSafetydataOnly = async () => {
    await fetchLogs(active)
    await fetchSafetydataDetailLogs()
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

      {active === "SAFETYDATA" ? (
        <div className="flex flex-col gap-2 shrink-0">
          <label className="text-sm text-muted-foreground flex flex-wrap items-center gap-2">
            <span>데이터셋</span>
            <select
              className="border rounded-md px-2 py-1.5 text-sm bg-background min-w-[12rem] max-w-full"
              value={safetyDatasetId}
              onChange={(e) => setSafetyDatasetId(e.target.value)}
              disabled={safetyDatasetsLoading}
            >
              <option value="__ALL__">전체 (API 키가 있는 항목만 순차 실행)</option>
              {safetyDatasets.map((d) => (
                <option key={d.id} value={d.id} disabled={!d.hasApiKey}>
                  {d.tableNameKo} ({d.id}){d.hasApiKey ? "" : " — 키 없음"}
                </option>
              ))}
            </select>
            {safetyDatasetsLoading ? <span className="text-xs">목록 불러오는 중…</span> : null}
          </label>
        </div>
      ) : null}

      <Card className="shrink-0">
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-nowrap">
          <CardTitle className="text-base min-w-0 truncate">시스템 연계 - {active}</CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            <Button type="button" size="sm" className="min-w-[5.5rem]" onClick={run} disabled={loading}>
              {loading ? "연계 중…" : "연계 시작"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-w-[5.5rem]"
              onClick={() => (active === "SAFETYDATA" ? refreshSafetydataOnly() : fetchLogs(active))}
              disabled={logsLoading || (active === "SAFETYDATA" && detailLogsLoading)}
            >
              {logsLoading || (active === "SAFETYDATA" && detailLogsLoading) ? "새로고침…" : "새로고침"}
            </Button>
          </div>
        </CardHeader>
        {error ? (
          <CardContent className="pt-0">
            <p className="text-sm text-red-600">{error}</p>
          </CardContent>
        ) : null}
      </Card>

      {active !== "SAFETYDATA" ? (
        <Card className="min-h-0 flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">실행 로그</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 overflow-y-scroll overflow-x-auto">
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
                      <TableCell className="whitespace-pre-wrap break-all">{r.ijl_message ?? ""}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="shrink-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">현재 진행 상태</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {latestJob ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                  <div className="rounded border px-3 py-2">
                    <div className="text-xs text-muted-foreground">상태</div>
                    <div className="font-semibold">{latestJob.ijl_status}</div>
                  </div>
                  <div className="rounded border px-3 py-2">
                    <div className="text-xs text-muted-foreground">진행</div>
                    <div className="font-semibold">{latestParsedJob.progress}</div>
                  </div>
                  <div className="rounded border px-3 py-2">
                    <div className="text-xs text-muted-foreground">데이터셋</div>
                    <div className="font-semibold">{latestParsedJob.dataset}</div>
                  </div>
                  <div className="rounded border px-3 py-2">
                    <div className="text-xs text-muted-foreground">대상 테이블</div>
                    <div className="font-semibold break-all">{latestParsedJob.table}</div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">실행 이력이 없습니다.</p>
              )}
            </CardContent>
          </Card>

          <Card className="min-h-0 flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">실행 로그 (integration_job_log)</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 overflow-y-scroll overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>시작시각</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>진행</TableHead>
                    <TableHead>데이터셋</TableHead>
                    <TableHead>대상테이블</TableHead>
                    <TableHead>건수요약</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-muted-foreground">
                        {logsLoading ? "불러오는 중…" : "로그가 없습니다."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => {
                      const p = parseJob(r.ijl_message)
                      return (
                        <TableRow key={r.ijl_key}>
                          <TableCell className="whitespace-nowrap">{formatDt(r.ijl_started_at)}</TableCell>
                          <TableCell>{r.ijl_status}</TableCell>
                          <TableCell className="whitespace-nowrap">{p.progress}</TableCell>
                          <TableCell className="whitespace-nowrap">{p.dataset}</TableCell>
                          <TableCell className="whitespace-nowrap">{p.table}</TableCell>
                          <TableCell className="whitespace-nowrap">{p.metrics}</TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="min-h-0 flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">데이터셋 결과 (log_safetydata)</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 overflow-y-scroll overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>요청시각</TableHead>
                    <TableHead>데이터셋</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>대상테이블</TableHead>
                    <TableHead className="text-right">가져옴</TableHead>
                    <TableHead className="text-right">적재</TableHead>
                    <TableHead className="text-right">필터제외</TableHead>
                    <TableHead className="text-right">페이지</TableHead>
                    <TableHead>메시지</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedDetails.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-muted-foreground">
                        {detailLogsLoading ? "불러오는 중…" : "상세 로그가 없습니다."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    parsedDetails.map(({ row, parsed }) => (
                      <TableRow key={row.log_safetydata_key}>
                        <TableCell className="whitespace-nowrap">{formatDt(row.log_safetydata_request_date)}</TableCell>
                        <TableCell className="whitespace-nowrap">{row.log_safetydata_dataset_id}</TableCell>
                        <TableCell>{row.log_safetydata_status}</TableCell>
                        <TableCell className="whitespace-nowrap">{parsed.table}</TableCell>
                        <TableCell className="text-right tabular-nums">{parsed.fetched ?? "-"}</TableCell>
                        <TableCell className="text-right tabular-nums">{parsed.inserted ?? "-"}</TableCell>
                        <TableCell className="text-right tabular-nums">{parsed.filteredOut ?? "-"}</TableCell>
                        <TableCell className="text-right tabular-nums">{parsed.pages ?? "-"}</TableCell>
                        <TableCell className="whitespace-normal break-all max-w-[24rem]">{parsed.raw}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
