"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import { BikeRoadAttrTable, type BikeRoadAttrEntry } from "./BikeRoadAttrTable";
import {
  BIKE_ROAD_PATH_TYPE_OPTIONS,
  bikeRoadWidthGroup,
  formatBikeRoadLengthKm,
  normalizeBikeRoadPathType,
  type BikeRoadSegment,
} from "./bikeRoadMock";

type Props = {
  segment: BikeRoadSegment;
  readOnly?: boolean;
  isNew?: boolean;
  onConfirm?: (next: BikeRoadSegment) => void;
  onClose: () => void;
  overlayLeftPx: number;
  overlayWidthPx: number;
};

/** 조회 행과 비슷한 높이 유지 + 얇은 테두리 */
const fieldClass =
  "box-border h-[22px] w-full min-w-0 max-w-full rounded border border-border bg-background px-1 text-[11px] leading-none text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/25";
const btnPrimary =
  "inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";
const btnGhost =
  "inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/50";

function display(v: string | undefined | null): string {
  const t = String(v ?? "").trim();
  return t || "—";
}

type SegDraft = {
  serialNo: string;
  routeName: string;
  startName: string;
  endName: string;
  lengthKm: string;
  roadLink: string;
  pathType: string;
  dedicatedRoad: string;
  dedicatedLane: string;
  priorityRoad: string;
  sharedSepBike: string;
  sharedSepWalk: string;
  sharedSepEffective: string;
  sharedNonSepRoad: string;
  sharedNonSepEffective: string;
  note: string;
};

function segmentToDraft(s: BikeRoadSegment): SegDraft {
  return {
    serialNo: s.serialNo,
    routeName: s.routeName,
    startName: s.startName,
    endName: s.endName,
    lengthKm: Number.isFinite(s.lengthKm) ? String(s.lengthKm) : "",
    roadLink: s.roadLink,
    pathType: normalizeBikeRoadPathType(s.pathType) || s.pathType,
    dedicatedRoad: s.dedicatedRoad,
    dedicatedLane: s.dedicatedLane,
    priorityRoad: s.priorityRoad,
    sharedSepBike: s.sharedSepBike,
    sharedSepWalk: s.sharedSepWalk,
    sharedSepEffective: s.sharedSepEffective,
    sharedNonSepRoad: s.sharedNonSepRoad,
    sharedNonSepEffective: s.sharedNonSepEffective,
    note: s.note,
  };
}

function draftToSegment(id: string, d: SegDraft): BikeRoadSegment {
  const lengthKm = Number(d.lengthKm);
  return {
    id,
    serialNo: d.serialNo.trim() || id,
    routeName: d.routeName.trim(),
    startName: d.startName.trim(),
    endName: d.endName.trim(),
    lengthKm: Number.isFinite(lengthKm) ? lengthKm : 0,
    roadLink: d.roadLink.trim(),
    pathType: d.pathType.trim(),
    dedicatedRoad: d.dedicatedRoad.trim(),
    dedicatedLane: d.dedicatedLane.trim(),
    priorityRoad: d.priorityRoad.trim(),
    sharedSepBike: d.sharedSepBike.trim(),
    sharedSepWalk: d.sharedSepWalk.trim(),
    sharedSepEffective: d.sharedSepEffective.trim(),
    sharedNonSepRoad: d.sharedNonSepRoad.trim(),
    sharedNonSepEffective: d.sharedNonSepEffective.trim(),
    note: d.note.trim(),
  };
}

function inputEntry(
  fieldKey: string,
  label: string,
  value: string,
  onChange: (v: string) => void,
  opts?: { fullWidth?: boolean; inputMode?: "decimal" }
): BikeRoadAttrEntry {
  return {
    fieldKey,
    label,
    fullWidth: opts?.fullWidth,
    value: (
      <input
        className={fieldClass}
        value={value}
        inputMode={opts?.inputMode}
        onChange={(e) =>
          onChange(
            opts?.inputMode === "decimal"
              ? e.target.value.replace(/[^\d.-]/g, "")
              : e.target.value
          )
        }
      />
    ),
  };
}

