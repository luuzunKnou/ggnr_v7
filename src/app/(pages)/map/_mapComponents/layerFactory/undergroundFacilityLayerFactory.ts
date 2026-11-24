/**
 * 지하시설물 — 레이어관리 그룹(상수·하수 등)과 동일한 define_table_group 기준.
 * schema: layer
 */
import { useEffect } from 'react';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import type { Map as OlMap } from 'ol';
import tables from '@/config/defineLayer/tables.json';
import {
  markLayerGeomStack,
  mergeDefineLayerShpTypesIntoGeometryMap,
  sortLayerNamesForWmsStack,
  type LayerDbGeometryKind,
} from '@/lib/mapLayerGeometryOrder';
import { WORKSPACE } from './serviceLayerFactory';
import type {
  ThematicMapLayerGroup,
  ThematicMapLayerOption,
} from './thematicMapLayerFactory';
import { getGeoServerBase } from '@/lib/geoserverUrl';
import { geoserverWmsImageLoadFunction } from '@/lib/geoserverWmsImageLoad';
import { compareDefineTableOrder, parseDefineTableIdx } from '@/lib/defineTableOrder';

type DefineTableRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
  define_table_schema?: string;
  define_table_parents_layer?: string;
  define_table_div_query?: string;
  define_table_idx?: string | number;
};

function compareUndergroundLayers(a: ThematicMapLayerOption, b: ThematicMapLayerOption): number {
  return compareDefineTableOrder(a.tableIdx, a.layerName, b.tableIdx, b.layerName);
}

/** 지도 «지하시설물» — 레이어관리 그룹명과 동일 */
export const UNDERGROUND_FACILITY_GROUP_ALLOW = new Set([
  '상수',
  '급수구역',
  '하수',
  '배수설비',
  '광역상수',
  '가스',
  '도시가스',
  'LPG배관',
  '전기',
  '통신',
]);

const UNDERGROUND_FACILITY_GROUP_ORDER = [
  '상수',
  '급수구역',
  '하수',
  '배수설비',
  '광역상수',
  '가스',
  '도시가스',
  'LPG배관',
  '전기',
  '통신',
];

const UNDERGROUND_FACILITY_SCHEMA = 'layer';

/** 지도 «지하시설물» 목록에서 제외할 테이블 (가압장 펌프/흡수정, 정수장 펌프 현황) */
const UNDERGROUND_FACILITY_EXCLUDE_TABLES = new Set([
  'wtl_pres_pm_ps',
  'wtl_pres_hj_ps',
  'wtl_puri_dt_ps',
]);

/** 그룹명 접두 일치 (LIKE '허용그룹%') */
export function isUndergroundFacilityGroup(group: string): boolean {
  const g = String(group ?? '').trim();
  if (!g) return false;
  for (const allowed of UNDERGROUND_FACILITY_GROUP_ALLOW) {
    if (g === allowed || g.startsWith(allowed)) return true;
  }
  return false;
}

function groupSortKey(title: string): number {
  const t = String(title ?? '').trim();
  let best = UNDERGROUND_FACILITY_GROUP_ORDER.length;
  let bestLen = -1;
  for (let i = 0; i < UNDERGROUND_FACILITY_GROUP_ORDER.length; i++) {
    const allowed = UNDERGROUND_FACILITY_GROUP_ORDER[i];
    if (t === allowed || t.startsWith(allowed)) {
      if (allowed.length > bestLen) {
        bestLen = allowed.length;
        best = i;
      }
    }
  }
  return best;
}

function hasLayerTable(existing: Set<string>, name: string): boolean {
  return existing.has(name.trim().toLowerCase());
}

/**
 * tables.json(또는 프로젝트 분할 merge 결과) `layer` 스키마 중 지하시설물 대상 그룹을 묶어 패널·WMS 목록 생성.
 * 주제도와 동일: 부모 제외, 선택적 DB·데이터 필터.
 */
