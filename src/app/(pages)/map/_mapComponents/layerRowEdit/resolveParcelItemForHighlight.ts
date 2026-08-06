import { call } from "@/lib/api";
import { resolveParcelGeoms } from "./resolveParcelGeoms";
import type { LayerRowParcelItem } from "./types";

/** 목록 클릭 시 지도 하이라이트용 geometry 확보 */
export async function resolveParcelItemForHighlight(
  item: LayerRowParcelItem,
  wmsLayerId?: string
): Promise<LayerRowParcelItem> {
  if (item.geometry3857) return item;

  const wmsKey = item.wmsRowKey;
  const layerTable = String(wmsLayerId ?? "").trim();
  if (wmsKey?.keyField && wmsKey?.keyValue && layerTable) {
    try {
      const res = await call("", "POST", {
        service: "layerRowService",
        action: "getTableRowGeomGeoJson3857",
        params: {
          table: layerTable,
          schema: "layer",
          keyField: wmsKey.keyField,
          keyValue: wmsKey.keyValue,
        },
      });
      const data = res?.data ?? res;
      const geometry = data?.geometry;
      if (geometry != null && typeof geometry === "object") {
        return {
          ...item,
          geometry3857: geometry as Record<string, unknown>,
        };
      }
    } catch {
      // jijuk/ extent 폴백
    }
  }

  const [resolved] = await resolveParcelGeoms([item]);
  return resolved ?? item;
}
