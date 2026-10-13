"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, FileImage, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SER_FILE_ENG } from "@/lib/serviceFileDataSerEng";
import {
  isImageServiceFileName,
  isPdfServiceFileName,
  serviceFileDataDownloadUrl,
  useServiceFileData,
} from "../../../_mapComponents/standard/useServiceFileData";
import { ServiceFilePdfThumb } from "../../../_mapComponents/standard/ServiceFilePdfThumb";
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from "../../../_mapComponents/standard/ServiceFileImagePreview";
import { MapSideDetailScroll } from "../../../_mapComponents/MapSideDetailScroll";
import { formatRoadLedgerAttrValue, pickRoadLedgerField, pickRoadLedgerOgcFid } from "./roadLedgerFormat";
import {
  fetchRoadLedgerDrawingFieldInfo,
  type RoadLedgerDrawingFieldInfo,
} from "./roadLedgerDrawingFields";
import { ROAD_LEDGER_DRAWING_FILE_KEY_FIELD } from "./roadLedgerDocLayerMap";

/** 색인도 썸네일과 같은 비율 (가로 3 : 세로 2) */
const THUMB_FRAME = "relative w-full aspect-[3/2] overflow-hidden bg-muted";
const GEOM_LIKE = new Set(["geom", "geometry", "the_geom", "wkb_geometry", "shape"]);
const SYSTEM_FILE_NAMES = new Set(["thumbs.db", "desktop.ini", ".ds_store"]);
const PAGE_SIZE = 12;

function isVisibleAttachment(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n !== "" && !n.startsWith(".") && !SYSTEM_FILE_NAMES.has(n) && !n.endsWith(".tmp");
}

export type RoadLedgerDrawingTable = {
  defineTableName: string;
  title: string;
  rows: Record<string, unknown>[];
  total: number;
  error?: string;
};

type Props = {
  table: RoadLedgerDrawingTable;
  /** 이 레이어에서 선택된 도면(전 컬럼). 덮개 상세로 표시 */
  selectedRow: Record<string, unknown> | null;
  /** 상세를 덮어 그릴 영역(속성정보·목록 전체) */
  overlayHost?: HTMLElement | null;
  /** 선택 조회 중인 ogc_fid */
  busyOgcFid: number | null;
  onSelect: (row: Record<string, unknown>) => void;
  onBack: () => void;
};

function useDrawingFieldInfo(defineTableName: string): RoadLedgerDrawingFieldInfo | null {
  const [state, setState] = useState<{ table: string; info: RoadLedgerDrawingFieldInfo } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchRoadLedgerDrawingFieldInfo(defineTableName).then((info) => {
      if (!cancelled) setState({ table: defineTableName, info });
    });
    return () => {
      cancelled = true;
    };
  }, [defineTableName]);
  return state?.table === defineTableName ? state.info : null;
}

function rowKeyText(row: Record<string, unknown>): string {
  return String(pickRoadLedgerField(row, ROAD_LEDGER_DRAWING_FILE_KEY_FIELD) ?? "").trim();
}

const TH_CLASS =
  "border-b border-border px-2.5 py-1.5 align-middle font-normal text-muted-foreground";

