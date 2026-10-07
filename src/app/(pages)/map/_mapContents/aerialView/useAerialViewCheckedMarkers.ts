'use client';

import '@/app/(pages)/map/_mapComponents/config/projections';
import { useEffect, useMemo, useRef, useState } from 'react';
import Feature, { type FeatureLike } from 'ol/Feature';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { getTransform } from 'ol/proj';
import Overlay from 'ol/Overlay';
import { Fill, Stroke, Style, Circle as CircleStyle, RegularShape } from 'ol/style';
import { boundingExtent } from 'ol/extent';
import type OlMap from 'ol/Map';
import { useMapContext } from '../../_mapComponents/MapContext';
import { aerialShotMeta, type AerialKind, type WorkFileItem, type WorkUnitItem } from './aerialMediaTypes';
import { mockUnitsForKind, subscribeMockWorkUnits } from './aerialMediaMockData';
import { collectFileLocations5181 } from './aerialLocationParse';

const LAYER_ID = 'aerial-view-checked-units';

type OpenDroneFileOnMap = (unitId: string, fileId: string) => void;
let openDroneFileOnMap: OpenDroneFileOnMap | null = null;

/** 작업단위 상세에서 고른 사진·동영상을 지도의 사진,동영상 레이어 카드로 연다. */
export function openAerialDroneFileOnMap(unitId: string, fileId: string): void {
  openDroneFileOnMap?.(unitId, fileId);
}
const to3857 = getTransform('EPSG:5181', 'EPSG:3857');

const ALL_KINDS: AerialKind[] = ['ortho', 'drone', 'panorama', 'satellite'];

const MARKER_FILL: Record<string, string> = {
  drone: 'rgba(14, 165, 233, 0.95)',
  panorama: 'rgba(234, 88, 12, 0.95)',
};

const KIND_LABEL: Record<string, string> = {
  drone: '사진,동영상',
  panorama: '항공뷰',
};

const markerStyleCache = new globalThis.Map<string, Style>();

function markerStyle(feature: FeatureLike) {
  const kind = String(feature.get('kind') ?? 'drone');
  const cached = markerStyleCache.get(kind);
  if (cached) return cached;
  const fill = new Fill({ color: MARKER_FILL[kind] ?? MARKER_FILL.drone });
  const stroke = new Stroke({ color: '#fff', width: 2 });
  const style = new Style({
    image:
      kind === 'panorama'
        ? new RegularShape({ points: 4, radius: 8, angle: Math.PI / 4, fill, stroke })
        : new CircleStyle({ radius: 7, fill, stroke }),
  });
  markerStyleCache.set(kind, style);
  return style;
}

/** 사진,동영상 체크 시 그 작업의 파일 위치가 모두 지도에 들어오게 맞춘다. */
export function fitDroneUnitFiles(map: OlMap, unitId: string) {
  const unit = mockUnitsForKind('drone').find((row) => row.id === unitId);
  if (!unit) return;
  const coords = collectFileLocations5181(unit.files)
    .map((loc) => to3857(loc.coord, undefined, undefined) as [number, number])
    .filter((xy) => Number.isFinite(xy[0]) && Number.isFinite(xy[1]));
  if (coords.length === 0) return;
  if (coords.length === 1) {
    map.getView().animate({ center: coords[0], duration: 350 });
    return;
  }
  map.getView().fit(boundingExtent(coords), {
    padding: [80, 80, 80, 80],
    maxZoom: 17,
    duration: 350,
  });
}

function allStoreUnits(): WorkUnitItem[] {
  return ALL_KINDS.flatMap((k) => mockUnitsForKind(k));
}

/**
 * 영상조회 패널에서 체크한 작업단위의 촬영 위치를 지도에 표시.
 * 사진,동영상 점을 누르면 목록 없이 그 자리 위에 미리보기를 연다.
 */
export type AerialCheckedPhotoPopup = {
  file: WorkFileItem;
  files: WorkFileItem[];
  workName: string;
  workDate: string;
  shotDate: string;
  photographer: string;
  onClose: () => void;
};

export type AerialCheckedPanoPopup = {
  file: WorkFileItem;
  files: WorkFileItem[];
  workName: string;
  shotDate: string;
  photographer: string;
  onClose: () => void;
  onSelect: (fileId: string) => void;
  onPickPoint: (unitId: string, fileId: string) => void;
};

export type AerialCheckedMarkerPopups = {
  photos: AerialCheckedPhotoPopup[];
  pano: AerialCheckedPanoPopup | null;
  /** 사진,동영상 체크 시 그 작업의 파일이 있는 위치를 모두 연다 */
  showDroneUnitFiles: (unitId: string) => void;
};

