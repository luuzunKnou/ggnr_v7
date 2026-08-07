import { call } from "@/lib/api";
import GeoJSON from "ol/format/GeoJSON";
import WKT from "ol/format/WKT";
import type { Geometry } from "ol/geom";

export type JijukParcelHit = {
  address: string;
  pnu: string;
  jimok?: string;
  /** 당초면적(㎡) — 지적 필지 도형 면적 */
  areaSqm?: number;
  extent3857: [number, number, number, number] | null;
  geometry3857: Record<string, unknown> | null;
};

/** 편입 범위(EPSG:3857 GeoJSON) → 지적 교차 조회용 WKT(EPSG:5181) */
export function geometry3857ToWkt5181(geometry3857: Record<string, unknown>): string | null {
  try {
    const geom = new GeoJSON().readGeometry(geometry3857, {
      dataProjection: "EPSG:3857",
      featureProjection: "EPSG:3857",
    }) as Geometry | null;
    if (!geom) return null;
    const cloned = geom.clone();
    cloned.transform("EPSG:3857", "EPSG:5181");
    return new WKT().writeGeometry(cloned);
  } catch {
    return null;
  }
}

/** OL Geometry(EPSG:3857) → GeoJSON + extent */
export function olGeomToGeometry3857(geom: Geometry): {
  geometry3857: Record<string, unknown>;
  extent3857: [number, number, number, number] | null;
} | null {
  try {
    const geometry3857 = new GeoJSON().writeGeometryObject(geom, {
      dataProjection: "EPSG:3857",
      featureProjection: "EPSG:3857",
    }) as unknown as Record<string, unknown>;
    const extent = geom.getExtent();
    const extent3857 =
      extent.every((v) => Number.isFinite(v)) ? (extent as [number, number, number, number]) : null;
    return { geometry3857, extent3857 };
  } catch {
    return null;
  }
}

/** 편입 범위와 교차하는 지적 필지 목록 조회 */
export async function fetchJijukParcelsByGeometry3857(
  geometry3857: Record<string, unknown>
): Promise<{ parcels: JijukParcelHit[]; error?: string }> {
  const wkt5181 = geometry3857ToWkt5181(geometry3857);
  if (!wkt5181) return { parcels: [], error: "도형을 변환하지 못했습니다." };

  try {
    const res = await call("", "POST", {
      service: "layerRowService",
      action: "listJijukParcelsByGeomWkt5181",
      params: { wkt5181 },
    });
    const data = res?.data ?? res;
    if (data?.error) return { parcels: [], error: String(data.error) };
    if (!Array.isArray(data?.parcels)) return { parcels: [] };

    const parcels: JijukParcelHit[] = data.parcels
      .map((x: Record<string, unknown>) => {
        const address = String(x?.address ?? "").trim();
        const pnu = String(x?.pnu ?? "").trim();
        if (!address && !pnu) return null;
        const geometry3857 =
          x?.geometry3857 != null && typeof x.geometry3857 === "object"
            ? (x.geometry3857 as Record<string, unknown>)
            : null;
        const extRaw = x?.extent3857 as unknown;
        const extent3857 =
          Array.isArray(extRaw) && extRaw.length === 4 && extRaw.every((v) => Number.isFinite(Number(v)))
            ? (extRaw.map((v) => Number(v)) as [number, number, number, number])
            : null;
        const jimok = String(x?.jimok ?? "").trim();
        const areaSqmRaw = Number(x?.areaSqm);
        const areaSqm =
          Number.isFinite(areaSqmRaw) && areaSqmRaw > 0 ? areaSqmRaw : undefined;
        return {
          address: address || pnu,
          pnu,
          ...(jimok ? { jimok } : {}),
          ...(areaSqm != null ? { areaSqm } : {}),
          extent3857,
          geometry3857,
        };
      })
      .filter((x: JijukParcelHit | null): x is JijukParcelHit => x != null);

    return { parcels };
  } catch {
    return { parcels: [], error: "필지목록을 불러오지 못했습니다." };
  }
}
