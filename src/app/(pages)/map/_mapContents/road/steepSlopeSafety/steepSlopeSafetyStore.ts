"use client";

import { useSyncExternalStore } from "react";
import { STEEP_SLOPE_ATTACHMENT_MAX } from "./steepSlopeSafetyConfig";
import {
  STEEP_SLOPE_SAFETY_NEW_ID,
  STEEP_SLOPE_SAFETY_SEED,
  createEmptySteepSlopeSafetyCard,
  isNewSteepSlopeSafetyId,
  steepSlopeAttachmentLabelFromFileName,
  type SteepSlopeSafetyCard,
} from "./steepSlopeSafetyMock";

function normalizeCard(card: SteepSlopeSafetyCard): SteepSlopeSafetyCard {
  const attachments = (card.attachments ?? [])
    .slice(0, STEEP_SLOPE_ATTACHMENT_MAX)
    .map((a) => ({
      ...a,
      label:
        String(a.label ?? "").trim() ||
        steepSlopeAttachmentLabelFromFileName(a.fileName),
    }));
  return { ...card, attachments };
}

let cards: SteepSlopeSafetyCard[] = STEEP_SLOPE_SAFETY_SEED.map((c) =>
  structuredClone(c)
);
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

export function useSteepSlopeSafetyCards(): SteepSlopeSafetyCard[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getSteepSlopeSafetyCard(
  id: string | null | undefined
): SteepSlopeSafetyCard | null {
  const key = String(id ?? "").trim();
  if (!key) return null;
  if (isNewSteepSlopeSafetyId(key)) return createEmptySteepSlopeSafetyCard();
  return cards.find((c) => c.id === key) ?? null;
}

export function upsertSteepSlopeSafetyCard(
  card: SteepSlopeSafetyCard
): SteepSlopeSafetyCard {
  const next = normalizeCard(structuredClone(card));
  if (isNewSteepSlopeSafetyId(next.id) || !next.id) {
    next.id = `sss-${Date.now()}`;
    if (!next.serialNo.trim()) {
      next.serialNo = String(cards.length + 169);
    }
    cards = [next, ...cards];
  } else {
    const idx = cards.findIndex((c) => c.id === next.id);
    if (idx >= 0) {
      const copy = cards.slice();
      copy[idx] = next;
      cards = copy;
    } else {
      cards = [next, ...cards];
    }
  }
  emit();
  return next;
}

export function removeSteepSlopeSafetyCard(id: string): void {
  if (isNewSteepSlopeSafetyId(id)) return;
  cards = cards.filter((c) => c.id !== id);
  emit();
}

export { STEEP_SLOPE_SAFETY_NEW_ID, isNewSteepSlopeSafetyId };
