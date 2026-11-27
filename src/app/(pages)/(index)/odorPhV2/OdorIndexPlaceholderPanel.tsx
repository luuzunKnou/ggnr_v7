'use client'

type Props = {
  title: string
  description: string
}

/** 미구현 메뉴 자리 — 목업 안내 */
export function OdorIndexPlaceholderPanel({ title, description }: Props) {
  return (
    <div className="flex min-h-[240px] flex-1 flex-col items-center justify-center rounded border border-dashed border-border bg-muted/20 px-6 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-2 max-w-md text-xs text-muted-foreground">{description}</p>
      <p className="mt-3 text-[11px] text-muted-foreground">화면 목업 준비 중</p>
    </div>
  )
}
