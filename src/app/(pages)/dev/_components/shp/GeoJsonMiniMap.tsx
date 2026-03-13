'use client';

import { useRef, useEffect } from 'react';
import { Map, View } from 'ol';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Style, Stroke, Fill, Circle as CircleStyle } from 'ol/style';
import { defaults } from 'ol/control';
import '@/app/(pages)/map/_mapComponents/config/projections';
import { createVWorldLayer } from '@/app/(pages)/map/_mapComponents/layerFactory/backgroundLayerFactory';
import { RESOLUTIONS_3857 } from '@/app/(pages)/map/_mapComponents/config/mapDefaults';
import { getTransform } from 'ol/proj';
import { Home } from 'lucide-react';
import 'ol/ol.css';

type GeoJsonGeometry = GeoJSON.Geometry | Record<string, unknown>;

type Props = {
  geometry: GeoJsonGeometry | null | undefined;
  /** 도형 좌표계 (예: EPSG:5181, EPSG:4326). 미지정 시 EPSG:4326 */
  dataProjection?: string;
  className?: string;
  /** 레이블 (예: "기존값 (DB)") */
  label?: string;
};

const DEFAULT_CENTER: [number, number] = getTransform('EPSG:4326', 'EPSG:3857')([128.7229, 36.5664]) as [number, number];
const DEFAULT_ZOOM = 10;

const VIEW_PROJECTION = 'EPSG:3857';

type InitialView = { center: [number, number]; zoom: number };

export function GeoJsonMiniMap({ geometry, dataProjection = 'EPSG:4326', className, label }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const vectorSourceRef = useRef<VectorSource | null>(null);
  const initialViewRef = useRef<InitialView>({ center: [DEFAULT_CENTER[0], DEFAULT_CENTER[1]], zoom: DEFAULT_ZOOM });

  useEffect(() => {
    if (!containerRef.current) return;

    const vectorSource = new VectorSource();
    vectorSourceRef.current = vectorSource;

    const baseLayer = createVWorldLayer('satellite');
    baseLayer.set('name', 'background');

    const vectorLayer = new VectorLayer({
      source: vectorSource,
      style: (feature) => {
        const geom = feature.getGeometry();
        if (!geom) return undefined;
        const type = geom.getType();
        if (type === 'Point' || type === 'MultiPoint') {
          return new Style({
            image: new CircleStyle({
              radius: 5,
              fill: new Fill({ color: 'rgba(59, 130, 246, 0.6)' }),
              stroke: new Stroke({ color: '#2563eb', width: 2 }),
            }),
          });
        }
        if (type === 'LineString' || type === 'MultiLineString') {
          return new Style({
            stroke: new Stroke({ color: '#2563eb', width: 3 }),
          });
        }
        return new Style({
          stroke: new Stroke({ color: '#2563eb', width: 2 }),
          fill: new Fill({ color: 'rgba(59, 130, 246, 0.2)' }),
        });
      },
    });

    const map = new Map({
      target: containerRef.current,
      layers: [baseLayer, vectorLayer],
      view: new View({
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        resolutions: RESOLUTIONS_3857,
        minZoom: 0,
        maxZoom: 20,
      }),
      controls: defaults({ zoom: false, attribution: false }),
    });
    mapRef.current = map;

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
      vectorSourceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const source = vectorSourceRef.current;
    const map = mapRef.current;
    if (!source || !map) return;

    source.clear();
    const view = map.getView();

    if (geometry && typeof geometry === 'object' && 'type' in geometry && 'coordinates' in geometry) {
      try {
        const geojson = {
          type: 'Feature' as const,
          geometry: geometry as GeoJSON.Geometry,
          properties: {},
        };
        const format = new GeoJSON();
        const features = format.readFeatures(
          { type: 'FeatureCollection', features: [geojson] },
          { dataProjection, featureProjection: VIEW_PROJECTION }
        );
        if (features.length > 0) {
          source.addFeatures(features);
          const ext = source.getExtent();
          if (ext.every((v) => isFinite(v))) {
            view.fit(ext, { padding: [12, 12, 12, 12], maxZoom: 18 });
          }
          const c = view.getCenter();
          const z = view.getZoom();
          if (c && z != null) initialViewRef.current = { center: [c[0], c[1]], zoom: z };
        } else {
          view.setCenter(DEFAULT_CENTER);
          view.setZoom(DEFAULT_ZOOM);
          initialViewRef.current = { center: [DEFAULT_CENTER[0], DEFAULT_CENTER[1]], zoom: DEFAULT_ZOOM };
        }
      } catch {
        view.setCenter(DEFAULT_CENTER);
        view.setZoom(DEFAULT_ZOOM);
        initialViewRef.current = { center: [DEFAULT_CENTER[0], DEFAULT_CENTER[1]], zoom: DEFAULT_ZOOM };
      }
    } else {
      view.setCenter(DEFAULT_CENTER);
      view.setZoom(DEFAULT_ZOOM);
      initialViewRef.current = { center: [DEFAULT_CENTER[0], DEFAULT_CENTER[1]], zoom: DEFAULT_ZOOM };
    }
  }, [geometry, dataProjection]);

  const goToInitialView = () => {
    const map = mapRef.current;
    if (!map) return;
    const view = map.getView();
    const { center, zoom } = initialViewRef.current;
    view.setCenter(center);
    view.setZoom(zoom);
  };

  return (
    <div className={className}>
      {label && (
        <h4 className="text-xs font-semibold text-muted-foreground mb-1.5">{label}</h4>
      )}
      <div className="relative w-full rounded border bg-muted/20" style={{ height: 180 }}>
        <div
          ref={containerRef}
          className="absolute inset-0 rounded"
        />
        <button
          type="button"
          onClick={goToInitialView}
          className="absolute bottom-1 right-1 rounded-[30px] bg-background/90 border border-border p-1.5 text-muted-foreground hover:text-foreground hover:bg-background"
          title="처음 보기로"
        >
          <Home className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
