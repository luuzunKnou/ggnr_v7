"use client";

import { useEffect } from "react";
import type BaseLayer from "ol/layer/Base";
import type ImageTile from "ol/ImageTile";
import type TileLayer from "ol/layer/Tile";
import type XYZ from "ol/source/XYZ";
import { createLocalOrthoTileLayer } from "../../../../_mapComponents/layerFactory/backgroundLayerFactory";
import { useMapContext } from "../../../../_mapComponents/MapContext";

const RIVER_ORTHO_LAYER_NAME = "riverOrtho";
/** JPEG 타일의 nodata(검정) 판정 상한. 압축 잡음 때문에 0보다 약간 크게 둔다 */
const NODATA_BLACK_MAX = 12;
const TILE_STATE_ERROR = 3;
/** JPEG 타일은 알파가 없어 영상 밖이 검게 채워지므로 검정 픽셀을 투명 처리해 배경이 보이게 한다 */
function loadTileBlackAsTransparent(tile: ImageTile, src: string): void {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !canvas.width || !canvas.height) {
      tile.setState(TILE_STATE_ERROR);
      return;
    }
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] <= NODATA_BLACK_MAX && px[i + 1] <= NODATA_BLACK_MAX && px[i + 2] <= NODATA_BLACK_MAX) {
        px[i + 3] = 0;
      }
    }
    ctx.putImageData(data, 0, 0);
    tile.setImage(canvas);
  };
  img.onerror = () => tile.setState(TILE_STATE_ERROR);
  img.src = src;
}

/** 하천 드론영상 타일을 배경지도 바로 위(데이터 레이어 최하단)에 깐다. 빈 배열이면 모두 제거 */
export function useRiverOrthoLayers(groupIds: string[]): void {
  const mapContext = useMapContext();
  const map = mapContext?.mapInstanceRef.current ?? null;
  const mapReady = mapContext?.mapReady ?? false;
  const key = groupIds.join(",");

  useEffect(() => {
    if (!mapReady || !map) return;
    const ids = key ? key.split(",") : [];
    const added: BaseLayer[] = [];
    for (const id of ids) {
      const layer = createLocalOrthoTileLayer(id, "") as TileLayer<XYZ>;
      layer.getSource()?.setTileLoadFunction((tile, src) => loadTileBlackAsTransparent(tile as ImageTile, src));
      layer.set("name", RIVER_ORTHO_LAYER_NAME);
      layer.set("riverOrthoGroup", id);
      const layers = map.getLayers();
      const bgIndex = layers.getArray().findIndex((l) => l.get("name") === "background");
      layers.insertAt(bgIndex + 1, layer);
      added.push(layer);
    }
    return () => {
      for (const layer of added) map.removeLayer(layer);
    };
  }, [map, mapReady, key]);
}
