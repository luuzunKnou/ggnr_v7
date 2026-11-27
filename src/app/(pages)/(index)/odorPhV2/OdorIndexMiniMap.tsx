'use client';

import { useEffect, useRef } from 'react';
import type {
  EmdGradeStatusMock,
  OdorGradePointMock,
  OdorGradeStatus,
} from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock';
import { getGeoServerBase } from '@/lib/geoserverUrl';
import { geoserverWmsImageLoadFunction } from '@/lib/geoserverWmsImageLoad';
import { withBasePathNav } from '@/lib/basePath';
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight';
import { cn } from '@/lib/utils';
import './odor-ol-minimal.css';

/** 타일/이미지 디코드 실패 시 OL EncodingError 방지 */
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const WORKSPACE = 'ggnr';
const SGG_CODE = '47110';
const VIEW_PROJECTION = 'EPSG:3857';
const CONTROL_MAP_HREF = '/map?system=odorAdmin';

const STATUS_FILL: Record<OdorGradeStatus, string> = {
  normal: 'rgba(34, 197, 94, 0.28)',
  caution: 'rgba(234, 179, 8, 0.32)',
  warning: 'rgba(239, 68, 68, 0.32)',
};

const STATUS_STROKE: Record<OdorGradeStatus, string> = {
  normal: 'rgba(22, 163, 74, 0.85)',
  caution: 'rgba(202, 138, 4, 0.9)',
  warning: 'rgba(220, 38, 38, 0.9)',
};

const POINT_FILL: Record<OdorGradeStatus, string> = {
  normal: '#22c55e',
  caution: '#eab308',
  warning: '#ef4444',
};

/** 카드별 지도 레이어 표시 여부 (독립 토글) */
export type OdorMapLayerVisibility = Record<OdorGradeStatus | 'abatement', boolean>;

export const DEFAULT_ODOR_MAP_LAYER_VISIBILITY: OdorMapLayerVisibility = {
  normal: true,
  caution: true,
  warning: true,
  abatement: true,
};

/** @deprecated 단일 필터 — layerVisibility 사용 */
export type OdorMapStatusFilter = OdorGradeStatus | 'abatement' | null;

function buildStatusLookup(emdStatuses: EmdGradeStatusMock[]) {
  const byCd = new Map<string, OdorGradeStatus>();
  const byNm = new Map<string, OdorGradeStatus>();
  for (const row of emdStatuses) {
    byCd.set(row.emdCd, row.status);
    byNm.set(row.emdNm, row.status);
  }
  return { byCd, byNm };
}

function resolveStatus(
  props: Record<string, unknown> | undefined,
  lookup: ReturnType<typeof buildStatusLookup>
): OdorGradeStatus {
  const emdCd = String(props?.emd_cd ?? props?.EMD_CD ?? '').trim();
  const emdNm = String(props?.emd_nm ?? props?.EMD_NM ?? '').trim();
  if (emdNm && lookup.byNm.has(emdNm)) return lookup.byNm.get(emdNm)!;
  if (emdCd && lookup.byCd.has(emdCd)) return lookup.byCd.get(emdCd)!;
  return 'normal';
}

function pointVisible(status: OdorGradeStatus, visibility: OdorMapLayerVisibility): boolean {
  return visibility[status] !== false;
}

type MapApi = {
  setPoints: (pts: OdorGradePointMock[]) => void;
  setEmdStatuses: (rows: EmdGradeStatusMock[]) => void;
  setHighlight: (sensorKey: string | null) => void;
  refresh: () => void;
};

