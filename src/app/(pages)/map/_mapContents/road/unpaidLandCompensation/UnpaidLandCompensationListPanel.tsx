"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Plus, Receipt, RotateCcw, Search, Trash2, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  UNPAID_LAND_OWNER_EXTRA_NOTES,
  formatUnpaidLandArea,
  formatUnpaidLandMoney,
  unpaidLandFeeLabelForRoad,
  type UnpaidLandOwner,
  type UnpaidLandRoadType,
} from "./unpaidLandCompensationMock";
import { useUnpaidLandMockCrud, type UnpaidLandEditField } from "./useUnpaidLandMockCrud";
import { useUnpaidLandParcelLocate } from "./useUnpaidLandParcelLocate";

type Props = {
  onClose: () => void;
};

type ExcelOwnerLine = {
  kind: "owner";
  key: string;
  parcelId: string;
  year: number;
  seq: number;
  address: string;
  jibun: string;
  landCat: string;
  parcelArea: number;
  showParcelMeta: boolean;
  owner: UnpaidLandOwner;
  /** 부대비용 묶음(2필지 이상일 때 표시용) */
  expenseSetId?: string | null;
  expenseGroupTone?: number;
  expenseGroupSize?: number;
};

type ExcelFeeLine = {
  kind: "fee";
  key: string;
  parcelId: string;
  expenseSetId: string;
  itemIndex: number;
  year: number;
  label: string;
  amount: number;
  roadType: UnpaidLandRoadType;
  /** 묶인 필지 연번 (표기용) */
  memberSeqs: number[];
  contiguous: boolean;
  groupTone: number;
};

type RoadTypeSum = { parcels: number; area: number; amount: number };

type ExcelTotalLine = {
  kind: "total";
  key: string;
  parcelArea: number;
  byRoad: Record<UnpaidLandRoadType, RoadTypeSum>;
};

type ExcelLine = ExcelOwnerLine | ExcelFeeLine | ExcelTotalLine;

type EditTarget = {
  parcelId: string;
  ownerId?: string;
  expenseSetId?: string;
  itemIndex?: number;
  field: UnpaidLandEditField;
  /** 국도·지방도·시군도 칸에서 편집 중일 때 — 저장 시 도로종류도 같이 맞춤 */
  roadType?: UnpaidLandRoadType;
};

type RowContextMenu = {
  x: number;
  y: number;
  parcelId: string;
};

function emptyRoadSum(): RoadTypeSum {
  return { parcels: 0, area: 0, amount: 0 };
}

function roadCells(owner: UnpaidLandOwner, type: UnpaidLandRoadType) {
  const extra = UNPAID_LAND_OWNER_EXTRA_NOTES[owner.id]?.[type];
  if (extra) {
    return { parcelText: "", area: "", amount: extra };
  }
  if (owner.roadType !== type) {
    return { parcelText: "", area: "", amount: "" };
  }
  return {
    parcelText: owner.parcelText || "",
    area: owner.areaNote || formatUnpaidLandArea(owner.area),
    amount:
      owner.amountNote && (owner.amount == null || owner.amount === 0)
        ? owner.amountNote
        : formatUnpaidLandMoney(owner.amount),
  };
}

function parseMoney(raw: string): number | null {
  const t = raw.replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseArea(raw: string): number {
  const n = Number(raw.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** 묶음별 왼쪽 띠 색 순환 */
function expenseGroupTone(expenseSetId: string): number {
  let h = 0;
  for (let i = 0; i < expenseSetId.length; i++) {
    h = (h * 31 + expenseSetId.charCodeAt(i)) >>> 0;
  }
  return h % 4;
}

function isContiguousSeqs(seqs: number[]): boolean {
  if (seqs.length <= 1) return true;
  const sorted = [...seqs].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1]! + 1) return false;
  }
  return true;
}

