"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/app/shadcnComponents/ui/dialog"
import { call } from "@/lib/api"
import { cn } from "@/lib/utils"
import { DbManagerImportContent } from "./DbManagerImportContent"
import { DbManagerBackupContent } from "./DbManagerBackupContent"
import { DbManagerUpdateContent } from "./DbManagerUpdateContent"
import { DbManagerSyncContent } from "./DbManagerSyncContent"
import { DbManagerErDiagramContent } from "./DbManagerErDiagramContent"
import { DbManagerTableDefContent } from "./DbManagerTableDefContent"
import { DbManagerLayerGeomSridContent } from "./DbManagerLayerGeomSridContent"

type DbManagerModalType = "import" | "backup" | "update" | "sync" | "erDiagram" | "tableDef" | "layerGeomSrid" | null

type DbConfig = { host: string; port: string; database: string; username: string; password?: string }
type ConnectionStatus = { success: boolean; error?: string } | null

type TableColumnRow = { schema?: string; tableComment: string; tableName: string; columnComment: string; columnName: string; columnType: string; columnTypeNormalized?: string }
/** varchar/character varying 등 동일 타입 통일 (백엔드 normalizeColumnTypeForCompare와 동일 기준) */
function normalizeTypeForCompare(type: string): string {
  const t = (type ?? "").toLowerCase().trim()
  if (!t) return ""
  if (["serial", "serial4", "integer", "int4"].some((g) => t === g || t.startsWith(g))) return "integer"
  if (["serial8", "bigint", "int8"].some((g) => t === g || t.startsWith(g))) return "bigint"
  if (["varchar", "character varying"].some((g) => t === g || t.startsWith(g))) return "varchar"
  if (["timestamp without time zone", "timestamp"].some((g) => t === g || t.startsWith(g))) return "timestamp"
  return t
}
type DiffRow = {
  key: string
  tableKey: string
  schema: TableColumnRow | null
  db: TableColumnRow | null
  isMatch: boolean
}