type Props = {
  className?: string;
  points: OdorGradePointMock[];
  emdStatuses: EmdGradeStatusMock[];
  embedded?: boolean;
  /** 업체 칩 필터 — 표시만 바꾸고 줌(fit)은 변경하지 않음 */
  agencyFilter?: string;
  /** 카드별 보이기/숨기기 */
  layerVisibility?: OdorMapLayerVisibility;
  /** 기기 목록 선택 시 하이라이트 (sensorKey 문자열, 지도 이동 없음) */
  highlightSensorKey?: string | null;
  /** true면 이동·줌 허용 (관제 지도). 기본은 Index 미니맵처럼 고정 */
  interactive?: boolean;
  /** 「지도 관제 열기」 버튼 표시 (기본 true) */
  showOpenMapButton?: boolean;
  /** 버튼 클릭 — 없으면 /map?system=odorAdmin 으로 이동 */
  onOpenControlMap?: () => void;
  /** 포인트 클릭 (sensorKey) */
  onPointClick?: (sensorKey: string) => void;
  /** true면 4·5등급(경보) 포인트에 데이터조회와 동일 레이더 펄스 */
  pulseAlertPoints?: boolean;
  /** 초기 fit 최대 줌 (기본 15). 단일 지점 모달 등은 17~18 */
  fitMaxZoom?: number;
  /** 초기 fit 버퍼(m). 기본 200. 단일 지점은 작게 */
  fitBufferMeters?: number;
};

/**
 * OL은 useEffect 안에서만 dynamic import — Index 정적 그래프에 ol 미포함
 * 지도는 1회 생성. 토글칩으로 points가 바뀌어도 fit(줌)하지 않음.
 */
