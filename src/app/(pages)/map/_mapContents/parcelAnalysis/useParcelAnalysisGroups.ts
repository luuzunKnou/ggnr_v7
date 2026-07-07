'use client';

import { useEffect, useMemo, useState } from 'react';
import { call } from '@/lib/api';
import {
  PARCEL_ANALYSIS_GROUPS,
  type ParcelAnalysisGroupDef,
} from './parcelAnalysisItems';

export type FacilityLayerMeta = {
  layerKey: string;
  layerKorName: string;
  geomType: string;
  schema: string;
};

type FacilityCatalogResponse = {
  ok?: boolean;
  groups?: Array<{
    id: string;
    title: string;
    description: string;
    layers: FacilityLayerMeta[];
  }>;
};

export function useParcelAnalysisGroups(isOpen: boolean) {
  const [facilityLayerMap, setFacilityLayerMap] = useState<Record<string, FacilityLayerMeta[]>>({});
  const [facilityItems, setFacilityItems] = useState<ParcelAnalysisGroupDef['items']>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setFacilityLayerMap({});
      setFacilityItems([]);
      setCatalogLoaded(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'mapAnalyseService',
          action: 'getParcelAnalysisFacilityCatalog',
          params: {},
        });
        const data = (res?.data ?? res) as FacilityCatalogResponse | undefined;
        if (cancelled) return;
        const groups = data?.groups ?? [];
        const layerMap: Record<string, FacilityLayerMeta[]> = {};
        const items = groups.map((g) => {
          layerMap[g.id] = g.layers ?? [];
          return { id: g.id, title: g.title, description: g.description };
        });
        setFacilityLayerMap(layerMap);
        setFacilityItems(items);
      } catch {
        if (!cancelled) {
          setFacilityLayerMap({});
          setFacilityItems([]);
        }
      } finally {
        if (!cancelled) setCatalogLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const groups = useMemo<ParcelAnalysisGroupDef[]>(() => {
    const staticGroups = PARCEL_ANALYSIS_GROUPS.filter((g) => g.id !== 'facility');
    if (!facilityItems.length) return staticGroups;
    return [...staticGroups, { id: 'facility', title: '시설목록', items: facilityItems }];
  }, [facilityItems]);

  const allItemIds = useMemo(() => groups.flatMap((g) => g.items.map((i) => i.id)), [groups]);

  return { groups, allItemIds, facilityLayerMap, catalogLoaded };
}
