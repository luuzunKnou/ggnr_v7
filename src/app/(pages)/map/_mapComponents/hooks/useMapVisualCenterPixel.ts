import { useEffect, useState } from "react";
import type { Map } from "ol";

/** view.padding(좌측 패널) 반영 "시각적 중심" 픽셀 좌표 (크로스헤어·안내 문구 등) */
export function useMapVisualCenterPixel(
  map: Map | null,
  mapReady: boolean,
  mapPaddingLeft: number
) {
  const [centerPixel, setCenterPixel] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!mapReady || !map) return;
    const view = map.getView();
    const update = () => {
      const size = map.getSize();
      if (!size) return;
      const padding = (view as unknown as { padding?: number[] }).padding ?? [0, 0, 0, 0];
      const [top, , bottom] = padding;
      // layout의 mapPaddingLeft를 기준으로 계산 — view.padding 반영 전에도 패널 폭 반영
      const x = (size[0] + mapPaddingLeft) / 2;
      const y = (size[1] - bottom + top) / 2;
      setCenterPixel({ x, y });
    };
    update();
    map.on("change:size", update);
    map.on("postrender", update);
    view.on("change", update);
    return () => {
      map.un("change:size", update);
      map.un("postrender", update);
      view.un("change", update);
    };
  }, [map, mapReady, mapPaddingLeft]);

  return centerPixel;
}
