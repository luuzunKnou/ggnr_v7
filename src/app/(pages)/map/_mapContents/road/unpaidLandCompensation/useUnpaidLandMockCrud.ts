"use client";

import { useCallback, useMemo, useState } from "react";
import {
  UNPAID_LAND_EXPENSE_SETS,
  UNPAID_LAND_OWNERS,
  UNPAID_LAND_PARCELS,
  UNPAID_LAND_ROAD_TYPES,
  buildUnpaidLandListRows,
  type UnpaidLandExpenseSet,
  type UnpaidLandOwner,
  type UnpaidLandParcel,
  type UnpaidLandRoadType,
} from "./unpaidLandCompensationMock";

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
   * 부대비용(수수료) 한 줄 추가.
   * 선택 필지에 묶음이 있으면 항목만 추가, 없으면 새 묶음 만들어 필지에 연결.
   */
  const addExpenseFee = useCallback((parcelId: string) => {
    const parcel = parcels.find((p) => p.id === parcelId);
    if (!parcel) return null;

    const existingId = parcel.expenseSetId ?? null;
    const existing = existingId
      ? expenseSets.find((e) => e.id === existingId)
      : undefined;
    if (existing) {
      const itemIndex = existing.items.length;
      setExpenseSets((prev) =>
        prev.map((e) =>
          e.id !== existingId
            ? e
            : {
                ...e,
                items: [...e.items, { name: "부대비용", amount: 0 }],
              }
        )
      );
      return { expenseSetId: existingId!, itemIndex };
    }

    const expenseSetId = nextId("es");
    setExpenseSets((prev) => [
      ...prev,
      {
        id: expenseSetId,
        roadType: "지방도",
        items: [{ name: "부대비용", amount: 0 }],
      },
    ]);
    setParcels((prev) =>
      prev.map((p) => (p.id === parcelId ? { ...p, expenseSetId } : p))
    );
    return { expenseSetId, itemIndex: 0 };
  }, [parcels, expenseSets]);

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
