import type { RadiationShelterListItem } from '@/service/radiationShelterService';
import {
  defineFieldInitialSortDir,
  getRowValueByDefineField,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils';

export type RadiationShelterListSortDir = 'asc' | 'desc';

export type RadiationShelterListSortSpec = {
  key: string;
  dir: RadiationShelterListSortDir;
};

function isNumberFieldType(field: DefineFieldLike | undefined): boolean {
  return String(field?.define_field_type ?? '').trim().toUpperCase() === 'NUMBER';
}

export function initialRadiationShelterSortDir(
  fieldKey: string,
  columns: DefineFieldLike[]
): RadiationShelterListSortDir {
  const col = columns.find(
    (c) => String(c.define_field_name ?? '').trim().toLowerCase() === fieldKey.toLowerCase()
  );
  const fallback = col && isNumberFieldType(col) ? 'asc' : 'asc';
  return col ? defineFieldInitialSortDir(col, fallback) : 'asc';
}

function compareText(a: string, b: string, dir: RadiationShelterListSortDir): number {
  const av = String(a ?? '').trim();
  const bv = String(b ?? '').trim();
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  const cmp = av.localeCompare(bv, 'ko');
  return dir === 'asc' ? cmp : -cmp;
}

function compareNumber(a: number | null, b: number | null, dir: RadiationShelterListSortDir): number {
  const av = a ?? Number.NEGATIVE_INFINITY;
  const bv = b ?? Number.NEGATIVE_INFINITY;
  if (av === bv) return 0;
  const cmp = av < bv ? -1 : 1;
  return dir === 'asc' ? cmp : -cmp;
}

function compareByField(
  a: RadiationShelterListItem,
  b: RadiationShelterListItem,
  key: string,
  dir: RadiationShelterListSortDir,
  columns: DefineFieldLike[]
): number {
  const col = columns.find(
    (c) => String(c.define_field_name ?? '').trim().toLowerCase() === key.toLowerCase()
  );
  const rowA = a as unknown as Record<string, unknown>;
  const rowB = b as unknown as Record<string, unknown>;
  if (col && isNumberFieldType(col)) {
    const na = getRowValueByDefineField(rowA, key);
    const nb = getRowValueByDefineField(rowB, key);
    const parse = (v: unknown) => {
      if (v == null || v === '') return null;
      const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
      return Number.isFinite(n) ? n : null;
    };
    return compareNumber(parse(na), parse(nb), dir);
  }
  const sa = String(getRowValueByDefineField(rowA, key) ?? '').trim();
  const sb = String(getRowValueByDefineField(rowB, key) ?? '').trim();
  return compareText(sa, sb, dir);
}

export function sortRadiationShelterListRows(
  rows: RadiationShelterListItem[],
  sorts: RadiationShelterListSortSpec[] | null | undefined,
  columns: DefineFieldLike[]
): RadiationShelterListItem[] {
  const specs = sorts ?? [];
  if (specs.length === 0) {
    return [...rows].sort((a, b) => b.id - a.id);
  }
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const cmp = compareByField(a, b, spec.key, spec.dir, columns);
      if (cmp !== 0) return cmp;
    }
    return b.id - a.id;
  });
}

export function toggleRadiationShelterSort(
  prev: RadiationShelterListSortSpec[],
  key: string,
  columns: DefineFieldLike[]
): RadiationShelterListSortSpec[] {
  const initial = initialRadiationShelterSortDir(key, columns);
  const idx = prev.findIndex((s) => s.key.toLowerCase() === key.toLowerCase());
  if (idx < 0) return [...prev, { key, dir: initial }];
  const cur = prev[idx];
  if (cur.dir === initial) {
    const next = [...prev];
    next[idx] = { key, dir: initial === 'asc' ? 'desc' : 'asc' };
    return next;
  }
  return prev.filter((s) => s.key.toLowerCase() !== key.toLowerCase());
}
