import type Map from 'ol/Map';
import { call } from '@/lib/api';
import {
  getForeignOccupationLedgerTableIds,
  getOccupationLedgerBinding,
  getOccupationLedgerWmsLayerIds,
} from '@/lib/occupationLedgerBinding';
import { refreshServiceWmsLayer } from '../../_mapComponents/layerFactory/serviceLayerFactory';
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults';

type SetVisible = (updater: (prev: Set<string>) => Set<string>) => void;

export function clearOccupationLedgerWmsLayers(
  setVisibleLayerNames: SetVisible | null | undefined,
  params?: { serEng?: string | null; system?: string | null }
) {
  if (!setVisibleLayerNames) return;
  const binding = getOccupationLedgerBinding({
    serEng: params?.serEng,
    system: params?.system,
  });
  if (!binding) return;
  const ids = new Set(getOccupationLedgerWmsLayerIds(binding));
  setVisibleLayerNames((prev) => {
    let changed = false;
    const next = new Set(prev);
    for (const id of ids) {
      if (next.delete(id)) changed = true;
    }
    return changed ? next : prev;
  });
}

/** 시스템 전환 시 — 현재 시스템이 아닌 점용대장 레이어만 끄기 */
export function clearForeignOccupationLedgerWmsLayers(
  setVisibleLayerNames: SetVisible | null | undefined,
  system?: string | null
) {
  if (!setVisibleLayerNames) return;
  const ids = getForeignOccupationLedgerTableIds(system);
  if (ids.length === 0) return;
  setVisibleLayerNames((prev) => {
    let changed = false;
    const next = new Set(prev);
    for (const id of ids) {
      if (next.delete(id)) changed = true;
    }
    return changed ? next : prev;
  });
}

export function ensureOccupationLedgerWmsLayers(
  setVisibleLayerNames: SetVisible | null | undefined,
  params?: {
    serEng?: string | null;
    system?: string | null;
    /** true면 필지·물건지 WMS도 켬. 기본은 본표만 (목록 선택 시 자식 도형 숨김) */
    includeChildren?: boolean;
  }
) {
  if (!setVisibleLayerNames) return;
  const binding = getOccupationLedgerBinding({
    serEng: params?.serEng,
    system: params?.system,
  });
  if (!binding) return;
  const mainId = binding.mainTable.trim().toLowerCase();
  const childIds = [binding.jijukTable, binding.mgjTable].map((t) => t.trim().toLowerCase());
  const includeChildren = params?.includeChildren === true;
  setVisibleLayerNames((prev) => {
    const next = new Set(prev);
    let changed = false;
    if (!next.has(mainId)) {
      next.add(mainId);
      changed = true;
    }
    if (includeChildren) {
      for (const id of childIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
    } else {
      for (const id of childIds) {
        if (next.delete(id)) changed = true;
      }
    }
    return changed ? next : prev;
  });
}

/** 저장·상세 갱신 후 WMS·뷰 동기화 (하천점용과 동일) */
export async function refreshOccupationLedgerMapView(opts: {
  map: Map | null | undefined;
  detailId: string;
  serEng?: string | null;
  system?: string | null;
  setVisibleLayerNames?: SetVisible | null;
  applyMapViewPadding?: (() => void) | null;
}): Promise<void> {
  const key = String(opts.detailId ?? '').trim();
  if (!key) return;

  ensureOccupationLedgerWmsLayers(opts.setVisibleLayerNames, {
    serEng: opts.serEng,
    system: opts.system,
  });
  refreshServiceWmsLayer(opts.map);
  requestAnimationFrame(() => refreshServiceWmsLayer(opts.map));

  try {
    const res = await call('', 'POST', {
      service: 'occupationLedgerService',
      action: 'getOccupationLedgerExtent3857ByKey',
      params: { key, serEng: opts.serEng, system: opts.system },
    });
    const data = res?.data ?? res;
    const ext = data?.extent3857 as unknown;
    if (
      opts.map &&
      Array.isArray(ext) &&
      ext.length === 4 &&
      ext.every((v) => Number.isFinite(Number(v)))
    ) {
      scheduleFitMapToExtent3857(opts.map, ext as number[], {
        maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
        applyMapViewPadding: () => opts.applyMapViewPadding?.(),
      });
    }
  } catch {
    /* extent 없으면 WMS 갱신만 */
  }
}
