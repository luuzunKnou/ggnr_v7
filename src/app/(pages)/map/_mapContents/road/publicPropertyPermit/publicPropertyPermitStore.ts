'use client';

import { useSyncExternalStore } from 'react';
import {
  PUBLIC_PROPERTY_PERMIT_NEW_ID,
  PUBLIC_PROPERTY_PERMIT_SEED,
  createEmptyPublicPropertyPermit,
  isNewPublicPropertyPermitId,
  type PublicPropertyPermit,
} from './publicPropertyPermitMock';

let rows: PublicPropertyPermit[] = PUBLIC_PROPERTY_PERMIT_SEED.map((r) => structuredClone(r));
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
  return rows;
}

export function usePublicPropertyPermits(): PublicPropertyPermit[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getPublicPropertyPermit(
  id: string | null | undefined
): PublicPropertyPermit | null {
  const key = String(id ?? '').trim();
  if (!key) return null;
  if (isNewPublicPropertyPermitId(key)) return createEmptyPublicPropertyPermit();
  return rows.find((r) => r.id === key) ?? null;
}

export function upsertPublicPropertyPermit(
  row: PublicPropertyPermit
): PublicPropertyPermit {
  const next = structuredClone(row);
  if (isNewPublicPropertyPermitId(next.id) || !next.id) {
    next.id = `ppp-${Date.now()}`;
    if (!next.permitNo.trim()) {
      next.permitNo = `P-${String(rows.length + 1).padStart(2, '0')}`;
    }
    rows = [next, ...rows];
  } else {
    const idx = rows.findIndex((r) => r.id === next.id);
    if (idx >= 0) {
      const copy = rows.slice();
      copy[idx] = next;
      rows = copy;
    } else {
      rows = [next, ...rows];
    }
  }
  emit();
  return next;
}

export function removePublicPropertyPermit(id: string): void {
  if (isNewPublicPropertyPermitId(id)) return;
  rows = rows.filter((r) => r.id !== id);
  emit();
}

export { PUBLIC_PROPERTY_PERMIT_NEW_ID, isNewPublicPropertyPermitId };
