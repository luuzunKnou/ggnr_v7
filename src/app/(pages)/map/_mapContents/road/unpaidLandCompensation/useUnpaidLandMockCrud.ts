"use client";

import { useCallback, useMemo, useState } from "react";
import {
  UNPAID_LAND_EXPENSE_SETS,
  UNPAID_LAND_OWNERS,
  UNPAID_LAND_PARCELS,
  UNPAID_LAND_ROAD_TYPES,
  buildUnpaidLandListRows,
  unpaidLandFeeLabelForRoad,
  unpaidLandParcelRoadType,
  type UnpaidLandExpenseSet,
  type UnpaidLandOwner,
  type UnpaidLandParcel,
  type UnpaidLandRoadType,
} from "./unpaidLandCompensationMock";

export type AddExpenseFeeResult =
  | {
      ok: true;
      expenseSetId: string;
      itemIndex: number;
      anchorParcelId: string;
      mode: "create" | "join" | "append";
      memberIds: string[];
      roadType: UnpaidLandRoadType;
    }
  | { ok: false; error: string };

function cloneParcels(): UnpaidLandParcel[] {
  return UNPAID_LAND_PARCELS.map((p) => ({ ...p }));
}
function cloneOwners(): UnpaidLandOwner[] {
  return UNPAID_LAND_OWNERS.map((o) => ({ ...o }));
}
function cloneExpenseSets(): UnpaidLandExpenseSet[] {
  return UNPAID_LAND_EXPENSE_SETS.map((e) => ({
    ...e,
    items: e.items.map((it) => ({ ...it })),
  }));
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 목업 CRUD — 화면 state만. DB 연동 전 프로토타입 */
export function useUnpaidLandMockCrud() {
  const [parcels, setParcels] = useState(cloneParcels);
  const [owners, setOwners] = useState(cloneOwners);
  const [expenseSets, setExpenseSets] = useState(cloneExpenseSets);

  const rows = useMemo(
    () => buildUnpaidLandListRows(parcels, owners, expenseSets),
    [parcels, owners, expenseSets]
  );

  const updateParcel = useCallback(
    (parcelId: string, patch: Partial<Pick<UnpaidLandParcel, "address" | "jibun" | "landCat" | "area" | "year" | "seq">>) => {
      setParcels((prev) =>
        prev.map((p) => (p.id === parcelId ? { ...p, ...patch } : p))
      );
    },
    []
  );

  const updateOwner = useCallback(
    (
      ownerId: string,
      patch: Partial<Pick<UnpaidLandOwner, "name" | "roadType" | "area" | "amount" | "parcelText">>
    ) => {
      setOwners((prev) =>
        prev.map((o) => (o.id === ownerId ? { ...o, ...patch } : o))
      );
    },
    []
  );

  /**
   * 필지 추가.
   * afterParcelId 있으면 그 행 바로 아래(같은 연도·연번+1)에 삽입.
   * 선택 행에 합계수수료 등이 걸려 있으면 수수료를 새 행으로 넘겨
   * 새 필지가 수수료 위(같은 묶음)에 오도록 함.
   */
  const addParcel = useCallback((year: number, afterParcelId?: string | null) => {
    const parcelId = nextId("p");
    const ownerId = nextId("o");

    setParcels((prev) => {
      const after = afterParcelId
        ? prev.find((p) => p.id === afterParcelId)
        : undefined;
      const targetYear = after?.year ?? year;
      const sameYear = prev.filter((p) => p.year === targetYear);
      const seq = after
        ? after.seq + 1
        : sameYear.length > 0
          ? Math.max(...sameYear.map((p) => p.seq)) + 1
          : 1;
      /** 선택 행이 수수료 앵커면 → 새 행이 묶음 끝이 되도록 이전 */
      const movedExpenseId = after?.expenseSetId ?? null;

      return [
        ...prev.map((p) => {
          let next = p;
          if (movedExpenseId && p.id === after!.id) {
            next = { ...next, expenseSetId: null };
          }
          if (p.year === targetYear && p.seq >= seq) {
            next = { ...next, seq: next.seq + 1 };
          }
          return next;
        }),
        {
          id: parcelId,
          year: targetYear,
          seq,
          address: "",
          jibun: "",
          landCat: "도",
          area: 0,
          ...(movedExpenseId ? { expenseSetId: movedExpenseId } : {}),
        },
      ];
    });
    setOwners((prev) => [
      ...prev,
      {
        id: ownerId,
        parcelId,
        name: "",
        roadType: "지방도",
        parcelText: "1",
        area: 0,
        amount: null,
      },
    ]);
    return parcelId;
  }, []);

  const addOwner = useCallback((parcelId: string) => {
    const ownerId = nextId("o");
    setOwners((prev) => [
      ...prev,
      {
        id: ownerId,
        parcelId,
        name: "",
        roadType: "지방도",
        parcelText: "1",
        area: 0,
        amount: null,
      },
    ]);
    return ownerId;
  }, []);

  /**
   * 부대비용(수수료) 추가 / 묶음 확장.
   * 국도·지방도(시군도)는 한 묶음에 한 도로종류만. 표기는 «국도수수료» 등, 금액 칸도 그 도로열.
   */
  const addExpenseFee = useCallback(
    (parcelIds: string | string[]): AddExpenseFeeResult | null => {
      const idList = (Array.isArray(parcelIds) ? parcelIds : [parcelIds]).filter(
        Boolean
      );
      const uniqueIds = [...new Set(idList)];
      const selected = parcels
        .filter((p) => uniqueIds.includes(p.id))
        .sort((a, b) =>
          a.year !== b.year ? a.year - b.year : a.seq - b.seq
        );
      if (selected.length === 0) return null;

      const selectedIds = selected.map((p) => p.id);
      const anchorParcelId = selected[selected.length - 1]!.id;
      const roadByParcel = selected.map((p) => ({
        id: p.id,
        road: unpaidLandParcelRoadType(p.id, owners),
      }));
      const roadTypesInSelection = [
        ...new Set(
          roadByParcel
            .map((r) => r.road)
            .filter((t): t is UnpaidLandRoadType => t != null)
        ),
      ];
      if (roadTypesInSelection.length === 0) {
        return {
          ok: false,
          error: "선택한 필지의 도로종류(국도·지방도)를 확인할 수 없습니다.",
        };
      }
      if (roadTypesInSelection.length > 1) {
        return {
          ok: false,
          error:
            "국도·지방도·시군도는 한 묶음에 함께 넣을 수 없습니다. 같은 도로종류만 체크하세요.",
        };
      }
      const bundleRoad = roadTypesInSelection[0]!;
      const feeName = unpaidLandFeeLabelForRoad(bundleRoad);

      const existingIds = [
        ...new Set(
          selected
            .map((p) => p.expenseSetId)
            .filter((id): id is string => id != null && id !== "")
        ),
      ];

      /** 기존 묶음 1개 + 새 필지 → 합치기(도로종류 일치할 때만) */
      if (existingIds.length === 1) {
        const targetId = existingIds[0]!;
        const existing = expenseSets.find((e) => e.id === targetId);
        const setRoad = existing?.roadType ?? bundleRoad;
        if (setRoad !== bundleRoad) {
          return {
            ok: false,
            error: `이미 «${setRoad}수수료» 묶음입니다. ${bundleRoad} 필지는 따로 묶으세요.`,
          };
        }
        const needsJoin = selected.some(
          (p) => (p.expenseSetId ?? null) !== targetId
        );
        if (needsJoin) {
          setParcels((prev) =>
            prev.map((p) =>
              selectedIds.includes(p.id) ? { ...p, expenseSetId: targetId } : p
            )
          );
          const itemIndex = Math.max(0, (existing?.items.length ?? 1) - 1);
          return {
            ok: true,
            expenseSetId: targetId,
            itemIndex,
            anchorParcelId,
            mode: "join",
            memberIds: selectedIds,
            roadType: setRoad,
          };
        }
        if (existing) {
          const itemIndex = existing.items.length;
          setExpenseSets((prev) =>
            prev.map((e) =>
              e.id !== targetId
                ? e
                : {
                    ...e,
                    roadType: setRoad,
                    items: [...e.items, { name: feeName, amount: 0 }],
                  }
            )
          );
          return {
            ok: true,
            expenseSetId: targetId,
            itemIndex,
            anchorParcelId,
            mode: "append",
            memberIds: selectedIds,
            roadType: setRoad,
          };
        }
      }

      /** 새 묶음 (또는 여러 묶음 재묶기) — 도로종류·표기·금액 열 일치 */
      const expenseSetId = nextId("es");
      setExpenseSets((prev) => [
        ...prev,
        {
          id: expenseSetId,
          roadType: bundleRoad,
          items: [{ name: feeName, amount: 0 }],
        },
      ]);
      setParcels((prev) =>
        prev.map((p) =>
          selectedIds.includes(p.id) ? { ...p, expenseSetId } : p
        )
      );
      return {
        ok: true,
        expenseSetId,
        itemIndex: 0,
        anchorParcelId,
        mode: "create",
        memberIds: selectedIds,
        roadType: bundleRoad,
      };
    },
    [parcels, owners, expenseSets]
  );

  const updateExpenseItem = useCallback(
    (
      expenseSetId: string,
      itemIndex: number,
      patch: Partial<{ name: string; amount: number; roadType: UnpaidLandRoadType }>
    ) => {
      setExpenseSets((prev) =>
        prev.map((e) => {
          if (e.id !== expenseSetId) return e;
          const items = e.items.map((it, i) => {
            if (i !== itemIndex) return it;
            return {
              ...it,
              ...(patch.name != null ? { name: patch.name } : {}),
              ...(patch.amount != null ? { amount: patch.amount } : {}),
            };
          });
          return {
            ...e,
            items,
            ...(patch.roadType ? { roadType: patch.roadType } : {}),
          };
        })
      );
    },
    []
  );

  const deleteExpenseItem = useCallback(
    (expenseSetId: string, itemIndex: number) => {
      setExpenseSets((prev) => {
        const target = prev.find((e) => e.id === expenseSetId);
        if (!target) return prev;
        const items = target.items.filter((_, i) => i !== itemIndex);
        if (items.length === 0) {
          setParcels((ps) =>
            ps.map((p) =>
              p.expenseSetId === expenseSetId ? { ...p, expenseSetId: null } : p
            )
          );
          return prev.filter((e) => e.id !== expenseSetId);
        }
        return prev.map((e) => (e.id === expenseSetId ? { ...e, items } : e));
      });
    },
    []
  );

  const deleteOwner = useCallback((ownerId: string) => {
    setOwners((prev) => {
      const target = prev.find((o) => o.id === ownerId);
      if (!target) return prev;
      const rest = prev.filter((o) => o.id !== ownerId);
      const siblings = rest.filter((o) => o.parcelId === target.parcelId);
      if (siblings.length === 0) {
        setParcels((ps) => ps.filter((p) => p.id !== target.parcelId));
      }
      return rest;
    });
  }, []);

  const deleteParcel = useCallback((parcelId: string) => {
    setParcels((prev) => prev.filter((p) => p.id !== parcelId));
    setOwners((prev) => prev.filter((o) => o.parcelId !== parcelId));
  }, []);

  const resetMock = useCallback(() => {
    setParcels(cloneParcels());
    setOwners(cloneOwners());
    setExpenseSets(cloneExpenseSets());
  }, []);

  return {
    rows,
    roadTypes: UNPAID_LAND_ROAD_TYPES,
    updateParcel,
    updateOwner,
    updateExpenseItem,
    addParcel,
    addOwner,
    addExpenseFee,
    deleteOwner,
    deleteExpenseItem,
    deleteParcel,
    resetMock,
  };
}

export type UnpaidLandEditField =
  | "year"
  | "address"
  | "jibun"
  | "landCat"
  | "parcelArea"
  | "name"
  | "ownerArea"
  | "amount"
  | "parcelText"
  | "roadType"
  | "feeLabel"
  | "feeAmount";
