import { call } from "@/lib/api";
import { resolveParcelItemForHighlight } from "./resolveParcelItemForHighlight";
import type { LayerRowParcelItem } from "./types";

/**
 * 필지 하이라이트용 — 점용(부모) ∩ 필지 교집합만 반환.
 * 교집합 실패 시 전체 필지로 폴백하지 않음 (geometry3857/extent3857 비움).
 */
export async function resolveParcelItemIntersectParentForHighlight(
  item: LayerRowParcelItem,
  opts: {
    childTable: string;
    parentTable: string;
    parentKeyField: string;
    parentKeyValue: string;
  }
): Promise<LayerRowParcelItem> {
  const childTable = String(opts.childTable ?? "").trim();
  const parentTable = String(opts.parentTable ?? "").trim();
  const parentKeyField = String(opts.parentKeyField ?? "").trim() || "id";
  const parentKeyValue = String(opts.parentKeyValue ?? "").trim();
  const childKey = item.wmsRowKey;

  const emptyHighlight: LayerRowParcelItem = {
    ...item,
    geometry3857: null,
    extent3857: null,
  };

  if (!parentTable || !parentKeyValue) return emptyHighlight;

  // 1) DB 행 키로 원본 SRID에서 교집합 (가장 확실)
  if (childTable && childKey?.keyField && childKey?.keyValue) {
    try {
      const res = await call("", "POST", {
        service: "layerRowService",
        action: "getIntersectedRowGeomGeoJson3857",
        params: {
          parentTable,
          parentKeyField,
          parentKeyValue,
          childTable,
          childKeyField: childKey.keyField,
          childKeyValue: childKey.keyValue,
          schema: "layer",
        },
      });
      const data = res?.data ?? res;
      const geometry = data?.geometry;
      if (geometry != null && typeof geometry === "object") {
        return {
          ...item,
          geometry3857: geometry as Record<string, unknown>,
          extent3857: null,
        };
      }
    } catch {
      // GeoJSON 교집합으로 이어감
    }
  }

  // 2) 이미 조회된 GeoJSON끼리 교집합
  const base = await resolveParcelItemForHighlight(item, childTable);
  if (!base.geometry3857) return emptyHighlight;

  try {
    const parentRes = await call("", "POST", {
      service: "layerRowService",
      action: "getTableRowGeomGeoJson3857",
      params: {
        table: parentTable,
        schema: "layer",
        keyField: parentKeyField,
        keyValue: parentKeyValue,
      },
    });
    const parentData = parentRes?.data ?? parentRes;
    const parentGeometry = parentData?.geometry;
    if (parentGeometry != null && typeof parentGeometry === "object") {
      const ixRes = await call("", "POST", {
        service: "layerRowService",
        action: "getIntersectedGeoJson3857",
        params: {
          parentGeometry,
          childGeometry: base.geometry3857,
        },
      });
      const ixData = ixRes?.data ?? ixRes;
      const geometry = ixData?.geometry;
      if (geometry != null && typeof geometry === "object") {
        return {
          ...base,
          geometry3857: geometry as Record<string, unknown>,
          extent3857: null,
        };
      }
    }
  } catch {
    // 전체 필지 폴백 없음
  }

  return emptyHighlight;
}
