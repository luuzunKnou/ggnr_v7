"use client";

import { useSyncExternalStore } from "react";
import { call } from "@/lib/api";
import type { RiverIllegalOccupationCard } from "./riverIllegalOccupationModel";

export type {
  RiverIllegalOccupationCard,
  RiverIllegalStatus,
} from "./riverIllegalOccupationModel";
export {
  RIVER_ILLEGAL_OCCUPATION_NEW_ID,
  isNewRiverIllegalOccupationId,
  emptyRiverIllegalStatus,
  emptyRiverIllegalStatusTotals,
  createEmptyRiverIllegalOccupationCard,
  splitRiverIllegalLines,
  riverIllegalLinesToText,
  riverIllegalTextToLines,
  riverIllegalStatusTotal,
  riverIllegalStatusTotalMarked,
  riverIllegalMgmtNoRank,
} from "./riverIllegalOccupationModel";
export type { RiverIllegalStatusTotals } from "./riverIllegalOccupationModel";

/**
 * 불법점용 관리카드 — layer.illegal_usage_as 연동 (클라이언트 구독만).
 */
let cards: RiverIllegalOccupationCard[] = [];
let loadError: string | null = null;
let loading = false;
let loadSeq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return cards;
}

function getErrorSnapshot() {
  return loadError;
}

function getLoadingSnapshot() {
  return loading;
}

export function getRiverIllegalOccupationCardsSnapshot(): RiverIllegalOccupationCard[] {
  return cards;
}

export function useRiverIllegalOccupationCards(): RiverIllegalOccupationCard[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useRiverIllegalOccupationLoadError(): string | null {
  return useSyncExternalStore(subscribe, getErrorSnapshot, getErrorSnapshot);
}

export function useRiverIllegalOccupationLoading(): boolean {
  return useSyncExternalStore(subscribe, getLoadingSnapshot, getLoadingSnapshot);
}

function unwrapListPayload(res: unknown): { items: RiverIllegalOccupationCard[]; warning?: string } {
  const root = res as { data?: unknown; items?: unknown; warning?: string; success?: boolean } | null;
  const data = (root?.data ?? root) as {
    items?: RiverIllegalOccupationCard[];
    warning?: string;
  } | null;
  if (Array.isArray(data)) return { items: data as RiverIllegalOccupationCard[] };
  if (Array.isArray(data?.items)) return { items: data.items, warning: data.warning ?? root?.warning };
  if (Array.isArray(root?.items)) return { items: root.items as RiverIllegalOccupationCard[], warning: root.warning };
  return { items: [], warning: data?.warning ?? root?.warning };
}

/** 레이어에서 목록 다시 읽기 */
export async function loadRiverIllegalOccupationCards(): Promise<void> {
  const seq = ++loadSeq;
  loading = true;
  loadError = null;
  emit();
  try {
    const res = await call("", "POST", {
      service: "riverIllegalOccupationService",
      action: "list",
      params: {},
    });
    if (seq !== loadSeq) return;
    if (res?.success === false) {
      cards = [];
      loadError = String(res.error ?? "목록을 불러오지 못했습니다.");
      return;
    }
    const { items, warning } = unwrapListPayload(res);
    cards = items;
    loadError = warning?.trim() ? warning : null;
  } catch (e: unknown) {
    if (seq !== loadSeq) return;
    cards = [];
    loadError = e instanceof Error ? e.message : "목록을 불러오지 못했습니다.";
  } finally {
    if (seq === loadSeq) {
      loading = false;
      emit();
    }
  }
}

/** 저장 — 서버 반영 후 목록 갱신, 저장된 id 반환 */
export async function saveRiverIllegalOccupationCard(card: RiverIllegalOccupationCard): Promise<string> {
  const res = await call("", "POST", {
    service: "riverIllegalOccupationService",
    action: "save",
    params: { card },
  });
  const data = res?.data ?? res;
  if (res?.success === false || data?.success === false) {
    throw new Error(String(res?.error ?? data?.error ?? "저장에 실패했습니다."));
  }
  const id = String(data?.id ?? "").trim();
  if (!id) throw new Error("저장 후 식별값을 받지 못했습니다.");
  await loadRiverIllegalOccupationCards();
  return id;
}

/** 일부 항목만 서버·로컬 반영 (위치도 자동 생성 등) */
export async function patchRiverIllegalOccupationCard(
  id: string,
  patch: Partial<Omit<RiverIllegalOccupationCard, "id">>
): Promise<void> {
  if (!cards.some((c) => c.id === id)) return;
  cards = cards.map((c) => (c.id === id ? { ...c, ...patch } : c));
  emit();
  try {
    await call("", "POST", {
      service: "riverIllegalOccupationService",
      action: "patch",
      params: { id, patch },
    });
  } catch {
    /* 자동 위치도 등은 실패해도 화면 값은 유지 */
  }
}

export async function deleteRiverIllegalOccupationCard(id: string): Promise<void> {
  const res = await call("", "POST", {
    service: "riverIllegalOccupationService",
    action: "remove",
    params: { id },
  });
  const data = res?.data ?? res;
  if (res?.success === false || data?.success === false) {
    throw new Error(String(res?.error ?? data?.error ?? "삭제에 실패했습니다."));
  }
  await loadRiverIllegalOccupationCards();
}