export function DbManagerContent() {
  const [modalType, setModalType] = useState<DbManagerModalType>(null)
  const [dbConfig, setDbConfig] = useState<DbConfig | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(null)
  const [diffRows, setDiffRows] = useState<DiffRow[]>([])
  const [loadingConnection, setLoadingConnection] = useState(false)
  const [loadingDiff, setLoadingDiff] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const diffScrollRef = useRef<HTMLDivElement>(null)

  const open = modalType !== null
  const closeModal = () => setModalType(null)

  const fetchConnectionInfo = useCallback(async () => {
    setLoadingConnection(true)
    setConnectionStatus(null)
    try {
      const res = await call("", "POST", { service: "dbManagerService", action: "getDefaultDbConfig", params: {} })
      const d = res?.data ?? res
      const config = d?.host ? { host: d.host, port: d.port ?? "5432", database: d.database, username: d.username, password: d.password } : null
      if (config) setDbConfig(config)
      const testRes = await call("", "POST", { service: "dbManagerService", action: "testConnection", params: config ?? {} })
      const t = testRes?.data ?? testRes
      setConnectionStatus({ success: !!t?.ok, error: t?.ok ? undefined : (t?.message ?? "연결 실패") })
    } catch (err: unknown) {
      const msg = err && typeof err === "object" ? String((err as { error?: string; message?: string }).error ?? (err as { message?: string }).message ?? "요청 실패") : "요청 실패"
      setConnectionStatus({ success: false, error: msg })
    } finally {
      setLoadingConnection(false)
    }
  }, [])

  const fetchDiff = useCallback(async () => {
    setLoadingDiff(true)
    try {
      const [schemaRes, dbRes] = await Promise.all([
        call("", "POST", { service: "dbManagerService", action: "getSchemaTableColumnList", params: {} }),
        call("", "POST", { service: "dbManagerService", action: "getDbTableColumnList", params: {} }),
      ])
      const schemaData = schemaRes?.data ?? schemaRes
      const dbData = dbRes?.data ?? dbRes
      const schemaRows = (schemaData?.rows ?? []) as TableColumnRow[]
      const dbRows = (dbData?.rows ?? []) as TableColumnRow[]

      const schemaMap = new Map<string, TableColumnRow>()
      schemaRows.forEach((r) => {
        const schema = r.schema ?? "public"
        const key = `${schema}.${r.tableName}.${r.columnName || "(table)"}`
        schemaMap.set(key, r)
      })
      const dbMap = new Map<string, TableColumnRow>()
      dbRows.forEach((r) => {
        const schema = r.schema ?? "public"
        const key = `${schema}.${r.tableName}.${r.columnName || "(table)"}`
        dbMap.set(key, r)
      })
      const s = (v: string | null | undefined) => (v ?? "").trim()
      const typeForCompare = (r: TableColumnRow | null) =>
        normalizeTypeForCompare(r?.columnTypeNormalized ?? r?.columnType ?? "")
      const allKeys = new Set([...schemaMap.keys(), ...dbMap.keys()])
      const sortedKeys = Array.from(allKeys).sort((a, b) => a.localeCompare(b))
      const rows: DiffRow[] = sortedKeys.map((key) => {
        const schema = schemaMap.get(key) ?? null
        const db = dbMap.get(key) ?? null
        const tableKey = key.split(".").slice(0, 2).join(".")
        const isMatch =
          !!schema &&
          !!db &&
          s(schema.tableComment) === s(db.tableComment) &&
          s(schema.tableName) === s(db.tableName) &&
          s(schema.columnComment) === s(db.columnComment) &&
          s(schema.columnName) === s(db.columnName) &&
          typeForCompare(schema) === typeForCompare(db)
        return { key, tableKey, schema, db, isMatch }
      })
      setDiffRows(rows)
    } catch {
      setDiffRows([])
    } finally {
      setLoadingDiff(false)
    }
  }, [])

  useEffect(() => {
    fetchConnectionInfo()
  }, [fetchConnectionInfo])

  useEffect(() => {
    fetchDiff()
  }, [fetchDiff])

  /** 해당 행(필드 또는 테이블 행)만 동기화: 테이블 생성/삭제 또는 컬럼 추가/삭제/코멘트 */
  const runFieldSync = useCallback(
    async (rowKey: string) => {
      const parts = rowKey.split(".")
      if (parts.length < 2) return
      const schema = parts[0] ?? "public"
      const field = parts[parts.length - 1]
      const table = parts.slice(1, -1).join(".")
      const params = dbConfig
        ? {
            host: dbConfig.host,
            port: Number(dbConfig.port) || 5432,
            database: dbConfig.database,
            username: dbConfig.username,
            password: dbConfig.password,
            schema,
            table,
            field,
          }
        : { schema, table, field }
      setSyncing(true)
      setSyncMessage(null)
      try {
        const planRes = await call("", "POST", {
          service: "dbManagerService",
          action: "getSchemaSyncPlanForField",
          params,
        })
        const plan = (planRes?.data ?? planRes) as { action: 'createTable' | 'dropTable' | 'addColumn' | 'dropColumn' | 'addComment' | null }
        const actionLabels: Record<string, string> = {
          createTable: "테이블 생성 (스키마에만 있음 → DB에 생성)",
          dropTable: "테이블 삭제 (스키마에 없음 → DB에서 삭제)",
          addColumn: "컬럼 추가",
          dropColumn: "컬럼 삭제",
          addComment: "한글명(코멘트) 추가",
        }
        const label = plan.action ? actionLabels[plan.action] ?? plan.action : ""
        if (!plan.action || !label) {
          setSyncMessage(`${rowKey}: 수행할 동작이 없습니다.`)
          setSyncing(false)
          return
        }
        if (!window.confirm(`[${rowKey}]\n\n${label}\n\n계속할까요?`)) {
          setSyncing(false)
          return
        }
        const res = await call("", "POST", {
          service: "dbManagerService",
          action: "applySchemaSyncForField",
          params,
        })
        const data = res?.data ?? res
        const results = data?.results ?? []
        const failed = results.filter((r: { action?: string }) => r.action === "failed")
        const msg = failed.length
          ? `실패: ${failed.map((f: { error?: string }) => f.error).join("; ")}`
          : `완료 (${results.length}건)`
        setSyncMessage(msg)
        const scrollTop = diffScrollRef.current?.scrollTop ?? 0
        const scrollLeft = diffScrollRef.current?.scrollLeft ?? 0
        await fetchDiff()
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (diffScrollRef.current) {
              diffScrollRef.current.scrollTop = scrollTop
              diffScrollRef.current.scrollLeft = scrollLeft
            }
          })
        })
      } catch (err: unknown) {
        const msg =
          err && typeof err === "object"
            ? String((err as { error?: string; message?: string }).error ?? (err as { message?: string }).message ?? "요청 실패")
            : "요청 실패"
        setSyncMessage(`오류: ${msg}`)
      } finally {
        setSyncing(false)
      }
    },
    [dbConfig, fetchDiff]
  )

  return (
    <>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* 상단: DB 연결 정보 + 버튼들 */}
        <section className="shrink-0 border-b pb-2 mb-2">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="rounded border bg-muted/30 p-2 space-y-1.5 md:col-span-2">
              <div className="text-sm font-medium flex items-center gap-2">
                <span
                  className={cn(
                    "inline-block w-2.5 h-2.5 rounded-full shrink-0",
                    connectionStatus == null && loadingConnection && "bg-amber-500 animate-pulse",
                    connectionStatus?.success && "bg-green-500",
                    connectionStatus != null && !connectionStatus.success && "bg-red-500"
                  )}
                  title={connectionStatus == null ? "확인 중" : connectionStatus.success ? "연결됨" : "연결 실패"}
                />
                DB 연결
              </div>
              <div className={cn("text-xs font-mono", connectionStatus?.success && "text-green-600 dark:text-green-400", connectionStatus != null && !connectionStatus.success && "text-red-600 dark:text-red-400")}>
                {loadingConnection
                  ? "확인 중..."
                  : connectionStatus?.success
                    ? `${dbConfig?.host ?? "-"}:${dbConfig?.port ?? ""} / ${dbConfig?.database ?? "-"}`
                    : connectionStatus?.error ?? "연결 정보 없음"}
              </div>
            </div>
            <div className="rounded border bg-muted/30 p-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="rounded-none" onClick={() => setModalType("import")}>
                데이터 가져오기
              </Button>
              <Button size="sm" variant="outline" className="rounded-none" onClick={() => setModalType("backup")}>
                백업하기
              </Button>
              <Button size="sm" variant="outline" className="rounded-none" onClick={() => setModalType("update")}>
                업데이트
              </Button>
            </div>
            <div className="rounded border bg-muted/30 p-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="rounded-none" onClick={() => setModalType("erDiagram")}>
                ER-Diagram
              </Button>
              <Button size="sm" variant="outline" className="rounded-none" onClick={() => setModalType("tableDef")}>
                테이블정의서
              </Button>
              <Button size="sm" variant="outline" className="rounded-none" onClick={() => setModalType("sync")}>
                동기화
              </Button>
            </div>
          </div>
        </section>

        {/* 가운데: 테이블 구조 동기화 diff (좌: schema 기반, 우: public 스키마 DB) */}
        <section className="flex-1 min-h-0 flex flex-col border rounded overflow-hidden">
          <div className="text-sm font-medium p-2 border-b bg-muted/30 shrink-0 flex items-center gap-2 flex-wrap">
            <span>테이블 구조 동기화 diff (좌: schema · 우: DB public)</span>
            {!loadingDiff && diffRows.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                일치 <span className="font-semibold text-green-600 dark:text-green-400">{diffRows.filter((r) => r.isMatch).length}</span>
                {" / "}
                불일치 <span className="font-semibold text-red-600 dark:text-red-400">{diffRows.filter((r) => !r.isMatch).length}</span>
              </span>
            )}
            <Button size="sm" variant="outline" className="rounded-none shrink-0" onClick={fetchDiff} disabled={loadingDiff}>
              {loadingDiff ? "갱신 중..." : "갱신"}
            </Button>
            {syncMessage != null && <span className={cn("w-full", syncMessage.startsWith("오류") ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{syncMessage}</span>}
          </div>
          <div ref={diffScrollRef} className="flex-1 min-h-0 overflow-auto">
            <table className="w-full table-fixed border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-border bg-muted leading-none sticky top-0 z-10">
                  <th className="text-left py-1 px-2 w-[90px] max-w-[90px] border-r-2 border-border truncate">동기화</th>
                  <th className="text-left py-1 px-2 w-[10%] max-w-0 border-r border-border truncate">테이블명 (schema)</th>
                  <th className="text-left py-1 px-2 w-[10%] max-w-0 border-r border-border truncate">테이블영문명 (schema)</th>
                  <th className="text-left py-1 px-2 w-[10%] max-w-0 border-r border-border truncate">필드명 (schema)</th>
                  <th className="text-left py-1 px-2 w-[10%] max-w-0 border-r border-border truncate">필드영문명 (schema)</th>
                  <th className="text-left py-1 px-2 w-[10%] max-w-0 border-r-2 border-border truncate">데이터타입 (schema)</th>
                  <th className="text-left py-1 px-2 w-[10%] max-w-0 border-r border-border border-l-2 truncate">테이블명 (DB)</th>
                  <th className="text-left py-1 px-2 w-[10%] max-w-0 border-r border-border truncate">테이블영문명 (DB)</th>
                  <th className="text-left py-1 px-2 w-[10%] max-w-0 border-r border-border truncate">필드명 (DB)</th>
                  <th className="text-left py-1 px-2 w-[10%] max-w-0 border-r border-border truncate">필드영문명 (DB)</th>
                  <th className="text-left py-1 px-2 w-[10%] max-w-0 truncate">데이터타입 (DB)</th>
                </tr>
              </thead>
              <tbody>
                {loadingDiff ? (
                  <tr>
                    <td colSpan={11} className="py-4 px-2 text-muted-foreground text-center">
                      로딩 중...
                    </td>
                  </tr>
                ) : diffRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-4 px-2 text-muted-foreground text-center">
                      데이터 없음 또는 로드 실패
                    </td>
                  </tr>
                ) : (
                  diffRows.map((row, index) => {
                    const prevTableKey = index > 0 ? diffRows[index - 1].tableKey : null
                    const isFirstInTable = prevTableKey !== row.tableKey
                    return (
                      <tr
                        key={row.key}
                        className={cn(
                          "leading-tight border-b border-border/50",
                          isFirstInTable && "border-t-2 border-border",
                          row.isMatch
                            ? "bg-green-50/80 dark:bg-green-950/30"
                            : "bg-red-50/80 dark:bg-red-950/30"
                        )}
                      >
                        <td className="py-1 px-2 w-[90px] max-w-[90px] border-r-2 border-border align-middle overflow-hidden">
                          {!row.isMatch && (
                            <Button size="sm" variant="outline" className="rounded-none h-5 py-1 px-1.5 text-[11px] min-w-0 leading-none" onClick={() => runFieldSync(row.key)} disabled={syncing || loadingDiff}>
                              동기화
                            </Button>
                          )}
                        </td>
                        <td className="py-1 px-2 font-mono border-r border-border max-w-0 truncate" title={row.schema?.tableComment ?? ""}>{row.schema?.tableComment ?? ""}</td>
                        <td className="py-1 px-2 font-mono border-r border-border max-w-0 truncate" title={row.schema?.tableName ?? ""}>{row.schema?.tableName ?? ""}</td>
                        <td className="py-1 px-2 font-mono border-r border-border max-w-0 truncate" title={row.schema?.columnComment ?? ""}>{row.schema?.columnComment ?? ""}</td>
                        <td className="py-1 px-2 font-mono border-r border-border max-w-0 truncate" title={row.schema?.columnName ?? ""}>{row.schema?.columnName ?? ""}</td>
                        <td className="py-1 px-2 font-mono border-r-2 border-border max-w-0 truncate" title={row.schema?.columnType ?? ""}>{row.schema?.columnType ?? ""}</td>
                        <td className="py-1 px-2 font-mono border-r border-border border-l-2 max-w-0 truncate" title={row.db?.tableComment ?? ""}>{row.db?.tableComment ?? ""}</td>
                        <td className="py-1 px-2 font-mono border-r border-border max-w-0 truncate" title={row.db?.tableName ?? ""}>{row.db?.tableName ?? ""}</td>
                        <td className="py-1 px-2 font-mono border-r border-border max-w-0 truncate" title={row.db?.columnComment ?? ""}>{row.db?.columnComment ?? ""}</td>
                        <td className="py-1 px-2 font-mono border-r border-border max-w-0 truncate" title={row.db?.columnName ?? ""}>{row.db?.columnName ?? ""}</td>
                        <td className="py-1 px-2 font-mono max-w-0 truncate" title={row.db?.columnType ?? ""}>{row.db?.columnType ?? ""}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
        <DialogContent className="w-full min-w-[1800px] h-[94vh] max-h-[94vh] rounded-none p-3 flex flex-col gap-0 overflow-hidden [&>button]:shrink-0">
          <DialogTitle className="sr-only">
            {modalType === "import" && "데이터 가져오기"}
            {modalType === "backup" && "데이터 백업하기"}
            {modalType === "update" && "데이터 업데이트"}
            {modalType === "sync" && "테이블 구조 동기화"}
            {modalType === "erDiagram" && "ER-Diagram"}
            {modalType === "tableDef" && "테이블 정의서 보기"}
            {modalType === "layerGeomSrid" && "layer geom 좌표계 5181 설정"}
          </DialogTitle>
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            {modalType === "import" && <DbManagerImportContent onBack={closeModal} />}
            {modalType === "backup" && <DbManagerBackupContent onBack={closeModal} />}
            {modalType === "update" && <DbManagerUpdateContent onBack={closeModal} />}
            {modalType === "sync" && <DbManagerSyncContent onBack={closeModal} />}
            {modalType === "erDiagram" && <DbManagerErDiagramContent onBack={closeModal} />}
            {modalType === "tableDef" && <DbManagerTableDefContent onBack={closeModal} />}
            {modalType === "layerGeomSrid" && <DbManagerLayerGeomSridContent onBack={closeModal} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
