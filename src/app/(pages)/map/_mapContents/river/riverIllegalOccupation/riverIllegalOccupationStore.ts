"use client";

import { useSyncExternalStore } from "react";
import {
  RIVER_ILLEGAL_LINE_SEPARATOR,
  RIVER_ILLEGAL_STATUS_KINDS,
  type RiverIllegalOccupationFieldKey,
  type RiverIllegalStatusKindKey,
  type RiverIllegalStatusRowKey,
} from "./riverIllegalOccupationConfig";

/**
 * 시제품 — 서버 저장 없이 화면 안에서만 보관 (새로고침 시 예시 자료로 초기화).
 * 여러 줄 항목 값은 DB와 같게 «@»로 합친 문자열로 둔다.
 */
export type RiverIllegalStatus = Record<RiverIllegalStatusKindKey, Record<RiverIllegalStatusRowKey, string>>;

export type RiverIllegalOccupationCard = Record<RiverIllegalOccupationFieldKey, string> & {
  id: string;
  status: RiverIllegalStatus;
};

export const RIVER_ILLEGAL_OCCUPATION_NEW_ID = "__new_river_illegal_occupation__";

export function isNewRiverIllegalOccupationId(id: string | null | undefined): boolean {
  return String(id ?? "") === RIVER_ILLEGAL_OCCUPATION_NEW_ID;
}

export function emptyRiverIllegalStatus(): RiverIllegalStatus {
  const out = {} as RiverIllegalStatus;
  for (const kind of RIVER_ILLEGAL_STATUS_KINDS) {
    out[kind.key] = { detected: "", acted: "", notActed: "" };
  }
  return out;
}

export function createEmptyRiverIllegalOccupationCard(): RiverIllegalOccupationCard {
  return {
    id: RIVER_ILLEGAL_OCCUPATION_NEW_ID,
    serialNo: "",
    riverType: "",
    firstCheckYmd: "",
    completeYmd: "",
    location: "",
    lon: "",
    lat: "",
    recurrence: "",
    actor: "",
    violation: "",
    relatedLaw: "",
    actionContent: "",
    actionPlan: "",
    manager: "",
    locationMapUrl: "",
    photo1Url: "",
    photo2Url: "",
    completePhotoUrl: "",
    status: emptyRiverIllegalStatus(),
  };
}

/** «@» 구분 값 → 화면 줄 목록 (빈 줄 제외) */
export function splitRiverIllegalLines(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(RIVER_ILLEGAL_LINE_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** «@» 구분 값 → 입력칸 문자열(줄바꿈) */
export function riverIllegalLinesToText(value: string | null | undefined): string {
  return splitRiverIllegalLines(value).join("\n");
}

/** 입력칸 줄바꿈 → 저장 값(«@» 구분). 입력 중 «@»를 직접 친 경우도 같은 구분으로 본다 */
export function riverIllegalTextToLines(text: string): string {
  return String(text ?? "")
    .split(/\r?\n/)
    .flatMap((line) => line.split(RIVER_ILLEGAL_LINE_SEPARATOR))
    .map((s) => s.trim())
    .filter(Boolean)
    .join(RIVER_ILLEGAL_LINE_SEPARATOR);
}

export function riverIllegalStatusTotal(
  status: RiverIllegalStatus,
  row: RiverIllegalStatusRowKey
): number {
  return RIVER_ILLEGAL_STATUS_KINDS.reduce((sum, kind) => {
    const n = Number(status[kind.key]?.[row]);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
}

function sampleStatus(): RiverIllegalStatus {
  const status = emptyRiverIllegalStatus();
  status.landChange = { detected: "1", acted: "1", notActed: "" };
  return status;
}

/** 보내준 관리카드(울진군 재말천-1) 예시 */
const SAMPLE_CARDS: RiverIllegalOccupationCard[] = [
  {
    id: "sample-1",
    serialNo: "울진군 재말천-1",
    riverType: "소하천",
    firstCheckYmd: "2026-03-13",
    completeYmd: "",
    location: "경북 울진군 북면 사계리 41-1",
    lon: "",
    lat: "",
    recurrence: "",
    actor: "남용구 / 010-9165-1193 (사계2길 60-10)",
    violation: "재말소하천 구역내 불법 성토(진출입로) 300㎡",
    relatedLaw: "소하천정비법 제14조 점용위반",
    actionContent: "('26.03.20.) 원상복구 명령(1차)@('26.07.01.) 조치완료-기타 양성화",
    actionPlan: "('26.04.04.) 원상복구 명령(2차)",
    manager: "(총괄부서) 건설과 김준형 054-789-6952@(관리부서) 건설과 김준형 054-789-6952",
    locationMapUrl: "",
    photo1Url: "",
    photo2Url: "",
    completePhotoUrl: "",
    status: sampleStatus(),
  },
];

let cards: RiverIllegalOccupationCard[] = SAMPLE_CARDS;
let idSeq = 0;
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

export function useRiverIllegalOccupationCards(): RiverIllegalOccupationCard[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 저장 — 신규면 새 id를 붙여 맨 앞에 넣고 그 id를 돌려준다 */
export function saveRiverIllegalOccupationCard(card: RiverIllegalOccupationCard): string {
  if (isNewRiverIllegalOccupationId(card.id)) {
    idSeq += 1;
    const saved = { ...card, id: `local-${Date.now()}-${idSeq}` };
    cards = [saved, ...cards];
    emit();
    return saved.id;
  }
  cards = cards.map((c) => (c.id === card.id ? card : c));
  emit();
  return card.id;
}

/** 일부 항목만 바꿈 (예시 카드 위치도 자동 생성 등) — 없는 id면 무시 */
export function patchRiverIllegalOccupationCard(
  id: string,
  patch: Partial<Omit<RiverIllegalOccupationCard, "id">>
): void {
  if (!cards.some((c) => c.id === id)) return;
  cards = cards.map((c) => (c.id === id ? { ...c, ...patch } : c));
  emit();
}

export function deleteRiverIllegalOccupationCard(id: string): void {
  cards = cards.filter((c) => c.id !== id);
  emit();
}
