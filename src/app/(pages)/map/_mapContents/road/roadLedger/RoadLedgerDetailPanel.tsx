"use client";

import { useCallback, useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  DraftingCompass,
  FileText,
  Layers,
  LayoutGrid,
  Map,
  Package,
  Shield,
  Video,
  Warehouse,
  Waves,
  X,
} from "lucide-react";
import { call } from "@/lib/api";
import { recordDataViewLog } from "@/lib/recordDataViewLog";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog";
import { useMapContext, type MapContextValue } from "../../../_mapComponents/MapContext";
import {
  formatRoadLedgerAttrValue,
  formatRoadLedgerDsgdateDisplay,
  formatRoadLedgerDetailTitleParen,
  formatRoadLedgerLenthWithUnit,
  formatRoadLedgerNumericToken,
  formatRoadLedgerRoadRankDisplay,
  pickRoadLedgerField,
} from "./roadLedgerFormat";
import {
  getAllRoadLedgerDocLayerIds,
  isRoadLedgerDocGroupActive,
  ROAD_LEDGER_DOC_LAYERS,
  ROAD_LEDGER_DOC_LABELS_WITH_LAYER_COUNT,
  ROAD_LEDGER_RDID_MIN_LEN_FOR_FACILITY_JOIN,
  type RoadLedgerDocButtonKey,
  toggleRoadLedgerDocLayers,
} from "./roadLedgerDocLayerMap";
import { RoadLedgerFacilityListSection } from "./RoadLedgerFacilityListSection";

/** 하천 기본계획 상세와 동일 버튼 스타일 + 라벨별 아이콘 (라벨 키는 roadLedgerDocLayerMap 과 일치) */
const DOC_ACTION_BUTTONS: { label: RoadLedgerDocButtonKey; icon: LucideIcon }[] = [
  { label: "보고서", icon: FileText },
  { label: "도로영상", icon: Video },
  { label: "매설물도", icon: Layers },
  { label: "종평면도", icon: LayoutGrid },
  { label: "용지도", icon: Map },
  { label: "주요시설", icon: Building2 },
  { label: "안전시설", icon: Shield },
  { label: "부대시설", icon: Warehouse },
  { label: "배수시설", icon: Waves },
  { label: "기타시설", icon: Package },
  { label: "기하구조", icon: DraftingCompass },
];

/** 보고서 ~ 용지도: 한 줄 5칸 / 그 아래 시설 구분: 한 줄 4칸 */
const DOC_ACTION_BUTTONS_PRIMARY = DOC_ACTION_BUTTONS.slice(0, 5);
const DOC_ACTION_BUTTONS_REST = DOC_ACTION_BUTTONS.slice(5);

/** 속성정보·표에 쓰는 필드(상세정보 접기에서 제외) */
const PRIMARY_ATTR_KEYS = new Set([
  "road_name",
  "road_no",
  "sect",
  "road_rank",
  "dsgdate",
  "lenth",
  "impopass",
  "s_point",
  "e_point",
]);

const PRIMARY_TABLE_ROWS: { field: string; label: string }[] = [
  { field: "dsgdate", label: "노선지정(인정)일" },
  { field: "lenth", label: "노선연장" },
  { field: "sect", label: "구간" },
  { field: "road_rank", label: "도로의종류" },
  { field: "impopass", label: "주요 통과지" },
  { field: "s_point", label: "위치_시점" },
  { field: "e_point", label: "위치_종점" },
];

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function cellText(field: string, raw: unknown): string {
  const t = formatRoadLedgerAttrValue(field, raw);
  return t === "" ? "—" : t;
}

function primaryCellDisplay(field: string, raw: unknown): string {
  if (field === "dsgdate") {
    return formatRoadLedgerDsgdateDisplay(raw);
  }
  if (field === "lenth") {
    return formatRoadLedgerLenthWithUnit(raw);
  }
  if (field === "road_rank") {
    return formatRoadLedgerRoadRankDisplay(raw);
  }
  if (field === "sect") {
    const t = formatRoadLedgerNumericToken(raw);
    return t === "" ? "—" : t;
  }
  return cellText(field, raw);
}

