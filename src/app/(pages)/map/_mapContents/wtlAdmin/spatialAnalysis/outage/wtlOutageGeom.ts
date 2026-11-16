/** 단수구역 도형 좌표 변환 (4326 ring ↔ 지도 좌표계 3857/5181) */
import type { Geometry } from 'ol/geom'
import Polygon from 'ol/geom/Polygon'
import MultiPolygon from 'ol/geom/MultiPolygon'
import WKT from 'ol/format/WKT'
import { transform } from 'ol/proj'

export type LonLat = [number, number]

/** 경위도 링 → 지도 좌표계 폴리곤 (viewProjection: 현재 지도 좌표계, 기본 3857) */
export function ringToViewPolygon(ring: LonLat[], viewProjection = 'EPSG:3857'): Polygon | null {
  if (ring.length < 3) return null
  const coords = ring.map(([lon, lat]) => {
    const [x, y] = transform([lon, lat], 'EPSG:4326', viewProjection)
    return [x, y]
  })
  const first = coords[0]
  const last = coords[coords.length - 1]
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    coords.push([...first])
  }
  return new Polygon([coords])
}

/** 지도 좌표계 폴리곤 → 경위도 외곽 링 (viewProjection: 현재 지도 좌표계, 기본 3857) */
export function geomToRing4326(geom: Geometry, viewProjection = 'EPSG:3857'): LonLat[] {
  const poly =
    geom instanceof Polygon
      ? geom
      : geom instanceof MultiPolygon
        ? geom.getPolygon(0)
        : null
  if (!poly) return []
  const coords = poly.getCoordinates()[0] ?? []
  return coords
    .filter((c) => Array.isArray(c) && c.length >= 2)
    .map((c) => {
      const [lon, lat] = transform([c[0], c[1]], viewProjection, 'EPSG:4326')
      return [lon, lat] as LonLat
    })
}

export function wkt5181ToRing4326(wkt5181: string): LonLat[] {
  try {
    const geom = new WKT().readGeometry(wkt5181, {
      dataProjection: 'EPSG:5181',
      featureProjection: 'EPSG:4326',
    })
    const poly =
      geom instanceof Polygon
        ? geom
        : geom instanceof MultiPolygon
          ? geom.getPolygon(0)
          : null
    if (!poly) return []
    const coords = poly.getCoordinates()[0] ?? []
    return coords
      .filter((c) => Array.isArray(c) && c.length >= 2)
      .map((c) => [Number(c[0]), Number(c[1])] as LonLat)
  } catch {
    return []
  }
}
