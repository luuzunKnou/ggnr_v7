"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  bikeFormFieldClass,
  bikeFormTableClass,
  bikeFormTdClass,
  bikeFormThClass,
} from "./bikeRoadFormUi";
import {
  BIKE_ROAD_PATH_TYPE_OPTIONS,
  normalizeBikeRoadPathType,
  type BikeRoadSegment,
} from "./bikeRoadMock";

const actionBtn = "standard-detail-action-btn inline-flex h-7 items-center gap-1";

type EditableKey = Exclude<keyof BikeRoadSegment, "id">;

type Props = {
  segments: BikeRoadSegment[];
  isEditing?: boolean;
  onAdd?: () => void;
  onRemove?: (segmentId: string) => void;
  onChange?: (segmentId: string, key: EditableKey, value: string) => void;
  drawActive?: boolean;
};

function cellText(v: string | undefined | null): string {
  const t = String(v ?? "").trim();
  return t || "—";
}

function pathTypeLabel(pathType: string): string {
  return normalizeBikeRoadPathType(pathType) || pathType.trim() || "—";
}

function Th({
  children,
  className,
  rowSpan,
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  rowSpan?: number;
  colSpan?: number;
}) {
  return (
    <th
      rowSpan={rowSpan}
      colSpan={colSpan}
      className={cn(bikeFormThClass, "px-0.5", className)}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
  title,
}: {
  children?: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td
      className={cn(bikeFormTdClass, "overflow-hidden px-0.5", className)}
      title={title}
    >
      {children}
    </td>
  );
}

