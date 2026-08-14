import WKT from "ol/format/WKT";
import MultiPolygon from "ol/geom/MultiPolygon";
import Polygon from "ol/geom/Polygon";
import { getCenter } from "ol/extent";
import { transform } from "ol/proj";
import "../config/projections"; // EPSG:5181 등록
import { getAddressFromCoord } from "../addressSearch/vworldAddressSearch";

/**
 * EPSG:5181 도형 WKT의 중심(내부점) 좌표로 주소 조회.
 * 도로명 우선, 없으면 지번.
 */
export async function resolveAddressFromWkt5181(
  wkt5181: string,
  apiKey: string
): Promise<string | null> {
  const raw = String(wkt5181 ?? "").trim();
  const key = String(apiKey ?? "").trim();
  if (!raw || !key) return null;

  try {
    const geom = new WKT().readGeometry(raw);
    let xy: number[] | null = null;

    if (geom instanceof Polygon) {
      xy = geom.getInteriorPoint().getCoordinates();
    } else if (geom instanceof MultiPolygon) {
      const pts = geom.getInteriorPoints();
      xy = pts.getCoordinates()[0] ?? null;
    }

    if (!xy || xy.length < 2) {
      const c = getCenter(geom.getExtent());
      xy = [c[0]!, c[1]!];
    }

    const [lon, lat] = transform([xy[0]!, xy[1]!], "EPSG:5181", "EPSG:4326");
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

    const addr = await getAddressFromCoord(lon, lat, { apiKey: key, type: "BOTH" });
    const text = (addr?.road || addr?.jibun || "").trim();
    return text || null;
  } catch {
    return null;
  }
}
