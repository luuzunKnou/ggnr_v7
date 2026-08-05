"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { getLegendUrl } from "../../../_mapComponents/hooks/useFeatureIdentify";
import {
  isRoadLedgerDocGroupActive,
  ROAD_LEDGER_DOC_LABELS_WITH_LAYER_COUNT,
  ROAD_LEDGER_RDID_MIN_LEN_FOR_FACILITY_JOIN,
  type RoadLedgerDocButtonKey,
} from "./roadLedgerDocLayerMap";
import { pickRoadLedgerField, pickRoadLedgerOgcFid } from "./roadLedgerFormat";
import {
  formatRoadLedgerFacilityCellValue,
  getRoadLedgerFacilityColumnKeys,
} from "./roadLedgerTableDisplayFields";

/** 시설 테이블당 목록에서 먼저 보여 줄 행 수 — 이후 더보기로 전체 */
const FACILITY_LIST_PREVIEW_ROWS = 5;
/** 더보기(전체 행) 시 테이블 영역 최대 높이 — 패널 전체가 무한히 늘어나지 않도록 */
const FACILITY_LIST_EXPANDED_MAX_H = "max-h-64";

function facilityTableExpandKey(groupKey: string, defineTableName: string): string {
  return `${groupKey}::${defineTableName}`;
}

type FacilitySection = {
  groupKey: string;
  tables: {
    defineTableName: string;
    title: string;
    rows: Record<string, unknown>[];
    total: number;
    error?: string;
  }[];
};

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

type Props = {
  row: Record<string, unknown>;
  visibleLayerNames: Set<string>;
  /** DB에 존재하는 define 레이어만 포함한 그룹별 id 목록 */
  getLayersForGroup: (key: RoadLedgerDocButtonKey) => string[];
};

