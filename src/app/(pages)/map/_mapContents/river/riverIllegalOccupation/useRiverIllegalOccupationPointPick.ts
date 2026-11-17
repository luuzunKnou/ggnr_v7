"use client";

import { useEffect, useRef } from "react";
import Draw from "ol/interaction/Draw";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import type Point from "ol/geom/Point";
import { toLonLat } from "ol/proj";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { canStartMapDrawInteraction } from "../../../_mapComponents/mapDrawInteraction";

/**
 * 위치 «점 찍기» — 지도를 한 번 누르면 그 경위도를 onPick 으로 넘긴다 (보상편입용지 그리기와 같은 방식).
 * 다른 지도 그리기와는 배타. 끝나면 상위에서 active 를 끈다.
 */
export function useRiverIllegalOccupationPointPick(
  active: boolean,
  onPick: (lon: number, lat: number) => void,
  onBlocked: () => void
) {
  const mapContext = useMapContext();
  const onPickRef = useRef(onPick);
  const onBlockedRef = useRef(onBlocked);
  useEffect(() => {
    onPickRef.current = onPick;
    onBlockedRef.current = onBlocked;
  }, [onPick, onBlocked]);

  useEffect(() => {
    if (!active) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!map || !canStartMapDrawInteraction(mapContext, "spatialSearch")) {
      onBlockedRef.current();
      return;
    }
    mapContext?.clearMapDrawInteractionsRef?.current?.();

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: 9999,
      style: new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: "#dc2626" }),
          stroke: new Stroke({ color: "#fff", width: 2 }),
        }),
      }),
    });
    const draw = new Draw({ source, type: "Point", stopClick: true });
    map.addLayer(layer);
    map.addInteraction(draw);

    const onEnd = (evt: { feature: { getGeometry: () => Point | undefined } }) => {
      const coord = evt.feature.getGeometry()?.getCoordinates();
      if (!coord) return;
      const [lon, lat] = toLonLat(coord);
      if (Number.isFinite(lon) && Number.isFinite(lat)) onPickRef.current(lon!, lat!);
    };
    draw.on("drawend", onEnd as never);

    return () => {
      draw.un("drawend", onEnd as never);
      map.removeInteraction(draw);
      map.removeLayer(layer);
      source.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 켜고 끌 때만 시작·종료
  }, [active, mapContext?.mapInstanceRef]);
}
