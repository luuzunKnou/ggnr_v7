'use client';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { Button } from '@/app/shadcnComponents/ui/button';
import type { SchemaSyncPreviewResult } from '@/lib/schemaSyncPreviewTypes';

type Props = {
  open: boolean;
  preview: SchemaSyncPreviewResult | null;
  loading?: boolean;
  onConfirm: () => void;
};

function ItemList({
  title,
  items,
  className,
}: {
  title: string;
  items: { summary: string; sql: string }[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={className}>
      <div className="mb-1 text-xs font-medium">{title}</div>
      <ul className="max-h-28 space-y-1 overflow-y-auto rounded border border-border bg-muted/30 p-2 text-xs">
        {items.map((it, i) => (
          <li key={`${it.sql}-${i}`} className="break-all" title={it.sql}>
            {it.summary}
            <span className="ml-1 text-muted-foreground">— {it.sql}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 최신소스 병합 후 스키마 변경 안내 (입력 없음 · ALTER 빨간색)
 */
export function SchemaSyncPreviewModal({ open, preview, loading, onConfirm }: Props) {
  const counts = preview?.counts ?? { create: 0, drop: 0, delete: 0, alter: 0 };
  const items = preview?.items ?? [];
  const creates = items.filter((i) => i.category === 'create');
  const drops = items.filter((i) => i.category === 'drop' || i.category === 'delete');
  const alters = items.filter((i) => i.category === 'alter');
  const failed = preview != null && !preview.ok;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onConfirm()}>
      <DialogContent
        className="sm:max-w-lg max-h-[85vh] flex flex-col"
        showCloseButton={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>스키마 변경 안내</DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto text-sm">
          {loading && (
            <p className="text-muted-foreground">스키마 비교 중…</p>
          )}

          {!loading && failed && (
            <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive">
              미리보기에 실패했습니다. 고정 정책(생성 적용 · 삭제·수정 스킵)으로 재기동합니다.
              {preview?.error ? (
                <span className="mt-1 block text-xs opacity-90">{preview.error}</span>
              ) : null}
            </p>
          )}

          {!loading && (
            <>
              <p className="text-xs text-muted-foreground">
                재기동 시 생성만 자동 반영됩니다. 삭제·데이터 비우기·ALTER(수정)는 실행하지 않습니다.
              </p>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-1.5 pr-2 font-medium">구분</th>
                    <th className="py-1.5 font-medium">건수</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/60">
                    <td className="py-1.5 pr-2">생성 (적용)</td>
                    <td className="py-1.5">{counts.create}</td>
                  </tr>
                  <tr className="border-b border-border/60">
                    <td className="py-1.5 pr-2">DROP (거부)</td>
                    <td className="py-1.5">{counts.drop}</td>
                  </tr>
                  <tr className="border-b border-border/60">
                    <td className="py-1.5 pr-2">DELETE·TRUNCATE (거부)</td>
                    <td className="py-1.5">{counts.delete}</td>
                  </tr>
                  <tr className="border-b border-border/60">
                    <td className="py-1.5 pr-2 text-destructive font-medium">ALTER (스킵)</td>
                    <td className="py-1.5 text-destructive font-medium">{counts.alter}</td>
                  </tr>
                </tbody>
              </table>

              <ItemList title="생성 (적용 예정)" items={creates} />
              <ItemList title="DROP·DELETE (거부)" items={drops} />
              <ItemList
                title="ALTER (스킵 · 수동 반영 필요)"
                items={alters}
                className="text-destructive [&_ul]:border-destructive/40 [&_li]:text-destructive"
              />

              {preview?.ok &&
                counts.create === 0 &&
                counts.drop === 0 &&
                counts.delete === 0 &&
                counts.alter === 0 && (
                  <p className="text-xs text-muted-foreground">적용·스킵할 스키마 변경이 없습니다.</p>
                )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            title="확인"
            className="cursor-pointer"
            disabled={loading}
            onClick={onConfirm}
          >
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
