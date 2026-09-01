"use client";

import { useEffect, useState } from "react";
import { call } from "@/lib/api";
import type { RiverBasicPlanTab } from "@/lib/riverBasicPlanMapAttachmentLayers";

/** 해당 탭에서 DB에 실제 있는 기본계획 지도 레이어. null이면 조회 중 */
export function useRiverBasicPlanExistingMapLayers(tab: RiverBasicPlanTab): string[] | null {
  const [layers, setLayers] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLayers(null);
    void call("", "POST", {
      service: "riverBasicPlanService",
      action: "getRiverBasicPlanExistingMapLayers",
      params: { tab },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setLayers(Array.isArray(data?.layers) ? data.layers.map((n: unknown) => String(n)) : []);
      })
      .catch(() => {
        if (!cancelled) setLayers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  return layers;
}