function DetailInfoRow({
  field,
  showBottomBorder,
  labelClassName,
}: {
  field: { fieldKey: string; label: string; value: string };
  showBottomBorder: boolean;
  labelClassName: string;
}) {
  return (
    <div className={cn("flex", showBottomBorder && "border-b border-slate-200")}>
      <div
        className={cn(
          "flex min-w-0 shrink-0 items-start bg-slate-100 px-2 py-1.5",
          labelClassName,
        )}
      >
        <span className="min-w-0 w-full whitespace-normal break-words text-[11px] leading-snug text-[#666]">
          {field.label}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 items-start px-2 py-1.5">
        <span className="break-all text-[11px] leading-snug text-[#666]">{field.value}</span>
      </div>
    </div>
  );
}

export function DetailInfoTable({
  entries,
}: {
  entries: { fieldKey: string; label: string; value: string }[];
}) {
  if (entries.length === 0) {
    return <p className="text-[11px] text-slate-500">표시할 항목이 없습니다.</p>;
  }

  const mid = Math.ceil(entries.length / 2);
  const leftCol = entries.slice(0, mid);
  const rightCol = entries.slice(mid);
  const labelW = "w-[min(5.5rem,32%)]";

  if (entries.length === 1) {
    const field = entries[0]!;
    return (
      <div className="overflow-hidden rounded-[5px] border border-slate-200">
        <DetailInfoRow field={field} showBottomBorder={false} labelClassName="w-[100px]" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 divide-x divide-slate-200 overflow-hidden rounded-[5px] border border-slate-200">
      <div className="min-w-0">
        {leftCol.map((field, index) => (
          <DetailInfoRow
            key={field.fieldKey}
            field={field}
            showBottomBorder={index !== leftCol.length - 1}
            labelClassName={labelW}
          />
        ))}
      </div>
      <div className="min-w-0">
        {rightCol.map((field, index) => (
          <DetailInfoRow
            key={field.fieldKey}
            field={field}
            showBottomBorder={index !== rightCol.length - 1}
            labelClassName={labelW}
          />
        ))}
      </div>
    </div>
  );
}

type Props = {
  row: Record<string, unknown>;
  onClose: () => void;
};

function RoadLedgerDocActionGrid({
  items,
  gridClassName,
  visibleLayerNames,
  setVisibleLayerNames,
  onDocClick,
  getLayersForKey,
  facilityDataCounts,
  facilityCountsLoading,
  hasRdidForFacility,
}: {
  items: { label: RoadLedgerDocButtonKey; icon: LucideIcon }[];
  gridClassName: string;
  visibleLayerNames: Set<string>;
  setVisibleLayerNames: NonNullable<MapContextValue>["setVisibleLayerNames"] | undefined;
  onDocClick: (key: RoadLedgerDocButtonKey) => void;
  getLayersForKey: (key: RoadLedgerDocButtonKey) => string[];
  facilityDataCounts: Partial<Record<RoadLedgerDocButtonKey, number>> | null;
  facilityCountsLoading: boolean;
  hasRdidForFacility: boolean;
}) {
  return (
    <div className={cn("grid gap-1.5", gridClassName)}>
      {items.map(({ label, icon: Icon }) => {
        const layers = getLayersForKey(label);
        const isReportOnly = label === "보고서";
        const hasLayers = layers.length > 0;
        const active =
          !isReportOnly && hasLayers && isRoadLedgerDocGroupActive(visibleLayerNames, layers);
        const showCount = ROAD_LEDGER_DOC_LABELS_WITH_LAYER_COUNT.includes(label);
        const dataN = facilityDataCounts?.[label];
        const displayLabel =
          showCount && hasRdidForFacility
            ? `${label} (${facilityCountsLoading ? "…" : typeof dataN === "number" ? dataN : "—"})`
            : label;
        return (
          <button
            key={label}
            type="button"
            title={
              isReportOnly
                ? "보고서"
                : hasLayers
                  ? "클릭: 해당 공간정보 레이어 켜기 / 다시 클릭: 끄기"
                  : "연결 레이어 없음"
            }
            onClick={() => onDocClick(label)}
            disabled={isReportOnly ? false : !setVisibleLayerNames}
            className={cn(
              "h-auto min-h-[28px] text-[11px] rounded border min-w-0 inline-flex items-center justify-center gap-1 px-1 py-1.5 leading-tight",
              !isReportOnly && !setVisibleLayerNames && "pointer-events-none opacity-50",
              isReportOnly
                ? "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                : hasLayers
                  ? active
                    ? "border-primary/45 bg-primary/[0.08] text-slate-800 ring-1 ring-inset ring-primary/15 hover:bg-primary/[0.11]"
                    : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                  : "border-slate-200 bg-slate-50/80 text-slate-500 hover:bg-slate-100",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="text-center whitespace-normal break-words [word-break:keep-all]">{displayLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

export function RoadLedgerDetailPanel({ row, onClose }: Props) {
  const [attrOpen, setAttrOpen] = useState(true);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [facilityDataCounts, setFacilityDataCounts] = useState<Partial<
    Record<RoadLedgerDocButtonKey, number>
  > | null>(null);
  const [facilityCountsLoading, setFacilityCountsLoading] = useState(false);
  const [existingDocLayerIds, setExistingDocLayerIds] = useState<Set<string> | null>(null);
  const mapContext = useMapContext();
  const visibleLayerNames = mapContext?.visibleLayerNames ?? new Set<string>();
  const setVisibleLayerNames = mapContext?.setVisibleLayerNames;

  // 데이터 이력관리에 조회 저장을 위해 추가
  useEffect(() => {
    const rdid = String(pickRoadLedgerField(row, "rdid") ?? "").trim();
    const ogcFid = String(
      pickRoadLedgerField(row, "ogc_fid") ??
        pickRoadLedgerField(row, "roadLedgerOgcFid") ??
        ""
    ).trim();
    const keyValue = rdid || ogcFid;
    if (!keyValue) return;
    recordDataViewLog({
      tableName: "a0020000",
      keyField: rdid ? "rdid" : "ogc_fid",
      keyValue,
      serviceName: "도로대장",
    });
  }, [row]);

  const getEffectiveDocLayers = useCallback(
    (key: RoadLedgerDocButtonKey) => {
      const raw = ROAD_LEDGER_DOC_LAYERS[key];
      if (existingDocLayerIds == null) return raw;
      return raw.filter((id) => existingDocLayerIds.has(id.toLowerCase()));
    },
    [existingDocLayerIds]
  );

  const handleDocButtonClick = useCallback(
    (key: RoadLedgerDocButtonKey) => {
      if (key === "보고서") return;
      const layers = getEffectiveDocLayers(key);
      if (layers.length === 0) {
        window.alert("해당 항목에 연결된 공간정보 레이어가 아직 없습니다. (준비 중)");
        return;
      }
      if (!setVisibleLayerNames) return;
      setVisibleLayerNames((prev) => toggleRoadLedgerDocLayers(prev, layers));
    },
    [getEffectiveDocLayers, setVisibleLayerNames]
  );

  useEffect(() => {
    let cancelled = false;
    call("", "POST", {
      service: "roadLedgerService",
      action: "getRoadLedgerExistingDefineLayerIds",
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const ids = data?.ids;
        setExistingDocLayerIds(
          new Set(
            Array.isArray(ids) ? ids.map((x: string) => String(x).trim().toLowerCase()).filter(Boolean) : []
          )
        );
      })
      .catch(() => {
        if (cancelled) return;
        setExistingDocLayerIds(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!setVisibleLayerNames || existingDocLayerIds == null) return;
    const allConfigured = new Set(getAllRoadLedgerDocLayerIds());
    setVisibleLayerNames((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const name of prev) {
        const ln = name.toLowerCase();
        if (allConfigured.has(ln) && !existingDocLayerIds.has(ln)) {
          next.delete(name);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [existingDocLayerIds, setVisibleLayerNames]);

  const roadName = str(pickRoadLedgerField(row, "road_name"));
  const rdid = str(pickRoadLedgerField(row, "rdid"));
  const hasRdidForFacility = rdid.length >= ROAD_LEDGER_RDID_MIN_LEN_FOR_FACILITY_JOIN;

  const titleParen = formatRoadLedgerDetailTitleParen(
    pickRoadLedgerField(row, "road_rank"),
    pickRoadLedgerField(row, "road_no"),
    pickRoadLedgerField(row, "sect")
  );

  useEffect(() => {
    if (!hasRdidForFacility) {
      setFacilityDataCounts(null);
      setFacilityCountsLoading(false);
      return;
    }
    let cancelled = false;
    setFacilityCountsLoading(true);
    call("", "POST", {
      service: "roadLedgerService",
      action: "getRoadLedgerFacilityGroupDataCounts",
      params: { rdid },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const counts = data?.counts as Partial<Record<RoadLedgerDocButtonKey, number>> | undefined;
        setFacilityDataCounts(counts && typeof counts === "object" ? counts : {});
        setFacilityCountsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFacilityDataCounts(null);
        setFacilityCountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasRdidForFacility, rdid]);

  const otherEntries = Object.entries(row)
    .filter(([k]) => k.toLowerCase() !== "geom")
    .filter(([k]) => !PRIMARY_ATTR_KEYS.has(k.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b, "ko"))
    .map(([key, val]) => ({
      fieldKey: key,
      label: key,
      value: cellText(key, val),
    }));

  return (
    <div className="flex w-full min-w-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold leading-snug text-slate-800">
            {roadName || "—"}
            {titleParen ? <span className="font-medium text-slate-600"> {titleParen}</span> : null}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex w-full min-w-0 flex-col">
        <div className="shrink-0 border-slate-200 px-3 py-2 pb-0 bg-white">
          <div className="space-y-3">
            <RoadLedgerDocActionGrid
              items={DOC_ACTION_BUTTONS_PRIMARY}
              gridClassName="grid-cols-5"
              visibleLayerNames={visibleLayerNames}
              setVisibleLayerNames={setVisibleLayerNames}
              onDocClick={handleDocButtonClick}
              getLayersForKey={getEffectiveDocLayers}
              facilityDataCounts={facilityDataCounts}
              facilityCountsLoading={facilityCountsLoading}
              hasRdidForFacility={hasRdidForFacility}
            />
            <RoadLedgerDocActionGrid
              items={DOC_ACTION_BUTTONS_REST}
              gridClassName="grid-cols-4"
              visibleLayerNames={visibleLayerNames}
              setVisibleLayerNames={setVisibleLayerNames}
              onDocClick={handleDocButtonClick}
              getLayersForKey={getEffectiveDocLayers}
              facilityDataCounts={facilityDataCounts}
              facilityCountsLoading={facilityCountsLoading}
              hasRdidForFacility={hasRdidForFacility}
            />
          </div>
        </div>

        <div className="border-slate-200 p-3 pt-0">
          <div className="mt-3 border-t border-slate-200">
            <div className="flex items-center justify-between gap-2 mt-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left transition-colors hover:bg-slate-50"
                onClick={() => setAttrOpen(!attrOpen)}
              >
                {attrOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                )}
                <span className="text-[12px] font-semibold text-[#666]">속성정보</span>
              </button>
              {otherEntries.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setDetailModalOpen(true)}
                  className="shrink-0 border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                >
                  상세정보
                </button>
              ) : null}
            </div>
            {attrOpen ? (
              <div className="mt-2 px-0 pb-1">
                <div className="overflow-hidden border border-slate-200">
                  {PRIMARY_TABLE_ROWS.map(({ field, label }, idx) => {
                    const raw = pickRoadLedgerField(row, field);
                    const display = primaryCellDisplay(field, raw);
                    return (
                      <div
                        key={field}
                        className={`flex ${idx !== PRIMARY_TABLE_ROWS.length - 1 ? "border-b border-slate-200" : ""}`}
                      >
                        <div className="w-[130px] shrink-0 bg-slate-100 px-2.5 py-1.5 text-[11px] text-[#666]">{label}</div>
                        <div className="min-w-0 flex-1 px-2.5 py-1.5 text-[11px] text-[#666] break-all">{display}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
            <DialogContent
              showCloseButton
              className="!flex max-h-[min(85vh,720px)] w-[min(36rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden rounded-[5px] p-0 sm:max-w-none"
            >
              <DialogHeader className="shrink-0 border-b border-slate-200 px-4 py-3 text-left">
                <DialogTitle className="text-base font-semibold text-slate-800">상세정보</DialogTitle>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
                <DetailInfoTable entries={otherEntries} />
              </div>
            </DialogContent>
          </Dialog>

          <RoadLedgerFacilityListSection
            row={row}
            visibleLayerNames={visibleLayerNames}
            getLayersForGroup={getEffectiveDocLayers}
          />
        </div>
      </div>
    </div>
  );
}