export function OdorIndexMiniMap({
  className,
  points,
  emdStatuses,
  embedded = false,
  agencyFilter = 'all',
  layerVisibility = DEFAULT_ODOR_MAP_LAYER_VISIBILITY,
  highlightSensorKey = null,
  interactive = false,
  showOpenMapButton = true,
  onOpenControlMap,
  onPointClick,
  pulseAlertPoints = false,
  fitMaxZoom = 15,
  fitBufferMeters = 200,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const visibilityRef = useRef(layerVisibility);
  visibilityRef.current = layerVisibility;
  const highlightRef = useRef(highlightSensorKey);
  highlightRef.current = highlightSensorKey;
  const agencyFilterRef = useRef(agencyFilter);
  agencyFilterRef.current = agencyFilter;
  const interactiveRef = useRef(interactive);
  const fitMaxZoomRef = useRef(fitMaxZoom);
  fitMaxZoomRef.current = fitMaxZoom;
  const fitBufferMetersRef = useRef(fitBufferMeters);
  fitBufferMetersRef.current = fitBufferMeters;
  interactiveRef.current = interactive;
  const onPointClickRef = useRef(onPointClick);
  onPointClickRef.current = onPointClick;
  const pulseAlertRef = useRef(pulseAlertPoints);
  pulseAlertRef.current = pulseAlertPoints;
  const mapApiRef = useRef<MapApi | null>(null);
  const didFitRef = useRef(false);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const emdStatusesRef = useRef(emdStatuses);
  emdStatusesRef.current = emdStatuses;

  useEffect(() => {
    mapApiRef.current?.refresh();
  }, [layerVisibility, agencyFilter, pulseAlertPoints]);

  useEffect(() => {
    mapApiRef.current?.setHighlight(highlightSensorKey);
  }, [highlightSensorKey]);

  /** 지도 1회 생성 */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    let map: { setTarget: (t: string | HTMLElement | undefined) => void } | null = null;

    (async () => {
      const [
        { Map: OlMap, View },
        { default: TileLayer },
        { default: ImageLayer },
        { default: VectorLayer },
        { default: XYZ },
        { default: ImageWMS },
        { default: VectorSource },
        { default: GeoJSON },
        { Style, Fill, Stroke, Circle: CircleStyle, Text },
        { defaults: defaultControls },
        { defaults: defaultInteractions },
        { fromLonLat },
        { default: Feature },
        { default: Point },
        { buffer: bufferExtent, isEmpty: isEmptyExtent },
      ] = await Promise.all([
        import('ol'),
        import('ol/layer/Tile'),
        import('ol/layer/Image'),
        import('ol/layer/Vector'),
        import('ol/source/XYZ'),
        import('ol/source/ImageWMS'),
        import('ol/source/Vector'),
        import('ol/format/GeoJSON'),
        import('ol/style'),
        import('ol/control'),
        import('ol/interaction'),
        import('ol/proj'),
        import('ol/Feature'),
        import('ol/geom/Point'),
        import('ol/extent'),
      ]);

      if (cancelled || !containerRef.current) return;

      const wmsUrl = `${getGeoServerBase()}/${WORKSPACE}/wms`;

      const baseLayer = new TileLayer({
        source: new XYZ({
          url: 'https://xdworld.vworld.kr/2d/Satellite/service/{z}/{x}/{y}.jpeg',
          crossOrigin: 'anonymous',
          maxZoom: 19,
          attributions: '© VWorld',
          tileLoadFunction: (tile, src) => {
            const image = (tile as unknown as { getImage: () => HTMLImageElement }).getImage();
            const fail = () => {
              image.src = TRANSPARENT_PIXEL;
            };
            if (!src) {
              fail();
              return;
            }
            fetch(src, { mode: 'cors' })
              .then(async (res) => {
                if (!res.ok) throw new Error(String(res.status));
                const buf = await res.arrayBuffer();
                const b = new Uint8Array(buf);
                const okJpeg = b[0] === 0xff && b[1] === 0xd8;
                const okPng =
                  b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
                if (!okJpeg && !okPng) throw new Error('not image');
                const blobUrl = URL.createObjectURL(
                  new Blob([buf], { type: okJpeg ? 'image/jpeg' : 'image/png' })
                );
                image.onload = () => URL.revokeObjectURL(blobUrl);
                image.onerror = () => {
                  URL.revokeObjectURL(blobUrl);
                  fail();
                };
                image.src = blobUrl;
              })
              .catch(() => fail());
          },
        }),
      });

      const emdWms = new ImageLayer({
        source: new ImageWMS({
          url: wmsUrl,
          params: {
            LAYERS: `${WORKSPACE}:emd`,
            STYLES: 'emd',
            CQL_FILTER: `emd_cd LIKE '${SGG_CODE}%'`,
            TILED: false,
          },
          serverType: 'geoserver',
          ratio: 1,
          imageLoadFunction: geoserverWmsImageLoadFunction,
        }),
        opacity: 1,
        zIndex: 4,
      });
      emdWms.set('name', 'emdBoundary');

      const statsSource = new VectorSource();
      const statsLayer = new VectorLayer({
        source: statsSource,
        style: (feature) => {
          const status = (feature.get('odorStatus') as OdorGradeStatus) || 'normal';
          if (!pointVisible(status, visibilityRef.current)) {
            return new Style({
              fill: new Fill({ color: 'rgba(148,163,184,0.06)' }),
              stroke: new Stroke({ color: 'rgba(148,163,184,0.28)', width: 1 }),
            });
          }
          return new Style({
            fill: new Fill({ color: STATUS_FILL[status] }),
            stroke: new Stroke({ color: STATUS_STROKE[status], width: 1 }),
          });
        },
        zIndex: 3,
      });
      statsLayer.set('name', 'emdGradeFill');

      const pointSource = new VectorSource();
      const pointLayer = new VectorLayer({
        source: pointSource,
        style: (feature) => {
          const status = (feature.get('odorStatus') as OdorGradeStatus) || 'normal';
          if (!pointVisible(status, visibilityRef.current)) return undefined;
          const agency = String(feature.get('agency') ?? '');
          const af = agencyFilterRef.current;
          if (af && af !== 'all' && agency !== af) return undefined;
          const korName = String(feature.get('label') ?? '').trim();
          return new Style({
            image: new CircleStyle({
              radius: 6,
              fill: new Fill({ color: POINT_FILL[status] }),
              stroke: new Stroke({ color: '#fff', width: 1.5 }),
            }),
            text: korName
              ? new Text({
                  text: korName,
                  font: '11px sans-serif',
                  offsetY: -14,
                  fill: new Fill({ color: '#fff' }),
                  stroke: new Stroke({ color: 'rgba(0,0,0,0.75)', width: 3 }),
                })
              : undefined,
          });
        },
        zIndex: 6,
      });
      pointLayer.set('name', 'odorGradePoints');

      /** 관망조회·데이터조회와 동일 — 선택 행 레이더 펄스 하이라이트 (포인트 아래) */
      let pulsePhase = 0;
      let pulseRaf = 0;
      const highlightSource = new VectorSource();
      const selectionStyle = createDataQuerySelectionRowHighlightStyle(() => pulsePhase);
      const highlightLayer = new VectorLayer({
        source: highlightSource,
        style: selectionStyle,
        zIndex: 5,
      });
      highlightLayer.set('name', 'odorDeviceSelectionHighlight');

      const stopPulse = () => {
        if (pulseRaf) {
          cancelAnimationFrame(pulseRaf);
          pulseRaf = 0;
        }
      };
      const startPulse = () => {
        if (pulseRaf) return;
        const loop = () => {
          pulsePhase += DATA_QUERY_SELECTION_PULSE_STEP;
          highlightSource.changed();
          pulseRaf = requestAnimationFrame(loop);
        };
        pulseRaf = requestAnimationFrame(loop);
      };

      const syncPulseHighlights = (sensorKey: string | null = highlightRef.current) => {
        highlightSource.clear();
        const vis = visibilityRef.current;
        const af = agencyFilterRef.current;

        if (pulseAlertRef.current) {
          for (const f of pointSource.getFeatures()) {
            const grade = Number(f.get('odorGrade') ?? 0);
            if (grade < 4) continue;
            const status = (f.get('odorStatus') as OdorGradeStatus) || 'warning';
            if (!pointVisible(status, vis)) continue;
            const agency = String(f.get('agency') ?? '');
            if (af && af !== 'all' && agency !== af) continue;
            const geom = f.getGeometry();
            if (!geom) continue;
            highlightSource.addFeature(
              new Feature({
                geometry: geom.clone(),
                isRadarPoint: true,
              })
            );
          }
        }

        if (sensorKey != null && sensorKey !== '') {
          const found = pointSource
            .getFeatures()
            .find((f) => String(f.get('sensorKey')) === sensorKey);
          const geom = found?.getGeometry();
          if (geom) {
            highlightSource.addFeature(
              new Feature({
                geometry: geom.clone(),
                isRadarPoint: true,
              })
            );
          }
        }

        if (highlightSource.getFeatures().length > 0) startPulse();
        else stopPulse();
      };

      const setHighlight = (sensorKey: string | null) => {
        syncPulseHighlights(sensorKey);
      };

      const refresh = () => {
        pointLayer.changed();
        statsLayer.changed();
        syncPulseHighlights(highlightRef.current);
      };

      const setPoints = (pts: OdorGradePointMock[]) => {
        pointSource.clear();
        for (const p of pts) {
          const sensorKey = p.id.startsWith('pt-') ? p.id.slice(3) : p.id;
          const f = new Feature({
            geometry: new Point(fromLonLat([p.lon, p.lat])),
            odorStatus: p.status,
            odorGrade: p.grade,
            label: p.label,
            emdNm: p.emdNm,
            agency: p.agency,
            sensorKey,
          });
          f.setId(p.id);
          pointSource.addFeature(f);
        }
        refresh();
      };

      const setEmdStatuses = (rows: EmdGradeStatusMock[]) => {
        const lookup = buildStatusLookup(rows);
        for (const f of statsSource.getFeatures()) {
          f.set('odorStatus', resolveStatus(f.getProperties() as Record<string, unknown>, lookup));
        }
        statsLayer.changed();
      };

      const fitSensors = () => {
        olMap.updateSize();
        const raw = pointSource.getExtent();
        if (isEmptyExtent(raw) || !raw.every((v) => Number.isFinite(v))) return;
        const padM = Math.max(20, fitBufferMetersRef.current);
        const ext = bufferExtent(raw, padM);
        olMap.getView().fit(ext, {
          padding: [28, 28, 28, 28],
          maxZoom: fitMaxZoomRef.current,
          nearest: true,
        });
      };

      const canInteract = interactiveRef.current;
      const olMap = new OlMap({
        target: containerRef.current,
        layers: [baseLayer, statsLayer, emdWms, highlightLayer, pointLayer],
        view: new View({
          center: fromLonLat([129.365, 36.019]),
          zoom: 11,
          minZoom: 8,
          maxZoom: 18,
        }),
        controls: defaultControls({
          zoom: canInteract,
          rotate: false,
          attribution: false,
        }),
        /** Index 미니맵은 고정, 관제 지도는 이동·줌 허용 */
        interactions: defaultInteractions({
          altShiftDragRotate: false,
          doubleClickZoom: canInteract,
          keyboard: false,
          mouseWheelZoom: canInteract,
          shiftDragZoom: canInteract,
          dragPan: canInteract,
          pinchRotate: false,
          pinchZoom: canInteract,
        }),
      });
      map = olMap;
      requestAnimationFrame(() => olMap.updateSize());

      olMap.on('singleclick', (evt) => {
        const cb = onPointClickRef.current;
        if (!cb) return;
        const hit = olMap.forEachFeatureAtPixel(
          evt.pixel,
          (feature, layer) => {
            if (layer !== pointLayer) return undefined;
            return String(feature.get('sensorKey') ?? '');
          },
          { hitTolerance: 8 }
        );
        if (hit) cb(hit);
      });

      try {
        const format = new GeoJSON();
        const qs = new URLSearchParams({
          service: 'WFS',
          version: '2.0.0',
          request: 'GetFeature',
          typeNames: `${WORKSPACE}:emd`,
          outputFormat: 'application/json',
          srsName: VIEW_PROJECTION,
          CQL_FILTER: `emd_cd LIKE '${SGG_CODE}%'`,
          count: '500',
        });
        const res = await fetch(`${getGeoServerBase()}/${WORKSPACE}/wfs?${qs.toString()}`);
        if (res.ok && !cancelled) {
          const json = (await res.json()) as { features?: unknown[] };
          if (Array.isArray(json.features)) {
            const features = format.readFeatures(
              { type: 'FeatureCollection', features: json.features },
              { dataProjection: VIEW_PROJECTION, featureProjection: VIEW_PROJECTION }
            );
            for (const f of features) {
              f.set('odorStatus', 'normal');
            }
            statsSource.addFeatures(features);
          }
        }
      } catch {
        /* ignore */
      }

      if (cancelled) {
        stopPulse();
        return;
      }

      mapApiRef.current = { setPoints, setEmdStatuses, setHighlight, refresh };
      setPoints(pointsRef.current);
      setEmdStatuses(emdStatusesRef.current);
      setHighlight(highlightRef.current);

      if (!didFitRef.current) {
        didFitRef.current = true;
        fitSensors();
        requestAnimationFrame(fitSensors);
        window.setTimeout(fitSensors, 120);
      }
    })();

    return () => {
      cancelled = true;
      mapApiRef.current?.setHighlight(null);
      mapApiRef.current = null;
      didFitRef.current = false;
      map?.setTarget(undefined);
      map = null;
    };
  }, []);

  /** 센서 목록 자체 변경 시에만 포인트 교체 (업체 칩은 agencyFilter로 표시만) — fit 없음 */
  useEffect(() => {
    mapApiRef.current?.setPoints(points);
  }, [points]);

  useEffect(() => {
    mapApiRef.current?.setEmdStatuses(emdStatuses);
  }, [emdStatuses]);

  const mapBox = (
    <div className={cn('relative min-h-0', embedded ? 'h-full w-full' : 'min-h-0 flex-1')}>
      <div
        ref={containerRef}
        className={cn(
          'absolute inset-0 overflow-hidden rounded border border-border bg-muted/20',
          className
        )}
      />
      {showOpenMapButton ? (
        <button
          type="button"
          title="지도 관제 열기"
          onClick={() => {
            if (onOpenControlMap) onOpenControlMap();
            else window.location.assign(withBasePathNav(CONTROL_MAP_HREF));
          }}
          className="pointer-events-auto absolute right-2 top-2 z-10 cursor-pointer rounded border border-white/50 bg-black/55 px-2.5 py-1.5 text-[12px] font-medium text-white opacity-85 shadow-sm transition-opacity hover:opacity-100"
        >
          지도 관제 열기
        </button>
      ) : null}
    </div>
  );

  if (embedded) {
    return mapBox;
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border border-border p-3">
      <h2 className="mb-1.5 shrink-0 text-sm font-semibold text-foreground">읍면동 등급 현황</h2>
      {mapBox}
    </section>
  );
}
