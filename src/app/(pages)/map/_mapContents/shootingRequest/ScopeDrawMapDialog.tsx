'use client';

import { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import { Map, View } from 'ol';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Draw, { createBox } from 'ol/interaction/Draw';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import type Polygon from 'ol/geom/Polygon';
import { getTransform } from 'ol/proj';
import { defaults as defaultControls } from 'ol/control';
import { Square, Pentagon, Trash2 } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { cn } from '@/lib/utils';
import '../../_mapComponents/config/projections';
import { createVWorldLayer } from '../../_mapComponents/layerFactory/backgroundLayerFactory';
import { transformCoordinate } from '../../_mapComponents/services/coordinateService';
import {
  DEFAULT_CENTER_LON,
  DEFAULT_CENTER_LAT,
  DEFAULT_ZOOM_2D,
  RESOLUTIONS_3857,
} from '../../_mapComponents/config/mapDefaults';

type DrawTool = 'rect' | 'polygon';

export type ScopeDrawResult = {
  tool: DrawTool;
  scopeLabel: string;
  /** EPSG:5181 폴리곤 외곽 링 */
  ring5181: [number, number][];
  /** EPSG:5181 POLYGON WKT */
  wkt5181: string;
  /** 중심 (WGS84 lon,lat) — 신청 후 지도 이동 참고용 */
  centerWgs84: [number, number] | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (result: ScopeDrawResult) => void;
};

const SCOPE_STYLE = new Style({
  stroke: new Stroke({ color: '#0284c7', width: 2 }),
  fill: new Fill({ color: 'rgba(2,132,199,0.15)' }),
});

/** 촬영 범위 그리기 전용 새 지도 팝업 */
export function ScopeDrawMapDialog({ open, onOpenChange, onConfirm }: Props) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const drawRef = useRef<Draw | null>(null);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<DrawTool>('rect');
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    if (!open) return;

    let map: Map | null = null;
    let ro: ResizeObserver | null = null;
    let rafInit = 0;
    let rafSize = 0;
    let t1 = 0;
    let t2 = 0;

    // 팝업 애니메이션이 끝나 컨테이너에 실제 크기가 생긴 뒤 지도를 만든다.
    // (열리는 즉시 만들면 폭·높이가 0이라 지도가 비어 보임)
    const tryInit = () => {
      const el = mapDivRef.current;
      if (!el || mapRef.current) return;
      if (el.clientWidth === 0 || el.clientHeight === 0) {
        rafInit = window.requestAnimationFrame(tryInit);
        return;
      }

      const to3857 = getTransform('EPSG:4326', 'EPSG:3857');
      const center = to3857([DEFAULT_CENTER_LON, DEFAULT_CENTER_LAT]);

      const source = new VectorSource();
      sourceRef.current = source;

      map = new Map({
        target: el,
        layers: [
          createVWorldLayer('base'),
          new VectorLayer({ source, style: SCOPE_STYLE }),
        ],
        view: new View({
          center,
          zoom: DEFAULT_ZOOM_2D,
          resolutions: RESOLUTIONS_3857,
          minZoom: 0,
          maxZoom: RESOLUTIONS_3857.length - 1,
          constrainResolution: true,
        }),
        controls: defaultControls({ attribution: false, zoom: true }),
      });
      mapRef.current = map;
      setReady(true);
      setHasDrawn(false);

      rafSize = window.requestAnimationFrame(() => map?.updateSize());
      t1 = window.setTimeout(() => map?.updateSize(), 150);
      t2 = window.setTimeout(() => map?.updateSize(), 400);
      ro = new ResizeObserver(() => map?.updateSize());
      ro.observe(el);
    };

    rafInit = window.requestAnimationFrame(tryInit);

    return () => {
      window.cancelAnimationFrame(rafInit);
      window.cancelAnimationFrame(rafSize);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      ro?.disconnect();
      map?.setTarget(undefined);
      mapRef.current = null;
      sourceRef.current = null;
      drawRef.current = null;
      setReady(false);
      setHasDrawn(false);
    };
  }, [open]);

  // 도구 전환 시 Draw 인터랙션 교체
  useEffect(() => {
    const map = mapRef.current;
    const source = sourceRef.current;
    if (!ready || !map || !source) return;

    if (drawRef.current) {
      map.removeInteraction(drawRef.current);
      drawRef.current = null;
    }

    const draw =
      tool === 'rect'
        ? new Draw({ source, type: 'Circle', geometryFunction: createBox() })
        : new Draw({ source, type: 'Polygon' });

    draw.on('drawstart', () => source.clear());
    draw.on('drawend', () => setHasDrawn(true));
    map.addInteraction(draw);
    drawRef.current = draw;

    return () => {
      map.removeInteraction(draw);
    };
  }, [tool, ready]);

  const handleClear = () => {
    sourceRef.current?.clear();
    setHasDrawn(false);
  };

  const handleConfirm = () => {
    const source = sourceRef.current;
    const feature = source?.getFeatures()[0];
    const geom = feature?.getGeometry() as Polygon | undefined;
    if (!geom) {
      window.alert('먼저 촬영 범위를 그려 주세요.');
      return;
    }

    const ring3857 = geom.getCoordinates()[0] as [number, number][];
    const ring5181: [number, number][] = [];
    for (const pt of ring3857) {
      const c = transformCoordinate(pt, 'EPSG:3857', 'EPSG:5181');
      if (c) ring5181.push([Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100]);
    }
    if (ring5181.length < 4) {
      window.alert('범위 좌표를 변환하지 못했습니다. 다시 그려 주세요.');
      return;
    }

    const wkt5181 = `POLYGON((${ring5181.map(([x, y]) => `${x} ${y}`).join(', ')}))`;

    const [minX, minY, maxX, maxY] = geom.getExtent();
    const centerWgs84 = transformCoordinate(
      [(minX + maxX) / 2, (minY + maxY) / 2],
      'EPSG:3857',
      'EPSG:4326'
    );

    const vertexCount = ring5181.length - 1;
    const scopeLabel =
      tool === 'rect' ? '사각형 범위 지정됨' : `다각형 범위 지정됨 (${vertexCount}점)`;

    onConfirm({ tool, scopeLabel, ring5181, wkt5181, centerWgs84 });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(96vh,1080px)] w-[min(100vw-1rem,96rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogHeader className="shrink-0 space-y-0 border-b border-slate-200 px-4 py-2.5 text-left">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-[13px] font-semibold text-slate-800">
              촬영 범위 그리기
            </DialogTitle>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTool('rect')}
                className={cn(
                  'inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-[11px]',
                  tool === 'rect'
                    ? 'border-sky-300 bg-sky-50 text-sky-800'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                )}
              >
                <Square className="h-3 w-3" />
                사각형
              </button>
              <button
                type="button"
                onClick={() => setTool('polygon')}
                className={cn(
                  'inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-[11px]',
                  tool === 'polygon'
                    ? 'border-sky-300 bg-sky-50 text-sky-800'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                )}
              >
                <Pentagon className="h-3 w-3" />
                다각형
              </button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 gap-1 px-2 text-[11px] text-slate-500"
                onClick={handleClear}
                disabled={!hasDrawn}
              >
                <Trash2 className="h-3.5 w-3.5" />
                지우기
              </Button>
            </div>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">
            {tool === 'rect'
              ? '지도에서 드래그해 사각형을 그립니다.'
              : '지도를 클릭해 꼭짓점을 찍고 더블클릭으로 다각형을 완성합니다.'}
          </p>
        </DialogHeader>

        <div className="relative min-h-0 flex-1">
          <div ref={mapDivRef} className="absolute inset-0" />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-slate-200 bg-white px-4 py-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-3 text-[11px]"
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 bg-sky-600 px-4 text-[11px] hover:bg-sky-700"
            onClick={handleConfirm}
            disabled={!hasDrawn}
          >
            확인
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
