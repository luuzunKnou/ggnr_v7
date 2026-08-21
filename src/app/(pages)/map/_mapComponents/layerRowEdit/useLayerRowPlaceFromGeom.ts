"use client";

import { useEffect, useRef } from "react";
import { formatAddressStripSidoSigungu } from "@/lib/formatAddressStripAdmin";
import { useMapContext } from "../MapContext";
import { resolveAddressFromWkt5181 } from "./resolveAddressFromWkt5181";

type Options = {
  enabled: boolean;
  placeFieldKey: string;
  onSetPlace: (fieldKey: string, value: string) => void;
  /** 도형 교차 필지 주소 — 역지오코딩 실패 시 폴백 */
  parcelAddresses?: string[];
  /**
   * true면 필지목록이 바뀔 때도 장소를 다시 채운다.
   * 수정에서는 끄고, 도형을 그렸을 때만 장소를 갱신한다.
   */
  refillOnParcelList?: boolean;
};

/**
 * 도형 추가·수정 → 점용장소 자동 입력.
 * 1) 도형 중심 역지오코딩
 * 2) 실패 시 필지목록 첫 주소
 * 신규는 필지목록이 채워진 뒤에도 장소를 맞춘다. 수정은 도형을 그렸을 때만 갱신한다.
 */
export function useLayerRowPlaceFromGeom({
  enabled,
  placeFieldKey,
  onSetPlace,
  parcelAddresses = [],
  refillOnParcelList = true,
}: Options) {
  const mapContext = useMapContext();
  const drawnRef = mapContext?.layerRowGeomDrawnRef;
  const wktRef = mapContext?.layerRowGeomEditWktRef;
  const dirtyRef = mapContext?.layerRowGeomEditDirtyRef;

  const apiKeyRef = useRef(String(mapContext?.vworldApiKey ?? "").trim());
  const placeFieldKeyRef = useRef(placeFieldKey);
  const onSetPlaceRef = useRef(onSetPlace);
  const parcelAddressesRef = useRef(parcelAddresses);
  const lastAppliedWktRef = useRef("");

  apiKeyRef.current = String(mapContext?.vworldApiKey ?? "").trim();
  placeFieldKeyRef.current = placeFieldKey;
  onSetPlaceRef.current = onSetPlace;
  parcelAddressesRef.current = parcelAddresses;

  const applyPlaceForWkt = (wkt5181: string) => {
    const field = placeFieldKeyRef.current;
    if (!field) return;
    const wkt = String(wkt5181 ?? "").trim();
    if (!wkt) return;

    const apiKey = apiKeyRef.current;

    void (async () => {
      let addr: string | null = null;
      if (apiKey) {
        addr = await resolveAddressFromWkt5181(wkt, apiKey);
      }
      // 필지 조회가 역지오코딩보다 늦게 끝나는 경우 대비 — await 이후 폴백 재확인
      const fallback = String(parcelAddressesRef.current[0] ?? "").trim();
      const raw = (addr || fallback || "").trim();
      if (!raw) return;
      const next = formatAddressStripSidoSigungu(raw) || raw;
      lastAppliedWktRef.current = wkt;
      onSetPlaceRef.current(field, next);
    })();
  };

  useEffect(() => {
    if (!drawnRef) return;

    if (!enabled || !placeFieldKey) {
      drawnRef.current = null;
      return;
    }

    drawnRef.current = ({ wkt5181 }) => {
      applyPlaceForWkt(wkt5181);
    };

    return () => {
      if (drawnRef.current) drawnRef.current = null;
    };
  }, [enabled, placeFieldKey, drawnRef]);

  /**
   * 도형 추가 직후: notify 시점엔 필지가 비어 있고, 필지 API 후에야 목록이 채워짐.
   * 필지 시그니처가 바뀌면(그리고 도형이 dirty면) 장소를 다시 채운다.
   */
  const parcelSig = parcelAddresses.map((a) => a.trim()).filter(Boolean).join("|");
  useEffect(() => {
    if (!enabled || !placeFieldKey || !refillOnParcelList) return;
    if (!parcelSig) return;
    if (dirtyRef?.current !== true) return;
    const wkt = String(wktRef?.current ?? "").trim();
    if (!wkt) return;
    applyPlaceForWkt(wkt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 필지·편집 세션 변화 시만
  }, [enabled, placeFieldKey, parcelSig, refillOnParcelList]);
}
