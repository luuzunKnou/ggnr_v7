'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll';
import {
  buildSafetyFacDetailRowsFromDefine,
  buildSafetyFacTitleFromDefine,
  isDefineFieldCodeType,
  type DefineCodeRow,
  type SafetyFacDefineField,
} from './safetyFacDetailConfig';
import {
  SAFETY_FAC_LIST_CHIP_LABEL,
  getSafetyFacBadgeStyle,
  type SafetyFacFacilityRow,
} from './safetyFacSymbols';

type Props = {
  facility: SafetyFacFacilityRow;
  onClose: () => void;
};

export function SafetyFacDetailPanel({ facility, onClose }: Props) {
  const [fields, setFields] = useState<SafetyFacDefineField[]>([]);
  const [codesByField, setCodesByField] = useState<Record<string, DefineCodeRow[]>>({});
  const chipName = SAFETY_FAC_LIST_CHIP_LABEL[facility.subtype];

  useEffect(() => {
    let cancelled = false;
    setFields([]);
    setCodesByField({});
    void fetch(`/api/config/defineLayer/fields/${encodeURIComponent(facility.table)}`)
      .then((r) => r.json())
      .then(async (json: { data?: SafetyFacDefineField[] }) => {
        const nextFields = Array.isArray(json?.data) ? json.data : [];
        if (cancelled) return;
        setFields(nextFields);
        const codeFields = nextFields.filter(isDefineFieldCodeType);
        if (codeFields.length === 0) {
          setCodesByField({});
          return;
        }
        const entries = await Promise.all(
          codeFields.map(async (f) => {
            const name = String(f.define_field_name ?? '').trim();
            if (!name) return null;
            const key = `${facility.table}__${name}`;
            try {
              const res = await fetch(`/api/config/defineLayer/codes/${encodeURIComponent(key)}`);
              const body = (await res.json()) as { data?: DefineCodeRow[] };
              const codes = Array.isArray(body?.data) ? body.data : [];
              return [name.toLowerCase(), codes] as const;
            } catch {
              return [name.toLowerCase(), [] as DefineCodeRow[]] as const;
            }
          })
        );
        if (cancelled) return;
        const next: Record<string, DefineCodeRow[]> = {};
        for (const e of entries) {
          if (!e) continue;
          next[e[0]] = e[1];
        }
        setCodesByField(next);
      })
      .catch(() => {
        if (!cancelled) {
          setFields([]);
          setCodesByField({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [facility.table]);

  const rows = useMemo(
    () => buildSafetyFacDetailRowsFromDefine(facility.detailAttrs, fields, codesByField),
    [facility.detailAttrs, fields, codesByField]
  );
  const headerTitle = useMemo(() => {
    const fromDefine = buildSafetyFacTitleFromDefine(
      facility.detailAttrs,
      fields,
      codesByField,
      facility.table
    );
    return fromDefine || facility.name;
  }, [facility.detailAttrs, facility.name, facility.table, fields, codesByField]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background" aria-label="재난대응시설 상세">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className="inline-flex shrink-0 items-center rounded px-2.5 py-1.5 text-[10px] font-semibold leading-none"
            style={getSafetyFacBadgeStyle(facility.subtype)}
          >
            {chipName}
          </span>
          <p className="min-w-0 truncate text-sm font-semibold leading-snug text-foreground" title={headerTitle}>
            {headerTitle || '—'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <MapSideDetailScroll className="min-h-0 flex-1 overflow-y-auto p-3">
        {rows.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">표시할 항목이 없습니다.</p>
        ) : (
          <div className="overflow-hidden rounded-[5px] border border-border">
            {rows.map((row, index) => (
              <div
                key={`${row.label}-${index}`}
                className={cn('flex', index !== rows.length - 1 && 'border-b border-border')}
              >
                <div className="flex min-w-0 w-[min(5.5rem,32%)] shrink-0 items-start bg-muted/40 px-2 py-1.5">
                  <span className="min-w-0 w-full whitespace-normal break-words text-[11px] leading-snug text-muted-foreground">
                    {row.label}
                  </span>
                </div>
                <div
                  className={cn(
                    'flex items-start px-2 py-1.5',
                    row.maxLength == null ? 'min-w-0 flex-1' : 'shrink-0 overflow-hidden'
                  )}
                  style={
                    row.maxLength != null
                      ? { width: `${row.maxLength}ch`, maxWidth: '100%' }
                      : undefined
                  }
                >
                  <span
                    className={cn(
                      'text-[11px] leading-snug text-muted-foreground',
                      row.maxLength == null
                        ? 'break-all'
                        : 'block w-full truncate whitespace-nowrap'
                    )}
                    title={row.maxLength != null ? row.value : undefined}
                  >
                    {row.value}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </MapSideDetailScroll>
    </div>
  );
}