/** 1,2,3,7 → «1~3·7» */
function formatSeqList(seqs: number[]): string {
  if (seqs.length === 0) return "";
  const sorted = [...seqs].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}~${prev}`);
    if (cur != null) {
      start = cur;
      prev = cur;
    }
  }
  return parts.join("·");
}

const EXPENSE_GROUP_ROW = [
  "border-l-[3px] border-l-sky-500 bg-sky-50/50",
  "border-l-[3px] border-l-violet-500 bg-violet-50/50",
  "border-l-[3px] border-l-teal-500 bg-teal-50/50",
  "border-l-[3px] border-l-amber-500 bg-amber-50/40",
] as const;
const EXPENSE_GROUP_FEE = [
  "border-l-[3px] border-l-sky-500 bg-sky-100/60",
  "border-l-[3px] border-l-violet-500 bg-violet-100/60",
  "border-l-[3px] border-l-teal-500 bg-teal-100/60",
  "border-l-[3px] border-l-amber-500 bg-amber-100/50",
] as const;

/** 엑셀형 고정 열폭(px). 도로그룹 필지 열은 헤더«필지»·숫자가 안 잘리게 확보 */
const COL_W = {
  check: 28,
  year: 44,
  seq: 36,
  address: 100,
  jibun: 60,
  landCat: 40,
  parcelArea: 64,
  owner: 72,
  roadParcel: 56,
  roadArea: 72,
  roadAmount: 92,
  del: 40,
} as const;
const ROAD_GROUP_W = COL_W.roadParcel + COL_W.roadArea + COL_W.roadAmount;
const TABLE_W =
  COL_W.check +
  COL_W.year +
  COL_W.seq +
  COL_W.address +
  COL_W.jibun +
  COL_W.landCat +
  COL_W.parcelArea +
  COL_W.owner +
  ROAD_GROUP_W * 3 +
  COL_W.del;

const ROAD_COL = {
  parcel:
    "box-border overflow-visible px-1 py-1.5 text-center align-middle whitespace-nowrap",
  area: "box-border px-1 py-1.5 text-right align-middle tabular-nums whitespace-nowrap",
  amount: "box-border px-1 py-1.5 text-right align-middle tabular-nums whitespace-nowrap",
  group: "border-l border-border px-1 py-1.5 text-center align-middle font-normal",
} as const;

function EditableCell(props: {
  editing: boolean;
  display: ReactNode;
  value: string;
  type?: "text" | "number";
  className?: string;
  align?: "left" | "right" | "center";
  onStart: () => void;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const align =
    props.align === "right"
      ? "text-right"
      : props.align === "center"
        ? "text-center"
        : "text-left";
  if (!props.editing) {
    return (
      <td
        className={cn(
          "px-2 py-1.5 align-middle hover:bg-primary/5",
          align,
          props.className
        )}
        onDoubleClick={(e) => {
          e.stopPropagation();
          props.onStart();
        }}
        title="더블클릭하여 편집"
      >
        {props.display != null && props.display !== "" ? (
          props.display
        ) : (
          <span className="text-muted-foreground/50">&nbsp;</span>
        )}
      </td>
    );
  }
  return (
    <td
      className={cn("px-1 py-1 align-middle", align, props.className)}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        type="text"
        inputMode={props.type === "number" ? "decimal" : undefined}
        defaultValue={props.value}
        className={cn(
          "h-7 w-full rounded border border-primary bg-background px-1.5 text-[11px] outline-none",
          align
        )}
        onBlur={(e) => props.onCommit(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            e.preventDefault();
            props.onCommit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            props.onCancel();
          }
        }}
      />
    </td>
  );
}

/**
 * 엑셀 지급대장 — 목업 CRUD(인라인 편집·행추가·삭제) + 행 클릭 시 필지 이동
 */
export function UnpaidLandCompensationListPanel({ onClose }: Props) {
  const [keyword, setKeyword] = useState("");
  const [yearFilter, setYearFilter] = useState<number | "전체">(2026);
  /** 데이터에 아직 필지가 없어도 필터에 보일 연도 */
  const [extraYears, setExtraYears] = useState<number[]>([]);
  const [addingYear, setAddingYear] = useState(false);
  const [newYearDraft, setNewYearDraft] = useState("");
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [rowMenu, setRowMenu] = useState<RowContextMenu | null>(null);
  /** 부대비용 묶음용 필지 체크 */
  const [checkedParcelIds, setCheckedParcelIds] = useState<string[]>([]);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const {
    selectedParcelId,
    locating,
    locateError,
    selectParcel,
    locateParcel,
    clearLocate,
  } = useUnpaidLandParcelLocate();

  useEffect(() => {
    if (!rowMenu) return;
    const close = () => setRowMenu(null);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [rowMenu]);
  const {
    rows: allRows,
    roadTypes,
    updateParcel,
    updateOwner,
    updateExpenseItem,
    addParcel,
    addOwner,
    addExpenseFee,
    deleteOwner,
    deleteExpenseItem,
    resetMock,
  } = useUnpaidLandMockCrud();

  const years = useMemo(() => {
    const fromData = allRows.map((r) => r.parcel.year);
    return [...new Set([...fromData, ...extraYears])].sort((a, b) => a - b);
  }, [allRows, extraYears]);

  const commitNewYear = () => {
    const y = Number(newYearDraft.replace(/\D/g, "").slice(0, 4));
    if (!Number.isFinite(y) || y < 1900 || y > 2100) {
      setAddingYear(false);
      setNewYearDraft("");
      return;
    }
    setExtraYears((prev) => (prev.includes(y) ? prev : [...prev, y]));
    setYearFilter(y);
    setAddingYear(false);
    setNewYearDraft("");
  };

  const filteredParcels = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return allRows.filter((row) => {
      if (yearFilter !== "전체" && row.parcel.year !== yearFilter) return false;
      if (!q) return true;
      const hay = [
        row.parcel.year,
        row.parcel.seq,
        row.parcel.address,
        row.parcel.jibun,
        row.parcel.landCat,
        ...row.owners.map((o) => o.name),
        ...row.owners.map((o) => o.roadType),
      ]
        .join(" ")
        .toLowerCase();
      return q.split(/\s+/).every((t) => hay.includes(t));
    });
  }, [allRows, keyword, yearFilter]);

  const excelLines = useMemo(() => {
    const lines: ExcelLine[] = [];
    const byRoad: Record<UnpaidLandRoadType, RoadTypeSum> = {
      국도: emptyRoadSum(),
      지방도: emptyRoadSum(),
      시군도: emptyRoadSum(),
    };
    let parcelAreaSum = 0;

    /** 같은 부대비용 묶음은 마지막 필지 아래에만 수수료 행 */
    const expenseAnchorBySet = new Map<string, string>();
    const expenseSeqsBySet = new Map<string, number[]>();
    for (const row of filteredParcels) {
      const esId = row.parcel.expenseSetId;
      if (!esId) continue;
      expenseAnchorBySet.set(esId, row.parcel.id);
      const list = expenseSeqsBySet.get(esId) ?? [];
      list.push(row.parcel.seq);
      expenseSeqsBySet.set(esId, list);
    }

    for (const row of filteredParcels) {
      if (row.parcel.area > 0) parcelAreaSum += row.parcel.area;
      const esId = row.parcel.expenseSetId ?? null;
      const memberSeqs = esId ? (expenseSeqsBySet.get(esId) ?? []) : [];
      const groupSize = memberSeqs.length;
      const groupTone =
        esId && groupSize > 1 ? expenseGroupTone(esId) : undefined;
      const owners =
        row.owners.length > 0
          ? row.owners
          : [
              {
                id: `${row.parcel.id}-empty`,
                parcelId: row.parcel.id,
                name: "—",
                roadType: "시군도" as const,
                parcelText: "",
                area: 0,
                amount: null,
              },
            ];
      owners.forEach((owner, idx) => {
        lines.push({
          kind: "owner",
          key: `${row.parcel.id}:${owner.id}`,
          parcelId: row.parcel.id,
          year: row.parcel.year,
          seq: row.parcel.seq,
          address: row.parcel.address,
          jibun: row.parcel.jibun,
          landCat: row.parcel.landCat,
          parcelArea: row.parcel.area,
          showParcelMeta: idx === 0,
          owner,
          expenseSetId: esId,
          expenseGroupTone: groupTone,
          expenseGroupSize: groupSize > 1 ? groupSize : undefined,
        });
        const bucket = byRoad[owner.roadType];
        bucket.parcels += 1;
        bucket.area += Number.isFinite(owner.area) ? owner.area : 0;
        if (owner.amount != null && Number.isFinite(owner.amount)) {
          bucket.amount += owner.amount;
        }
      });
      const es = row.expenseSet;
      const isExpenseAnchor =
        es != null && expenseAnchorBySet.get(es.id) === row.parcel.id;
      if (es && isExpenseAnchor) {
        const feeRoad = es.roadType ?? "지방도";
        const seqs = expenseSeqsBySet.get(es.id) ?? [row.parcel.seq];
        const tone = expenseGroupTone(es.id);
        es.items.forEach((it, itemIndex) => {
          lines.push({
            kind: "fee",
            key: `${es.id}:${row.parcel.id}:${itemIndex}`,
            parcelId: row.parcel.id,
            expenseSetId: es.id,
            itemIndex,
            year: row.parcel.year,
            label: it.name,
            amount: it.amount,
            roadType: feeRoad,
            memberSeqs: seqs,
            contiguous: isContiguousSeqs(seqs),
            groupTone: tone,
          });
          byRoad[feeRoad].amount += it.amount;
        });
      }
    }

    if (lines.length > 0) {
      lines.push({
        kind: "total",
        key: "total-계",
        parcelArea: parcelAreaSum,
        byRoad,
      });
    }
    return lines;
  }, [filteredParcels]);

  const filteredParcelIds = useMemo(
    () => filteredParcels.map((r) => r.parcel.id),
    [filteredParcels]
  );
  const allFilteredChecked =
    filteredParcelIds.length > 0 &&
    filteredParcelIds.every((id) => checkedParcelIds.includes(id));
  const someFilteredChecked = filteredParcelIds.some((id) =>
    checkedParcelIds.includes(id)
  );

  const toggleParcelCheck = (parcelId: string) => {
    setExpenseError(null);
    setCheckedParcelIds((prev) =>
      prev.includes(parcelId)
        ? prev.filter((id) => id !== parcelId)
        : [...prev, parcelId]
    );
  };

  const toggleCheckAllFiltered = () => {
    if (allFilteredChecked) {
      setCheckedParcelIds((prev) =>
        prev.filter((id) => !filteredParcelIds.includes(id))
      );
      return;
    }
    setCheckedParcelIds((prev) => [
      ...new Set([...prev, ...filteredParcelIds]),
    ]);
  };

  const ownerCount = excelLines.filter((l) => l.kind === "owner").length;
  const addYear = yearFilter === "전체" ? 2026 : yearFilter;

  const isEditing = (
    parcelId: string,
    field: UnpaidLandEditField,
    ownerId?: string,
    roadType?: UnpaidLandRoadType,
    feeKey?: { expenseSetId: string; itemIndex: number }
  ) =>
    edit?.parcelId === parcelId &&
    edit.field === field &&
    (ownerId == null || edit.ownerId === ownerId) &&
    (roadType == null || edit.roadType === roadType) &&
    (feeKey == null ||
      (edit.expenseSetId === feeKey.expenseSetId && edit.itemIndex === feeKey.itemIndex));

  const commitEdit = (raw: string) => {
    if (!edit) return;
    const { parcelId, ownerId, field, roadType: editRoad, expenseSetId, itemIndex } = edit;
    if (field === "year") {
      const y = Number(raw.replace(/\D/g, "").slice(0, 4));
      if (Number.isFinite(y) && y >= 1900 && y <= 2100) {
        updateParcel(parcelId, { year: y });
        setExtraYears((prev) => (prev.includes(y) ? prev : [...prev, y]));
        if (yearFilter !== "전체") setYearFilter(y);
      }
    } else if (field === "address") updateParcel(parcelId, { address: raw.trim() });
    else if (field === "jibun") updateParcel(parcelId, { jibun: raw.trim() });
    else if (field === "landCat") updateParcel(parcelId, { landCat: raw.trim() || "도" });
    else if (field === "parcelArea") updateParcel(parcelId, { area: parseArea(raw) });
    else if (
      (field === "feeLabel" || field === "feeAmount") &&
      expenseSetId != null &&
      itemIndex != null
    ) {
      if (field === "feeLabel") {
        updateExpenseItem(expenseSetId, itemIndex, {
          name:
            raw.trim() ||
            (editRoad ? unpaidLandFeeLabelForRoad(editRoad) : "부대비용"),
        });
      } else {
        /** 금액 칸 편집 시 그 도로열로 위치만 맞춤(국도·지방도) */
        updateExpenseItem(expenseSetId, itemIndex, {
          amount: parseMoney(raw) ?? 0,
          ...(editRoad ? { roadType: editRoad } : {}),
        });
      }
    } else if (ownerId) {
      const roadPatch = editRoad ? { roadType: editRoad } : {};
      if (field === "name") updateOwner(ownerId, { name: raw.trim() });
      else if (field === "ownerArea") {
        updateOwner(ownerId, { ...roadPatch, area: parseArea(raw) });
      } else if (field === "amount") {
        updateOwner(ownerId, { ...roadPatch, amount: parseMoney(raw) });
      } else if (field === "parcelText") {
        updateOwner(ownerId, { ...roadPatch, parcelText: raw.trim() || "1" });
      } else if (field === "roadType") {
        const t = raw.trim() as UnpaidLandRoadType;
        if ((roadTypes as readonly string[]).includes(t)) {
          updateOwner(ownerId, { roadType: t });
        }
      }
    }
    setEdit(null);
  };

  const openRowMenu = (e: ReactMouseEvent, parcelId: string) => {
    e.preventDefault();
    e.stopPropagation();
    selectParcel(parcelId);
    const pad = 8;
    const menuW = 160;
    const menuH = 120;
    const x = Math.min(e.clientX, window.innerWidth - menuW - pad);
    const y = Math.min(e.clientY, window.innerHeight - menuH - pad);
    setRowMenu({ x: Math.max(pad, x), y: Math.max(pad, y), parcelId });
  };

  const handleAddParcelBelow = (afterParcelId: string | null) => {
    const id = addParcel(addYear, afterParcelId);
    selectParcel(id);
    setEdit({ parcelId: id, field: "address" });
    setRowMenu(null);
  };

  const handleAddOwner = (parcelId: string) => {
    const oid = addOwner(parcelId);
    selectParcel(parcelId);
    setEdit({ parcelId, ownerId: oid, field: "name" });
    setRowMenu(null);
  };

  const handleAddExpense = (parcelIds: string[]) => {
    const added = addExpenseFee(parcelIds);
    if (!added) return;
    if (!added.ok) {
      setExpenseError(added.error);
      setRowMenu(null);
      return;
    }
    setExpenseError(null);
    selectParcel(added.anchorParcelId);
    if (added.mode === "append" || added.mode === "create") {
      setEdit({
        parcelId: added.anchorParcelId,
        expenseSetId: added.expenseSetId,
        itemIndex: added.itemIndex,
        field: "feeLabel",
      });
    } else {
      setEdit(null);
    }
    /** 추가 후 체크 해제 — 다음 묶음 체크와 합쳐지지 않음 */
    setCheckedParcelIds([]);
    setRowMenu(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-2">
        <span className="standard-panel-title min-w-0 flex-1 truncate">
          미지급용지
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">목업</span>
        <button
          type="button"
          onClick={() => {
            clearLocate();
            onClose();
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="shrink-0 space-y-2 border-b border-border px-2.5 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="소재지·지번·소유자"
            className="h-8 w-full rounded border border-border pl-7 pr-2.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="연도 필터">
          <button
            type="button"
            onClick={() => setYearFilter("전체")}
            className={cn(
              "rounded border px-2 py-0.5 text-[10px]",
              yearFilter === "전체"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted/50"
            )}
          >
            전체
          </button>
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYearFilter(y)}
              className={cn(
                "rounded border px-2 py-0.5 text-[10px] tabular-nums",
                yearFilter === y
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted/50"
              )}
            >
              {y}
            </button>
          ))}
          {addingYear ? (
            <input
              autoFocus
              value={newYearDraft}
              onChange={(e) => setNewYearDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onBlur={commitNewYear}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitNewYear();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setAddingYear(false);
                  setNewYearDraft("");
                }
              }}
              placeholder="YYYY"
              className="h-6 w-14 rounded border border-primary bg-background px-1 text-center text-[10px] tabular-nums outline-none"
              inputMode="numeric"
              aria-label="새 연도 입력"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setAddingYear(true);
                setNewYearDraft("");
              }}
              className="inline-flex h-6 items-center gap-0.5 rounded border border-dashed border-border px-1.5 text-[10px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              title="연도 추가 후 해당 연도로 필지 추가"
            >
              <Plus className="h-3 w-3" />
              연도
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => handleAddParcelBelow(selectedParcelId)}
            className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[10px] hover:bg-muted/50"
            title={
              selectedParcelId
                ? "선택한 행 바로 아래에 추가(수수료 묶음 유지)"
                : "해당 연도 맨 아래에 추가"
            }
          >
            <Plus className="h-3 w-3" />
            필지 추가
          </button>
          <button
            type="button"
            disabled={!selectedParcelId}
            onClick={() => {
              if (!selectedParcelId) return;
              handleAddOwner(selectedParcelId);
            }}
            className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[10px] hover:bg-muted/50 disabled:opacity-40"
          >
            <UserPlus className="h-3 w-3" />
            소유자 추가
          </button>
          <button
            type="button"
            disabled={checkedParcelIds.length === 0}
            onClick={() => handleAddExpense(checkedParcelIds)}
            className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[10px] hover:bg-muted/50 disabled:opacity-40"
            title="체크한 필지에 부대비용 행 추가(국도·지방도 따로). 추가 후 체크 해제"
          >
            <Receipt className="h-3 w-3" />
            부대비용 추가
            {checkedParcelIds.length > 0
              ? ` (${checkedParcelIds.length})`
              : ""}
          </button>
          {checkedParcelIds.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setCheckedParcelIds([]);
                setExpenseError(null);
              }}
              className="inline-flex h-7 items-center rounded border border-border px-2 text-[10px] text-muted-foreground hover:bg-muted/50"
              title="체크 취소"
            >
              체크 취소
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              clearLocate();
              setEdit(null);
              setCheckedParcelIds([]);
              resetMock();
            }}
            className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[10px] text-muted-foreground hover:bg-muted/50"
          >
            <RotateCcw className="h-3 w-3" />
            초기화
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          필지 {filteredParcels.length}건 · 소유자 행 {ownerCount}건
          {checkedParcelIds.length > 0
            ? ` · 체크 ${checkedParcelIds.length}건`
            : ""}
          {locating
            ? " · 필지 찾는 중…"
            : " · 체크→부대비용 추가(추가 후 체크 해제) · 국도·지방도 따로 · 클릭=지도"}
        </p>
        {expenseError ? (
          <p className="text-[11px] text-rose-600">{expenseError}</p>
        ) : null}
        {locateError ? (
          <p className="text-[11px] text-rose-600">{locateError}</p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {excelLines.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">검색 결과가 없습니다.</p>
        ) : (
          <table
            className="border-collapse border border-border text-left text-[11px] leading-snug [&_td]:border [&_td]:border-border [&_th]:border [&_th]:border-border"
            style={{ tableLayout: "fixed", width: TABLE_W }}
          >
            <colgroup>
              <col style={{ width: COL_W.check }} />
              <col style={{ width: COL_W.year }} />
              <col style={{ width: COL_W.seq }} />
              <col style={{ width: COL_W.address }} />
              <col style={{ width: COL_W.jibun }} />
              <col style={{ width: COL_W.landCat }} />
              <col style={{ width: COL_W.parcelArea }} />
              <col style={{ width: COL_W.owner }} />
              {(["국도", "지방도", "시군도"] as const).flatMap((t) => [
                <col key={`${t}-p`} style={{ width: COL_W.roadParcel }} />,
                <col key={`${t}-a`} style={{ width: COL_W.roadArea }} />,
                <col key={`${t}-m`} style={{ width: COL_W.roadAmount }} />,
              ])}
              <col style={{ width: COL_W.del }} />
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-muted [&_th]:text-center">
              <tr className="border-b border-border text-muted-foreground">
                <th
                  className="px-0.5 py-1.5 font-normal whitespace-nowrap"
                  rowSpan={2}
                  title="부대비용용 필지 선택"
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    checked={allFilteredChecked}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate =
                          someFilteredChecked && !allFilteredChecked;
                      }
                    }}
                    onChange={toggleCheckAllFiltered}
                    aria-label="표시 필지 전체 선택"
                    onClick={(e) => e.stopPropagation()}
                  />
                </th>
                <th className="px-1.5 py-1.5 font-normal whitespace-nowrap" rowSpan={2}>
                  연도
                </th>
                <th className="px-1.5 py-1.5 font-normal whitespace-nowrap" rowSpan={2}>
                  연번
                </th>
                <th className="truncate px-1.5 py-1.5 font-normal" rowSpan={2}>
                  소재지
                </th>
                <th className="px-1.5 py-1.5 font-normal whitespace-nowrap" rowSpan={2}>
                  지번
                </th>
                <th className="px-1.5 py-1.5 font-normal whitespace-nowrap" rowSpan={2}>
                  지목
                </th>
                <th className="px-1.5 py-1.5 font-normal whitespace-nowrap" rowSpan={2}>
                  면적
                </th>
                <th className="truncate px-1.5 py-1.5 font-normal" rowSpan={2}>
                  소유자
                </th>
                <th className={ROAD_COL.group} colSpan={3}>
                  국도
                </th>
                <th className={ROAD_COL.group} colSpan={3}>
                  지방도
                </th>
                <th className={ROAD_COL.group} colSpan={3}>
                  시군도
                </th>
                <th
                  className="border-l border-border px-1.5 py-1.5 font-normal whitespace-nowrap"
                  rowSpan={2}
                >
                  삭제
                </th>
              </tr>
              <tr className="border-b border-border text-muted-foreground">
                {(["국도", "지방도", "시군도"] as const).flatMap((t) => [
                  <th
                    key={`${t}-p`}
                    className={cn(
                      "border-l border-border px-1 py-1.5 font-normal whitespace-nowrap"
                    )}
                  >
                    필지
                  </th>,
                  <th
                    key={`${t}-a`}
                    className="px-1 py-1.5 font-normal whitespace-nowrap"
                  >
                    면적
                  </th>,
                  <th
                    key={`${t}-m`}
                    className="px-1 py-1.5 font-normal whitespace-nowrap"
                  >
                    금액
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {excelLines.map((line) => {
                if (line.kind === "fee") {
                  const feeKey = {
                    expenseSetId: line.expenseSetId,
                    itemIndex: line.itemIndex,
                  };
                  const feeAmountCell = (t: UnpaidLandRoadType) => {
                    const active = line.roadType === t;
                    return (
                      <EditableCell
                        editing={isEditing(
                          line.parcelId,
                          "feeAmount",
                          undefined,
                          t,
                          feeKey
                        )}
                        display={
                          active
                            ? formatUnpaidLandMoney(line.amount) || "—"
                            : ""
                        }
                        value={active ? String(line.amount || "") : ""}
                        type="number"
                        align="right"
                        className={cn(ROAD_COL.amount, active && "font-medium")}
                        onStart={() =>
                          setEdit({
                            parcelId: line.parcelId,
                            expenseSetId: line.expenseSetId,
                            itemIndex: line.itemIndex,
                            field: "feeAmount",
                            roadType: t,
                          })
                        }
                        onCommit={commitEdit}
                        onCancel={() => setEdit(null)}
                      />
                    );
                  };
                  const multi = line.memberSeqs.length > 1;
                  const seqHint = multi
                    ? `연번 ${formatSeqList(line.memberSeqs)}${
                        line.contiguous
                          ? ""
                          : " · 비연속"
                      } (${line.memberSeqs.length}필지)`
                    : "";
                  return (
                    <tr
                      key={line.key}
                      className={cn(
                        "border-b border-border text-foreground",
                        multi
                          ? EXPENSE_GROUP_FEE[line.groupTone % 4]
                          : "bg-muted/30",
                        selectedParcelId === line.parcelId && "bg-primary/10"
                      )}
                      title={seqHint || undefined}
                      onClick={() => {
                        if (selectedParcelId === line.parcelId) clearLocate();
                        else selectParcel(line.parcelId);
                      }}
                      onContextMenu={(e) => openRowMenu(e, line.parcelId)}
                    >
                      <td className="px-0.5 py-1.5" />
                      <td className="px-2 py-1.5" />
                      <td className="px-2 py-1.5 text-center align-middle text-[10px] text-muted-foreground">
                        {multi ? "묶" : ""}
                      </td>
                      <td
                        className="px-2 py-1.5 align-middle text-[10px] text-muted-foreground"
                        colSpan={4}
                      >
                        {seqHint}
                      </td>
                      <EditableCell
                        editing={isEditing(
                          line.parcelId,
                          "feeLabel",
                          undefined,
                          undefined,
                          feeKey
                        )}
                        display={line.label || "—"}
                        value={line.label}
                        className="font-medium"
                        onStart={() =>
                          setEdit({
                            parcelId: line.parcelId,
                            expenseSetId: line.expenseSetId,
                            itemIndex: line.itemIndex,
                            field: "feeLabel",
                          })
                        }
                        onCommit={commitEdit}
                        onCancel={() => setEdit(null)}
                      />
                      <td className={cn("border-l border-border", ROAD_COL.parcel)} />
                      <td className={ROAD_COL.area} />
                      {feeAmountCell("국도")}
                      <td className={cn("border-l border-border", ROAD_COL.parcel)} />
                      <td className={ROAD_COL.area} />
                      {feeAmountCell("지방도")}
                      <td className={cn("border-l border-border", ROAD_COL.parcel)} />
                      <td className={ROAD_COL.area} />
                      {feeAmountCell("시군도")}
                      <td
                        className="border-l border-border px-2 py-1.5 text-center align-middle"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                          title="부대비용 행 삭제"
                          onClick={() => {
                            deleteExpenseItem(line.expenseSetId, line.itemIndex);
                            setEdit(null);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                }

                if (line.kind === "total") {
                  const cell = (t: UnpaidLandRoadType) => line.byRoad[t];
                  return (
                    <tr
                      key={line.key}
                      className="border-t-2 border-border bg-muted/50 font-semibold text-foreground"
                    >
                      <td className="px-0.5 py-1.5" />
                      <td className="px-2 py-1.5" />
                      <td className="px-2 py-1.5 text-center align-middle">계</td>
                      <td className="px-2 py-1.5" colSpan={3} />
                      <td className="px-2 py-1.5 text-right tabular-nums align-middle whitespace-nowrap">
                        {line.parcelArea > 0
                          ? Number(line.parcelArea.toFixed(2)).toLocaleString("ko-KR")
                          : ""}
                      </td>
                      <td className="px-2 py-1.5" />
                      {(["국도", "지방도", "시군도"] as const).map((t) => {
                        const s = cell(t);
                        return (
                          <Fragment key={t}>
                            <td className={cn("border-l border-border", ROAD_COL.parcel)}>
                              {s.parcels > 0 ? s.parcels : ""}
                            </td>
                            <td className={ROAD_COL.area}>
                              {s.area > 0 ? formatUnpaidLandArea(s.area) : ""}
                            </td>
                            <td className={ROAD_COL.amount}>
                              {s.amount > 0 ? formatUnpaidLandMoney(s.amount) : ""}
                            </td>
                          </Fragment>
                        );
                      })}
                      <td className="border-l border-border px-2 py-1.5" />
                    </tr>
                  );
                }

                const nat = roadCells(line.owner, "국도");
                const prov = roadCells(line.owner, "지방도");
                const city = roadCells(line.owner, "시군도");
                const selected = selectedParcelId === line.parcelId;
                const amountCell = (t: UnpaidLandRoadType, cell: ReturnType<typeof roadCells>) => {
                  const active = line.owner.roadType === t;
                  return (
                    <EditableCell
                      editing={isEditing(line.parcelId, "amount", line.owner.id, t)}
                      display={active ? cell.amount || "—" : cell.amount || ""}
                      value={
                        active && line.owner.amount != null
                          ? String(line.owner.amount)
                          : ""
                      }
                      type="number"
                      align="right"
                      className={ROAD_COL.amount}
                      onStart={() =>
                        setEdit({
                          parcelId: line.parcelId,
                          ownerId: line.owner.id,
                          field: "amount",
                          roadType: t,
                        })
                      }
                      onCommit={commitEdit}
                      onCancel={() => setEdit(null)}
                    />
                  );
                };
                const areaCell = (t: UnpaidLandRoadType, cell: ReturnType<typeof roadCells>) => {
                  const active = line.owner.roadType === t;
                  return (
                    <EditableCell
                      editing={isEditing(line.parcelId, "ownerArea", line.owner.id, t)}
                      display={active ? cell.area || "—" : cell.area || ""}
                      value={active && line.owner.area ? String(line.owner.area) : ""}
                      type="number"
                      align="right"
                      className={ROAD_COL.area}
                      onStart={() =>
                        setEdit({
                          parcelId: line.parcelId,
                          ownerId: line.owner.id,
                          field: "ownerArea",
                          roadType: t,
                        })
                      }
                      onCommit={commitEdit}
                      onCancel={() => setEdit(null)}
                    />
                  );
                };
                const parcelCell = (t: UnpaidLandRoadType, cell: ReturnType<typeof roadCells>) => {
                  const active = line.owner.roadType === t;
                  return (
                    <EditableCell
                      editing={isEditing(line.parcelId, "parcelText", line.owner.id, t)}
                      display={active ? cell.parcelText || "—" : cell.parcelText || ""}
                      value={active ? line.owner.parcelText || "" : ""}
                      align="center"
                      className={cn("border-l border-border", ROAD_COL.parcel)}
                      onStart={() =>
                        setEdit({
                          parcelId: line.parcelId,
                          ownerId: line.owner.id,
                          field: "parcelText",
                          roadType: t,
                        })
                      }
                      onCommit={commitEdit}
                      onCancel={() => setEdit(null)}
                    />
                  );
                };

                const goMap = () => {
                  if (selectedParcelId === line.parcelId) {
                    clearLocate();
                    return;
                  }
                  void locateParcel({
                    parcelId: line.parcelId,
                    address: line.address,
                    jibun: line.jibun,
                  });
                };

                const checked = checkedParcelIds.includes(line.parcelId);
                const inExpenseGroup =
                  line.expenseGroupSize != null && line.expenseGroupSize > 1;
                const groupToneClass =
                  inExpenseGroup && line.expenseGroupTone != null
                    ? EXPENSE_GROUP_ROW[line.expenseGroupTone % 4]
                    : null;

                return (
                  <tr
                    key={line.key}
                    className={cn(
                      "cursor-pointer border-b border-border text-foreground hover:bg-muted/40",
                      groupToneClass,
                      selected && "bg-primary/10",
                      checked && "bg-amber-50/80"
                    )}
                    onClick={goMap}
                    onContextMenu={(e) => openRowMenu(e, line.parcelId)}
                    title={
                      inExpenseGroup
                        ? `부대비용 묶음 ${line.expenseGroupSize}필지 · 클릭=선택·지도(다시=해제)`
                        : "체크=부대비용 · 클릭=선택·지도(다시 클릭=해제) · 더블클릭=편집 · 우클릭=추가"
                    }
                  >
                    <td
                      className="px-0.5 py-1.5 text-center align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {line.showParcelMeta ? (
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-primary"
                          checked={checked}
                          onChange={() => toggleParcelCheck(line.parcelId)}
                          aria-label={`${line.year}-${line.seq} 필지 선택`}
                        />
                      ) : null}
                    </td>
                    {line.showParcelMeta ? (
                      <EditableCell
                        editing={isEditing(line.parcelId, "year")}
                        display={line.year}
                        value={String(line.year)}
                        type="number"
                        align="center"
                        className="tabular-nums whitespace-nowrap"
                        onStart={() => setEdit({ parcelId: line.parcelId, field: "year" })}
                        onCommit={commitEdit}
                        onCancel={() => setEdit(null)}
                      />
                    ) : (
                      <td className="px-2 py-1.5" />
                    )}
                    <td className="px-2 py-1.5 text-center tabular-nums align-middle whitespace-nowrap">
                      {line.showParcelMeta ? (
                        <span className="inline-flex items-center gap-0.5">
                          {line.seq}
                          {inExpenseGroup ? (
                            <span
                              className="rounded bg-foreground/10 px-0.5 text-[9px] font-medium text-muted-foreground"
                              title={`부대비용 묶음 ${line.expenseGroupSize}필지`}
                            >
                              묶
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        ""
                      )}
                    </td>
                    {line.showParcelMeta ? (
                      <EditableCell
                        editing={isEditing(line.parcelId, "address")}
                        display={line.address || "—"}
                        value={line.address}
                        className="truncate"
                        onStart={() => setEdit({ parcelId: line.parcelId, field: "address" })}
                        onCommit={commitEdit}
                        onCancel={() => setEdit(null)}
                      />
                    ) : (
                      <td className="px-2 py-1.5" />
                    )}
                    {line.showParcelMeta ? (
                      <EditableCell
                        editing={isEditing(line.parcelId, "jibun")}
                        display={line.jibun || "—"}
                        value={line.jibun}
                        className="whitespace-nowrap"
                        onStart={() => setEdit({ parcelId: line.parcelId, field: "jibun" })}
                        onCommit={commitEdit}
                        onCancel={() => setEdit(null)}
                      />
                    ) : (
                      <td className="px-2 py-1.5" />
                    )}
                    {line.showParcelMeta ? (
                      <EditableCell
                        editing={isEditing(line.parcelId, "landCat")}
                        display={line.landCat || "—"}
                        value={line.landCat}
                        align="center"
                        className="whitespace-nowrap"
                        onStart={() => setEdit({ parcelId: line.parcelId, field: "landCat" })}
                        onCommit={commitEdit}
                        onCancel={() => setEdit(null)}
                      />
                    ) : (
                      <td className="px-2 py-1.5" />
                    )}
                    {line.showParcelMeta ? (
                      <EditableCell
                        editing={isEditing(line.parcelId, "parcelArea")}
                        display={formatUnpaidLandArea(line.parcelArea) || "—"}
                        value={line.parcelArea ? String(line.parcelArea) : ""}
                        type="number"
                        align="right"
                        className="tabular-nums whitespace-nowrap"
                        onStart={() => setEdit({ parcelId: line.parcelId, field: "parcelArea" })}
                        onCommit={commitEdit}
                        onCancel={() => setEdit(null)}
                      />
                    ) : (
                      <td className="px-2 py-1.5" />
                    )}
                    <EditableCell
                      editing={isEditing(line.parcelId, "name", line.owner.id)}
                      display={line.owner.name || "—"}
                      value={line.owner.name}
                      className="truncate"
                      onStart={() =>
                        setEdit({
                          parcelId: line.parcelId,
                          ownerId: line.owner.id,
                          field: "name",
                        })
                      }
                      onCommit={commitEdit}
                      onCancel={() => setEdit(null)}
                    />
                    {parcelCell("국도", nat)}
                    {areaCell("국도", nat)}
                    {amountCell("국도", nat)}
                    {parcelCell("지방도", prov)}
                    {areaCell("지방도", prov)}
                    {amountCell("지방도", prov)}
                    {parcelCell("시군도", city)}
                    {areaCell("시군도", city)}
                    {amountCell("시군도", city)}
                    <td
                      className="border-l border-border px-2 py-1.5 text-center align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                        title="소유자 행 삭제"
                        onClick={() => {
                          if (selectedParcelId === line.parcelId) clearLocate();
                          deleteOwner(line.owner.id);
                          setEdit(null);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {rowMenu ? (
        <div
          className="fixed z-[80] min-w-[10rem] rounded-md border border-border bg-background py-1 shadow-md"
          style={{ left: rowMenu.x, top: rowMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-muted"
            onClick={() => handleAddParcelBelow(rowMenu.parcelId)}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            필지 추가
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-muted"
            onClick={() => handleAddOwner(rowMenu.parcelId)}
          >
            <UserPlus className="h-3.5 w-3.5 shrink-0" />
            소유자 추가
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-muted"
            onClick={() =>
              handleAddExpense(
                checkedParcelIds.length > 0
                  ? checkedParcelIds
                  : [rowMenu.parcelId]
              )
            }
            title={
              checkedParcelIds.length > 0
                ? `체크한 ${checkedParcelIds.length}필지 묶음에 부대비용 추가`
                : "이 행 필지에 부대비용 추가"
            }
          >
            <Receipt className="h-3.5 w-3.5 shrink-0" />
            {checkedParcelIds.length > 0
              ? `부대비용 추가 (${checkedParcelIds.length})`
              : "부대비용 추가"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
