'use client';

import { useCallback, useEffect, useState } from 'react';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { Input } from '@/app/shadcnComponents/ui/input';

export type ShpExtraFieldMapping = {
  sourceField: string;
  labelKo?: string;
  dataType?: string;
};

type AttrField = { name: string; dataType: string };

type Props = {
  pathOrResult: string;
  sourceFile: string;
  value: ShpExtraFieldMapping[];
  onChange: (next: ShpExtraFieldMapping[]) => void;
};

/** 신규 SHP — 추가속성으로 옮길 속성 선택·한글명·jsonb 미리보기 */
export function ShpExtraFieldsPicker({ pathOrResult, sourceFile, value, onChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<AttrField[]>([]);
  const [preview, setPreview] = useState<Array<Record<string, string>>>([]);
  const [previewBusy, setPreviewBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void call('', 'POST', {
      service: 'shpUploadService',
      action: 'listShpAttributeFields',
      params: { pathOrResult },
    })
      .then((res) => {
        if (cancelled) return;
        const d = res?.data ?? res;
        if (!d?.success && d?.error) {
          setFields([]);
          setError(String(d.error));
          return;
        }
        setFields(Array.isArray(d?.fields) ? d.fields : []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setFields([]);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pathOrResult]);

  useEffect(() => {
    if (value.length === 0) {
      setPreview([]);
      return;
    }
    let cancelled = false;
    setPreviewBusy(true);
    void call('', 'POST', {
      service: 'shpUploadService',
      action: 'previewShpExtraJson',
      params: { pathOrResult, fields: value },
    })
      .then((res) => {
        if (cancelled) return;
        const d = res?.data ?? res;
        setPreview(Array.isArray(d?.preview) ? d.preview : []);
      })
      .catch(() => {
        if (!cancelled) setPreview([]);
      })
      .finally(() => {
        if (!cancelled) setPreviewBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pathOrResult, value]);

  const selected = new Set(value.map((v) => v.sourceField.toLowerCase()));

  const toggle = useCallback(
    (field: AttrField, on: boolean) => {
      if (on) {
        if (selected.has(field.name.toLowerCase())) return;
        onChange([
          ...value,
          { sourceField: field.name, labelKo: '', dataType: field.dataType },
        ]);
      } else {
        onChange(value.filter((v) => v.sourceField.toLowerCase() !== field.name.toLowerCase()));
      }
    },
    [onChange, selected, value]
  );

  const setLabel = useCallback(
    (sourceField: string, labelKo: string) => {
      onChange(
        value.map((v) =>
          v.sourceField.toLowerCase() === sourceField.toLowerCase() ? { ...v, labelKo } : v
        )
      );
    },
    [onChange, value]
  );

  return (
    <div className="rounded-md border border-border/70 bg-background p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-foreground truncate" title={sourceFile}>
          {sourceFile}
        </p>
        <span className="shrink-0 text-[10px] text-muted-foreground">추가속성 선택</span>
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        선택한 속성은 일반 속성 컬럼이 아니라 추가속성(extra)으로만 저장됩니다. 한글 이름을 비우면
        SHP 영문 필드명을 씁니다.
      </p>
      {loading ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          속성 목록 불러오는 중…
        </p>
      ) : error ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : fields.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">선택 가능한 속성이 없습니다.</p>
      ) : (
        <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
          {fields.map((f) => {
            const on = selected.has(f.name.toLowerCase());
            const mapping = value.find((v) => v.sourceField.toLowerCase() === f.name.toLowerCase());
            return (
              <li
                key={f.name}
                className={cn(
                  'flex flex-wrap items-center gap-2 rounded border border-transparent px-1.5 py-1',
                  on && 'border-border bg-muted/40'
                )}
              >
                <label className="flex min-w-0 flex-1 items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0"
                    checked={on}
                    onChange={(e) => toggle(f, e.target.checked)}
                  />
                  <span className="truncate font-mono text-foreground" title={f.name}>
                    {f.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{f.dataType}</span>
                </label>
                {on ? (
                  <Input
                    value={mapping?.labelKo ?? ''}
                    onChange={(e) => setLabel(f.name, e.target.value)}
                    placeholder="한글명"
                    className="h-7 w-36 text-[11px]"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {value.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground">
            미리보기 (샘플 1건)
            {previewBusy ? ' …' : ''}
          </p>
          <pre className="max-h-36 overflow-auto rounded border border-border bg-muted/30 p-2 text-[10px] leading-snug text-foreground">
            {JSON.stringify(preview, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
