"use client";

import { useCallback, useEffect, useState } from "react";
import { SER_FILE_ENG } from "@/lib/serviceFileDataSerEng";
import {
  isImageServiceFileName,
  isPdfServiceFileName,
  serviceFileDataDownloadUrl,
} from "../standard/useServiceFileData";
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from "../standard/ServiceFileImagePreview";
import { useMapContext } from "../MapContext";

/** 하천기본계획 패널 열림 시 지도에서 종단·횡단·구조물 식별 → 도면보기와 동일 전체화면 미리보기 */
export function RiverBasicPlanMapDrawingFromMapHandler() {
  const mapContext = useMapContext();
  const req = mapContext?.riverBasicPlanDrawingFromMap;
  const setReq = mapContext?.setRiverBasicPlanDrawingFromMap;
  const controllerRef = mapContext?.riverBasicPlanMapDrawingPreviewControllerRef;

  const [preview, setPreview] = useState<{
    items: ServiceFilePreviewItem[];
    initialIndex: number;
  } | null>(null);

  const close = useCallback(() => {
    setPreview(null);
  }, []);

  useEffect(() => {
    if (!controllerRef) return;
    controllerRef.current = { close };
    return () => {
      controllerRef.current = null;
    };
  }, [controllerRef, close]);

  useEffect(() => {
    if (!req?.fileLayer?.trim() || !req?.fileKey?.trim() || !setReq) return;
    const layer = req.fileLayer.trim();
    const key = req.fileKey.trim();

    let cancelled = false;
    void (async () => {
      try {
        const qs = new URLSearchParams({
          serEng: SER_FILE_ENG.riverBasicPlan,
          layer,
          key,
        });
        const res = await fetch(`/api/service-files?${qs.toString()}`, { credentials: "include" });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(typeof j.error === "string" ? j.error : "목록을 불러오지 못했습니다.");
        }
        const data = (await res.json()) as { files?: { name: string }[] };
        const files = Array.isArray(data.files) ? data.files : [];
        const items: ServiceFilePreviewItem[] = files
          .filter((f) => isImageServiceFileName(f.name) || isPdfServiceFileName(f.name))
          .map((f) => ({
            url: serviceFileDataDownloadUrl(SER_FILE_ENG.riverBasicPlan, layer, key, f.name),
            fileName: f.name,
            kind: isPdfServiceFileName(f.name) ? ("pdf" as const) : ("image" as const),
          }));
        if (cancelled) return;
        if (items.length === 0) {
          window.alert("도면으로 볼 수 있는 첨부파일(이미지·PDF)이 없습니다.");
          return;
        }
        setPreview({ items, initialIndex: 0 });
      } catch (e) {
        if (!cancelled) {
          window.alert(e instanceof Error ? e.message : "첨부를 불러오지 못했습니다.");
        }
      } finally {
        // 이 요청(layer/key)이 아직 컨텍스트에 있을 때만 비움 — 느린 이전 요청이 새 클릭 상태를 지우지 않도록
        setReq((prev) => {
          const pl = prev?.fileLayer?.trim();
          const pk = prev?.fileKey?.trim();
          if (pl === layer && pk === key) return null;
          return prev;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [req, setReq]);

  if (preview == null) return null;
  return (
    <ServiceFileImagePreview
      items={preview.items}
      initialIndex={preview.initialIndex}
      onClose={close}
    />
  );
}
