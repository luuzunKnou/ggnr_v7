'use client';

import { useRef, useEffect, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import ImageLayer from 'ol/layer/Image';
import Static from 'ol/source/ImageStatic';
import { defaults } from 'ol/control';
import '@/app/(pages)/map/_mapComponents/config/projections';
import { createVWorldLayer } from '@/app/(pages)/map/_mapComponents/layerFactory/backgroundLayerFactory';
import { RESOLUTIONS_3857 } from '@/app/(pages)/map/_mapComponents/config/mapDefaults';
import 'ol/ol.css';
import { Loader2 } from 'lucide-react';

type Props = { groupName: string; epsg: number };

/**
 * VWorld 항공영상 + 가정 CRS로 워프한 샘플 TIF 미리보기(저해상도, EPSG:3857 ImageStatic)
 */
export function OrthophotoCrsPreviewMap({ groupName, epsg }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let map: Map | null = null;

    const run = async () => {
      setError(null);
      setLoading(true);
      try {
        const metaRes = await fetch(
          `/api/orthophoto/crs-preview/meta?groupName=${encodeURIComponent(groupName)}&epsg=${epsg}`
        );
        if (!metaRes.ok) {
          const j = (await metaRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(j?.error ?? '미리보기 정보를 불러오지 못했습니다.');
        }
        const meta = (await metaRes.json()) as { extent3857?: unknown };
        const ext = meta.extent3857;
        if (!Array.isArray(ext) || ext.length !== 4 || !ext.every((x) => typeof x === 'number' && Number.isFinite(x))) {
          throw new Error('extent3857 형식이 올바르지 않습니다.');
        }
        const extent3857 = ext as [number, number, number, number];
        if (cancelled || !containerRef.current) return;

        const base = createVWorldLayer('satellite');
        base.set('name', 'background');

        const imgUrl = `/api/orthophoto/crs-preview?groupName=${encodeURIComponent(groupName)}&epsg=${epsg}`;
        const overlay = new ImageLayer({
          opacity: 0.88,
          source: new Static({
            url: imgUrl,
            projection: 'EPSG:3857',
            imageExtent: extent3857,
          }),
        });

        map = new Map({
          target: containerRef.current,
          layers: [base, overlay],
          view: new View({
            resolutions: RESOLUTIONS_3857,
            minZoom: 0,
            maxZoom: 22,
          }),
          controls: defaults({ zoom: false, attribution: false }),
        });
        mapRef.current = map;
        map.getView().fit(extent3857, { padding: [14, 14, 14, 14], maxZoom: 19, duration: 200 });
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (map) {
        map.setTarget(undefined);
        mapRef.current = null;
      }
    };
  }, [groupName, epsg]);

  return (
    <div className="relative w-full rounded border border-border overflow-hidden bg-muted/20">
      <div ref={containerRef} className="w-full h-[200px]" />
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-[1]">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-destructive/10 p-2 z-[2]">
          <p className="text-[11px] text-destructive text-center">{error}</p>
        </div>
      )}
    </div>
  );
}