export function buildUndergroundFacilityLayerGroups(
  existingLayerTables?: Set<string> | null,
  layersWithData?: Set<string> | null,
  defineTables?: DefineTableRow[] | null
): ThematicMapLayerGroup[] {
  const rows = (defineTables ?? (tables as DefineTableRow[])) as DefineTableRow[];

  const parentNames = new Set<string>();
  for (const t of rows) {
    const parent = String(t.define_table_parents_layer ?? '').trim();
    if (parent) parentNames.add(parent.toLowerCase());
  }

  const dataNamesLower =
    layersWithData != null
      ? new Set([...layersWithData].map((n) => n.trim().toLowerCase()).filter(Boolean))
      : null;

  const byGroup = new Map<string, ThematicMapLayerOption[]>();

  for (const t of rows) {
    const schema = String(t.define_table_schema ?? '').trim();
    if (schema && schema !== UNDERGROUND_FACILITY_SCHEMA) continue;

    const group = String(t.define_table_group ?? '').trim();
    if (!isUndergroundFacilityGroup(group)) continue;

    const tableName = String(t.define_table_name ?? '').trim();
    if (!tableName) continue;
    if (UNDERGROUND_FACILITY_EXCLUDE_TABLES.has(tableName.toLowerCase())) continue;

    const layerName = String(t.define_table_kor_name ?? tableName).trim();
    const parentTableName = String(t.define_table_parents_layer ?? '').trim() || undefined;
    const cqlFilter = String(t.define_table_div_query ?? '').trim() || undefined;
    const tableIdx = parseDefineTableIdx(t.define_table_idx);

    if (parentNames.has(tableName.toLowerCase())) continue;
    if (!parentTableName && layerName.startsWith('(연속주제)')) continue;

    if (existingLayerTables) {
      if (parentTableName) {
        if (!hasLayerTable(existingLayerTables, parentTableName)) continue;
      } else if (!hasLayerTable(existingLayerTables, tableName)) {
        continue;
      }
    }

    if (dataNamesLower && !dataNamesLower.has(tableName.toLowerCase())) continue;

    const list = byGroup.get(group) ?? [];
    list.push({
      tableName,
      layerName,
      parentTableName,
      cqlFilter,
      tableIdx,
      minZoom: 8,
      maxZoom: 30,
    });
    byGroup.set(group, list);
  }

  return [...byGroup.entries()]
    .sort(([a], [b]) => {
      const da = groupSortKey(a) - groupSortKey(b);
      if (da !== 0) return da;
      return a.localeCompare(b, 'ko');
    })
    .map(([title, layers]) => ({
      id: title,
      title,
      layers: layers.sort(compareUndergroundLayers),
    }));
}

export const UNDERGROUND_FACILITY_LAYER_GROUPS: ThematicMapLayerGroup[] =
  buildUndergroundFacilityLayerGroups();

export const UNDERGROUND_FACILITY_LAYERS: ThematicMapLayerOption[] =
  UNDERGROUND_FACILITY_LAYER_GROUPS.flatMap((g) => g.layers);

/** 테이블별 div_query(CQL) — 묶음 GetMap 시 레이어 순과 맞춤 */
function buildBaseCqlByTable(
  layers: ThematicMapLayerOption[] = UNDERGROUND_FACILITY_LAYERS
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const opt of layers) {
    const t = String(opt.tableName ?? '').trim();
    const cql = String(opt.cqlFilter ?? '').trim();
    if (t && cql) out[t] = cql;
  }
  return out;
}

const UF_GEOM_TYPES: Record<string, LayerDbGeometryKind> =
  mergeDefineLayerShpTypesIntoGeometryMap({}, tables as unknown[]);

function mergeCqlParts(...parts: Array<string | null | undefined>): string {
  const clauses = parts
    .map((p) => String(p ?? '').trim())
    .filter((p) => p && p !== 'INCLUDE');
  if (clauses.length === 0) return 'INCLUDE';
  if (clauses.length === 1) return clauses[0]!;
  return clauses.map((c) => `(${c})`).join(' AND ');
}

