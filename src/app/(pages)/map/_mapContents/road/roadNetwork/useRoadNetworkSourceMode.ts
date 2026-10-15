"use client";

import { useEffect, useState } from "react";
import { call } from "@/lib/api";
import type { RoadNetworkSourceMode } from "./roadNetworkLayerId";

let cached: RoadNetworkSourceMode | null = null;
let pending: Promise<RoadNetworkSourceMode> | null = null;

function fetchRoadNetworkSourceMode(): Promise<RoadNetworkSourceMode> {
  if (cached) return Promise.resolve(cached);
  pending ??= call("", "POST", {
    service: "roadNetworkService",
    action: "getRoadNetworkSourceMode",
    params: {},
  })
    .then((res) => {
      const data = res?.data ?? res;
      cached = data?.mode === "unified" ? "unified" : "legacy";
      return cached;
    })
    .catch(() => "legacy" as const)
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** 통합 도로망 자료 사용 여부. 조회 전에는 null */
export function useRoadNetworkSourceMode(): RoadNetworkSourceMode | null {
  const [mode, setMode] = useState<RoadNetworkSourceMode | null>(cached);
  useEffect(() => {
    if (mode) return;
    let alive = true;
    void fetchRoadNetworkSourceMode().then((m) => {
      if (alive) setMode(m);
    });
    return () => {
      alive = false;
    };
  }, [mode]);
  return mode;
}
