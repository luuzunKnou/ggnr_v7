'use client';

import { useEffect, useState } from 'react';
import {
  isDefineFieldCodeType,
  type DefineCodeRow,
} from '@/lib/defineLayerCodeDisplay';

type FieldLike = {
  define_field_name?: string;
  define_field_type?: unknown;
};

export type UseDefineLayerCodesOptions = {
  /** 분할 레이어 등: tableName에 코드가 없을 때 부모·물리 테이블명으로 재조회 */
  fallbackTableName?: string | null;
};

function codeFieldNamesKey(fields: FieldLike[]): string {
  const names: string[] = [];
  for (const f of fields) {
    if (!isDefineFieldCodeType(f.define_field_type)) continue;
    const name = String(f.define_field_name ?? '').trim();
    if (name) names.push(name);
  }
  return names.join('\0');
}

function tablesToTry(
  tableName: string,
  fallbackTableName?: string | null
): string[] {
  const primary = String(tableName ?? '').trim();
  const fallback = String(fallbackTableName ?? '').trim();
  const out: string[] = [];
  if (primary) out.push(primary);
  if (fallback && fallback !== primary) out.push(fallback);
  return out;
}

async function fetchCodes(tableFieldKey: string): Promise<DefineCodeRow[]> {
  try {
    const res = await fetch(`/api/config/defineLayer/codes/${encodeURIComponent(tableFieldKey)}`);
    const body = (await res.json()) as { data?: DefineCodeRow[] };
    return Array.isArray(body?.data) ? body.data : [];
  } catch {
    return [];
  }
}

async function loadCodesForField(
  tables: string[],
  fieldName: string
): Promise<DefineCodeRow[]> {
  const nameVariants = [fieldName];
  const upper = fieldName.toUpperCase();
  if (upper !== fieldName) nameVariants.push(upper);
  const lower = fieldName.toLowerCase();
  if (lower !== fieldName && lower !== upper) nameVariants.push(lower);

  for (const table of tables) {
    for (const name of nameVariants) {
      const codes = await fetchCodes(`${table}__${name}`);
      if (codes.length > 0) return codes;
    }
  }
  return [];
}

/** 레이어 설정(Code) JSON — 필드명 소문자 키 */
export function useDefineLayerCodes(
  tableName: string | null | undefined,
  fields: FieldLike[],
  options?: UseDefineLayerCodesOptions
): Record<string, DefineCodeRow[]> {
  const [codesByField, setCodesByField] = useState<Record<string, DefineCodeRow[]>>({});
  const table = String(tableName ?? '').trim();
  const fallback = String(options?.fallbackTableName ?? '').trim();
  const namesKey = codeFieldNamesKey(fields);
  const tablesKey = tablesToTry(table, fallback).join('\0');

  useEffect(() => {
    if (!table || !namesKey) {
      setCodesByField((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const codeFieldNames = namesKey.split('\0');
    const tables = tablesKey.split('\0').filter(Boolean);
    let cancelled = false;
    void Promise.all(
      codeFieldNames.map(async (name) => {
        const codes = await loadCodesForField(tables, name);
        return [name.toLowerCase(), codes] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, DefineCodeRow[]> = {};
      for (const [k, codes] of entries) next[k] = codes;
      setCodesByField(next);
    });
    return () => {
      cancelled = true;
    };
  }, [table, tablesKey, namesKey]);

  return codesByField;
}
