"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMapContext } from "../../../_mapComponents/MapContext";
import type { PreferRegion } from "../../../_mapComponents/addressSearch/vworldAddressSearch";
import {
  fitMapToLayerRowParcel,
  getParcelExtent3857,
} from "../../../_mapComponents/layerRowEdit/layerRowParcelUtils";
import { resolveParcelGeoms } from "../../../_mapComponents/layerRowEdit/resolveParcelGeoms";
import { useLayerRowParcelHighlight } from "../../../_mapComponents/layerRowEdit/useLayerRowParcelHighlight";
import type { LayerRowParcelItem } from "../../../_mapComponents/layerRowEdit/types";
import { call } from "@/lib/api";

function buildParcelQuery(address: string, jibun: string, region?: PreferRegion): string {
  const parts = [
    region?.sido?.trim(),
    region?.sigungu?.trim(),
    address.trim(),
    jibun.trim(),
  ].filter(Boolean);
  // 시·군 중복 방지: 소재지에 이미 시군구가 있으면 앞 접두만 생략
  const addr = address.trim();
  const sigungu = region?.sigungu?.trim() ?? "";
  if (sigungu && addr.includes(sigungu.replace(/시$|군$|구$/, ""))) {
    return [addr, jibun.trim()].filter(Boolean).join(" ");
  }
  return parts.join(" ");
}

/**
 * 미지급용지 목록 행 → 지적 필지 조회·이동·하이라이트
 * (점용대장·필지목록과 동일: resolveJijuk + 파란 하이라이트)
 */
export function useUnpaidLandParcelLocate() {
  const mapContext = useMapContext();
  const regionRef = useRef<PreferRegion | undefined>(undefined);
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const [highlightItem, setHighlightItem] = useState<LayerRowParcelItem | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  useLayerRowParcelHighlight(highlightItem, "blue");

  useEffect(() => {
    let cancelled = false;
    void call("", "POST", {
      service: "configService",
      action: "getParcelAnalysisRegionFromFooter",
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const data = (res as { data?: PreferRegion })?.data ?? res;
        const sido = String((data as PreferRegion)?.sido ?? "").trim();
        const sigungu = String((data as PreferRegion)?.sigungu ?? "").trim();
        regionRef.current =
          !sido && !sigungu
            ? undefined
            : {
                ...(sido ? { sido } : {}),
                ...(sigungu ? { sigungu } : {}),
              };
      })
      .catch(() => {
        if (!cancelled) regionRef.current = undefined;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearLocate = useCallback(() => {
    setSelectedParcelId(null);
    setHighlightItem(null);
    setLocateError(null);
  }, []);

  /** 지도 조회 없이 행만 선택 (신규 필지·편집용) */
  const selectParcel = useCallback((parcelId: string) => {
    setSelectedParcelId(parcelId);
    setLocateError(null);
  }, []);

  const locateParcel = useCallback(
    async (params: { parcelId: string; address: string; jibun: string }) => {
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) {
        setLocateError("지도가 준비되지 않았습니다.");
        setSelectedParcelId(params.parcelId);
        return;
      }
      const address = String(params.address ?? "").trim();
      const jibun = String(params.jibun ?? "").trim();
      setSelectedParcelId(params.parcelId);
      if (!address && !jibun) {
        setLocateError(null);
        return;
      }

      setLocating(true);
      setLocateError(null);

      try {
        const query = buildParcelQuery(address, jibun, regionRef.current);
        const base: LayerRowParcelItem = {
          address: query,
          extent3857: null,
          showMapGeom: true,
        };
        const [resolved] = await resolveParcelGeoms([base]);
        if (!resolved || (!getParcelExtent3857(resolved) && !resolved.geometry3857)) {
          setHighlightItem(null);
          setLocateError(`필지를 찾지 못했습니다: ${query}`);
          return;
        }
        setHighlightItem(resolved);
        fitMapToLayerRowParcel(map, resolved, {
          applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current,
          enableWmsLayer: false,
        });
      } catch {
        setHighlightItem(null);
        setLocateError("필지 조회 중 오류가 발생했습니다.");
      } finally {
        setLocating(false);
      }
    },
    [mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef]
  );

  return {
    selectedParcelId,
    locating,
    locateError,
    selectParcel,
    locateParcel,
    clearLocate,
  };
}
