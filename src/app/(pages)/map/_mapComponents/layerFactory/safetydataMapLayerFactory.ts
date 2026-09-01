import { useEffect, useState } from 'react';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import type { Map } from 'ol';
import type { Extent } from 'ol/extent';
import { transformExtent } from 'ol/proj';
import { call } from '@/lib/api';
import { WORKSPACE } from './serviceLayerFactory';
import { getGeoServerBase } from '@/lib/geoserverUrl';

/**
 * 재난안전데이터(안전데이터포털 연계) — GeoServer WMS
 * SafetyMapLayerPanel 토글과 동기화
 *
 * 지도 그리기: 브라우저가 OpenLayers ImageWMS로 동일 출처 `/geoserver/.../wms`(rewrite)에 GetMap 요청함.
 * Next `POST /api`(lib/api `call`)와 무관 — WMS는 geoserver 경로, JSON 게이트웨이는 /api 로 구분.
 */
/** 병상정보 패널 — GeoServer WMS(병원 POI). `safetyMapLayerVisibility` 키와 동일 */
export const SAFETY_HOSPITAL_POI_GEO_TABLE = 'sd_mois_hospital_poi' as const;

/** 저수지 수위 패널(saftyJsj) — GeoServer WMS(저수지 제원 포인트) */
export const SAFETY_RESERVOIR_MASTER_GEO_TABLE = 'sd_reservoir_master' as const;

/** 재난대응시설 패널에서 켜는 GeoServer 레이어 (panelId === tableName). */
export const SAFETY_FAC_PANEL_GEO_TABLE_NAMES: readonly string[] = [
  'sd_cold_wave_shelter',
  'sd_heat_wave_shelter',
  'sd_heat_mitigation_facility',
  'sd_earthquake_outdoor_evac_site',
  'sd_tsunami_emergency_evac_site',
  'sd_civil_defense_shelter',
  'sd_mois_displaced_temp_housing',
] as const;

export const SAFETY_MAP_GEOSERVER_OVERLAYS: {
  panelId: string;
  tableName: string;
  zIndex: number;
  opacity: number;
}[] = [
  /** 침수흔적도(moisFloodTrace)는 safemap IF_0092_WMS — SafetyMapLayerPanel */
  /** 물놀이관리지역(waterPlayManaged)는 safemap IF_0044_WMS — SafetyMapLayerPanel */
  /** 겹침 순서(위→아래): 한파쉼터 > 무더위쉼터 > 폭염저감시설 */
  { panelId: 'sd_heat_mitigation_facility', tableName: 'sd_heat_mitigation_facility', zIndex: 119, opacity: 0.88 },
  { panelId: 'sd_heat_wave_shelter', tableName: 'sd_heat_wave_shelter', zIndex: 120, opacity: 0.88 },
  { panelId: 'sd_cold_wave_shelter', tableName: 'sd_cold_wave_shelter', zIndex: 121, opacity: 0.88 },
  {
    panelId: 'sd_earthquake_outdoor_evac_site',
    tableName: 'sd_earthquake_outdoor_evac_site',
    zIndex: 122,
    opacity: 0.88,
  },
  {
    panelId: 'sd_tsunami_emergency_evac_site',
    tableName: 'sd_tsunami_emergency_evac_site',
    zIndex: 123,
    opacity: 0.88,
  },
  {
    panelId: 'sd_civil_defense_shelter',
    tableName: 'sd_civil_defense_shelter',
    zIndex: 124,
    opacity: 0.88,
  },
  {
    panelId: 'sd_mois_displaced_temp_housing',
    tableName: 'sd_mois_displaced_temp_housing',
    zIndex: 125,
    opacity: 0.88,
  },
  /** 병상정보 패널 진입 시 자동 표시 (테이블명 = WMS LAYERS / visibility 키) */
  {
    panelId: SAFETY_HOSPITAL_POI_GEO_TABLE,
    tableName: SAFETY_HOSPITAL_POI_GEO_TABLE,
    zIndex: 126,
    opacity: 0.88,
  },
  /** 저수지 수위 패널(saftyJsj) — 제원 포인트 WMS */
  {
    panelId: SAFETY_RESERVOIR_MASTER_GEO_TABLE,
    tableName: SAFETY_RESERVOIR_MASTER_GEO_TABLE,
    zIndex: 127,
    opacity: 0.88,
  },
];

