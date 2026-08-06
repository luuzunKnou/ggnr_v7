import WKT from "ol/format/WKT";
import GeoJSON from "ol/format/GeoJSON";
import type { Geometry } from "ol/geom";
import type { RiverConstructionLedgerRow } from "./riverConstructionLedgerMock";

function extentsOverlap(a: number[], b: number[]): boolean {
  return !(a[0]! > b[2]! || b[0]! > a[2]! || a[1]! > b[3]! || b[1]! > a[3]!);
}

function densifyRing(coords: number[][], step = 60): number[][] {
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

function polygonIntersectsFilter(filterGeom: Geometry, polyGeom: Geometry): boolean {
  if (!extentsOverlap(filterGeom.getExtent(), polyGeom.getExtent())) return false;

  const polyType = polyGeom.getType();
  const rings =
    polyType === "Polygon"
      ? (polyGeom as import("ol/geom/Polygon").default).getCoordinates()
      : polyType === "MultiPolygon"
        ? (polyGeom as import("ol/geom/MultiPolygon").default).getCoordinates().flat()
        : [];
  for (const ring of rings) {
    for (const c of densifyRing(ring)) {
      if (filterGeom.intersectsCoordinate(c)) return true;
    }
  }

  const filterType = filterGeom.getType();
  if (filterType === "Polygon" || filterType === "MultiPolygon") {
    const filterRings =
      filterType === "Polygon"
        ? (filterGeom as import("ol/geom/Polygon").default).getCoordinates()
        : (filterGeom as import("ol/geom/MultiPolygon").default).getCoordinates().flat();
    for (const ring of filterRings) {
      for (const c of densifyRing(ring)) {
        if (polyGeom.intersectsCoordinate(c)) return true;
      }
    }
  }

  return false;
}

export function riverConstructionLedgerRowIntersectsWkt5181(
  row: RiverConstructionLedgerRow,
  wkt5181: string
): boolean {
  if (!row.geom?.coordinates?.length || !wkt5181.trim()) return false;
  try {
    const filterGeom = new WKT().readGeometry(wkt5181, {
      dataProjection: "EPSG:5181",
      featureProjection: "EPSG:3857",
    });
    if (!filterGeom) return false;
    const polyGeom = new GeoJSON().readGeometry(
      {
        type: row.geom.type,
        coordinates: row.geom.coordinates,
      },
      {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
      }
    );
    if (!polyGeom) return false;
    return polygonIntersectsFilter(filterGeom, polyGeom);
  } catch {
    return false;
  }
}

export function filterRiverConstructionLedgerRowsByWkt5181(
  rows: RiverConstructionLedgerRow[],
  wkt5181: string | null
): RiverConstructionLedgerRow[] {
  if (!wkt5181?.trim()) return rows;
  return rows.filter((r) => riverConstructionLedgerRowIntersectsWkt5181(r, wkt5181));
}
