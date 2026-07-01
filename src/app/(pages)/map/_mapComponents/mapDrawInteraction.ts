import type { MapContextValue } from "./MapContext";

/** 지도 Draw 계열 인터랙션 — 동시에 하나만 활성 */
export type MapDrawInteractionKind = "measure" | "spatialSearch" | "layerRowGeomEdit";

const LABELS: Record<MapDrawInteractionKind, string> = {
  measure: "거리·면적 측정",
  spatialSearch: "도형 검색 그리기",
  layerRowGeomEdit: "등록·수정 도형 편집",
};

type MapDrawContextSlice = Pick<
  MapContextValue,
  "measurementActive" | "spatialDrawRequest" | "layerRowGeomEdit"
>;

/** except를 제외하고 진행 중인 Draw 인터랙션 */
export function getBlockingMapDrawInteraction(
  ctx: MapDrawContextSlice | null | undefined,
  except?: MapDrawInteractionKind
): MapDrawInteractionKind | null {
  if (!ctx) return null;
  if (except !== "layerRowGeomEdit" && ctx.layerRowGeomEdit) return "layerRowGeomEdit";
  if (except !== "spatialSearch" && ctx.spatialDrawRequest) return "spatialSearch";
  if (except !== "measure" && ctx.measurementActive) return "measure";
  return null;
}

export function notifyMapDrawInteractionBlocked(
  blocker: MapDrawInteractionKind,
  target: MapDrawInteractionKind
): void {
  if (typeof window === "undefined") return;
  window.alert(
    `${LABELS[blocker]}이(가) 진행 중입니다. 완료하거나 취소한 후 ${LABELS[target]}을(를) 사용해 주세요.`
  );
}

/** target 시작 가능 여부 (불가 시 안내 후 false) */
export function canStartMapDrawInteraction(
  ctx: MapDrawContextSlice | null | undefined,
  target: MapDrawInteractionKind
): boolean {
  const blocker = getBlockingMapDrawInteraction(ctx, target);
  if (!blocker) return true;
  notifyMapDrawInteractionBlocked(blocker, target);
  return false;
}
