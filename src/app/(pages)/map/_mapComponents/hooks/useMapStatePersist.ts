import { useEffect, useRef } from 'react';
import { Map } from 'ol';
import { isUsageDataAsWmsLayerId } from '../../_mapContents/river/usageDataAs/usageDataAsLayerId';

const STORAGE_KEY = 'ggnr_map_state';
const SAVE_DEBOUNCE_MS = 300;

function getStorageKey(projectName?: string): string {
  const name = String(projectName ?? '').trim();
  return name ? `${STORAGE_KEY}:${name}` : STORAGE_KEY;
}

export interface PersistedMapState {
  zoom: number;
  centerX: number;
  centerY: number;
  backgroundMap: string;
  activeControls: string[];
  /** 데이터 조회 레이어 목록에서 켜 둔 레이어 테이블명 목록 */
  visibleLayerNames: string[];
  /** 지목/소유구분/지적도/건물도로/주제도 상세 패널 체크박스 선택 (테이블명 배열) */
  visibleJimokLayerNames?: string[];
  visibleLandownLayerNames?: string[];
  visibleCadastralLayerNames?: string[];
  visibleBuildingRoadLayerNames?: string[];
  visibleThematicLayerNames?: string[];
}

export function loadPersistedMapState(projectName?: string): PersistedMapState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(getStorageKey(projectName));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.zoom === 'number' &&
      typeof parsed.centerX === 'number' &&
      typeof parsed.centerY === 'number' &&
      typeof parsed.backgroundMap === 'string' &&
      Array.isArray(parsed.activeControls)
    ) {
      return {
        ...parsed,
        visibleLayerNames: Array.isArray(parsed.visibleLayerNames) ? parsed.visibleLayerNames : [],
        visibleJimokLayerNames: Array.isArray(parsed.visibleJimokLayerNames)
          ? parsed.visibleJimokLayerNames
          : Array.isArray(parsed.visibleJomokLayerNames)
            ? parsed.visibleJomokLayerNames
            : undefined,
        visibleLandownLayerNames: Array.isArray(parsed.visibleLandownLayerNames)
          ? parsed.visibleLandownLayerNames
          : undefined,
        visibleCadastralLayerNames: Array.isArray(parsed.visibleCadastralLayerNames)
          ? parsed.visibleCadastralLayerNames
          : undefined,
        visibleBuildingRoadLayerNames: Array.isArray(parsed.visibleBuildingRoadLayerNames)
          ? parsed.visibleBuildingRoadLayerNames
          : undefined,
        visibleThematicLayerNames: Array.isArray(parsed.visibleThematicLayerNames)
          ? parsed.visibleThematicLayerNames
          : undefined,
      } as PersistedMapState;
    }
  } catch { /* ignore corrupted data */ }
  return null;
}

function saveMapState(state: PersistedMapState, projectName?: string) {
  try {
    localStorage.setItem(getStorageKey(projectName), JSON.stringify(state));
  } catch { /* storage full or unavailable */ }
}

/** 3D 배경 선택 등 — 기존 ggnr_map_state 유지한 채 backgroundMap 만 갱신 */
export function patchPersistedBackgroundMap(backgroundMap: string, projectName?: string): void {
  const prev = loadPersistedMapState(projectName);
  if (!prev) return;
  saveMapState({ ...prev, backgroundMap }, projectName);
}

/** 지목/소유구분/지적도/건물도로/주제도 체크박스 상태 (null이면 저장 시 빈 배열로 저장하지 않음) */
export type PersistedLayerPanelSelections = {
  visibleJimokLayerNames: string[] | null;
  visibleLandownLayerNames: string[] | null;
  visibleCadastralLayerNames: string[] | null;
  visibleBuildingRoadLayerNames: string[] | null;
  visibleThematicLayerNames: string[] | null;
};

/**
 * 맵 뷰 변경(zoom, center) 시 자동 저장.
 * backgroundMap / activeControls / visibleLayerNames / 네 가지 상세 패널 선택은 값이 바뀔 때마다 저장.
 */
export function useMapStatePersist(
  map: Map | null,
  mapReady: boolean,
  backgroundMap: string,
  activeControls: string[],
  visibleLayerNames: Set<string>,
  layerPanelSelections: PersistedLayerPanelSelections,
  projectName?: string,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({
    backgroundMap,
    activeControls,
    visibleLayerNames,
    layerPanelSelections,
  });
  latestRef.current = {
    backgroundMap,
    activeControls,
    visibleLayerNames,
    layerPanelSelections,
  };

  useEffect(() => {
    if (!mapReady || !map) return;
    const view = map.getView();

    const persist = () => {
      const zoom = view.getZoom();
      const center = view.getCenter();
      if (zoom == null || !center) return;
      const sel = latestRef.current.layerPanelSelections;
      saveMapState({
        zoom,
        centerX: center[0],
        centerY: center[1],
        backgroundMap: latestRef.current.backgroundMap,
        activeControls: latestRef.current.activeControls,
        // 하천점용 패널 전용 레이어는 저장하지 않음 (시스템 재진입 시 잔상·클릭 무반응 방지)
        visibleLayerNames: Array.from(latestRef.current.visibleLayerNames).filter(
          (n) => !isUsageDataAsWmsLayerId(n)
        ),
        ...(sel.visibleJimokLayerNames && { visibleJimokLayerNames: sel.visibleJimokLayerNames }),
        ...(sel.visibleLandownLayerNames && {
          visibleLandownLayerNames: sel.visibleLandownLayerNames,
        }),
        ...(sel.visibleCadastralLayerNames && {
          visibleCadastralLayerNames: sel.visibleCadastralLayerNames,
        }),
        ...(sel.visibleBuildingRoadLayerNames && {
          visibleBuildingRoadLayerNames: sel.visibleBuildingRoadLayerNames,
        }),
        ...(sel.visibleThematicLayerNames && {
          visibleThematicLayerNames: sel.visibleThematicLayerNames,
        }),
      }, projectName);
    };

    const debouncedPersist = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(persist, SAVE_DEBOUNCE_MS);
    };

    view.on('change', debouncedPersist);
    persist();

    return () => {
      view.un('change', debouncedPersist);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [map, mapReady, projectName]);

  useEffect(() => {
    if (!mapReady || !map) return;
    const view = map.getView();
    const zoom = view.getZoom();
    const center = view.getCenter();
    if (zoom == null || !center) return;
    const sel = layerPanelSelections;
    saveMapState({
      zoom,
      centerX: center[0],
      centerY: center[1],
      backgroundMap,
      activeControls,
      visibleLayerNames: Array.from(visibleLayerNames),
      ...(sel.visibleJimokLayerNames && { visibleJimokLayerNames: sel.visibleJimokLayerNames }),
      ...(sel.visibleLandownLayerNames && {
        visibleLandownLayerNames: sel.visibleLandownLayerNames,
      }),
      ...(sel.visibleCadastralLayerNames && {
        visibleCadastralLayerNames: sel.visibleCadastralLayerNames,
      }),
      ...(sel.visibleBuildingRoadLayerNames && {
        visibleBuildingRoadLayerNames: sel.visibleBuildingRoadLayerNames,
      }),
      ...(sel.visibleThematicLayerNames && {
        visibleThematicLayerNames: sel.visibleThematicLayerNames,
      }),
    }, projectName);
  }, [
    backgroundMap,
    activeControls,
    visibleLayerNames,
    layerPanelSelections,
    map,
    mapReady,
    projectName,
  ]);
}
