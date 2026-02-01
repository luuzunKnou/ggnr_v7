"use client"

import { useState, useEffect } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Input } from "@/app/shadcnComponents/ui/input"
import { call } from "@/lib/api"

/** TileServe 기본 포트 (TileServer GL 등) */
const TILE_SERVE_DEFAULT_PORT = "8080"
/** FeatureServe 기본 포트 (ArcGIS Feature Service 등) */
const FEATURE_SERVE_DEFAULT_PORT = "6080"

function getDefaultTileServUrl(): string {
  if (typeof window === "undefined") return `http://127.0.0.1:${TILE_SERVE_DEFAULT_PORT}`
  return `http://${window.location.hostname}:${TILE_SERVE_DEFAULT_PORT}`
}

function getDefaultFeatureServUrl(): string {
  if (typeof window === "undefined") return `http://127.0.0.1:${FEATURE_SERVE_DEFAULT_PORT}`
  return `http://${window.location.hostname}:${FEATURE_SERVE_DEFAULT_PORT}`
}

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
  const [tileServUrl, setTileServUrl] = useState("")
  const [featureServUrl, setFeatureServUrl] = useState("")

  useEffect(() => {
    setTileServUrl(getDefaultTileServUrl())
    setFeatureServUrl(getDefaultFeatureServUrl())
  }, [])

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`])
  }

  const testDatabase = async () => {
    setIsLoading(true)
    setResult(null)
    setLogs([])
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

  const testTileServe = async () => {
    if (!tileServUrl.trim()) {
      addLog("Tile 서버: URL을 입력하세요.")
      return
    }
    setIsLoading(true)
    addLog(`Tile 서버 테스트 시작: ${tileServUrl}`)
    try {
      const response = await call("", "POST", {
        service: "devTestService",
        action: "testTileServe",
        params: { url: tileServUrl.trim() },
      })
      if (!response.success) {
        addLog(`Tile 서버 테스트 실패: ${response.error}`)
        return
      }
      const d = response.data
      if (d.success) {
        addLog(`Tile 서버 연결 성공 (${d.status} ${d.statusText})`)
        if (d.contentType) addLog(`  Content-Type: ${d.contentType}`)
      } else {
        addLog(`Tile 서버 연결 실패: ${d.error ?? `${d.status} ${d.statusText}`}`)
      }
    } catch (e: any) {
      addLog(`Tile 서버 테스트 오류: ${e?.message ?? String(e)}`)
    } finally {
      setIsLoading(false)
    }
  }

  const testFeatureServ = async () => {
    if (!featureServUrl.trim()) {
      addLog("Feature 서버: URL을 입력하세요.")
      return
    }
    setIsLoading(true)
    addLog(`Feature 서버 테스트 시작: ${featureServUrl}`)
    try {
      const response = await call("", "POST", {
        service: "devTestService",
        action: "testFeatureServ",
        params: { url: featureServUrl.trim() },
      })
      if (!response.success) {
        addLog(`Feature 서버 테스트 실패: ${response.error}`)
        return
      }
      const d = response.data
      if (d.success) {
        addLog(`Feature 서버 연결 성공 (${d.status} ${d.statusText})`)
        if (d.contentType) addLog(`  Content-Type: ${d.contentType}`)
        if (d.bodyPreview) addLog(`  응답 미리보기: ${d.bodyPreview.slice(0, 80)}...`)
      } else {
        addLog(`Feature 서버 연결 실패: ${d.error ?? `${d.status} ${d.statusText}`}`)
      }
    } catch (e: any) {
      addLog(`Feature 서버 테스트 오류: ${e?.message ?? String(e)}`)
    } finally {
      setIsLoading(false)
    }
  }

  const clearLogs = () => {
    setLogs([])
    setResult(null)
  }

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
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Tile 서버 URL"
            value={tileServUrl}
            onChange={(e) => setTileServUrl(e.target.value)}
            className="h-8 w-64 rounded-none text-sm"
          />
          <Button
            onClick={testTileServe}
            disabled={isLoading}
            size="sm"
            className="rounded-none"
          >
            Tile 서버 테스트
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Feature 서버 URL"
            value={featureServUrl}
            onChange={(e) => setFeatureServUrl(e.target.value)}
            className="h-8 w-64 rounded-none text-sm"
          />
          <Button
            onClick={testFeatureServ}
            disabled={isLoading}
            size="sm"
            className="rounded-none"
          >
            Feature 서버 테스트
          </Button>
        </div>
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
    </div>
  )
}
