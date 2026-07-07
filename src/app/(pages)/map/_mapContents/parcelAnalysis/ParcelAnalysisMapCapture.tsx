'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import dynamic from 'next/dynamic';
import Feature from 'ol/Feature';
import type { ImageWrapper } from 'ol/Image';
import WKT from 'ol/format/WKT';
import { Map, View } from 'ol';
import ImageLayer from 'ol/layer/Image';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import { ImageWMS, XYZ } from 'ol/source';
import VectorSource from 'ol/source/Vector';
import { Stroke, Style } from 'ol/style';
import {
  resolveBasicMapLayersForCapture,
} from '@/app/(pages)/map/_mapContents/parcelAnalysis/parcelAnalysisBasicMapConfig';
import { loadMapCaptureImage } from '@/app/(pages)/map/_mapContents/parcelAnalysis/parcelAnalysisMapCaptureImage';

type MapCaptureProps = {
  wkt5181: string;
  layerIds: string[];
  geoserverUrl: string;
  workspace: string;
};

const VWORLD_SATELLITE = 'https://xdworld.vworld.kr/2d/Satellite/service/{z}/{x}/{y}.jpeg';
const VWORLD_BASE = 'https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png';
/** 숨김 OL 지도 캡처 해상도 */
const CAPTURE_SIZE: [number, number] = [900, 400];
/** 분석 영역 외곽선이 잘리지 않도록 최소 여백(px) */
const CAPTURE_FIT_PADDING: [number, number, number, number] = [20, 20, 20, 20];

function createVworldTileSource(url: string): XYZ {
  return new XYZ({
    url,
    crossOrigin: 'anonymous',
    tileLoadFunction: (tile, src) => {
      const img = tile.getImage() as HTMLImageElement;
      void loadMapCaptureImage(img, src);
    },
  });
}

