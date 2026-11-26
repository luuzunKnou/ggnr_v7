import type { MapContextValue } from '@/app/(pages)/map/_mapComponents/MapContext';
import { UNDERGROUND_FACILITY_LAYERS } from '@/app/(pages)/map/_mapComponents/layerFactory/undergroundFacilityLayerFactory';
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
    | 'setDataQueryMapPick'
    | 'setServiceWmsCqlByLayer'
  >
>;

/** 도로대장 총괄(a0020000)을 기본으로 켜 두는 좌측 서비스 메뉴 */
export const SERVICE_MENUS_WITH_ROAD_LEDGER_SUMMARY = new Set(['roadLedger']);

/**
 * 우측 «지하시설물» 패널 선택은 visibleLayerNames에 미러된다.
 * 좌측 업무 메뉴 전환 시 서비스 WMS만 끄고, 지하시설물 켠 상태는 유지한다.
 */
const UNDERGROUND_FACILITY_VISIBLE_NAMES = new Set(
  UNDERGROUND_FACILITY_LAYERS.map((l) => l.tableName.trim().toLowerCase()).filter(Boolean)
);

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

function pickPreservedVisibleLayerNames(prev: Set<string>): Set<string> {
  const next = new Set<string>();
  for (const name of prev) {
    const key = String(name ?? '').trim().toLowerCase();
    if (UNDERGROUND_FACILITY_VISIBLE_NAMES.has(key)) next.add(name);
  }
  return next;
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
  const preserved = pickPreservedVisibleLayerNames(prev);

  if (keepSummary) {
    const next = new Set<string>(preserved);
    next.add(summaryId);
    if (setsEqual(prev, next)) return prev;
    return next;
  }

  if (prev.size === 0) return prev;
  if (setsEqual(prev, preserved)) return prev;
  return preserved;
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

/**
 * 좌측 서비스(서브메뉴) 전환 시 끌 레이어·검색 상태.
 * 우측 지적도·건물 등은 별도 상태라 여기서 끄지 않음.
 * 지하시설물은 visible에 미러되므로 이름만 골라 남긴다.
 */
export function clearServiceMenuLayerState(
  ctx: ServiceMenuLayerClearTarget | null | undefined,
  options?: ClearServiceMenuLayerOptions
) {
  if (!ctx) return;
  ctx.setVisibleLayerNames?.((prev) => resolveClearedVisibleLayerNames(prev, options));
  ctx.setSafetyMapLayerVisibility?.((prev) => (Object.keys(prev ?? {}).length === 0 ? prev : {}));
  ctx.setSpatialFilterWkt?.((prev) => (prev == null ? prev : null));
  ctx.setSpatialFilteredLayerNames?.((prev) => (prev == null ? prev : null));
  ctx.setServiceWmsCqlByLayer?.((prev) => (prev == null ? prev : null));
  ctx.setIdentifyResultList?.((prev) => (prev == null ? prev : null));
  ctx.setIdentifySelectedRow?.((prev) => (prev == null ? prev : null));
  ctx.setDataQueryMapPick?.((prev) => (prev == null ? prev : null));
}