export function RoadLedgerFacilityListSection({
  row,
  visibleLayerNames,
  getLayersForGroup,
}: Props) {
  const mapContext = useMapContext();
  const visibleLayerKey = useMemo(
    () => JSON.stringify([...visibleLayerNames].sort()),
    [visibleLayerNames]
  );

  const activeFacilityGroups = useMemo(() => {
    let names: string[] = [];
    try {
      names = JSON.parse(visibleLayerKey) as string[];
    } catch {
      names = [];
    }
    const vis = new Set(names);
    return ROAD_LEDGER_DOC_LABELS_WITH_LAYER_COUNT.filter((g) =>
      isRoadLedgerDocGroupActive(vis, getLayersForGroup(g))
    );
  }, [visibleLayerKey, getLayersForGroup]);

  const rdid = str(pickRoadLedgerField(row, "rdid"));
  const hasRdidForFacilityList = rdid.length >= ROAD_LEDGER_RDID_MIN_LEN_FOR_FACILITY_JOIN;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<FacilitySection[]>([]);
  const [loadingFacilityRowKey, setLoadingFacilityRowKey] = useState<string | null>(null);
  const [expandedFacilityTableKeys, setExpandedFacilityTableKeys] = useState<Set<string>>(
    () => new Set()
  );

  const handleFacilityRowClick = useCallback(
    async (defineTableName: string, tableTitle: string, facilityRow: Record<string, unknown>) => {
      const ogcRaw = pickRoadLedgerField(facilityRow, "ogc_fid");
      const ogc = typeof ogcRaw === "string" ? parseInt(ogcRaw, 10) : Number(ogcRaw);
      if (!mapContext?.setRoadLedgerFacilityModal || !Number.isFinite(ogc) || ogc <= 0) return;
      const rowKey = `${defineTableName}:${ogc}`;
      setLoadingFacilityRowKey(rowKey);
      try {
        const res = await call("", "POST", {
          service: "roadLedgerService",
          action: "getRoadLedgerFacilityFeatureByOgcFid",
          params: { defineTableName, ogcFid: ogc },
        });
        const data = res?.data ?? res;
        const fullRow = data?.row as Record<string, unknown> | null | undefined;
        const kor = String(data?.defineTableKorName ?? "").trim();
        if (fullRow && typeof fullRow === "object") {
          mapContext.setRoadLedgerFacilityModal({
            row: fullRow,
            defineTableName,
            defineTableTitle: kor || tableTitle,
            pickFromMap: false,
          });
        }
      } catch {
        // 상세 모달만 생략
      } finally {
        setLoadingFacilityRowKey(null);
      }
    },
    [mapContext]
  );

  const activeGroupsKey = useMemo(() => activeFacilityGroups.join("|"), [activeFacilityGroups]);

  const [selectedTabKey, setSelectedTabKey] = useState<RoadLedgerDocButtonKey | null>(null);

  useEffect(() => {
    setExpandedFacilityTableKeys(new Set());
  }, [selectedTabKey, activeGroupsKey, rdid]);

  const prevActiveFacilityGroupsRef = useRef<readonly RoadLedgerDocButtonKey[]>([]);

  useEffect(() => {
    const prev = prevActiveFacilityGroupsRef.current;
    const prevSet = new Set(prev);
    const added = activeFacilityGroups.filter((g) => !prevSet.has(g));

    if (activeFacilityGroups.length === 0) {
      setSelectedTabKey(null);
      prevActiveFacilityGroupsRef.current = activeFacilityGroups;
      return;
    }

    /** 상단 시설 버튼으로 레이어를 켜서 탭이 하나 새로 생긴 경우 → 그 탭 활성화 */
    if (added.length === 1) {
      setSelectedTabKey(added[0]!);
      prevActiveFacilityGroupsRef.current = activeFacilityGroups;
      return;
    }

    setSelectedTabKey((prevKey) =>
      prevKey && activeFacilityGroups.includes(prevKey) ? prevKey : activeFacilityGroups[0]!
    );
    prevActiveFacilityGroupsRef.current = activeFacilityGroups;
  }, [activeGroupsKey, activeFacilityGroups]);

  useEffect(() => {
    if (activeFacilityGroups.length === 0) {
      setSections([]);
      setError(null);
      setLoading(false);
      return;
    }
    if (!hasRdidForFacilityList) {
      setSections([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    call("", "POST", {
      service: "roadLedgerService",
      action: "getRoadLedgerFacilityFilteredLists",
      params: {
        rdid,
        activeFacilityGroups,
      },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const err = typeof data?.error === "string" ? data.error : null;
        const secs = Array.isArray(data?.sections) ? (data.sections as FacilitySection[]) : [];
        setSections(secs);
        setError(err);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setSections([]);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rdid, hasRdidForFacilityList, activeGroupsKey, activeFacilityGroups]);

  const selectedSection = useMemo(
    () => (selectedTabKey ? sections.find((s) => s.groupKey === selectedTabKey) : undefined),
    [sections, selectedTabKey]
  );

  const facilityModal = mapContext?.roadLedgerFacilityModal ?? null;
  const modalTableLc = facilityModal?.defineTableName
    ? String(facilityModal.defineTableName).trim().toLowerCase()
    : null;
  const modalOgc = facilityModal ? pickRoadLedgerOgcFid(facilityModal.row) : null;

  if (activeFacilityGroups.length === 0) {
    return (
      <div className="mt-3 border-t border-slate-200 pt-3">
        <p className="text-[11px] leading-relaxed text-slate-500">
          주요시설~기타시설 구분을 켜면, 하위 시설 목록이 여기에 표시됩니다.
        </p>
      </div>
    );
  }

  if (!hasRdidForFacilityList) {
    return (
      <div className="mt-3 border-t border-slate-200 pt-3">
        <p className="text-[11px] text-amber-700">
          RDID가 없거나 {ROAD_LEDGER_RDID_MIN_LEN_FOR_FACILITY_JOIN}자 미만이면 시설 목록을 불러올 수 없습니다.
          (레이어 3자 제외 4~19번째·16자로 조인)
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <div className="flex flex-col gap-0">
        <div
          className="-mx-0 flex flex-wrap gap-0.5 border-b border-slate-200"
          role="tablist"
          aria-label="시설 구분"
        >
          {activeFacilityGroups.map((key) => {
            const isSel = selectedTabKey === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={isSel}
                onClick={() => setSelectedTabKey(key)}
                className={cn(
                  "relative shrink-0 border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                  isSel
                    ? "z-[1] -mb-px border-slate-200 border-b-white bg-white font-semibold text-primary"
                    : "border-transparent bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-800",
                )}
              >
                {key}
              </button>
            );
          })}
        </div>

        <div
          className="min-h-[4rem] border border-t-0 border-slate-200 bg-white p-1"
          role="tabpanel"
        >
          {loading ? (
            <p className="px-2 text-[11px] text-slate-500">불러오는 중…</p>
          ) : error ? (
            <p className="px-2 text-[11px] text-red-600">{error}</p>
          ) : !selectedTabKey ? (
            <p className="px-2 text-[11px] text-slate-500">구분을 선택해 주세요.</p>
          ) : !selectedSection || selectedSection.tables.length === 0 ? (
            <p className="px-2 text-[11px] text-slate-500">해당 구분에 표시할 시설 데이터가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {selectedSection.tables.map((t) => {
                const columnKeys =
                  t.rows.length > 0 ? getRoadLedgerFacilityColumnKeys(t.defineTableName, t.rows[0]!) : [];
                const tableExpandKey = facilityTableExpandKey(
                  selectedSection.groupKey,
                  t.defineTableName
                );
                const tableExpanded = expandedFacilityTableKeys.has(tableExpandKey);
                const displayRows = tableExpanded
                  ? t.rows
                  : t.rows.slice(0, FACILITY_LIST_PREVIEW_ROWS);
                const moreRowCount = Math.max(0, t.rows.length - FACILITY_LIST_PREVIEW_ROWS);
                return (
                  <div
                    key={`${selectedSection.groupKey}-${t.defineTableName}`}
                    className="overflow-hidden rounded border border-slate-200 bg-white"
                  >
                    <div className="flex min-w-0 items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-2 py-1.5">
                      <img
                        src={getLegendUrl(t.defineTableName)}
                        alt=""
                        width={20}
                        height={20}
                        className="h-5 w-5 shrink-0 object-contain"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                      <span className="min-w-0 text-[11px] font-medium text-slate-800">{t.title}</span>
                      <span className="shrink-0 text-[10px] text-slate-500">
                        {t.defineTableName}
                        {typeof t.total === "number" ? ` · ${t.total}건` : ""}
                      </span>
                    </div>
                    {t.error ? (
                      <div className="px-2 py-1.5 text-[11px] text-red-600">{t.error}</div>
                    ) : columnKeys.length === 0 ? (
                      <p className="px-2 py-1.5 text-[11px] text-slate-500">표시할 속성이 없습니다.</p>
                    ) : (
                      <>
                        <div
                          className={cn(
                            "max-w-full overflow-x-auto",
                            tableExpanded && `${FACILITY_LIST_EXPANDED_MAX_H} overflow-y-auto overscroll-contain`,
                          )}
                        >
                        <table className="w-max min-w-full border-collapse text-left text-[10px] text-slate-700">
                          <thead className={tableExpanded ? "sticky top-0 z-[1]" : undefined}>
                            <tr className="border-b border-slate-200 bg-slate-100">
                              {columnKeys.map((col) => (
                                <th
                                  key={col}
                                  scope="col"
                                  className="max-w-[7.5rem] min-w-0 whitespace-normal break-words px-1.5 py-1 text-left align-top font-medium leading-tight text-slate-700"
                                >
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                          {displayRows.map((r, rowIdx) => {
                            const ogcRaw = pickRoadLedgerField(r, "ogc_fid");
                            const ogcNum =
                              typeof ogcRaw === "string" ? parseInt(ogcRaw, 10) : Number(ogcRaw);
                            const rowKey =
                              Number.isFinite(ogcNum) && ogcNum > 0
                                ? `${t.defineTableName}:${ogcNum}`
                                : `${t.defineTableName}:i${rowIdx}`;
                            const rowBusy = loadingFacilityRowKey === rowKey;
                            const tableLc = String(t.defineTableName).trim().toLowerCase();
                            const isModalRow =
                              modalTableLc != null &&
                              modalOgc != null &&
                              modalOgc > 0 &&
                              Number.isFinite(ogcNum) &&
                              ogcNum > 0 &&
                              modalTableLc === tableLc &&
                              modalOgc === Math.floor(ogcNum);
                            return (
                            <tr
                              key={rowKey}
                              role="button"
                              tabIndex={0}
                              className={cn(
                                "cursor-pointer border-b border-slate-100 align-middle transition-colors hover:bg-primary/5",
                                !isModalRow && rowIdx % 2 === 1 && "bg-slate-50/60",
                                isModalRow &&
                                  "bg-primary/[0.12] ring-1 ring-inset ring-primary/25 hover:bg-primary/[0.16]",
                                rowBusy && "pointer-events-none opacity-60",
                              )}
                              onClick={() => void handleFacilityRowClick(t.defineTableName, t.title, r)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  void handleFacilityRowClick(t.defineTableName, t.title, r);
                                }
                              }}
                            >
                                {columnKeys.map((col) => (
                                  <td
                                    key={col}
                                    className="max-w-none whitespace-nowrap px-1.5 py-1"
                                  >
                                    {formatRoadLedgerFacilityCellValue(col, r)}
                                  </td>
                              ))}
                            </tr>
                            );
                          })}
                          </tbody>
                        </table>
                        </div>
                        {moreRowCount > 0 && (
                          <div className="flex justify-center border-t border-slate-100 bg-slate-50/80 px-2 py-1.5">
                            <button
                              type="button"
                              className="text-[11px] font-medium text-primary hover:underline"
                              onClick={() => {
                                setExpandedFacilityTableKeys((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(tableExpandKey)) next.delete(tableExpandKey);
                                  else next.add(tableExpandKey);
                                  return next;
                                });
                              }}
                            >
                              {tableExpanded
                                ? "접기"
                                : `더보기 (${moreRowCount}건)`}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
