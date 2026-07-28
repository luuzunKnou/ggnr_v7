import { useEffect, useState } from "react";
import type { Map } from "ol";

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
      const padding = (view as unknown as { padding?: number[] }).padding ?? [0, 0, 0, 0];
      const top = padding[0] ?? 0;
      const bottom = padding[2] ?? 0;
      // 상하 분할 등에서 padding을 0으로 둔 경우 그 값을 따름.
      // 아직 미적용(undefined)일 때만 layout mapPaddingLeft 사용.
      const leftRaw = padding[3];
      const left =
        leftRaw != null && Number.isFinite(Number(leftRaw))
          ? Number(leftRaw)
          : mapPaddingLeft;
      const x = (size[0] + left) / 2;
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