export function findUndergroundFacilityServiceLayer(
  map: OlMap | null | undefined
): ImageLayer<ImageWMS> | null {
  if (!map) return null;
  for (const raw of map.getLayers().getArray()) {
    if (!raw.get('undergroundFacilityServiceLayer')) continue;
    return raw as ImageLayer<ImageWMS>;
  }
  return null;
}

function createUfImageWmsSource(
  params: Record<string, string | boolean | undefined>
): ImageWMS {
  const geoServerBase = getGeoServerBase();
  const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`;
  const next: Record<string, string | boolean> = {
    TRANSPARENT: true,
    EXCEPTIONS: 'application/vnd.ogc.se_xml',
  };
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    next[k] = v;
  }
  return new ImageWMS({
    url: wmsUrl,
    params: next,
    serverType: 'geoserver',
    ratio: 1.5,
    imageLoadFunction: geoserverWmsImageLoadFunction,
  });
}

/**
 * 지도 본용 — 데이터 조회(serviceLayer)와 동일하게 켜진 테이블을 한 GetMap에 묶는다.
 * (위상분석 등 전용 복제 레이어는 createUndergroundFacilityLayers 유지)
 */
export function createUndergroundFacilityServiceLayer(): ImageLayer<ImageWMS> {
  const layer = new ImageLayer({
    minZoom: 8,
    maxZoom: 30,
    visible: false,
    source: createUfImageWmsSource({
      LAYERS: '',
      STYLES: '',
    }),
  });
  layer.set('name', '지하시설물');
  layer.set('undergroundFacilityLayer', true);
  layer.set('undergroundFacilityServiceLayer', true);
  layer.set('layerCqlByTable', buildBaseCqlByTable());
  markLayerGeomStack(layer, 'LINE');
  return layer;
}

/**
 * 테이블당 ImageWMS — 위상분석 배경 등 개별 스타일/SLD가 필요할 때.
 * 지도 기본 지하시설물 표시는 createUndergroundFacilityServiceLayer 사용.
 */
export function createUndergroundFacilityLayers(
  layers: ThematicMapLayerOption[] = UNDERGROUND_FACILITY_LAYERS
): ImageLayer<ImageWMS>[] {
  const geoServerBase = getGeoServerBase();
  const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`;

  return layers.map(({ tableName, layerName, parentTableName, cqlFilter, minZoom, maxZoom }) => {
    const params: Record<string, string> = {
      LAYERS: `${WORKSPACE}:${tableName}`,
      STYLES: tableName,
    };
    if (cqlFilter) {
      params.CQL_FILTER = cqlFilter;
    }

    const layer = new ImageLayer({
      minZoom,
      maxZoom,
      visible: false,
      source: new ImageWMS({
        url: wmsUrl,
        params,
        serverType: 'geoserver',
        ratio: 1.5,
        imageLoadFunction: geoserverWmsImageLoadFunction,
      }),
    });
    layer.set('name', layerName);
    layer.set('undergroundFacilityLayer', true);
    layer.set('layerTableName', tableName);
    if (parentTableName) layer.set('layerParentTableName', parentTableName);
    if (cqlFilter) layer.set('layerCqlFilter', cqlFilter);
    return layer;
  });
}

/** LAYERS 교체 후 새 이미지가 올 때까지 숨김 — gen이 바뀌면 이전 리스너는 무시 */
function hideUfUntilImageReady(
  layer: ImageLayer<ImageWMS>,
  source: ImageWMS
): void {
  const gen = ((layer.get('ufWmsGen') as number | undefined) ?? 0) + 1;
  layer.set('ufWmsGen', gen);
  layer.setOpacity(0);
  const finish = () => {
    if (layer.get('ufWmsGen') !== gen) return;
    layer.setOpacity(1);
    source.un('imageloadend', finish);
    source.un('imageloaderror', finish);
    const t = layer.get('ufWmsRevealTimer') as ReturnType<typeof setTimeout> | undefined;
    if (t != null) {
      clearTimeout(t);
      layer.unset('ufWmsRevealTimer');
    }
  };
  source.on('imageloadend', finish);
  source.on('imageloaderror', finish);
  const prevTimer = layer.get('ufWmsRevealTimer') as
    | ReturnType<typeof setTimeout>
    | undefined;
  if (prevTimer != null) clearTimeout(prevTimer);
  // imageloadend 누락 시에도 영구 투명 방지
  layer.set(
    'ufWmsRevealTimer',
    setTimeout(finish, 12_000)
  );
}

