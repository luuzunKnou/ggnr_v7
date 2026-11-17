import { maskPersonFieldByLength } from '@/lib/personInfoMask';
import type { ParcelLandModalKind } from './api';

export { maskPersonFieldByLength };

/** 패널 표시 — personInfo ON일 때만 마스킹 */
export function formatPersonField(value: unknown, maskEnabled: boolean): string {
  const raw = value == null ? '' : String(value).trim();
  if (!raw || raw === '-') return raw || '-';
  return maskEnabled ? maskPersonFieldByLength(raw) : raw;
}

/**
 * V6 landOwnInfoModal 기준
 * - 공유인: 소유자(1열)만
 * - 변동연혁: 소유자(3열)만
 */
export function maskParcelLandModalRows(
  kind: ParcelLandModalKind,
  rows: string[][],
  maskEnabled: boolean
): string[][] {
  if (!maskEnabled) return rows;
  if (kind === 'share') {
    return rows.map((row) =>
      row.map((cell, i) => (i === 1 ? maskPersonFieldByLength(cell) : cell))
    );
  }
  if (kind === 'change') {
    return rows.map((row) =>
      row.map((cell, i) => (i === 3 ? maskPersonFieldByLength(cell) : cell))
    );
  }
  return rows;
}
