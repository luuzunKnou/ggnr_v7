import { useEffect, useState } from "react";
import type { Map } from "ol";
import { getMapVisualCenterPixel } from "../config/mapVisualCenter";

/** view.padding 반영 "시각적 중심" 픽셀 좌표 (크로스헤어·안내 문구 등) */
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
      const padding = (view as unknown as { padding?: number[] }).padding;
      // padding 미적용 시에만 layout mapPaddingLeft로 보정
      if (padding == null && mapPaddingLeft > 0) {
        const size = map.getSize();
        if (!size) return;
        setCenterPixel({
          x: (size[0] + mapPaddingLeft) / 2,
          y: size[1] / 2,
        });
        return;
      }
      const pixel = getMapVisualCenterPixel(map);
      if (pixel) setCenterPixel({ x: pixel[0], y: pixel[1] });
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
