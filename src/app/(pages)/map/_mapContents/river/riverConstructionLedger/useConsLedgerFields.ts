"use client";

import { useEffect, useState } from "react";
import { call } from "@/lib/api";
import type { ConsLedgerKind } from "@/lib/consLedgerVariant";

/** null = 조회 전·실패 — 이때는 모든 항목을 보여 준다 */
const fieldsCache = new Map<ConsLedgerKind, Set<string>>();

/** 공사대장 레이어에 실제로 있는 속성 컬럼(소문자) */
export function useConsLedgerFields(kind: ConsLedgerKind): Set<string> | null {
  const [fetched, setFetched] = useState<{ kind: ConsLedgerKind; fields: Set<string> } | null>(
    null
  );

  useEffect(() => {
    if (fieldsCache.has(kind)) return;
    let cancelled = false;
    void call("", "POST", {
      service: "consDataAsService",
      action: "getFieldInfo",
      params: { kind },
    })
      .then((res) => {
        const data = res?.data ?? res;
        if (data?.error || !Array.isArray(data?.fields)) return;
        const fields = new Set((data.fields as string[]).map((f) => String(f).toLowerCase()));
        fieldsCache.set(kind, fields);
        if (!cancelled) setFetched({ kind, fields });
      })
      .catch(() => {
        /* 실패 시 전체 항목 표시 */
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  return fieldsCache.get(kind) ?? (fetched?.kind === kind ? fetched.fields : null);
}

/** fields 가 없으면(조회 전) 표시, 있으면 컬럼 존재 여부 */
export function hasConsLedgerField(fields: Set<string> | null, column: string): boolean {
  return fields == null || fields.has(column.toLowerCase());
}