/**
 * 지도 본 지하시설물 묶음 GetMap 파라미터 반영.
 * 체크 해제 = 소스 제거(이전 이미지 삭제). 새 LAYERS = 소스 교체 후 로드 완료 때만 표시.
 */
export function applyUndergroundFacilityServiceWms(
  map: OlMap | null | undefined,
  selectedNames: readonly string[],
  groupOn: boolean
): void {
  const layer = findUndergroundFacilityServiceLayer(map);
  if (!layer || !map) return;

  layer.set('ufSyncSelected', [...selectedNames]);
  layer.set('ufSyncGroupOn', groupOn);

  const hideRaw = layer.get('ufTempHideTables');
  const hide = new Set(
    (Array.isArray(hideRaw) ? hideRaw : [])
      .map((n) => String(n ?? '').trim())
      .filter(Boolean)
  );
  const names = sortLayerNamesForWmsStack(
    selectedNames.filter((n) => n && !hide.has(n)),
    UF_GEOM_TYPES
  );

  /** 체크 해제·그룹 끔 — 투명 유지가 아니라 소스까지 비워 완전히 지움 */
  if (!groupOn || names.length === 0) {
    const emptySig = 'off';
    if (layer.get('ufWmsSig') === emptySig && !layer.getVisible() && !layer.getSource()) {
      return;
    }
    layer.set('ufWmsSig', emptySig);
    layer.set('ufWmsGen', ((layer.get('ufWmsGen') as number | undefined) ?? 0) + 1);
    const prevTimer = layer.get('ufWmsRevealTimer') as
      | ReturnType<typeof setTimeout>
      | undefined;
    if (prevTimer != null) {
      clearTimeout(prevTimer);
      layer.unset('ufWmsRevealTimer');
    }
    layer.setVisible(false);
    layer.setOpacity(1);
    layer.setSource(null);
    map.render();
    return;
  }

  const baseCql =
    (layer.get('layerCqlByTable') as Record<string, string> | undefined) ?? {};
  const searchCql =
    (layer.get('layerSearchCqlByTable') as Record<string, string> | undefined) ??
    {};
  const layersParam = names.map((n) => `${WORKSPACE}:${n}`).join(',');
  const stylesParam = names.join(',');
  const cqlArr = names.map((n) =>
    mergeCqlParts(baseCql[n], searchCql[n] ?? searchCql[n.toLowerCase()])
  );
  const allInclude = cqlArr.every((c) => c === 'INCLUDE');
  const cqlParam = allInclude ? '' : cqlArr.join(';');
  const onSig = `on|${layersParam}|${stylesParam}|${cqlParam}`;
  // 동일 구성이면 재적용 생략(검색 CQL reapply가 opacity 복구·GetMap을 가로채지 않게)
  if (layer.get('ufWmsSig') === onSig && layer.getSource()) {
    return;
  }
  layer.set('ufWmsSig', onSig);

  const nextParams: Record<string, string | boolean | undefined> = {
    LAYERS: layersParam,
    STYLES: stylesParam,
    TRANSPARENT: 'true',
    EXCEPTIONS: 'application/vnd.ogc.se_xml',
    _dc: String(Date.now()),
  };
  if (!allInclude) nextParams.CQL_FILTER = cqlParam;

  const prevSource = layer.getSource();
  const prevLayers = prevSource
    ? String((prevSource.getParams() as Record<string, string | undefined>).LAYERS ?? '')
    : '';
  const layersChanged = prevLayers !== layersParam || !prevSource;

  // LAYERS가 바뀌거나 소스가 없으면 새 소스(이전 그림 삭제). 로드 전엔 opacity 0.
  if (layersChanged) {
    const newSource = createUfImageWmsSource(nextParams);
    layer.setSource(newSource);
    layer.setVisible(true);
    hideUfUntilImageReady(layer, newSource);
    map.render();
    return;
  }

  const source = layer.getSource();
  if (!source || typeof source.updateParams !== 'function') return;
  const cur = source.getParams() as Record<string, string | undefined>;
  if (allInclude) {
    source.updateParams({
      LAYERS: layersParam,
      STYLES: stylesParam,
      TRANSPARENT: 'true',
      EXCEPTIONS: 'application/vnd.ogc.se_xml',
      _dc: String(Date.now()),
    });
    delete cur.CQL_FILTER;
  } else {
    source.updateParams({
      LAYERS: layersParam,
      STYLES: stylesParam,
      CQL_FILTER: cqlParam,
      TRANSPARENT: 'true',
      EXCEPTIONS: 'application/vnd.ogc.se_xml',
      _dc: String(Date.now()),
    });
  }
  layer.setOpacity(1);
  layer.setVisible(true);
  source.changed();
}

