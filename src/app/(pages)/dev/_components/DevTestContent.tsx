"use client"

import { useState, useEffect } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { call } from "@/lib/api"

const GEOSERVER_DEFAULT_URL = "http://localhost:8080/geoserver"

interface TestResult {
  timestamp: string
  connection: {
    success: boolean
    currentTime?: string
    pgVersion?: string
    error?: string
  } | null
  postgis: {
    available: boolean
    version?: string | null
    enabled?: boolean
    error?: string
    enableError?: string
  } | null
  tables?: {
    success: boolean
    count?: number
    list?: Array<{ table_schema: string; table_name: string; table_type: string }>
    error?: string
    details?: string
  }
  functions?: {
    success: boolean
    count?: number
    list?: Array<{ routine_schema: string; routine_name: string; routine_type: string }>
    error?: string
    details?: string
  }
  error?: string
}

export function DevTestContent() {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [geoserverUrl, setGeoserverUrl] = useState("")
  const [geoserverLoading, setGeoserverLoading] = useState(false)
  const [geoserverStartLoading, setGeoserverStartLoading] = useState(false)
  const [geoserverStopLoading, setGeoserverStopLoading] = useState(false)
  const [geoserverDbSetupLoading, setGeoserverDbSetupLoading] = useState(false)
  const [geoserverDbVerifyLoading, setGeoserverDbVerifyLoading] = useState(false)
  const [geoserverLayerListLoading, setGeoserverLayerListLoading] = useState(false)
  const [geoserverLayerCreateLoading, setGeoserverLayerCreateLoading] = useState(false)
  const [geoserverPublishedLayersLoading, setGeoserverPublishedLayersLoading] = useState(false)
  const [moveLayerToPublicLoading, setMoveLayerToPublicLoading] = useState(false)
  const [geoserverLogs, setGeoserverLogs] = useState<string[]>([])

  useEffect(() => {
    if (typeof window !== "undefined") {
      setGeoserverUrl(`${window.location.protocol}//${window.location.hostname}:8080/geoserver`)
    } else {
      setGeoserverUrl(GEOSERVER_DEFAULT_URL)
    }
  }, [])

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`])
  }

  const testDatabase = async () => {
    setIsLoading(true)
    setResult(null)
    addLog("데이터베이스 연결 테스트 시작...")

    try {
      const response = await call("", "POST", {
        service: "devTestService",
        action: "testDatabaseConnection",
        params: {},
      })

      if (!response.success) {
        throw new Error(response.error || "Unknown error")
      }

      const data: TestResult = response.data
      setResult(data)

      if (data.connection?.success) {
        const pgVersion =
          data.connection.pgVersion?.split("compiled by")[0].trim() || data.connection.pgVersion
        addLog(`데이터베이스 연결 성공 (${pgVersion})`)
      } else {
        addLog("데이터베이스 연결 실패")
        addLog(`   오류: ${data.connection?.error || "Unknown error"}`)
      }

      if (data.postgis) {
        if (data.postgis.available) {
          addLog(`PostGIS 사용 가능 (버전: ${data.postgis.version})`)
        } else {
          addLog("PostGIS 사용 불가")
          if (data.postgis.error) {
            addLog(`   오류: ${data.postgis.error}`)
          }
        }

        if (data.postgis.enabled) {
          addLog("PostGIS 확장 활성화 완료")
        } else if (data.postgis.enableError) {
          addLog(`PostGIS 확장 활성화 실패: ${data.postgis.enableError}`)
        }
      }

      if (data.tables) {
        if (data.tables.success) {
          addLog(`테이블 목록 조회 성공 (총 ${data.tables.count}개)`)
        } else {
          addLog(`테이블 목록 조회 실패: ${data.tables.error}`)
          if (data.tables.details) {
            addLog(`   상세: ${data.tables.details}`)
          }
        }
      }

      if (data.error) {
        addLog(`오류 발생: ${data.error}`)
      }
    } catch (error: any) {
      addLog(`테스트 중 오류 발생: ${error.message}`)
      setResult({
        timestamp: new Date().toISOString(),
        connection: null,
        postgis: null,
        error: error.message,
      })
    } finally {
      setIsLoading(false)
    }
  }

  const addGeoserverLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setGeoserverLogs((prev) => [...prev, `[${timestamp}] ${message}`])
  }

  const testGeoServer = async () => {
    if (!geoserverUrl.trim()) {
      addGeoserverLog("URL을 입력하세요.")
      return
    }
    setGeoserverLoading(true)
    addGeoserverLog("GeoServer 연결 테스트 시작...")

    try {
      const response = await call("", "POST", {
        service: "devTestService",
        action: "testGeoServer",
        params: { url: geoserverUrl.trim() },
      })

      if (!response.success) {
        addGeoserverLog(`테스트 실패: ${response.error}`)
        return
      }

      const d = response.data
      if (d.success) {
        addGeoserverLog(`GeoServer 연결 성공 (HTTP ${d.status})`)
        if (d.version) addGeoserverLog(`GeoServer 버전: ${d.version}`)
      } else {
        addGeoserverLog(`GeoServer 연결 실패: ${d.error ?? `${d.status} ${d.statusText}`}`)
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      addGeoserverLog(`테스트 오류: ${message}`)
    } finally {
      setGeoserverLoading(false)
    }
  }

  const clearLogs = () => {
    setLogs([])
    setResult(null)
  }

  const clearGeoserverLogs = () => {
    setGeoserverLogs([])
  }

  const startGeoServer = async () => {
    setGeoserverStartLoading(true)
    addGeoserverLog("GeoServer 실행 중...")

    try {
      const response = await call("", "POST", {
        service: "devTestService",
        action: "startGeoServer",
        params: {},
      })

      if (response.success && response.data?.success) {
        addGeoserverLog("GeoServer가 백그라운드에서 시작되었습니다.")
        addGeoserverLog("웹 UI: http://localhost:8080/geoserver")
      } else {
        addGeoserverLog(`실행 실패: ${response.error ?? response.data?.error ?? "Unknown"}`)
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      addGeoserverLog(`실행 오류: ${message}`)
    } finally {
      setGeoserverStartLoading(false)
    }
  }

  const stopGeoServer = async () => {
    setGeoserverStopLoading(true)
    addGeoserverLog("GeoServer 종료 중...")

    try {
      const response = await call("", "POST", {
        service: "devTestService",
        action: "stopGeoServer",
        params: {},
      })

      if (response.success && response.data?.success) {
        addGeoserverLog("GeoServer가 종료되었습니다.")
      } else {
        addGeoserverLog(`종료 실패: ${response.error ?? response.data?.error ?? "Unknown"}`)
      }
      const out = response.data?.output
      if (out) out.split(/\r?\n/).forEach((line: string) => line.trim() && addGeoserverLog(line))
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      addGeoserverLog(`종료 오류: ${message}`)
    } finally {
      setGeoserverStopLoading(false)
    }
  }

  const setupGeoServerDb = async () => {
    setGeoserverDbSetupLoading(true)
    addGeoserverLog("GeoServer DB 연결 설정 중...")

    try {
      const response = await call("", "POST", {
        service: "devTestService",
        action: "setupGeoServerDb",
        params: { url: geoserverUrl.trim() },
      })

      if (!response.success) {
        addGeoserverLog(`설정 실패: ${response.error}`)
        return
      }

      const d = response.data
      if (d.success) {
        addGeoserverLog(`GeoServer DB 연결 설정 완료 (workspace: ${d.workspace ?? "ggnr"}, datastore: ${d.datastoreName ?? "postgres_layer,postgres_public_layer"})`)
      } else {
        addGeoserverLog(`설정 실패: ${d.error ?? "Unknown"}`)
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      addGeoserverLog(`설정 오류: ${message}`)
    } finally {
      setGeoserverDbSetupLoading(false)
    }
  }

  const verifyGeoServerDbConnection = async () => {
    setGeoserverDbVerifyLoading(true)
    addGeoserverLog("GeoServer DB 연결 확인 중...")

    try {
      const response = await call("", "POST", {
        service: "devTestService",
        action: "verifyGeoServerDbConnection",
        params: { url: geoserverUrl.trim() },
      })

      if (!response.success) {
        addGeoserverLog(`확인 실패: ${response.error}`)
        return
      }

      const d = response.data
      if (d.success) {
        addGeoserverLog("GeoServer DB 연결 확인 완료")
        const ft = d.featureTypes ?? []
        addGeoserverLog(`Feature types: ${ft.length}개`)
        ft.forEach((f: { name?: string }) => addGeoserverLog(`  - ${f.name ?? f}`))
        if (d.error) addGeoserverLog(`  참고: ${d.error}`)
      } else {
        addGeoserverLog(`확인 실패: ${d.error ?? "Unknown"}`)
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      addGeoserverLog(`확인 오류: ${message}`)
    } finally {
      setGeoserverDbVerifyLoading(false)
    }
  }

  const fetchLayerTableList = async () => {
    setGeoserverLayerListLoading(true)
    addGeoserverLog("레이어 테이블 목록 조회 중...")

    try {
      const response = await call("", "POST", {
        service: "devTestService",
        action: "getLayerTableList",
        params: {},
      })

      if (!response.success) {
        addGeoserverLog(`조회 실패: ${response.error}`)
        return
      }

      const d = response.data
      if (d.success && d.tables?.length) {
        addGeoserverLog(`레이어 테이블 ${d.tables.length}개`)
        d.tables.forEach(
          (t: { schema: string; table: string; geometryColumn: string }) =>
            addGeoserverLog(`  - ${t.schema}.${t.table} (${t.geometryColumn})`)
        )
      } else if (d.success) {
        addGeoserverLog("geometry 테이블이 없습니다. (layer, public 스키마)")
      } else {
        addGeoserverLog(`조회 실패: ${d.error ?? "Unknown"}`)
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      addGeoserverLog(`조회 오류: ${message}`)
    } finally {
      setGeoserverLayerListLoading(false)
    }
  }

  const fetchGeoServerLayerList = async () => {
    setGeoserverPublishedLayersLoading(true)
    addGeoserverLog("GeoServer 레이어 목록 조회 중...")

    try {
      const response = await call("", "POST", {
        service: "devTestService",
        action: "getGeoServerLayerList",
        params: { url: geoserverUrl.trim() },
      })

      if (!response.success) {
        addGeoserverLog(`조회 실패: ${response.error}`)
        return
      }

      const d = response.data
      if (d.success && d.layers?.length) {
        addGeoserverLog(`GeoServer 레이어 ${d.layers.length}개`)
        d.layers.forEach((name: string) => addGeoserverLog(`  - ${name}`))
      } else if (d.success) {
        addGeoserverLog("GeoServer에 게시된 레이어가 없습니다.")
      } else {
        addGeoserverLog(`조회 실패: ${d.error ?? "Unknown"}`)
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      addGeoserverLog(`조회 오류: ${message}`)
    } finally {
      setGeoserverPublishedLayersLoading(false)
    }
  }

  const moveLayerUndefinedToPublicLayer = async (dryRun: boolean) => {
    setMoveLayerToPublicLoading(true)
    addGeoserverLog(dryRun ? "layer 미정의 테이블 조회 중 (dry-run)..." : "layer 미정의 테이블 → public_layer 이전 중...")

    try {
      const response = await call("", "POST", {
        service: "devTestService",
        action: "moveLayerUndefinedTablesToPublicLayer",
        params: { dryRun },
      })

      if (!response.success) {
        addGeoserverLog(`실패: ${response.error}`)
        return
      }

      const d = response.data
      if (d && d.success === false && d.error) {
        addGeoserverLog(`오류: ${d.error}`)
        return
      }

      addGeoserverLog(d.message ?? (dryRun ? "dry-run 완료" : "이전 완료"))
      if (d.moved?.length) {
        d.moved.forEach((t: string) => addGeoserverLog(`  이동: ${t}`))
      }
      if (d.failed?.length) {
        d.failed.forEach((f: { table: string; error: string }) =>
          addGeoserverLog(`  실패: ${f.table} - ${f.error}`)
        )
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      addGeoserverLog(`오류: ${message}`)
    } finally {
      setMoveLayerToPublicLoading(false)
    }
  }

  const createGeoServerLayers = async () => {
    setGeoserverLayerCreateLoading(true)
    addGeoserverLog("GeoServer 레이어 생성 중...")

    try {
      const response = await call("", "POST", {
        service: "devTestService",
        action: "createGeoServerLayers",
        params: { url: geoserverUrl.trim() },
      })

      if (!response.success) {
        addGeoserverLog(`생성 실패: ${response.error}`)
        return
      }

      const d = response.data
      const created = d.created ?? []
      const failed = d.failed ?? []
      if (created.length) {
        addGeoserverLog(`생성 완료: ${created.length}개`)
        created.forEach((c: { schema: string; table: string }) =>
          addGeoserverLog(`  - ${c.schema}.${c.table}`)
        )
      }
      if (failed.length) {
        addGeoserverLog(`생성 실패: ${failed.length}개`)
        failed.forEach((f: { schema: string; table: string; error: string }) =>
          addGeoserverLog(`  - ${f.schema}.${f.table}: ${f.error}`)
        )
      }
      if (!created.length && !failed.length && d.error) {
        addGeoserverLog(d.error)
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      addGeoserverLog(`생성 오류: ${message}`)
    } finally {
      setGeoserverLayerCreateLoading(false)
    }
  }

  const geoDisabled =
    geoserverLoading ||
    geoserverStartLoading ||
    geoserverStopLoading ||
    geoserverDbSetupLoading ||
    geoserverDbVerifyLoading ||
    geoserverLayerListLoading ||
    geoserverLayerCreateLoading ||
    geoserverPublishedLayersLoading ||
    moveLayerToPublicLoading

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Button
          onClick={testDatabase}
          disabled={isLoading}
          size="sm"
          className="rounded-none"
        >
          {isLoading ? "테스트 중..." : "DB 연결 테스트"}
        </Button>
        <Button
          onClick={clearLogs}
          disabled={isLoading}
          size="sm"
          className="rounded-none"
        >
          로그 지우기
        </Button>
      </div>

      <div className="p-2 font-mono text-sm min-h-[280px] max-h-[420px] overflow-y-auto border rounded border-border bg-muted/30">
        {logs.length === 0 ? (
          <div className="text-muted-foreground">로그가 없습니다. 테스트를 실행해주세요.</div>
        ) : (
          <div className="space-y-1">
            {logs.map((log, index) => (
              <div key={index} className="leading-relaxed text-foreground">
                {log}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-3">
          <Button
            onClick={startGeoServer}
            disabled={geoDisabled}
            size="sm"
            className="rounded-none"
          >
            {geoserverStartLoading ? "실행 중..." : "GeoServer 실행"}
          </Button>
          <Button
            onClick={stopGeoServer}
            disabled={geoDisabled}
            size="sm"
            className="rounded-none"
          >
            {geoserverStopLoading ? "종료 중..." : "GeoServer 종료"}
          </Button>
          <Button
            onClick={testGeoServer}
            disabled={geoDisabled}
            size="sm"
            className="rounded-none"
          >
            {geoserverLoading ? "테스트 중..." : "GeoServer 연결 테스트"}
          </Button>
          <Button
            onClick={setupGeoServerDb}
            disabled={geoDisabled}
            size="sm"
            className="rounded-none"
          >
            {geoserverDbSetupLoading ? "설정 중..." : "GeoServer DB 연결 설정"}
          </Button>
          <Button
            onClick={verifyGeoServerDbConnection}
            disabled={geoDisabled}
            size="sm"
            className="rounded-none"
          >
            {geoserverDbVerifyLoading ? "확인 중..." : "GeoServer DB 연결 확인"}
          </Button>
          <Button
            onClick={fetchLayerTableList}
            disabled={geoDisabled}
            size="sm"
            className="rounded-none"
          >
            {geoserverLayerListLoading ? "조회 중..." : "레이어 목록 확인"}
          </Button>
          <Button
            onClick={fetchGeoServerLayerList}
            disabled={geoDisabled}
            size="sm"
            className="rounded-none"
          >
            {geoserverPublishedLayersLoading ? "조회 중..." : "GeoServer 레이어 목록 조회"}
          </Button>
          <Button
            onClick={createGeoServerLayers}
            disabled={geoDisabled}
            size="sm"
            className="rounded-none"
          >
            {geoserverLayerCreateLoading ? "생성 중..." : "GeoServer 레이어 생성"}
          </Button>
          <Button
            onClick={() => moveLayerUndefinedToPublicLayer(true)}
            disabled={geoDisabled}
            size="sm"
            variant="outline"
            className="rounded-none"
          >
            {moveLayerToPublicLoading ? "조회 중..." : "미정의 테이블 조회 (dry-run)"}
          </Button>
          <Button
            onClick={() => {
              if (window.confirm("layer 스키마에서 tables.json에 없는 테이블을 public_layer로 이전합니다. 계속할까요?")) {
                moveLayerUndefinedToPublicLayer(false)
              }
            }}
            disabled={geoDisabled}
            size="sm"
            variant="outline"
            className="rounded-none"
          >
            {moveLayerToPublicLoading ? "이전 중..." : "미정의 테이블 → public_layer 이전"}
          </Button>
          <Button
            onClick={clearGeoserverLogs}
            disabled={geoDisabled}
            size="sm"
            className="rounded-none"
          >
            로그 지우기
          </Button>
        </div>
        <div className="p-2 font-mono text-sm min-h-[280px] max-h-[420px] overflow-y-auto border rounded border-border bg-muted/30">
          {geoserverLogs.length === 0 ? (
            <div className="text-muted-foreground">로그가 없습니다. 테스트를 실행해주세요.</div>
          ) : (
            <div className="space-y-1">
              {geoserverLogs.map((log, index) => (
                <div key={index} className="leading-relaxed text-foreground">
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
