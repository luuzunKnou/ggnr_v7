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
      const size = map.getSize();
      if (!size) return;
      const padding = (view as unknown as { padding?: number[] }).padding;
      // padding 미적용 시 layout mapPaddingLeft로 보정, 적용 시엔 유틸 사용
      if (padding == null) {
        const x = (size[0] + mapPaddingLeft) / 2;
        const y = size[1] / 2;
        setCenterPixel((prev) => {
          if (prev && prev.x === x && prev.y === y) return prev;
          return { x, y };
        });
        return;
      }
      const pixel = getMapVisualCenterPixel(map);
      if (!pixel) return;
      const x = pixel[0];
      const y = pixel[1];
      setCenterPixel((prev) => {
        if (prev && prev.x === x && prev.y === y) return prev;
        return { x, y };
      });
    };
    update();
    // postrender는 매 프레임 setState를 유발해 Maximum update depth를 만들 수 있음
    // size는 Map 이벤트만 존재 (View에는 change:size 없음)
    map.on("change:size", update);
    view.on("change:resolution", update);
    view.on("change:center", update);
    window.addEventListener("resize", update);
    return () => {
      map.un("change:size", update);
      view.un("change:resolution", update);
      view.un("change:center", update);
      window.removeEventListener("resize", update);
    };
  }, [map, mapReady, mapPaddingLeft]);

  return centerPixel;
}
