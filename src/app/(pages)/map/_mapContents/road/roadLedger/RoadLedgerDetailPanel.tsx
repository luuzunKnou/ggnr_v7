"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  DraftingCompass,
  FileText,
  Layers,
  LayoutGrid,
  Loader2,
  Map,
  Package,
  Shield,
  Video,
  Warehouse,
  Waves,
  X,
} from "lucide-react";
import { call } from "@/lib/api";
import { appFetch } from "@/lib/basePath";
import { recordDataViewLog } from "@/lib/recordDataViewLog";
import { SER_FILE_ENG } from "@/lib/serviceFileDataSerEng";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog";
import { MapSideDetailScroll } from "../../../_mapComponents/MapSideDetailScroll";
import { useMapContext, type MapContextValue } from "../../../_mapComponents/MapContext";
import {
  ServiceFilePdfPreview,
  type ServiceFilePdfPreviewItem,
} from "../../../_mapComponents/standard/ServiceFilePdfPreview";
import {
  isPdfServiceFileName,
  serviceFileDataDownloadUrl,
} from "../../../_mapComponents/standard/useServiceFileData";
import {
  formatRoadLedgerAttrValue,
  formatRoadLedgerDsgdateDisplay,
  formatRoadLedgerDetailTitleParen,
  formatRoadLedgerLenthWithUnit,
  formatRoadLedgerNumericToken,
  formatRoadLedgerRoadRankDisplay,
  pickRoadLedgerField,
  pickRoadLedgerOgcFid,
} from "./roadLedgerFormat";
import {
  getAllRoadLedgerDocLayerIds,
  isRoadLedgerDocGroupActive,
  ROAD_LEDGER_DOC_LAYERS,
  ROAD_LEDGER_DOC_LABELS_WITH_LAYER_COUNT,
  ROAD_LEDGER_RDID_MIN_LEN_FOR_FACILITY_JOIN,
  ROAD_LEDGER_SUMMARY_LAYER_ID,
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
    <div className={cn("flex", showBottomBorder && "border-b border-border")}>
      <div
        className={cn(
          "flex min-w-0 shrink-0 items-start bg-muted px-2 py-1.5",
          labelClassName,
        )}
      >
        <span className="min-w-0 w-full whitespace-normal break-words text-[11px] leading-snug text-muted-foreground">
          {field.label}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 items-start px-2 py-1.5">
        <span className="break-all text-[11px] leading-snug text-muted-foreground">{field.value}</span>
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
    return <p className="text-[11px] text-muted-foreground">표시할 항목이 없습니다.</p>;
  }

  const mid = Math.ceil(entries.length / 2);
  const leftCol = entries.slice(0, mid);
  const rightCol = entries.slice(mid);
  const labelW = "w-[min(5.5rem,32%)]";

  if (entries.length === 1) {
    const field = entries[0]!;
    return (
      <div className="overflow-hidden rounded-[5px] border border-border">
        <DetailInfoRow field={field} showBottomBorder={false} labelClassName="w-[100px]" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 divide-x divide-border overflow-hidden rounded-[5px] border border-border">
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
  reportPdfLoading,
  reportPdfActive,
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
  reportPdfLoading: boolean;
  reportPdfActive: boolean;
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
                ? "보고서 PDF 보기"
                : hasLayers
                  ? "클릭: 해당 공간정보 레이어 켜기 / 다시 클릭: 끄기"
                  : "연결 레이어 없음"
            }
            onClick={() => onDocClick(label)}
            disabled={isReportOnly ? reportPdfLoading : !setVisibleLayerNames}
            className={cn(
              "h-7 text-[11px] rounded border min-w-0 inline-flex items-center justify-center gap-0.5 px-1 leading-none whitespace-nowrap",
              !isReportOnly && !setVisibleLayerNames && "pointer-events-none opacity-50",
              isReportOnly
                ? reportPdfActive
                  ? "border-primary/45 bg-primary/[0.08] text-foreground ring-1 ring-inset ring-primary/15 hover:bg-primary/[0.11]"
                  : "border-border bg-muted/50 text-foreground/90 hover:bg-muted"
                : hasLayers
                  ? active
                    ? "border-primary/45 bg-primary/[0.08] text-foreground ring-1 ring-inset ring-primary/15 hover:bg-primary/[0.11]"
                    : "border-border bg-muted/50 text-foreground/90 hover:bg-muted"
                  : "border-border bg-muted/50 text-muted-foreground hover:bg-muted",
            )}
          >
            {isReportOnly && reportPdfLoading ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
            ) : (
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 truncate [word-break:keep-all]">{displayLabel}</span>
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
  const [reportPdfPreview, setReportPdfPreview] = useState<{
    items: ServiceFilePdfPreviewItem[];
    initialIndex: number;
  } | null>(null);
  const [reportPdfLoading, setReportPdfLoading] = useState(false);
  const reportPdfBusyRef = useRef(false);
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

  const openReportPdfViewer = useCallback(async () => {
    if (reportPdfBusyRef.current) return;
    const ogcFid = pickRoadLedgerOgcFid(row);
    if (ogcFid == null) {
      window.alert("노선을 선택하세요.");
      return;
    }
    reportPdfBusyRef.current = true;
    setReportPdfLoading(true);
    try {
      const qs = new URLSearchParams({
        serEng: SER_FILE_ENG.roadLedger,
        layer: ROAD_LEDGER_SUMMARY_LAYER_ID,
        key: String(ogcFid),
      });
      const res = await appFetch(`/api/service-files?${qs.toString()}`, { credentials: "include" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(typeof j.error === "string" ? j.error : "목록을 불러오지 못했습니다.");
      }
      const data = (await res.json()) as { files?: { name: string }[] };
      const files = Array.isArray(data.files) ? data.files : [];
      const items: ServiceFilePdfPreviewItem[] = files
        .filter((f) => isPdfServiceFileName(f.name))
        .map((f) => ({
          url: serviceFileDataDownloadUrl(
            SER_FILE_ENG.roadLedger,
            ROAD_LEDGER_SUMMARY_LAYER_ID,
            ogcFid,
            f.name
          ),
          fileName: f.name,
        }));
      if (items.length === 0) {
        window.alert("보고서 PDF가 없습니다.");
        return;
      }
      setReportPdfPreview({ items, initialIndex: 0 });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "보고서를 불러오지 못했습니다.");
    } finally {
      reportPdfBusyRef.current = false;
      setReportPdfLoading(false);
    }
  }, [row]);

  const handleDocButtonClick = useCallback(
    (key: RoadLedgerDocButtonKey) => {
      if (key === "보고서") {
        void openReportPdfViewer();
        return;
      }
      const layers = getEffectiveDocLayers(key);
      if (layers.length === 0) {
        window.alert("해당 항목에 연결된 공간정보 레이어가 아직 없습니다. (준비 중)");
        return;
      }
      if (!setVisibleLayerNames) return;
      setVisibleLayerNames((prev) => toggleRoadLedgerDocLayers(prev, layers));
    },
    [getEffectiveDocLayers, setVisibleLayerNames, openReportPdfViewer]
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
    <>
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold leading-snug text-foreground">
            {roadName || "—"}
            {titleParen ? <span className="font-medium text-muted-foreground"> {titleParen}</span> : null}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-border bg-background px-3 py-2 pb-0">
          <div className="space-y-1.5">
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
              reportPdfLoading={reportPdfLoading}
              reportPdfActive={reportPdfPreview != null}
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
              reportPdfLoading={reportPdfLoading}
              reportPdfActive={reportPdfPreview != null}
            />
          </div>
        </div>

        <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto border-border p-3 pt-0">
          <div className="mt-3 border-t border-border">
            <div className="flex items-center justify-between gap-2 mt-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left transition-colors hover:bg-muted/50"
                onClick={() => setAttrOpen(!attrOpen)}
              >
                {attrOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="text-[12px] font-semibold text-muted-foreground">속성정보</span>
              </button>
              {otherEntries.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setDetailModalOpen(true)}
                  className="shrink-0 border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground/90 shadow-sm transition-colors hover:bg-muted/50"
                >
                  상세정보
                </button>
              ) : null}
            </div>
            {attrOpen ? (
              <div className="mt-2 px-0 pb-1">
                <div className="overflow-hidden border border-border">
                  {PRIMARY_TABLE_ROWS.map(({ field, label }, idx) => {
                    const raw = pickRoadLedgerField(row, field);
                    const display = primaryCellDisplay(field, raw);
                    return (
                      <div
                        key={field}
                        className={`flex ${idx !== PRIMARY_TABLE_ROWS.length - 1 ? "border-b border-border" : ""}`}
                      >
                        <div className="w-[130px] shrink-0 bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground">{label}</div>
                        <div className="min-w-0 flex-1 px-2.5 py-1.5 text-[11px] text-muted-foreground break-all">{display}</div>
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
              <DialogHeader className="shrink-0 border-b border-border px-4 py-3 text-left">
                <DialogTitle className="text-base font-semibold text-foreground">상세정보</DialogTitle>
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
        </MapSideDetailScroll>
      </div>
    </div>
    {reportPdfPreview != null && (
      <ServiceFilePdfPreview
        items={reportPdfPreview.items}
        initialIndex={reportPdfPreview.initialIndex}
        onClose={() => setReportPdfPreview(null)}
      />
    )}
    </>
  );
}
