"use client";

import type { BikeRoadRoute } from "./bikeRoadMock";
import { useBikeRoadMapOverlay } from "./useBikeRoadMapOverlay";

/** map-layout — 노선 오버레이만 (범례는 구간 추가 모달에만) */
export function BikeRoadMapOverlay({
  open,
  selectedId,
  routes,
}: {
  open: boolean;
  selectedId: string | null;
  routes?: BikeRoadRoute[];
}) {
  useBikeRoadMapOverlay({ open, selectedId, routes });
  return null;
}
