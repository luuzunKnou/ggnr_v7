"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { getLegendUrl } from "../../../_mapComponents/hooks/useFeatureIdentify";
import { formatRoadLedgerAttrValue } from "./roadLedgerFormat";
import {
  fetchRoadLedgerDefineFieldLabels,
  resolveRoadLedgerFieldLabel,
} from "./roadLedgerDefineFieldLabels";
import { DetailInfoTable } from "./RoadLedgerDetailPanel";

const GEOM_LIKE = new Set(["geom", "geometry", "the_geom", "wkb_geometry", "shape"]);

function isGeomKey(k: string): boolean {
  return GEOM_LIKE.has(k.toLowerCase());
}

export type RoadLedgerFacilityAttrModalProps = {
  /** 도로대장 목록 패널 왼쪽 끝 (뷰포트 기준 px) */
  overlayLeftPx: number;
  /** 목록 + 상세 패널 너비 합 (px) */
  overlayWidthPx: number;
};

/**
 * 도로대장 목록·상세 두 패널 영역을 가득 덮는 시설 속성 모달.
 * 제목: define 한글명 (define_table_name). 바깥 반투명·안쪽 흰 카드.
 */
export function RoadLedgerFacilityAttrModal({
  overlayLeftPx,
  overlayWidthPx,
}: RoadLedgerFacilityAttrModalProps) {
  const mapContext = useMapContext();
  const pick = mapContext?.roadLedgerFacilityModal;
  const open = Boolean(pick);
  const titleId = useId();
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({});

  const close = useCallback(() => {
    mapContext?.setRoadLedgerFacilityModal?.(null);
  }, [mapContext]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    const table = String(pick?.defineTableName ?? "").trim();
    if (!open || !table) {
      setFieldLabels({});
      return;
    }
    let cancelled = false;
    void fetchRoadLedgerDefineFieldLabels(table).then((labels) => {
      if (!cancelled) setFieldLabels(labels);
    });
    return () => {
      cancelled = true;
    };
  }, [open, pick?.defineTableName]);

  const entries = pick
    ? Object.entries(pick.row)
        .filter(([k]) => !isGeomKey(k))
        .sort(([a], [b]) => {
          const la = resolveRoadLedgerFieldLabel(fieldLabels, a);
          const lb = resolveRoadLedgerFieldLabel(fieldLabels, b);
          return la.localeCompare(lb, "ko");
        })
        .map(([fieldKey, val]) => ({
          fieldKey,
          label: resolveRoadLedgerFieldLabel(fieldLabels, fieldKey),
          value: formatRoadLedgerAttrValue(fieldKey, val),
        }))
    : [];

  if (!open || overlayWidthPx <= 0 || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed z-[80] box-border flex min-h-0 items-center justify-center overflow-y-auto bg-black/50 p-10 pointer-events-auto"
      style={{
        left: overlayLeftPx,
        top: 0,
        width: overlayWidthPx,
        height: "100dvh",
        maxHeight: "100dvh",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={close}
    >
      <div
        className="relative w-full max-h-[calc(100dvh-5rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-[5px] border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-border bg-background px-4 py-3 pr-10">
          <div className="flex min-w-0 flex-1 items-start gap-2 text-left">
            {pick?.defineTableName ? (
              <img
                src={getLegendUrl(pick.defineTableName)}
                alt=""
                width={20}
                height={20}
                className="mt-0.5 h-5 w-5 shrink-0 object-contain"
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : null}
            <h2
              id={titleId}
              className="min-w-0 break-words text-base font-semibold leading-snug text-foreground"
            >
              {pick?.defineTableTitle}
              <span className="font-semibold text-muted-foreground"> ({pick?.defineTableName})</span>
            </h2>
          </div>
          <button
            type="button"
            className="absolute right-3 top-3 rounded-sm p-1 text-muted-foreground opacity-90 ring-offset-background transition-opacity hover:bg-muted/50 hover:text-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="닫기"
            onClick={close}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-3">
          {entries.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">표시할 속성이 없습니다.</p>
          ) : (
            <DetailInfoTable entries={entries} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
