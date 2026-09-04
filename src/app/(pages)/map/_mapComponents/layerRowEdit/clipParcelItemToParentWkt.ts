import { call } from "@/lib/api";
import type { LayerRowParcelItem } from "./types";

/** 필지 도형을 부모 도형(WKT 5181)과 겹치는 면만 잘라 반환. 겹침이 없으면 null */
export async function clipParcelItemToParentWkt(
  item: LayerRowParcelItem,
  parentWkt5181: string
): Promise<LayerRowParcelItem | null> {
  const wkt = String(parentWkt5181 ?? "").trim();
  const geom = item.geometry3857;
  if (!wkt || !geom || typeof geom !== "object") return null;
  try {
    const res = await call("", "POST", {
      service: "layerRowService",
      action: "clipGeoJson3857ToWkt5181",
      params: { geometry3857: geom, parentWkt5181: wkt },
    });
    const data = res?.data ?? res;
    const geometry3857 =
      data?.geometry3857 != null && typeof data.geometry3857 === "object"
        ? (data.geometry3857 as Record<string, unknown>)
        : null;
    if (!geometry3857) return null;
    const extRaw = data?.extent3857 as unknown;
    const extent3857 =
      Array.isArray(extRaw) && extRaw.length === 4 && extRaw.every((v) => Number.isFinite(Number(v)))
        ? (extRaw.map((v) => Number(v)) as [number, number, number, number])
        : item.extent3857;
    return { ...item, geometry3857, extent3857 };
  } catch {
    return null;
  }
}