export function RoadLedgerDrawingSection({
  table,
  selectedRow,
  overlayHost = null,
  busyOgcFid,
  onSelect,
  onBack,
}: Props) {
  const fieldInfo = useDrawingFieldInfo(table.defineTableName);
  const [page, setPage] = useState(1);

  const items = useMemo(() => {
    return table.rows
      .map((row) => ({ row, ogc: pickRoadLedgerOgcFid(row), label: rowKeyText(row) }))
      .sort((a, b) =>
        a.label && b.label
          ? a.label.localeCompare(b.label, "ko", { numeric: true })
          : (a.ogc ?? 0) - (b.ogc ?? 0)
      );
  }, [table.rows]);

  const columns = useMemo(() => {
    const listFields = fieldInfo?.listFields ?? [];
    if (listFields.length > 0) return listFields;
    return [
      {
        name: ROAD_LEDGER_DRAWING_FILE_KEY_FIELD,
        label: fieldInfo?.labels[ROAD_LEDGER_DRAWING_FILE_KEY_FIELD] || "분할코드",
      },
    ];
  }, [fieldInfo]);

  const selectedOgc = selectedRow ? pickRoadLedgerOgcFid(selectedRow) : null;
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));

  /** 지도에서 고른 도면이 다른 페이지에 있으면 그 페이지로 이동 */
  const [appliedSelectedOgc, setAppliedSelectedOgc] = useState<number | null>(null);
  if (selectedOgc !== appliedSelectedOgc) {
    setAppliedSelectedOgc(selectedOgc);
    const idx = selectedOgc == null ? -1 : items.findIndex((it) => it.ogc === selectedOgc);
    if (idx >= 0) setPage(Math.floor(idx / PAGE_SIZE) + 1);
  }

  const safePage = Math.min(page, pageCount);
  const pagedItems = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (table.error) {
    return <p className="px-2 py-1.5 text-[11px] text-destructive">{table.error}</p>;
  }
  if (items.length === 0) {
    return <p className="px-2 py-1.5 text-[11px] text-muted-foreground">표시할 도면이 없습니다.</p>;
  }

  return (
    <div className="flex flex-1 flex-col gap-2 p-1.5 text-[11px]">
      <div className="flex-1 overflow-x-auto border border-border">
        <table className="w-full border-collapse whitespace-nowrap text-left">
          <thead className="bg-muted">
            <tr>
              <th className={cn(TH_CLASS, "w-[2.5rem] text-center")}>No</th>
              {columns.map((c) => (
                <th key={c.name} className={TH_CLASS}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagedItems.map(({ row, ogc }, i) => {
              const no = (safePage - 1) * PAGE_SIZE + i + 1;
              const isSelected = ogc != null && ogc === selectedOgc;
              const busy = ogc != null && busyOgcFid === ogc;
              const select = () => (isSelected ? onBack() : onSelect(row));
              return (
                <tr
                  key={ogc ?? `i${no}`}
                  role="button"
                  tabIndex={0}
                  aria-selected={isSelected}
                  onClick={select}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      select();
                    }
                  }}
                  className={cn(
                    "cursor-pointer border-b border-border transition-colors",
                    isSelected ? "bg-muted" : "hover:bg-muted/50",
                    busy && "pointer-events-none opacity-60"
                  )}
                >
                  <td className="px-2 py-1.5 text-center align-middle tabular-nums text-muted-foreground">
                    {busy ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" aria-hidden /> : no}
                  </td>
                  {columns.map((c) => {
                    const text = formatRoadLedgerAttrValue(c.name, pickRoadLedgerField(row, c.name)) || "—";
                    return (
                      <td
                        key={c.name}
                        className="max-w-[16rem] truncate px-2.5 py-1.5 align-middle text-muted-foreground"
                        title={text}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-2 px-0.5">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="이전 페이지"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            이전
          </button>
          <span className="tabular-nums text-muted-foreground">
            {safePage} / {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="다음 페이지"
          >
            다음
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

      {selectedRow
        ? (() => {
            const detail = (
              <RoadLedgerDrawingDetail
                table={table}
                row={selectedRow}
                fieldInfo={fieldInfo}
                onBack={onBack}
              />
            );
            return overlayHost ? createPortal(detail, overlayHost) : null;
          })()
        : null}
    </div>
  );
}

function RoadLedgerDrawingDetail({
  table,
  row,
  fieldInfo,
  onBack,
}: {
  table: RoadLedgerDrawingTable;
  row: Record<string, unknown>;
  fieldInfo: RoadLedgerDrawingFieldInfo | null;
  onBack: () => void;
}) {
  const layer = table.defineTableName;
  const keyValue = rowKeyText(row) || null;
  const serEng = SER_FILE_ENG.roadLedger;
  const [preview, setPreview] = useState<{ items: ServiceFilePreviewItem[]; initialIndex: number } | null>(
    null
  );

  const fileQuery = useServiceFileData({
    serEng,
    enabled: keyValue != null,
    layerSegment: layer,
    keyValue,
  });
  const files = useMemo(
    () => fileQuery.files.filter((f) => isVisibleAttachment(f.name)),
    [fileQuery.files]
  );

  const galleryItems = useMemo((): ServiceFilePreviewItem[] => {
    if (keyValue == null) return [];
    return files
      .filter((f) => isImageServiceFileName(f.name) || isPdfServiceFileName(f.name))
      .map((f) => ({
        url: serviceFileDataDownloadUrl(serEng, layer, keyValue, f.name),
        fileName: f.name,
        kind: isPdfServiceFileName(f.name) ? ("pdf" as const) : ("image" as const),
      }));
  }, [files, keyValue, layer, serEng]);

  const thumb = useMemo(() => {
    const img = files.find((f) => isImageServiceFileName(f.name));
    if (img) return { kind: "image" as const, name: img.name };
    const pdf = files.find((f) => isPdfServiceFileName(f.name));
    if (pdf) return { kind: "pdf" as const, name: pdf.name };
    return null;
  }, [files]);

  const openFile = (fileName: string) => {
    const idx = galleryItems.findIndex((g) => g.fileName === fileName);
    if (idx >= 0) setPreview({ items: galleryItems, initialIndex: idx });
  };

  const entries = useMemo(() => {
    const defs = fieldInfo?.detailFields ?? [];
    const list =
      defs.length > 0
        ? defs.map((f) => ({ key: f.name, label: f.label }))
        : Object.keys(row)
            .filter((k) => !GEOM_LIKE.has(k.toLowerCase()))
            .map((k) => ({ key: k, label: k }));
    return list.map((f) => ({
      ...f,
      value: formatRoadLedgerAttrValue(f.key, pickRoadLedgerField(row, f.key)) || "—",
    }));
  }, [fieldInfo, row]);

  const thumbState = keyValue == null ? "분할코드 값 없음" : (fileQuery.error ?? undefined);

  return (
    <MapSideDetailScroll className="absolute inset-0 overflow-auto bg-background p-3 pt-0">
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border py-2">
        <p className="text-[12px] font-semibold text-muted-foreground">{table.title}</p>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          title={`${table.title} 목록으로`}
          aria-label={`${table.title} 목록으로`}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-muted">
        <div className={THUMB_FRAME} title={thumbState}>
          {keyValue == null || fileQuery.error ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <FileImage className="h-16 w-16 text-muted-foreground opacity-50" aria-hidden />
            </div>
          ) : fileQuery.loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : thumb == null ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
              <FileImage className="h-12 w-12 text-muted-foreground opacity-50" aria-hidden />
              <span className="text-[11px] text-muted-foreground">첨부 도면이 없습니다.</span>
            </div>
          ) : thumb.kind === "image" ? (
            <button
              type="button"
              className="absolute inset-0 flex cursor-zoom-in items-center justify-center border-0 bg-white p-3"
              onClick={() => openFile(thumb.name)}
              aria-label="도면 전체화면 보기"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={serviceFileDataDownloadUrl(serEng, layer, keyValue, thumb.name)}
                alt=""
                className="pointer-events-none block max-h-full max-w-full border border-neutral-800 bg-white object-contain"
              />
            </button>
          ) : (
            <button
              type="button"
              className="absolute inset-0 block cursor-zoom-in border-0 bg-foreground p-0"
              onClick={() => openFile(thumb.name)}
              aria-label="PDF 전체화면 보기"
            >
              <ServiceFilePdfThumb
                serEng={serEng}
                layerSegment={layer}
                keyValue={keyValue}
                fileName={thumb.name}
                thumbMaxPx={960}
                unboxed
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            </button>
          )}
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[12px] font-semibold text-muted-foreground">속성정보</p>
        {entries.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">표시할 속성이 없습니다.</p>
        ) : (
          <div className="overflow-hidden border border-border">
            {entries.map((e, idx) => (
              <div
                key={e.key}
                className={cn("flex", idx !== entries.length - 1 && "border-b border-border")}
              >
                <div className="w-[130px] shrink-0 bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  {e.label}
                </div>
                <div className="min-w-0 flex-1 break-all px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  {e.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {preview != null ? (
        <ServiceFileImagePreview
          items={preview.items}
          initialIndex={preview.initialIndex}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </MapSideDetailScroll>
  );
}