function CellInput({
  value,
  onChange,
  className,
  center,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  center?: boolean;
}) {
  return (
    <input
      className={cn(bikeFormFieldClass, center && "text-center", className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function ViewSpan({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return <span className={cn("block truncate", className)}>{cellText(value)}</span>;
}

/** 구간 표 — 폭원 항상 표시, sticky 없음(선 이중·짤림 방지) */
export function BikeRoadSegmentListSection({
  segments,
  isEditing = false,
  onAdd,
  onRemove,
  onChange,
  drawActive = false,
}: Props) {
  const [open, setOpen] = useState(true);

  const setField = (id: string, key: EditableKey, value: string) => {
    onChange?.(id, key, value);
  };

  return (
    <section className="relative shrink-0 border-b border-border">
      <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold text-foreground/90"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="shrink-0">구간</span>
          <span className="font-normal tabular-nums text-muted-foreground">
            ({segments.length})
          </span>
        </button>
        {isEditing && onAdd ? (
          <button
            type="button"
            className={cn(actionBtn)}
            disabled={drawActive}
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
          >
            <Plus className="h-3 w-3" />
            추가
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="px-3 pb-2.5">
          {segments.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-muted-foreground">
              {isEditing
                ? "«추가»를 누르면 그리기 창에서 도로를 따라 구간을 넣을 수 있습니다."
                : "구간이 없습니다."}
            </p>
          ) : (
            <div className="map-side-detail-scroll max-h-[calc(3.5rem+8*1.875rem)] overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-thin !mr-0">
              <table className={cn(bikeFormTableClass, "w-full")}>
                <colgroup>
                  <col style={{ width: "3%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "3.5%" }} />
                  <col style={{ width: "6.5%" }} />
                  <col style={{ width: "5%" }} />
                  <col style={{ width: "5.5%" }} />
                  <col style={{ width: "5.5%" }} />
                  <col style={{ width: "5.5%" }} />
                  <col style={{ width: "6.5%" }} />
                  <col style={{ width: "6.5%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "5.5%" }} />
                  <col style={{ width: "8%" }} />
                  {isEditing ? <col style={{ width: "2.5%" }} /> : null}
                </colgroup>
                <thead className="sticky top-0 z-[1] bg-muted">
                  <tr>
                    <Th rowSpan={2}>
                      일련
                      <br />
                      번호
                    </Th>
                    <Th rowSpan={2}>노선명</Th>
                    <Th rowSpan={2}>기점</Th>
                    <Th rowSpan={2}>종점</Th>
                    <Th rowSpan={2}>
                      도로
                      <br />
                      연계
                    </Th>
                    <Th rowSpan={2}>종류</Th>
                    <Th rowSpan={2}>총 연장</Th>
                    <Th rowSpan={2}>전용도로</Th>
                    <Th rowSpan={2}>전용차로</Th>
                    <Th rowSpan={2}>우선도로</Th>
                    <Th colSpan={3}>겸용도로(분리)</Th>
                    <Th colSpan={2}>겸용도로(비분리)</Th>
                    {isEditing ? (
                      <Th rowSpan={2} className="p-0">
                        <span className="sr-only">삭제</span>
                      </Th>
                    ) : null}
                  </tr>
                  <tr>
                    <Th>자전거도로</Th>
                    <Th>보도</Th>
                    <Th>유효폭원</Th>
                    <Th>도로폭원</Th>
                    <Th>유효폭원</Th>
                  </tr>
                </thead>
                <tbody>
                  {segments.map((s) => {
                    const typeLabel = pathTypeLabel(s.pathType);
                    const pathValue =
                      normalizeBikeRoadPathType(s.pathType) || s.pathType;
                    return (
                      <tr key={s.id}>
                        <Td className="text-center tabular-nums" title={s.serialNo}>
                          {isEditing ? (
                            <CellInput
                              value={s.serialNo}
                              onChange={(v) => setField(s.id, "serialNo", v)}
                              center
                            />
                          ) : (
                            <ViewSpan value={s.serialNo} className="tabular-nums" />
                          )}
                        </Td>
                        <Td title={s.routeName}>
                          {isEditing ? (
                            <CellInput
                              value={s.routeName}
                              onChange={(v) => setField(s.id, "routeName", v)}
                            />
                          ) : (
                            <ViewSpan value={s.routeName} />
                          )}
                        </Td>
                        <Td title={s.startName}>
                          {isEditing ? (
                            <CellInput
                              value={s.startName}
                              onChange={(v) => setField(s.id, "startName", v)}
                            />
                          ) : (
                            <ViewSpan value={s.startName} />
                          )}
                        </Td>
                        <Td title={s.endName}>
                          {isEditing ? (
                            <CellInput
                              value={s.endName}
                              onChange={(v) => setField(s.id, "endName", v)}
                            />
                          ) : (
                            <ViewSpan value={s.endName} />
                          )}
                        </Td>
                        <Td className="text-center" title={s.roadLink}>
                          {isEditing ? (
                            <CellInput
                              value={s.roadLink}
                              onChange={(v) => setField(s.id, "roadLink", v)}
                              center
                            />
                          ) : (
                            <ViewSpan value={s.roadLink} />
                          )}
                        </Td>
                        <Td title={typeLabel}>
                          {isEditing ? (
                            <select
                              className={cn(bikeFormFieldClass, "cursor-pointer")}
                              value={pathValue}
                              onChange={(e) =>
                                setField(s.id, "pathType", e.target.value)
                              }
                            >
                              <option value="">선택</option>
                              {BIKE_ROAD_PATH_TYPE_OPTIONS.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <ViewSpan value={typeLabel} />
                          )}
                        </Td>
                        <Td
                          className="px-0 text-center tabular-nums"
                          title={s.totalLength}
                        >
                          {isEditing ? (
                            <CellInput
                              value={s.totalLength}
                              onChange={(v) => setField(s.id, "totalLength", v)}
                              center
                              className="px-0"
                            />
                          ) : (
                            <ViewSpan
                              value={s.totalLength}
                              className="tabular-nums"
                            />
                          )}
                        </Td>
                        <Td className="text-center" title={s.dedicatedRoad}>
                          {isEditing ? (
                            <CellInput
                              value={s.dedicatedRoad}
                              onChange={(v) =>
                                setField(s.id, "dedicatedRoad", v)
                              }
                              center
                            />
                          ) : (
                            <ViewSpan value={s.dedicatedRoad} />
                          )}
                        </Td>
                        <Td className="text-center" title={s.dedicatedLane}>
                          {isEditing ? (
                            <CellInput
                              value={s.dedicatedLane}
                              onChange={(v) =>
                                setField(s.id, "dedicatedLane", v)
                              }
                              center
                            />
                          ) : (
                            <ViewSpan value={s.dedicatedLane} />
                          )}
                        </Td>
                        <Td className="text-center" title={s.priorityRoad}>
                          {isEditing ? (
                            <CellInput
                              value={s.priorityRoad}
                              onChange={(v) =>
                                setField(s.id, "priorityRoad", v)
                              }
                              center
                            />
                          ) : (
                            <ViewSpan value={s.priorityRoad} />
                          )}
                        </Td>
                        <Td className="text-center" title={s.sharedSepBike}>
                          {isEditing ? (
                            <CellInput
                              value={s.sharedSepBike}
                              onChange={(v) =>
                                setField(s.id, "sharedSepBike", v)
                              }
                              center
                            />
                          ) : (
                            <ViewSpan value={s.sharedSepBike} />
                          )}
                        </Td>
                        <Td className="text-center" title={s.sharedSepWalk}>
                          {isEditing ? (
                            <CellInput
                              value={s.sharedSepWalk}
                              onChange={(v) =>
                                setField(s.id, "sharedSepWalk", v)
                              }
                              center
                            />
                          ) : (
                            <ViewSpan value={s.sharedSepWalk} />
                          )}
                        </Td>
                        <Td title={s.sharedSepEffective}>
                          {isEditing ? (
                            <CellInput
                              value={s.sharedSepEffective}
                              onChange={(v) =>
                                setField(s.id, "sharedSepEffective", v)
                              }
                            />
                          ) : (
                            <ViewSpan value={s.sharedSepEffective} />
                          )}
                        </Td>
                        <Td className="text-center" title={s.sharedNonSepRoad}>
                          {isEditing ? (
                            <CellInput
                              value={s.sharedNonSepRoad}
                              onChange={(v) =>
                                setField(s.id, "sharedNonSepRoad", v)
                              }
                              center
                            />
                          ) : (
                            <ViewSpan value={s.sharedNonSepRoad} />
                          )}
                        </Td>
                        <Td
                          className="text-center"
                          title={s.sharedNonSepEffective}
                        >
                          {isEditing ? (
                            <CellInput
                              value={s.sharedNonSepEffective}
                              onChange={(v) =>
                                setField(s.id, "sharedNonSepEffective", v)
                              }
                              center
                            />
                          ) : (
                            <ViewSpan value={s.sharedNonSepEffective} />
                          )}
                        </Td>
                        {isEditing ? (
                          <Td className="p-0 text-center">
                            {onRemove ? (
                              <button
                                type="button"
                                onClick={() => onRemove(s.id)}
                                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                aria-label="구간 삭제"
                                title="삭제"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </Td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
