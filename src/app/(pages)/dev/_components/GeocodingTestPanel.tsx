"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/app/shadcnComponents/ui/button";
import { Input } from "@/app/shadcnComponents/ui/input";
import { call } from "@/lib/api";
import {
  getCoordFromAddress,
  type GetCoordFromAddressResult,
  type VWorldGetCoordAddressType,
} from "@/app/(pages)/map/_mapComponents/addressSearch/vworldAddressSearch";
import { Loader2 } from "lucide-react";

const SAMPLE_ROAD = "서울특별시 강남구 봉은사로 524";

export function GeocodingTestPanel() {
  const [apiKey, setApiKey] = useState("");
  const [address, setAddress] = useState(SAMPLE_ROAD);
  const [addrType, setAddrType] = useState<VWorldGetCoordAddressType>("ROAD");
  const [loadingKey, setLoadingKey] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<GetCoordFromAddressResult | null>(null);
  const [rawJson, setRawJson] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingKey(true);
      try {
        const r = await call("", "POST", { service: "configService", action: "getMapConfig", params: {} });
        const d = r?.data ?? r;
        const k = String(d?.VWORLD_API_KEY ?? "").trim();
        if (!cancelled) setApiKey(k);
      } catch {
        if (!cancelled) setApiKey("");
      } finally {
        if (!cancelled) setLoadingKey(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runTest = useCallback(async () => {
    setRunning(true);
    setResult(null);
    setRawJson("");
    try {
      const res = await getCoordFromAddress(address, { apiKey, type: addrType });
      setResult(res);
      setRawJson(JSON.stringify(res.ok ? res.raw : res.raw ?? { message: res.message }, null, 2));
    } finally {
      setRunning(false);
    }
  }, [address, apiKey, addrType]);

  const keyHint =
    apiKey.length > 8
      ? `로드됨 (${apiKey.length}자, 끝 4자 …${apiKey.slice(-4)})`
      : apiKey
        ? "로드됨"
        : "없음 (runtime.env 의 VWORLD_API_KEY 확인)";

  return (
    <div className="flex max-w-3xl flex-col gap-4 p-1 text-sm">
      <div>
        <h3 className="text-base font-semibold text-foreground">VWorld 지오코딩 테스트 (GetCoord)</h3>
        <p className="mt-1 text-muted-foreground">
          Address API 2.0 <code className="rounded bg-muted px-1">request=GetCoord</code> — 도로명(
          <code>ROAD</code>) 또는 지번(<code>PARCEL</code>) 주소를 EPSG:4326 좌표로 조회합니다. 인증키는{" "}
          <code>configService.getMapConfig</code> 의 <code>VWORLD_API_KEY</code> 를 사용합니다.
        </p>
      </div>

      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">키:</span> {loadingKey ? "불러오는 중…" : keyHint}
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-muted-foreground">주소</label>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={SAMPLE_ROAD} className="font-mono text-xs" />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <span className="text-xs font-medium text-muted-foreground">type</span>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input type="radio" name="vworldGetCoordType" checked={addrType === "ROAD"} onChange={() => setAddrType("ROAD")} />
          ROAD (도로명)
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input type="radio" name="vworldGetCoordType" checked={addrType === "PARCEL"} onChange={() => setAddrType("PARCEL")} />
          PARCEL (지번)
        </label>
      </div>

      <div>
        <Button type="button" onClick={() => void runTest()} disabled={running || !apiKey.trim() || !address.trim()}>
          {running ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              호출 중…
            </>
          ) : (
            "GetCoord 호출"
          )}
        </Button>
        {!apiKey.trim() && !loadingKey && (
          <p className="mt-2 text-xs text-destructive">VWORLD_API_KEY 가 비어 있어 호출할 수 없습니다.</p>
        )}
      </div>

      {result && (
        <div className="space-y-2">
          {result.ok ? (
            <p className="rounded border border-green-600/40 bg-green-500/10 px-3 py-2 text-sm text-green-800 dark:text-green-200">
              경도(lon): <strong>{result.lon}</strong>, 위도(lat): <strong>{result.lat}</strong>
            </p>
          ) : (
            <p className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {result.message}
              {result.status ? ` [status: ${result.status}]` : ""}
            </p>
          )}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">응답 JSON</p>
            <pre className="max-h-80 overflow-auto rounded border bg-muted/50 p-3 text-[11px] leading-relaxed">{rawJson}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
