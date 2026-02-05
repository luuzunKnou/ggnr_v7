"use client";

import { useEffect, useState } from "react";
import { Button } from "@/app/shadcnComponents/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/shadcnComponents/ui/card";
import { Input } from "@/app/shadcnComponents/ui/input";
import { call } from "@/lib/api";

type DbConnection = {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
};

type SridResult = {
  schema: string;
  table: string;
  column: string;
  status: "updated" | "failed";
  error?: string;
};

export function DbManagerLayerGeomSridContent({ onBack }: { onBack?: () => void }) {
  const [conn, setConn] = useState<DbConnection>({
    host: "",
    port: "5432",
    database: "",
    username: "",
    password: "",
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectSuccess, setConnectSuccess] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    schema: string;
    updatedCount: number;
    failedCount: number;
    results: SridResult[];
  } | null>(null);

  const canConnect = Boolean(
    conn.host.trim() && conn.port.trim() && conn.database.trim() && conn.username.trim()
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await call("", "POST", {
          service: "dbManagerService",
          action: "getDefaultDbConfig",
          params: {},
        });
        if (cancelled || !response?.success || !response?.data) return;
        const d = response.data;
        setConn((prev) => ({
          ...prev,
          host: d.host ?? prev.host,
          port: d.port ?? prev.port,
          database: d.database ?? prev.database,
          username: d.username ?? prev.username,
          password: d.password ?? prev.password,
        }));
      } catch {
        // 무시
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const params = {
    host: conn.host.trim(),
    port: conn.port.trim(),
    database: conn.database.trim(),
    username: conn.username.trim(),
    password: conn.password || undefined,
  };

  const testConnection = async () => {
    setConnectError(null);
    setConnectSuccess(null);
    setIsConnecting(true);
    try {
      const response = await call("", "POST", {
        service: "dbManagerService",
        action: "testConnection",
        params,
      });
      if (!response?.success) throw new Error(response?.error || "연결 실패");
      setConnectSuccess(response?.data?.serverTime ? `연결 성공 (${response.data.serverTime})` : "연결 성공");
      setConnectError(null);
    } catch (e: unknown) {
      setConnectSuccess(null);
      const msg =
        e && typeof e === "object" && "error" in e
          ? (e as { error: string }).error
          : (e as Error)?.message ?? "연결 실패";
      setConnectError(String(msg));
    } finally {
      setIsConnecting(false);
    }
  };

  const runSetLayerGeomSrid = async () => {
    setRunError(null);
    setResult(null);
    setIsRunning(true);
    try {
      const response = await call("", "POST", {
        service: "dbManagerService",
        action: "setLayerSchemaGeomSrid",
        params: { ...params, schema: "layer" },
      });
      if (!response?.success) throw new Error(response?.error || "실행 실패");
      setResult(response.data);
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "error" in e ? (e as { error: string }).error : (e as Error)?.message ?? "실행 실패";
      setRunError(String(msg));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">layer 스키마 geom 좌표계 5181 설정</h2>
        {onBack && (
          <Button variant="outline" size="sm" className="rounded-none" onClick={onBack}>
            뒤로
          </Button>
        )}
      </div>

      <Card className="rounded-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">DB 연결</CardTitle>
          <CardDescription>
            layer 스키마에 있는 모든 테이블의 geom 컬럼 SRID를 EPSG:5181로 설정합니다. (pg_tileserv 등에서 사용)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Host</label>
              <Input
                value={conn.host}
                onChange={(e) => setConn((c) => ({ ...c, host: e.target.value }))}
                placeholder="192.168.120.82"
                className="rounded-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Port</label>
              <Input
                value={conn.port}
                onChange={(e) => setConn((c) => ({ ...c, port: e.target.value }))}
                placeholder="5432"
                className="rounded-none"
              />
            </div>
            <div className="space-y-1 col-span-2">
              <label className="text-sm font-medium">Database</label>
              <Input
                value={conn.database}
                onChange={(e) => setConn((c) => ({ ...c, database: e.target.value }))}
                placeholder="database"
                className="rounded-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Username</label>
              <Input
                value={conn.username}
                onChange={(e) => setConn((c) => ({ ...c, username: e.target.value }))}
                placeholder="user"
                className="rounded-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Password</label>
              <Input
                type="password"
                value={conn.password}
                onChange={(e) => setConn((c) => ({ ...c, password: e.target.value }))}
                placeholder="••••••••"
                className="rounded-none"
              />
            </div>
          </div>
          {connectError && <p className="text-sm text-destructive">{connectError}</p>}
          {connectSuccess && <p className="text-sm text-green-600">{connectSuccess}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              className="rounded-none"
              onClick={testConnection}
              disabled={!canConnect || isConnecting}
            >
              {isConnecting ? "연결 중..." : "연결 테스트"}
            </Button>
            <Button
              size="sm"
              className="rounded-none"
              onClick={runSetLayerGeomSrid}
              disabled={!canConnect || isRunning}
            >
              {isRunning ? "실행 중..." : "layer 스키마 geom → 5181 설정"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {runError && <p className="text-sm text-destructive">{runError}</p>}

      {result && (
        <Card className="rounded-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">실행 결과</CardTitle>
            <CardDescription>
              스키마: {result.schema} · 성공: {result.updatedCount}개 · 실패: {result.failedCount}개
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result.results.length === 0 ? (
              <p className="text-sm text-muted-foreground">geometry_columns에 등록된 geom 컬럼이 없습니다.</p>
            ) : (
              <ul className="text-sm space-y-1 max-h-60 overflow-y-auto">
                {result.results.map((r, i) => (
                  <li key={i} className={r.status === "failed" ? "text-destructive" : ""}>
                    {r.schema}.{r.table}.{r.column}: {r.status === "updated" ? "설정 완료" : r.error ?? "실패"}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
