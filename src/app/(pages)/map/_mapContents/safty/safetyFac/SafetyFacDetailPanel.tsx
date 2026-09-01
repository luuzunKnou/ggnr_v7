'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { appFetch } from '@/lib/basePath';
import {
  buildSafetyFacCustomDetailRows,
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
import { SafetyFacRelatedLayerSection } from './SafetyFacRelatedLayerSection';
import { SafetyFacHistorySection } from './SafetyFacHistorySection';

/** 라벨 글자 수 기준 컬럼 폭(rem). 한 줄 유지·과대 확장 방지 */
function maxLabelColumnRem(labels: string[]): number {
  if (labels.length === 0) return 6.5;
  const maxChars = Math.max(...labels.map((l) => [...l].length));
  return Math.min(Math.max(maxChars * 0.68, 6.5), 9.5);
}

type Props = {
  facility: SafetyFacFacilityRow;
  onClose: () => void;
};

export function SafetyFacDetailPanel({ facility, onClose }: Props) {
  const [fields, setFields] = useState<SafetyFacDefineField[]>([]);
  const [codesByField, setCodesByField] = useState<Record<string, DefineCodeRow[]>>({});
  const [basicOpen, setBasicOpen] = useState(true);
  const chipName = SAFETY_FAC_LIST_CHIP_LABEL[facility.subtype];

  useEffect(() => {
    let cancelled = false;
    setFields([]);
    setCodesByField({});
    setBasicOpen(true);
    void appFetch(`/api/config/defineLayer/fields/${encodeURIComponent(facility.table)}`)
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
              const res = await appFetch(`/api/config/defineLayer/codes/${encodeURIComponent(key)}`);
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
    () =>
      buildSafetyFacCustomDetailRows(facility.table, facility.detailAttrs, fields, codesByField),
    [facility.table, facility.detailAttrs, fields, codesByField]
  );
  const labelColumnRem = useMemo(
    () => maxLabelColumnRem(rows.map((r) => r.label)),
    [rows]
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
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background"
      aria-label="재난대응시설 상세"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className="inline-flex shrink-0 items-center rounded px-2.5 py-1.5 text-[10px] font-semibold leading-none"
            style={getSafetyFacBadgeStyle(facility.subtype)}
          >
            {chipName}
          </span>
          <p
            className="min-w-0 truncate text-sm font-semibold leading-snug text-foreground"
            title={headerTitle}
          >
            {headerTitle || '—'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="shrink-0 border-border bg-background px-3 py-2 pb-0">
        <SafetyFacRelatedLayerSection lon={facility.lon} lat={facility.lat} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-border p-3 pt-2">
        <div className="shrink-0 border-t border-border">
          <div className="mt-1 flex items-center justify-between gap-2">
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1.5 text-left transition-colors hover:bg-muted/50"
              onClick={() => setBasicOpen((v) => !v)}
              title={basicOpen ? '기본 정보 접기' : '기본 정보 펼치기'}
            >
              {basicOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="text-[12px] font-semibold text-muted-foreground">기본 정보</span>
            </button>
          </div>
          {basicOpen ? (
            <div className="mt-2 px-0 pb-1">
              {rows.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">표시할 항목이 없습니다.</p>
              ) : (
                <>
                  <div className="overflow-hidden rounded-[5px] border border-border">
                    {rows.map((row, index) => (
                      <div
                        key={`${row.label}-${index}`}
                        className={cn('flex', index !== rows.length - 1 && 'border-b border-border')}
                      >
                        <div
                          className="flex shrink-0 items-start bg-muted px-2 py-1.5"
                          style={{ width: `${labelColumnRem}rem` }}
                        >
                          <span className="whitespace-nowrap text-[11px] leading-snug text-muted-foreground">
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
                              'text-[11px] leading-snug text-foreground',
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
                  <p className="mt-1.5 text-[11px] text-muted-foreground">출처: 재난안전공유 플랫폼</p>
                </>
              )}
            </div>
          ) : null}
        </div>

        <SafetyFacHistorySection hisGubun={facility.table} ftrIdn={facility.id} />
      </div>
    </div>
  );
}