function widthSectionTitle(group: ReturnType<typeof bikeRoadWidthGroup>): string {
  if (group === "dedicated") return "폭원 (m) · 전용";
  if (group === "sharedSep") return "폭원 (m) · 겸용(분리)";
  if (group === "sharedNonSep") return "폭원 (m) · 겸용(비분리)";
  return "폭원 (m)";
}

/** 도로보상 필지 모달과 동일 오버레이. 종류에 따라 폭원만 표시 */
export function BikeRoadSegmentModal({
  segment,
  readOnly = true,
  isNew = false,
  onConfirm,
  onClose,
  overlayLeftPx,
  overlayWidthPx,
}: Props) {
  const titleId = useId();
  const close = useCallback(() => onClose(), [onClose]);
  const [draft, setDraft] = useState<SegDraft>(() => segmentToDraft(segment));

  useEffect(() => {
    setDraft(segmentToDraft(segment));
  }, [segment.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const set = <K extends keyof SegDraft>(key: K, value: SegDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const pathTypeValue = readOnly ? segment.pathType : draft.pathType;
  const widthGroup = bikeRoadWidthGroup(pathTypeValue);

  const basicEntries = useMemo<BikeRoadAttrEntry[]>(() => {
    if (readOnly) {
      return [
        { fieldKey: "startName", label: "기점", value: display(segment.startName) },
        { fieldKey: "endName", label: "종점", value: display(segment.endName) },
        { fieldKey: "roadLink", label: "도로 연계성", value: display(segment.roadLink) },
        {
          fieldKey: "pathType",
          label: "자전거도로 종류",
          value: display(normalizeBikeRoadPathType(segment.pathType) || segment.pathType),
        },
        {
          fieldKey: "lengthKm",
          label: "연장",
          value: formatBikeRoadLengthKm(segment.lengthKm),
        },
        { fieldKey: "note", label: "비고", value: display(segment.note), fullWidth: true },
      ];
    }
    return [
      inputEntry("serialNo", "일련번호", draft.serialNo, (v) => set("serialNo", v)),
      inputEntry("routeName", "노선명", draft.routeName, (v) => set("routeName", v)),
      inputEntry("startName", "기점", draft.startName, (v) => set("startName", v), {
        fullWidth: true,
      }),
      inputEntry("endName", "종점", draft.endName, (v) => set("endName", v), {
        fullWidth: true,
      }),
      inputEntry("roadLink", "도로 연계성", draft.roadLink, (v) => set("roadLink", v)),
      {
        fieldKey: "pathType",
        label: "자전거도로 종류",
        value: (
          <select
            className={fieldClass}
            value={draft.pathType}
            onChange={(e) => set("pathType", e.target.value)}
          >
            <option value="">선택</option>
            {BIKE_ROAD_PATH_TYPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ),
      },
      inputEntry("lengthKm", "연장(km)", draft.lengthKm, (v) => set("lengthKm", v), {
        inputMode: "decimal",
      }),
      inputEntry("note", "비고", draft.note, (v) => set("note", v), { fullWidth: true }),
    ];
  }, [readOnly, segment, draft]);

  const widthEntries = useMemo<BikeRoadAttrEntry[]>(() => {
    if (widthGroup === "dedicated") {
      if (readOnly) {
        return [
          { fieldKey: "dedicatedRoad", label: "전용도로", value: display(segment.dedicatedRoad) },
          { fieldKey: "dedicatedLane", label: "전용차로", value: display(segment.dedicatedLane) },
          { fieldKey: "priorityRoad", label: "우선도로", value: display(segment.priorityRoad) },
        ];
      }
      return [
        inputEntry("dedicatedRoad", "전용도로", draft.dedicatedRoad, (v) =>
          set("dedicatedRoad", v)
        ),
        inputEntry("dedicatedLane", "전용차로", draft.dedicatedLane, (v) =>
          set("dedicatedLane", v)
        ),
        inputEntry("priorityRoad", "우선도로", draft.priorityRoad, (v) =>
          set("priorityRoad", v)
        ),
      ];
    }
    if (widthGroup === "sharedSep") {
      if (readOnly) {
        return [
          {
            fieldKey: "sharedSepBike",
            label: "자전거도로",
            value: display(segment.sharedSepBike),
          },
          { fieldKey: "sharedSepWalk", label: "보도", value: display(segment.sharedSepWalk) },
          {
            fieldKey: "sharedSepEffective",
            label: "유효폭원",
            value: display(segment.sharedSepEffective),
            fullWidth: true,
          },
        ];
      }
      return [
        inputEntry("sharedSepBike", "자전거도로", draft.sharedSepBike, (v) =>
          set("sharedSepBike", v)
        ),
        inputEntry("sharedSepWalk", "보도", draft.sharedSepWalk, (v) =>
          set("sharedSepWalk", v)
        ),
        inputEntry(
          "sharedSepEffective",
          "유효폭원",
          draft.sharedSepEffective,
          (v) => set("sharedSepEffective", v),
          { fullWidth: true }
        ),
      ];
    }
    if (widthGroup === "sharedNonSep") {
      if (readOnly) {
        return [
          {
            fieldKey: "sharedNonSepRoad",
            label: "도로폭원",
            value: display(segment.sharedNonSepRoad),
          },
          {
            fieldKey: "sharedNonSepEffective",
            label: "유효폭원",
            value: display(segment.sharedNonSepEffective),
          },
        ];
      }
      return [
        inputEntry("sharedNonSepRoad", "도로폭원", draft.sharedNonSepRoad, (v) =>
          set("sharedNonSepRoad", v)
        ),
        inputEntry(
          "sharedNonSepEffective",
          "유효폭원",
          draft.sharedNonSepEffective,
          (v) => set("sharedNonSepEffective", v)
        ),
      ];
    }
    return [];
  }, [widthGroup, readOnly, segment, draft]);

  const handleConfirm = () => {
    onConfirm?.(draftToSegment(segment.id, draft));
  };

  if (overlayWidthPx <= 0 || typeof document === "undefined") return null;

  const title = isNew ? "구간 추가" : readOnly ? "구간 상세" : "구간 편집";
  const serial = readOnly ? segment.serialNo : draft.serialNo || "—";
  const name = readOnly ? segment.routeName || "—" : draft.routeName || "—";

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
        className="relative flex max-h-[calc(100dvh-5rem)] w-full max-w-lg flex-col overflow-hidden rounded-[5px] border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 py-2 pr-10">
          <div className="min-w-0 flex-1 text-left">
            <h2
              id={titleId}
              className="truncate text-[13px] font-semibold leading-tight text-foreground"
            >
              {title}
            </h2>
            <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
              {serial} · {name}
            </p>
          </div>
          <button
            type="button"
            className="absolute right-2.5 top-2 rounded-sm p-1 text-muted-foreground opacity-90 ring-offset-background transition-opacity hover:bg-muted/50 hover:text-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="닫기"
            onClick={close}
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 scrollbar-hide">
          <section className="space-y-1.5">
            <h3 className="text-xs font-semibold text-foreground/90">기본</h3>
            <BikeRoadAttrTable entries={basicEntries} />
          </section>

          {widthGroup ? (
            <section className="space-y-1.5">
              <h3 className="text-xs font-semibold text-foreground/90">
                {widthSectionTitle(widthGroup)}
              </h3>
              <BikeRoadAttrTable entries={widthEntries} />
            </section>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              자전거도로 종류를 선택하면 폭원이 표시됩니다.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border px-3 py-1.5">
          {!readOnly ? (
            <button type="button" className={btnPrimary} onClick={handleConfirm}>
              확인
            </button>
          ) : null}
          <button type="button" className={btnGhost} onClick={close}>
            {readOnly ? "닫기" : "취소"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