export function createSafetydataMapLayers(): ImageLayer<ImageWMS>[] {
  const geoServerBase = getGeoServerBase();
  const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`;

  return SAFETY_MAP_GEOSERVER_OVERLAYS.map(({ tableName, zIndex, opacity }) => {
    const layer = new ImageLayer({
      minZoom: 0,
      maxZoom: 30,
      visible: false,
      opacity,
      source: new ImageWMS({
        url: wmsUrl,
        params: {
          LAYERS: `${WORKSPACE}:${tableName}`,
          STYLES: tableName,
        },
        serverType: 'geoserver',
        ratio: 1.5,
      }),
    });
    layer.set('name', tableName);
    layer.set('safetyMapGeoLayer', true);
    layer.set('layerTableName', tableName);
    layer.setZIndex(zIndex);
    return layer;
  });
}

/** 패널 visibility 레코드 → 켜진 GeoServer 테이블명 집합 */
export function getVisibleSafetyMapGeoTables(visibility: Record<string, boolean | undefined>): Set<string> {
  const s = new Set<string>();
  for (const row of SAFETY_MAP_GEOSERVER_OVERLAYS) {
    if (visibility[row.panelId]) s.add(row.tableName);
  }
  return s;
}

function emdWgs84To3857Extent(d: {
  minX: unknown;
  maxX: unknown;
  minY: unknown;
  maxY: unknown;
}): Extent | undefined {
  const minX = Number(d.minX);
  const maxX = Number(d.maxX);
  const minY = Number(d.minY);
  const maxY = Number(d.maxY);
  if (![minX, maxX, minY, maxY].every((n) => Number.isFinite(n))) return undefined;
  if (minX >= maxX || minY >= maxY) return undefined;
  return transformExtent([minX, minY, maxX, maxY], 'EPSG:4326', 'EPSG:3857') as Extent;
}

/**
 * GeoServer WMS ImageWMS는 뷰 전체 BBOX로 GetMap — emd(교통·safemap과 동일) 밖은 그리지 않도록 레이어 extent로 클리핑
 * (ol/renderer: layerState.extent 있으면 clipped rendering)
 */
export function useSafetydataMapLayerSync(map: Map | null, mapReady: boolean, visibleTables: Set<string>) {
  const [emd3857, setEmd3857] = useState<Extent | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'devTestService',
          action: 'getEmdExtentWgs84',
          params: {},
        });
        if (cancelled) return;
        const d = res?.data ?? res;
        if (d && typeof d === 'object' && 'error' in d && (d as { error?: string }).error) {
          setEmd3857(undefined);
          return;
        }
        if (!d || typeof d !== 'object' || d.minX == null || d.maxX == null || d.minY == null || d.maxY == null) {
          setEmd3857(undefined);
          return;
        }
        setEmd3857(emdWgs84To3857Extent(d as { minX: unknown; maxX: unknown; minY: unknown; maxY: unknown }));
      } catch {
        if (!cancelled) setEmd3857(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !map) return;
    map.getLayers().getArray().forEach((l) => {
      if (!l.get('safetyMapGeoLayer')) return;
      const tableName = l.get('layerTableName') as string | undefined;
      const row = SAFETY_MAP_GEOSERVER_OVERLAYS.find((r) => r.tableName === tableName);
      if (row) {
        l.setOpacity(row.opacity);
        l.setZIndex(row.zIndex);
      }
      l.setVisible(tableName != null && visibleTables.has(tableName));
      l.setExtent(emd3857);
    });
  }, [map, mapReady, visibleTables, emd3857]);
}