function resolveGeoServerBase(configUrl: string): string {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8080/geoserver`;
  }
  return configUrl.replace(/\/$/, '') || 'http://localhost:8080/geoserver';
}

function useMapCaptureWhenVisible(rootRef: RefObject<HTMLDivElement | null>) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || visible) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { rootMargin: '120px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootRef, visible]);

  return visible;
}

function ParcelAnalysisMapCaptureInner({
  wkt5181,
  layerIds,
  geoserverUrl,
  workspace,
}: MapCaptureProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wmsNotice, setWmsNotice] = useState<string | null>(null);
  const visible = useMapCaptureWhenVisible(rootRef);

  const layerDefs = resolveBasicMapLayersForCapture(layerIds);
  const wmsDefs = layerDefs.filter((d) => d.wmsLayer);
  const showSatellite = layerDefs.some((d) => d.showSatellite);
  const layerKey = layerIds.join('|');

  useEffect(() => {
    if (!visible) return;

    const defs = resolveBasicMapLayersForCapture(layerIds);
    const wmsLayerDefs = defs.filter((d) => d.wmsLayer);
    const useSatellite = defs.some((d) => d.showSatellite);
    if (!defs.length || !wkt5181.trim()) return;

    setWmsNotice(null);

    const mapContainer = document.createElement('div');
    mapContainer.style.width = `${CAPTURE_SIZE[0]}px`;
    mapContainer.style.height = `${CAPTURE_SIZE[1]}px`;
    mapContainer.style.position = 'absolute';
    mapContainer.style.visibility = 'hidden';
    mapContainer.style.pointerEvents = 'none';
    mapContainer.setAttribute('data-parcel-map-capture', 'true');
    document.body.appendChild(mapContainer);

    let map: Map | null = null;
    let cancelled = false;
    const failedWms = new Set<string>();

    try {
      const geom = new WKT().readGeometry(wkt5181);
      const extent = geom.getExtent();
      const view = new View({ projection: 'EPSG:5181' });
      view.fit(extent, {
        size: CAPTURE_SIZE,
        padding: CAPTURE_FIT_PADDING,
        maxZoom: 19,
      });

      const layers = [];

      layers.push(
        new TileLayer({
          source: createVworldTileSource(useSatellite ? VWORLD_SATELLITE : VWORLD_BASE),
        })
      );

      const wmsBase = `${resolveGeoServerBase(geoserverUrl)}/${workspace}/wms`;
      const notifyWmsFail = (layerKey: string) => {
        if (cancelled) return;
        failedWms.add(layerKey);
        setWmsNotice(
          `GeoServer 레이어(${[...failedWms].join(', ')})를 불러오지 못했습니다. GeoServer 기동·${workspace} 워크스페이스 publish를 확인하세요.`
        );
      };

      for (const def of wmsLayerDefs) {
        const wmsKey = def.wmsLayer!;
        let wmsLoaded = false;
        const wmsLayer = new ImageLayer({
          source: new ImageWMS({
            url: wmsBase,
            params: {
              LAYERS: `${workspace}:${wmsKey}`,
              STYLES: wmsKey,
              VERSION: '1.1.1',
              EXCEPTIONS: 'application/vnd.ogc.se_inimage',
            },
            serverType: 'geoserver',
            ratio: 1,
            imageLoadFunction: (image: ImageWrapper, src: string) => {
              const img = image.getImage() as HTMLImageElement;
              void loadMapCaptureImage(img, src, () => notifyWmsFail(wmsKey));
            },
          }),
        });
        const wmsSource = wmsLayer.getSource();
        wmsSource?.on('imageloadend', () => {
          wmsLoaded = true;
        });
        wmsSource?.on('imageloaderror', () => notifyWmsFail(wmsKey));
        layers.push(wmsLayer);

        window.setTimeout(() => {
          if (!cancelled && !wmsLoaded) notifyWmsFail(wmsKey);
        }, 6000);
      }

      const feature = new Feature({ geometry: geom });
      feature.setStyle(
        new Style({
          stroke: new Stroke({ color: 'rgba(255, 220, 0, 1)', width: 3 }),
        })
      );

      layers.push(
        new VectorLayer({
          source: new VectorSource({ features: [feature] }),
        })
      );

      map = new Map({
        target: mapContainer,
        layers,
        view,
      });

      const finishCapture = () => {
        if (cancelled) return;
        const target = map;
        if (!target) return;
        const mapCanvas = target.getViewport().querySelector('canvas');
        const canvas = canvasRef.current;
        if (!mapCanvas || !canvas) return;
        const context = canvas.getContext('2d');
        if (!context) return;
        canvas.width = mapCanvas.width;
        canvas.height = mapCanvas.height;
        try {
          context.drawImage(mapCanvas, 0, 0);
        } catch {
          setWmsNotice('지도 이미지를 표시하지 못했습니다. GeoServer·배경지도 연결을 확인하세요.');
        }

        document.body.removeChild(mapContainer);
        target.setTarget(undefined);
        map = null;
      };

      map.once('rendercomplete', finishCapture);
      window.setTimeout(() => {
        if (!cancelled && map) finishCapture();
      }, 8000);
    } catch {
      if (mapContainer.parentNode) document.body.removeChild(mapContainer);
      setWmsNotice('분석 영역 지도 캡처에 실패했습니다.');
    }

    return () => {
      cancelled = true;
      if (map) map.setTarget(undefined);
      if (mapContainer.parentNode) document.body.removeChild(mapContainer);
    };
  }, [visible, wkt5181, layerKey, geoserverUrl, workspace]);

  return (
    <div ref={rootRef}>
      <canvas
        ref={canvasRef}
        className="my-2 max-w-full rounded border border-slate-200 bg-slate-50"
        style={{ width: '100%', height: 'auto', minHeight: visible ? undefined : 160 }}
      />
      {!visible ? (
        <p className="mb-2 text-[11px] text-slate-400">지도 캡처 준비 중…</p>
      ) : null}
      {wmsNotice ? <p className="mb-2 text-[11px] text-amber-700">{wmsNotice}</p> : null}
    </div>
  );
}

export const ParcelAnalysisMapCapture = dynamic(
  () => Promise.resolve({ default: ParcelAnalysisMapCaptureInner }),
  { ssr: false }
);
