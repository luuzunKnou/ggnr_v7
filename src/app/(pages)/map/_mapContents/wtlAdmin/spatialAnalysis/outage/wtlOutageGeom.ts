/** 단수구역 도형 좌표 변환 (4326 ring ↔ 3857/5181) */
import type { Geometry } from 'ol/geom'
import Polygon from 'ol/geom/Polygon'
import MultiPolygon from 'ol/geom/MultiPolygon'
import WKT from 'ol/format/WKT'
import { transform } from 'ol/proj'

export type LonLat = [number, number]

export function ringToPolygon3857(ring: LonLat[]): Polygon | null {
  if (ring.length < 3) return null
  const coords = ring.map(([lon, lat]) => {
    const [x, y] = transform([lon, lat], 'EPSG:4326', 'EPSG:3857')
    return [x, y]
  })
  const first = coords[0]
  const last = coords[coords.length - 1]
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    coords.push([...first])
  }
  return new Polygon([coords])
}

export function geomToRing4326(geom: Geometry): LonLat[] {
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
      const [lon, lat] = transform([c[0], c[1]], 'EPSG:3857', 'EPSG:4326')
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
