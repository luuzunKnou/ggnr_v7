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
  busyAction?: boolean;
  onContinue: () => void;
  onAbort: () => void;
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
 * 최신소스 병합 후 스키마 변경 안내 ([중단]=롤백 · [진행]=재기동)
 */
export function SchemaSyncPreviewModal({
  open,
  preview,
  loading,
  busyAction,
  onContinue,
  onAbort,
}: Props) {
  const counts = preview?.counts ?? { create: 0, drop: 0, delete: 0, alter: 0 };
  const items = preview?.items ?? [];
  const creates = items.filter((i) => i.category === 'create');
  const drops = items.filter((i) => i.category === 'drop' || i.category === 'delete');
  const alters = items.filter((i) => i.category === 'alter');
  const failed = preview != null && !preview.ok;
  const actionsDisabled = Boolean(loading || busyAction);

  return (
    <Dialog open={open} onOpenChange={() => {}}>
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
          {loading && <p className="text-muted-foreground">스키마 비교 중…</p>}

          {!loading && failed && (
            <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive">
              미리보기에 실패했습니다. [진행] 시 고정 규칙으로 재기동하고, [중단] 시 적용 직전
              소스로 되돌립니다.
              {preview?.error ? (
                <span className="mt-1 block text-xs opacity-90">{preview.error}</span>
              ) : null}
            </p>
          )}

          {!loading && (
            <>
              <p className="text-xs text-muted-foreground">
                Drizzle 스키마에 정의된 테이블만 DB와 비교합니다. DB에만 있는 레이어 테이블 등은
                목록·건수에 넣지 않습니다. 생성은 적용하고, 정의 테이블에 대한 삭제·데이터 비우기는
                실행하지 않으며, 컬럼 수정·타입 변경 등은 건너뜁니다.
              </p>
              <p className="text-xs text-destructive">
                건너뛴 변경은 자동 반영되지 않습니다. 목록을 확인한 뒤 필요하면 개발 환경에서
                수동으로 스키마를 맞추세요.
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
                title="ALTER (스킵 · 수동 확인·동기화 필요)"
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

        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            type="button"
            title="중단"
            variant="outline"
            className="cursor-pointer"
            disabled={actionsDisabled}
            onClick={onAbort}
          >
            중단
          </Button>
          <Button
            type="button"
            title="진행"
            className="cursor-pointer"
            disabled={actionsDisabled}
            onClick={onContinue}
          >
            진행
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
