import type { Type } from 'ol/geom/Geometry';
import Feature from 'ol/Feature';
import WKT from 'ol/format/WKT';
import { MultiLineString, MultiPoint, MultiPolygon, LineString, Point, Polygon } from 'ol/geom';

/** define_table_shp_type → OpenLayers Draw type */
export function shpTypeToDrawType(shpType: string): Type {
  const t = String(shpType ?? '').toUpperCase();
  if (t.includes('POINT')) return 'Point';
  if (t.includes('LINE')) return 'LineString';
  return 'Polygon';
}

export function shpTypeLabel(shpType: string): string {
  const t = String(shpType ?? '').toUpperCase();
  if (t.includes('POINT')) return '점';
  if (t.includes('LINE')) return '선';
  return '면';
}

function mergeGeometries3857(features: Feature[]) {
  const geoms = features
    .map((f) => f.getGeometry()?.clone())
    .filter((g): g is NonNullable<typeof g> => g != null);
  if (geoms.length === 0) return null;
  if (geoms.length === 1) return geoms[0]!;

  const type = geoms[0]!.getType();
  if (type === 'Point') {
    return new MultiPoint(geoms.map((g) => (g as Point).getCoordinates()));
  }
  if (type === 'LineString') {
    return new MultiLineString(geoms.map((g) => (g as LineString).getCoordinates()));
  }
  if (type === 'Polygon') {
    return new MultiPolygon(geoms.map((g) => (g as Polygon).getCoordinates()));
  }
  return geoms[0]!;
}

/** EPSG:5181 WKT → 편집 VectorSource용 Feature (EPSG:3857) */
export function wkt5181ToFeature(wkt5181: string): Feature | null {
  const raw = String(wkt5181 ?? '').trim();
  if (!raw) return null;
  try {
    const geom = new WKT().readGeometry(raw, {
      dataProjection: 'EPSG:5181',
      featureProjection: 'EPSG:3857',
    });
    if (!geom) return null;
    return new Feature({ geometry: geom });
  } catch {
    return null;
  }
}

/** 편집 VectorSource features → EPSG:5181 WKT */
export function featuresToWkt5181(features: Feature[]): string | null {
  if (features.length === 0) return null;
  const merged = mergeGeometries3857(features);
  if (!merged) return null;
  const clone = merged.clone();
  clone.transform('EPSG:3857', 'EPSG:5181');
  return new WKT().writeGeometry(clone);
}
