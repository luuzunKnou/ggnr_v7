import type { MapContextValue } from '@/app/(pages)/map/_mapComponents/MapContext';
import { ROAD_LEDGER_SUMMARY_LAYER_ID } from '@/app/(pages)/map/_mapContents/road/roadLedger/roadLedgerDocLayerMap';

type ServiceMenuLayerClearTarget = Partial<
  Pick<
    MapContextValue,
    | 'setVisibleLayerNames'
    | 'setSafetyMapLayerVisibility'
    | 'setSpatialFilterWkt'
    | 'setSpatialFilteredLayerNames'
    | 'setIdentifyResultList'
    | 'setIdentifySelectedRow'
  >
>;

/** 도로대장 총괄(a0020000)을 기본으로 켜 두는 좌측 서비스 메뉴 */
export const SERVICE_MENUS_WITH_ROAD_LEDGER_SUMMARY = new Set(['roadLedger', 'roadInfra']);

export type ClearServiceMenuLayerOptions = {
  /** 전환 직후 열릴 서비스 메뉴 키(opened) */
  nextServiceMenuKey?: string;
  /** CCTV 통행 모드 등으로 총괄 레이어를 켜지 않을 때 */
  skipRoadLedgerSummary?: boolean;
};

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

export function shouldKeepRoadLedgerSummaryLayer(
  nextServiceMenuKey: string | undefined,
  opts?: Pick<ClearServiceMenuLayerOptions, 'skipRoadLedgerSummary'>
): boolean {
  if (opts?.skipRoadLedgerSummary) return false;
  const key = String(nextServiceMenuKey ?? '').trim();
  return key.length > 0 && SERVICE_MENUS_WITH_ROAD_LEDGER_SUMMARY.has(key);
}

function resolveClearedVisibleLayerNames(
  prev: Set<string>,
  options?: ClearServiceMenuLayerOptions
): Set<string> {
  const summaryId = ROAD_LEDGER_SUMMARY_LAYER_ID.toLowerCase();
  const keepSummary = shouldKeepRoadLedgerSummaryLayer(options?.nextServiceMenuKey, options);

  if (keepSummary) {
    const next = new Set<string>([summaryId]);
    if (setsEqual(prev, next)) return prev;
    if (
      prev.size === 1 &&
      (prev.has(summaryId) || prev.has(ROAD_LEDGER_SUMMARY_LAYER_ID))
    ) {
      return prev;
    }
    return next;
  }

  if (prev.size === 0) return prev;
  return new Set();
}

export function ensureRoadLedgerSummaryLayer(
  ctx: Pick<ServiceMenuLayerClearTarget, 'setVisibleLayerNames'> | null | undefined
) {
  if (!ctx?.setVisibleLayerNames) return;
  const id = ROAD_LEDGER_SUMMARY_LAYER_ID.toLowerCase();
  ctx.setVisibleLayerNames((prev) => {
    if (prev.has(id) || prev.has(ROAD_LEDGER_SUMMARY_LAYER_ID)) return prev;
    const next = new Set(prev);
    next.add(id);
    return next;
  });
}

/** 좌측 서비스(서브메뉴) 전환 시 끌 레이어·검색 상태. 우측 public_layer(지적도 등)는 별도 상태. */
export function clearServiceMenuLayerState(
  ctx: ServiceMenuLayerClearTarget | null | undefined,
  options?: ClearServiceMenuLayerOptions
) {
  if (!ctx) return;
  ctx.setVisibleLayerNames?.((prev) => resolveClearedVisibleLayerNames(prev, options));
  ctx.setSafetyMapLayerVisibility?.((prev) => (Object.keys(prev ?? {}).length === 0 ? prev : {}));
  ctx.setSpatialFilterWkt?.((prev) => (prev == null ? prev : null));
  ctx.setSpatialFilteredLayerNames?.((prev) => (prev == null ? prev : null));
  ctx.setIdentifyResultList?.((prev) => (prev == null ? prev : null));
  ctx.setIdentifySelectedRow?.((prev) => (prev == null ? prev : null));
}