/** 속성(ufTempHideTables·검색 CQL)만 바뀐 뒤 마지막 선택 상태로 다시 그림 */
export function reapplyUndergroundFacilityServiceWms(
  map: OlMap | null | undefined
): void {
  const layer = findUndergroundFacilityServiceLayer(map);
  if (!layer) return;
  const selected = layer.get('ufSyncSelected');
  const names = Array.isArray(selected)
    ? selected.map((n) => String(n ?? '').trim()).filter(Boolean)
    : [];
  const groupOn = layer.get('ufSyncGroupOn') === true;
  applyUndergroundFacilityServiceWms(map, names, groupOn);
}

/** DB 도형 변경 후 지하시설물 WMS 이미지를 바로 다시 받는다. */
export function refreshUndergroundFacilityWmsLayers(map: OlMap | null | undefined): void {
  if (!map) return;
  const stamp = String(Date.now());
  for (const raw of map.getLayers().getArray()) {
    if (!raw.get('undergroundFacilityLayer')) continue;
    const source = (raw as ImageLayer<ImageWMS>).getSource();
    if (!source || typeof source.updateParams !== 'function') continue;
    source.updateParams({ ...source.getParams(), _dc: stamp });
    source.changed();
    raw.changed();
  }
  map.render();
}

export function useUndergroundFacilityLayerSync(
  map: OlMap | null,
  mapReady: boolean,
  activeControls: string[],
  visibleTableNames?: Set<string> | null,
  availableTableNames?: Set<string> | null,
  suppressDrawTableNames?: ReadonlySet<string> | null
) {
  useEffect(() => {
    if (!mapReady || !map) return;
    const groupOn = activeControls.includes('underground-facility');
    const catalogReady = availableTableNames != null;
    const showAll = visibleTableNames == null;

    const serviceLayer = findUndergroundFacilityServiceLayer(map);
    if (serviceLayer) {
      const selected: string[] = [];
      if (groupOn && catalogReady && availableTableNames) {
        for (const name of availableTableNames) {
          if (suppressDrawTableNames?.has(name)) continue;
          if (!showAll && !(visibleTableNames?.has(name) ?? false)) continue;
          selected.push(name);
        }
      }
      applyUndergroundFacilityServiceWms(map, selected, groupOn);
      return;
    }

    // 레거시: 테이블당 ImageWMS (맵 분할 구버전 등)
    map.getLayers().getArray().forEach((l) => {
      if (!l.get('undergroundFacilityLayer')) return;
      if (l.get('undergroundFacilityServiceLayer')) return;
      const tableName = l.get('layerTableName') as string | undefined;
      if (tableName != null && suppressDrawTableNames?.has(tableName)) {
        l.setVisible(false);
        return;
      }
      const inCatalog =
        catalogReady && tableName != null && availableTableNames!.has(tableName);
      const selected =
        showAll || (tableName != null && (visibleTableNames?.has(tableName) ?? false));
      l.setVisible(groupOn && inCatalog && selected);
    });
  }, [
    map,
    mapReady,
    activeControls,
    visibleTableNames,
    availableTableNames,
    suppressDrawTableNames,
  ]);
}
