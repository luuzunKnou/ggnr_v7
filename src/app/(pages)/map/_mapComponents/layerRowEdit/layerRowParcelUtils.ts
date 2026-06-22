import { formatAddressStripSidoSigungu } from "@/lib/formatAddressStripAdmin";
import GeoJSON from "ol/format/GeoJSON";
import type Map from "ol/Map";
import { transform } from "ol/proj";
import type { VWorldAddressItem } from "../addressSearch/vworldAddressSearch";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../config/mapDefaults";
import { scheduleFitMapToExtent3857 } from "../config/mapAutoNavigation";
import type { LayerRowParcelItem } from "./types";

export function parcelAddressesFromItems(items: LayerRowParcelItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const addr = String(item.address ?? "").trim();
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
}

/** 지도 이동용 extent — extent3857 → geometry3857 → point4326 순 */
export function getParcelExtent3857(item: LayerRowParcelItem): [number, number, number, number] | null {
  const ext = item.extent3857;
  if (ext && ext.length === 4 && ext.every((v) => Number.isFinite(v))) return ext;

  if (item.geometry3857) {
    try {
      const geom = new GeoJSON().readGeometry(item.geometry3857, {
        dataProjection: "EPSG:3857",
        featureProjection: "EPSG:3857",
      });
      const envelope = geom?.getExtent();
      if (envelope && envelope.length === 4 && envelope.every((v) => Number.isFinite(v))) {
        return envelope as [number, number, number, number];
      }
    } catch {
      // ignore
    }
  }

  const lon = item.point4326?.x;
  const lat = item.point4326?.y;
  if (typeof lon === "number" && typeof lat === "number" && Number.isFinite(lon) && Number.isFinite(lat)) {
    const [x, y] = transform([lon, lat], "EPSG:4326", "EPSG:3857");
    const pad = 40;
    return [x - pad, y - pad, x + pad, y + pad];
  }

  return null;
}

export function fitMapToLayerRowParcel(
  map: Map,
  item: LayerRowParcelItem,
  opts?: {
    wmsLayerId?: string;
    setVisibleLayerNames?: (updater: (prev: Set<string>) => Set<string>) => void;
    applyMapViewPadding?: (() => void) | null;
  }
): boolean {
  const ext = getParcelExtent3857(item);
  if (!ext) return false;

  const wmsLayerId = String(opts?.wmsLayerId ?? "").trim();
  if (wmsLayerId && opts?.setVisibleLayerNames) {
    const lid = wmsLayerId.toLowerCase();
    opts.setVisibleLayerNames((prev) => {
      if (prev.has(lid)) return prev;
      return new Set(prev).add(lid);
    });
  }

  scheduleFitMapToExtent3857(map, ext, {
    maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
    pointZoom: 16,
    applyMapViewPadding: () => opts?.applyMapViewPadding?.(),
  });
  return true;
}

function hasAdminUnitInAddress(value: string): boolean {
  return /(읍|면|동|리)(\s|$)/u.test(value);
}

/** VWorld 검색 결과 → 필지목록 주소 (시·도·시군구 제외, 읍면동리 포함) */
function pickParcelAddressRaw(item: VWorldAddressItem): string {
  const jibun = (item.jibunAddress ?? "").trim();
  const title = (item.title ?? "").trim();
  const fallback = (item.address ?? "").trim();

  if (jibun && hasAdminUnitInAddress(jibun)) return jibun;
  if (title && (title.includes(jibun) || !jibun)) return title;
  if (jibun && title && hasAdminUnitInAddress(title)) {
    const adminPart = formatAddressStripSidoSigungu(title);
    if (adminPart && !adminPart.includes(jibun)) return `${adminPart} ${jibun}`.trim();
  }
  return jibun || title || fallback;
}

export function vworldItemToParcelItem(item: VWorldAddressItem): LayerRowParcelItem | null {
  const raw = pickParcelAddressRaw(item);
  if (!raw) return null;
  const address = formatAddressStripSidoSigungu(raw);
  if (!address) return null;

  const lon = item.point?.x;
  const lat = item.point?.y;
  if (typeof lon === "number" && typeof lat === "number" && Number.isFinite(lon) && Number.isFinite(lat)) {
    const [x, y] = transform([lon, lat], "EPSG:4326", "EPSG:3857");
    const pad = 40;
    return {
      address,
      extent3857: [x - pad, y - pad, x + pad, y + pad],
      point4326: { x: lon, y: lat },
    };
  }
  return { address, extent3857: null };
}
