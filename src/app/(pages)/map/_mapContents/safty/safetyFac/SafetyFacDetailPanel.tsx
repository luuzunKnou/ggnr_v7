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

/** 안전점검 상세 속성표 th·라벨 배경과 동일 */
const SAFETY_FAC_ATTR_LABEL_CLASS =
  'standard-detail-attr-label bg-slate-100 dark:bg-muted';

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
    <div className="standard-panel-root" aria-label="재난대응시설 상세">
      <div className="standard-panel-header">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className="inline-flex shrink-0 items-center rounded px-2.5 py-1.5 text-[10px] font-semibold leading-none"
            style={getSafetyFacBadgeStyle(facility.subtype)}
          >
            {chipName}
          </span>
          <p className="standard-panel-title min-w-0 truncate leading-snug" title={headerTitle}>
            {headerTitle || '—'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="standard-panel-close"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <section className="standard-detail-section shrink-0">
        <div className="standard-detail-section-body">
          <SafetyFacRelatedLayerSection lon={facility.lon} lat={facility.lat} />
        </div>
      </section>

      <section className="standard-detail-section shrink-0">
        <div className="standard-detail-section-header">
          <button
            type="button"
            className="standard-detail-section-toggle"
            onClick={() => setBasicOpen((v) => !v)}
            title={basicOpen ? '기본 정보 접기' : '기본 정보 펼치기'}
          >
            {basicOpen ? (
              <ChevronDown className="standard-detail-section-chevron" />
            ) : (
              <ChevronRight className="standard-detail-section-chevron" />
            )}
            <span className="standard-detail-section-toggle-label">기본 정보</span>
          </button>
        </div>
        {basicOpen ? (
          <div className="standard-detail-section-body">
            {rows.length === 0 ? (
              <p className="standard-detail-attr-empty">표시할 항목이 없습니다.</p>
            ) : (
              <>
                <div className="overflow-hidden rounded border border-border">
                  {rows.map((row, index) => (
                    <div
                      key={`${row.label}-${index}`}
                      className={cn(
                        'flex',
                        index !== rows.length - 1 && 'border-b border-border'
                      )}
                    >
                      <div
                        className={cn(
                          SAFETY_FAC_ATTR_LABEL_CLASS,
                          'flex shrink-0 items-start self-stretch'
                        )}
                        style={{ width: `${labelColumnRem}rem` }}
                      >
                        <span className="whitespace-nowrap leading-snug">{row.label}</span>
                      </div>
                      <div
                        className={cn(
                          'standard-detail-attr-value min-w-0 text-foreground',
                          row.maxLength == null ? 'flex-1' : 'shrink-0 overflow-hidden'
                        )}
                        style={
                          row.maxLength != null
                            ? { width: `${row.maxLength}ch`, maxWidth: '100%' }
                            : undefined
                        }
                      >
                        <span
                          className={cn(
                            'leading-snug',
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
                <p className="standard-detail-hint mt-1.5">출처: 재난안전공유 플랫폼</p>
              </>
            )}
          </div>
        ) : null}
      </section>

      <SafetyFacHistorySection hisGubun={facility.table} ftrIdn={facility.id} />
    </div>
  );
}