export function useAerialViewCheckedMarkers(params: {
  enabled: boolean;
  checkedUnitIds: Set<string>;
  /** 목록이 열려 있으면 체크 전 위치도 보여주고, 클릭으로 켠다 */
  showAll?: boolean;
  /** 체크한 작업만 그릴 때 화면을 맞출지. 오른쪽 목록은 체크 쪽에서 따로 맞춘다 */
  fitView?: boolean;
  onActivate?: (unitId: string, kind?: AerialKind) => void;
  /** 사진 미리보기를 닫으면 같은 작업의 체크를 푼다 */
  onDeactivate?: (unitId: string) => void;
}): AerialCheckedMarkerPopups {
  const { enabled, checkedUnitIds, showAll = false, fitView = true, onActivate, onDeactivate } = params;
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;
  const onDeactivateRef = useRef(onDeactivate);
  onDeactivateRef.current = onDeactivate;
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const lastKeyRef = useRef<string>('');
  const [listTick, setListTick] = useState(0);
  const [photoPopups, setPhotoPopups] = useState<{ unitId: string; fileId: string }[]>([]);
  const [panoPopup, setPanoPopup] = useState<{ unitId: string; fileId: string } | null>(null);

  useEffect(() => subscribeMockWorkUnits(() => setListTick((t) => t + 1)), []);

  useEffect(() => {
    openDroneFileOnMap = (unitId, fileId) => {
      onActivateRef.current?.(unitId, 'drone');
      setPanoPopup(null);
      setPhotoPopups((prev) =>
        prev.some((row) => row.unitId === unitId && row.fileId === fileId)
          ? prev
          : [...prev, { unitId, fileId }]
      );
    };
    return () => {
      openDroneFileOnMap = null;
    };
  }, []);

  const markerKey = useMemo(
    () =>
      showAll
        ? `all|${listTick}`
        : `${Array.from(checkedUnitIds).sort().join(',')}|${listTick}`,
    [showAll, checkedUnitIds, listTick]
  );

  useEffect(() => {
    if (!enabled) {
      const m = mapContext?.mapInstanceRef?.current;
      const layer = layerRef.current;
      if (m && layer) m.removeLayer(layer);
      layerRef.current = null;
      sourceRef.current = null;
      lastKeyRef.current = '';
      return;
    }
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;

    if (!sourceRef.current) {
      const source = new VectorSource();
      const layer = new VectorLayer({
        source,
        properties: { id: LAYER_ID, geomStackSkip: true },
        zIndex: 9500,
        style: markerStyle,
      });
      map.addLayer(layer);
      sourceRef.current = source;
      layerRef.current = layer;
    }

    const onClick = (evt: MapBrowserEvent) => {
      if (!layerRef.current) return;
      const hits = map.getFeaturesAtPixel(evt.pixel, {
        layerFilter: (candidate) => candidate === layerRef.current,
        hitTolerance: 8,
      }) as Feature[];
      const picked = hits.find((feat) => feat.get('unitId') && feat.get('fileId'));
      if (!picked) return;
      const kind = picked.get('kind');
      if (kind !== 'drone' && kind !== 'panorama') return;
      evt.stopPropagation();
      const hit = {
        unitId: String(picked.get('unitId')),
        fileId: String(picked.get('fileId')),
      };
      onActivateRef.current?.(hit.unitId, kind);
      if (kind === 'drone') {
        setPanoPopup(null);
        setPhotoPopups((prev) =>
          prev.some((row) => row.unitId === hit.unitId && row.fileId === hit.fileId) ? prev : [...prev, hit]
        );
        return;
      }
      setPhotoPopups([]);
      setPanoPopup(hit);
    };
    const tip = document.createElement('div');
    tip.className =
      'pointer-events-none rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white shadow';
    const tipOverlay = new Overlay({
      element: tip,
      offset: [12, -10],
      positioning: 'bottom-left',
      stopEvent: false,
    });
    map.addOverlay(tipOverlay);

    const onMove = (evt: MapBrowserEvent) => {
      if (!layerRef.current) return;
      const hits = map.getFeaturesAtPixel(evt.pixel, {
        layerFilter: (candidate) => candidate === layerRef.current,
        hitTolerance: 8,
      }) as Feature[];
      const picked = hits.find((feat) => feat.get('kind'));
      const el = map.getTargetElement();
      if (el) el.style.cursor = picked ? 'pointer' : '';
      if (!picked) {
        tipOverlay.setPosition(undefined);
        return;
      }
      tip.textContent = KIND_LABEL[String(picked.get('kind'))] ?? '';
      tipOverlay.setPosition(tip.textContent ? evt.coordinate : undefined);
    };
    map.on('singleclick', onClick as never);
    map.on('pointermove', onMove as never);

    return () => {
      map.un('singleclick', onClick as never);
      map.un('pointermove', onMove as never);
      map.removeOverlay(tipOverlay);
      const m = mapContext?.mapInstanceRef?.current;
      const layer = layerRef.current;
      if (m && layer) m.removeLayer(layer);
      layerRef.current = null;
      sourceRef.current = null;
      lastKeyRef.current = '';
      const el = map.getTargetElement();
      if (el) el.style.cursor = '';
    };
  }, [enabled, mapContext?.mapInstanceRef]);

  useEffect(() => {
    if (!enabled) return;
    const source = sourceRef.current;
    const map = mapContext?.mapInstanceRef?.current;
    if (!source || !map) return;
    if (markerKey === lastKeyRef.current) return;
    lastKeyRef.current = markerKey;

    source.clear();
    const units = allStoreUnits().filter((u) =>
      showAll ? u.kind === 'drone' || u.kind === 'panorama' : checkedUnitIds.has(u.id)
    );
    const coords3857: number[][] = [];

    for (const unit of units) {
      if (unit.kind === 'satellite' || unit.kind === 'ortho') continue;
      const locs = collectFileLocations5181(unit.files);
      for (const loc of locs) {
        const [x, y] = to3857(loc.coord, undefined, undefined);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        coords3857.push([x, y]);
        source.addFeature(
          new Feature({
            geometry: new Point([x, y]),
            unitId: unit.id,
            fileId: loc.fileId,
            kind: unit.kind,
          })
        );
      }
    }

    if (showAll || !fitView || coords3857.length === 0) return;
    if (coords3857.length === 1) {
      map.getView().animate({ center: coords3857[0], duration: 350 });
      return;
    }
    const extent = boundingExtent(coords3857);
    map.getView().fit(extent, { padding: [80, 80, 80, 80], maxZoom: 17, duration: 350 });
  }, [enabled, markerKey, showAll, fitView, checkedUnitIds, mapContext?.mapInstanceRef]);

  useEffect(() => {
    setPhotoPopups((prev) => prev.filter((row) => checkedUnitIds.has(row.unitId)));
    setPanoPopup((prev) => (prev && checkedUnitIds.has(prev.unitId) ? prev : null));
  }, [checkedUnitIds]);

  const showDroneUnitFiles = (unitId: string) => {
    const unit = mockUnitsForKind('drone').find((row) => row.id === unitId);
    if (!unit) return;
    const fileIds = [
      ...new Set(collectFileLocations5181(unit.files).map((loc) => loc.fileId)),
    ];
    setPhotoPopups((prev) => [
      ...prev.filter((row) => row.unitId !== unitId),
      ...fileIds.map((fileId) => ({ unitId, fileId })),
    ]);
  };

  const photos: AerialCheckedPhotoPopup[] = photoPopups.flatMap((item) => {
    if (!checkedUnitIds.has(item.unitId)) return [];
    const unit = mockUnitsForKind('drone').find((row) => row.id === item.unitId);
    const file = unit?.files.find((row) => row.id === item.fileId);
    if (!unit || !file) return [];
    return [
      {
        file,
        files: unit.files,
        workDate: unit.workDate,
        ...aerialShotMeta(unit),
        onClose: () => {
          setPhotoPopups((prev) => {
            const next = prev.filter((row) => !(row.unitId === item.unitId && row.fileId === item.fileId));
            if (!next.some((row) => row.unitId === item.unitId)) onDeactivateRef.current?.(item.unitId);
            return next;
          });
        },
      },
    ];
  });

  const panoUnit = panoPopup
    ? mockUnitsForKind('panorama').find((unit) => unit.id === panoPopup.unitId) ?? null
    : null;
  const panoFile = panoUnit?.files.find((file) => file.id === panoPopup?.fileId) ?? null;
  const pano =
    panoPopup && checkedUnitIds.has(panoPopup.unitId) && panoUnit && panoFile
      ? {
          file: panoFile,
          files: panoUnit.files,
          ...aerialShotMeta(panoUnit),
          onClose: () => {
            setPanoPopup(null);
            onDeactivateRef.current?.(panoPopup.unitId);
          },
          onSelect: (fileId: string) => setPanoPopup({ unitId: panoUnit.id, fileId }),
          onPickPoint: (unitId: string, fileId: string) => {
            onActivateRef.current?.(unitId);
            setPanoPopup({ unitId, fileId });
          },
        }
      : null;

  return { photos, pano, showDroneUnitFiles };
}
