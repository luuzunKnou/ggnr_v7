import { call } from "@/lib/api";
import GeoJSON from "ol/format/GeoJSON";
import WKT from "ol/format/WKT";
import GeometryCollection from "ol/geom/GeometryCollection";
import MultiPolygon from "ol/geom/MultiPolygon";
import Polygon from "ol/geom/Polygon";
import type { Geometry } from "ol/geom";
import "../../../_mapComponents/config/projections";

export type JijukParcelHit = {
  address: string;
  pnu: string;
  jimok?: string;
  /** 당초면적(㎡) — 지적 필지 전체 도형 면적 */
  areaSqm?: number;
  /** 편입면적(㎡) — 그린 범위와 겹친 면적 */
  intersectAreaSqm?: number;
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

function collectPolygonCoords(geom: Geometry): number[][][][] {
  const type = geom.getType();
  if (type === "Polygon") return [(geom as Polygon).getCoordinates()];
  if (type === "MultiPolygon") return (geom as MultiPolygon).getCoordinates();
  if (type === "GeometryCollection") {
    const out: number[][][][] = [];
    for (const child of (geom as GeometryCollection).getGeometries()) {
      out.push(...collectPolygonCoords(child));
    }
    return out;
  }
  return [];
}

/** 편입 범위 두 건을 하나의 다각형(또는 다중 다각형)으로 합침 */
export function unionGeometry3857(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): { geometry3857: Record<string, unknown>; extent3857: [number, number, number, number] | null } | null {
  try {
    const format = new GeoJSON();
    const g1 = format.readGeometry(a, {
      dataProjection: "EPSG:3857",
      featureProjection: "EPSG:3857",
    }) as Geometry | null;
    const g2 = format.readGeometry(b, {
      dataProjection: "EPSG:3857",
      featureProjection: "EPSG:3857",
    }) as Geometry | null;
    if (!g1 || !g2) return null;
    const coords = [...collectPolygonCoords(g1), ...collectPolygonCoords(g2)];
    if (coords.length === 0) return null;
    const geom = coords.length === 1 ? new Polygon(coords[0]!) : new MultiPolygon(coords);
    return olGeomToGeometry3857(geom);
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
      params: { wkt5181, clipToSearchGeom: true },
    });
    const data = res?.data ?? res;
    if (res && typeof res === "object" && "success" in res && res.success === false) {
      return { parcels: [], error: String((res as { error?: unknown }).error ?? "필지목록을 불러오지 못했습니다.") };
    }
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
        const intersectRaw = Number(x?.intersectAreaSqm);
        const intersectAreaSqm =
          Number.isFinite(intersectRaw) && intersectRaw > 0 ? intersectRaw : undefined;
        return {
          address: address || pnu,
          pnu,
          ...(jimok ? { jimok } : {}),
          ...(areaSqm != null ? { areaSqm } : {}),
          ...(intersectAreaSqm != null ? { intersectAreaSqm } : {}),
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
