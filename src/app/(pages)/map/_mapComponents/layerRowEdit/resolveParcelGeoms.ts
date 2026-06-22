import { call } from "@/lib/api";
import type { LayerRowParcelItem } from "./types";

function parseResolvedRow(raw: Record<string, unknown> | undefined): Pick<
  LayerRowParcelItem,
  "extent3857" | "geometry3857"
> | null {
  if (!raw) return null;
  const extRaw = raw.extent3857 as unknown;
  const extent3857 =
    Array.isArray(extRaw) && extRaw.length === 4 && extRaw.every((v) => Number.isFinite(Number(v)))
      ? (extRaw.map((v) => Number(v)) as [number, number, number, number])
      : null;
  const geometry = raw.geometry3857;
  const geometry3857 =
    geometry != null && typeof geometry === "object" ? (geometry as Record<string, unknown>) : null;
  if (!geometry3857 && !extent3857) return null;
  return { extent3857, geometry3857 };
}

/** public_layer.jijuk geom 조회 후 병합 (항상 DB 기준) */
export async function resolveParcelGeoms(items: LayerRowParcelItem[]): Promise<LayerRowParcelItem[]> {
  if (items.length === 0) return [];

  const res = await call("", "POST", {
    service: "layerRowService",
    action: "resolveJijukParcelGeomsByAddresses",
    params: {
      items: items.map((i) => ({
        address: i.address,
        pnu: i.pnu,
        lon: i.point4326?.x,
        lat: i.point4326?.y,
      })),
    },
  });
  const data = res?.data ?? res;
  const resolvedList = Array.isArray(data?.parcels) ? data.parcels : [];

  return items.map((item, index) => {
    const parsed = parseResolvedRow(resolvedList[index] as Record<string, unknown> | undefined);
    const resolvedPnu = String((resolvedList[index] as Record<string, unknown> | undefined)?.pnu ?? "").trim();
    if (!parsed?.geometry3857) return item;
    return {
      ...item,
      pnu: resolvedPnu || item.pnu,
      extent3857: parsed.extent3857 ?? item.extent3857,
      geometry3857: parsed.geometry3857,
      showMapGeom: item.showMapGeom !== false ? true : false,
    };
  });
}
