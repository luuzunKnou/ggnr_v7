import WKT from "ol/format/WKT";
import GeoJSON from "ol/format/GeoJSON";
import type { Geometry } from "ol/geom";
import type { RoadNetworkRow } from "./roadNetworkMock";

function extentsOverlap(a: number[], b: number[]): boolean {
  return !(a[0]! > b[2]! || b[0]! > a[2]! || a[1]! > b[3]! || b[1]! > a[3]!);
}

/** LineString을 대략 등간격으로 보간해 도형 교차 판정에 사용 */
function densifyLineCoords(coords: number[][], step = 80): number[][] {
  if (coords.length < 2) return coords;
  const out: number[][] = [coords[0]!];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const dx = b[0]! - a[0]!;
    const dy = b[1]! - a[1]!;
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push([a[0]! + dx * t, a[1]! + dy * t]);
    }
  }
  return out;
}

function collectLineCoords(roadGeom: Geometry): number[][] {
  const type = roadGeom.getType();
  if (type === "LineString") {
    return (roadGeom as import("ol/geom/LineString").default).getCoordinates();
  }
  if (type === "MultiLineString") {
    const multi = roadGeom as import("ol/geom/MultiLineString").default;
    return multi.getCoordinates().flat();
  }
  const extent = roadGeom.getExtent();
  if (!extent) return [];
  return [
    [extent[0]!, extent[1]!],
    [extent[2]!, extent[3]!],
  ];
}

function lineIntersectsPolygon(filterGeom: Geometry, roadGeom: Geometry): boolean {
  if (!extentsOverlap(filterGeom.getExtent(), roadGeom.getExtent())) return false;

  const flat = collectLineCoords(roadGeom);
  const samples = densifyLineCoords(flat);
  for (const c of samples) {
    if (filterGeom.intersectsCoordinate(c)) return true;
  }
  return false;
}

/** 5181 WKT 검색 도형과 도로 선(WGS84) 교차 여부 */
export function roadNetworkRowIntersectsWkt5181(
  row: RoadNetworkRow,
  wkt5181: string
): boolean {
  if (!row.geom || !wkt5181.trim()) return false;
  try {
    const filterGeom = new WKT().readGeometry(wkt5181, {
      dataProjection: "EPSG:5181",
      featureProjection: "EPSG:3857",
    });
    if (!filterGeom) return false;
    const roadGeom = new GeoJSON().readGeometry(row.geom, {
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857",
    });
    if (!roadGeom) return false;
    return lineIntersectsPolygon(filterGeom, roadGeom);
  } catch {
    return false;
  }
}

export function filterRoadNetworkRowsByWkt5181(
  rows: RoadNetworkRow[],
  wkt5181: string | null
): RoadNetworkRow[] {
  if (!wkt5181?.trim()) return rows;
  return rows.filter((r) => roadNetworkRowIntersectsWkt5181(r, wkt5181));
}
