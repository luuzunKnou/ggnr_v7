'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { Button } from '@/app/shadcnComponents/ui/button';
import { cn } from '@/lib/utils';
import { AlertTriangle, Loader2 } from 'lucide-react';

export type SchemaTypeMismatch = { name: string; shpType: string; dbType: string };

export type SchemaResolvePayload = {
  sourceFile: string;
  pathOrResult: string;
  tableName: string;
  missingInDb: string[];
  missingInShp: string[];
  typeMismatches: SchemaTypeMismatch[];
  message?: string;
};

export type SchemaResolveApplyInput = {
  mode: 'adjust' | 'recreate';
  typeChoices: Array<{ name: string; prefer: 'db' | 'shp' }>;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: SchemaResolvePayload | null;
  busy?: boolean;
  error?: string | null;
  onApply: (input: SchemaResolveApplyInput) => void | Promise<void>;
};

export function ShpSchemaResolveModal({
  open,
  onOpenChange,
  payload,
  busy = false,
  error = null,
  onApply,
}: Props) {
  const [typePrefer, setTypePrefer] = useState<Record<string, 'db' | 'shp'>>({});
  const [recreate, setRecreate] = useState(false);

  useEffect(() => {
    if (!open || !payload) return;
    const next: Record<string, 'db' | 'shp'> = {};
    for (const t of payload.typeMismatches) {
      next[t.name] = 'db';
    }
    setTypePrefer(next);
    setRecreate(false);
  }, [open, payload]);

  const hasIssues = useMemo(() => {
    if (!payload) return false;
    return (
      payload.typeMismatches.length > 0 ||
      payload.missingInDb.length > 0 ||
      payload.missingInShp.length > 0
    );
  }, [payload]);

  const handleApply = () => {
    if (!payload) return;
    if (recreate) {
      void onApply({ mode: 'recreate', typeChoices: [] });
      return;
    }
    const typeChoices = payload.typeMismatches.map((t) => ({
      name: t.name,
      prefer: typePrefer[t.name] ?? 'db',
    }));
    void onApply({ mode: 'adjust', typeChoices });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[640px] max-w-[96vw] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-sm">스키마 해소</DialogTitle>
          {payload ? (
            <p className="text-xs text-muted-foreground">
              레이어: {payload.tableName || payload.sourceFile.replace(/\.shp$/i, '')}
            </p>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-xs">
          {!payload || !hasIssues ? (
            <p className="text-muted-foreground">해소할 스키마 차이가 없습니다.</p>
          ) : (
            <>
              {payload.typeMismatches.length > 0 ? (
                <section className="space-y-2">
                  <h4 className="font-medium">타입 불일치</h4>
                  <div className="overflow-hidden rounded border">
                    <table className="w-full text-left">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-2 py-1.5 font-medium">컬럼</th>
                          <th className="px-2 py-1.5 font-medium">DB 타입</th>
                          <th className="px-2 py-1.5 font-medium">SHP 타입</th>
                          <th className="px-2 py-1.5 font-medium">선택</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payload.typeMismatches.map((t) => (
                          <tr key={t.name} className="border-t">
                            <td className="px-2 py-1.5 font-mono">{t.name}</td>
                            <td className="px-2 py-1.5">{t.dbType}</td>
                            <td className="px-2 py-1.5">{t.shpType}</td>
                            <td className="px-2 py-1.5">
                              <div className="flex flex-wrap gap-3">
                                <label className="inline-flex items-center gap-1">
                                  <input
                                    type="radio"
                                    name={`type-${t.name}`}
                                    checked={(typePrefer[t.name] ?? 'db') === 'db'}
                                    disabled={busy || recreate}
                                    onChange={() =>
                                      setTypePrefer((prev) => ({ ...prev, [t.name]: 'db' }))
                                    }
                                  />
                                  DB 유지
                                </label>
                                <label className="inline-flex items-center gap-1">
                                  <input
                                    type="radio"
                                    name={`type-${t.name}`}
                                    checked={typePrefer[t.name] === 'shp'}
                                    disabled={busy || recreate}
                                    onChange={() =>
                                      setTypePrefer((prev) => ({ ...prev, [t.name]: 'shp' }))
                                    }
                                  />
                                  SHP
                                </label>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {payload.missingInDb.length > 0 ? (
                <section className="space-y-1.5">
                  <h4 className="font-medium">SHP에만 있는 필드</h4>
                  <p className="text-muted-foreground">적용 시 DB에 컬럼을 추가합니다.</p>
                  <ul className="list-inside list-disc rounded border bg-muted/20 px-3 py-2 font-mono">
                    {payload.missingInDb.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {payload.missingInShp.length > 0 ? (
                <section className="space-y-1.5">
                  <h4 className="font-medium">DB에만 있는 필드</h4>
                  <p className="text-muted-foreground">컬럼을 삭제하지 않고 유지합니다.</p>
                  <ul className="list-inside list-disc rounded border bg-muted/20 px-3 py-2 font-mono">
                    {payload.missingInShp.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section
                className={cn(
                  'space-y-2 rounded border p-3',
                  recreate ? 'border-amber-500/60 bg-amber-500/5' : 'border-border'
                )}
              >
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={recreate}
                    disabled={busy}
                    onChange={(e) => setRecreate(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">기존 테이블을 백업명으로 바꾼 뒤 SHP로 재생성</span>
                    <span className="mt-1 flex items-start gap-1 text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      백업명은 _rctmp_테이블_날짜_시분초 형식입니다. 백업 삭제는 수동이며, 새
                      테이블은 SHP 기준으로 새로 만들어집니다.
                    </span>
                  </span>
                </label>
              </section>
            </>
          )}

          {error ? <p className="text-red-600 dark:text-red-400">{error}</p> : null}
        </div>

        <DialogFooter className="gap-2 border-t px-4 py-3 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !payload || !hasIssues}
            onClick={handleApply}
          >
            {busy ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                적용 중…
              </>
            ) : recreate ? (
              '백업 후 재생성'
            ) : (
              '적용 후 다시 검증'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
