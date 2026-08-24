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

function codeFieldNamesKey(fields: FieldLike[]): string {
  const names: string[] = [];
  for (const f of fields) {
    if (!isDefineFieldCodeType(f.define_field_type)) continue;
    const name = String(f.define_field_name ?? '').trim();
    if (name) names.push(name);
  }
  return names.join('\0');
}

/** 레이어 설정(Code) JSON — 필드명 소문자 키 */
export function useDefineLayerCodes(
  tableName: string | null | undefined,
  fields: FieldLike[]
): Record<string, DefineCodeRow[]> {
  const [codesByField, setCodesByField] = useState<Record<string, DefineCodeRow[]>>({});
  const table = String(tableName ?? '').trim();
  const namesKey = codeFieldNamesKey(fields);

  useEffect(() => {
    if (!table || !namesKey) {
      setCodesByField((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const codeFieldNames = namesKey.split('\0');
    let cancelled = false;
    void Promise.all(
      codeFieldNames.map(async (name) => {
        const key = `${table}__${name}`;
        try {
          const res = await fetch(`/api/config/defineLayer/codes/${encodeURIComponent(key)}`);
          const body = (await res.json()) as { data?: DefineCodeRow[] };
          const codes = Array.isArray(body?.data) ? body.data : [];
          return [name.toLowerCase(), codes] as const;
        } catch {
          return [name.toLowerCase(), [] as DefineCodeRow[]] as const;
        }
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
  }, [table, namesKey]);

  return codesByField;
}
