"use client"

import { X } from "lucide-react"
import { handbookChapterLabel, type HandbookDetailSelection } from "./roadWorkHandbookData"
import { MaterialFilesPanel, ProcedureDetailCard } from "./roadWorkHandbookUi"
import { useRoadWorkHandbookCatalog } from "./useRoadWorkHandbookCatalog"

type Props = {
  selection: HandbookDetailSelection
  searchKeyword?: string
  onClose: () => void
}

export function RoadWorkHandbookDetailPanel({ selection, searchKeyword, onClose }: Props) {
  const { reviews, materials, loading, error } = useRoadWorkHandbookCatalog()
  const proc =
    selection.kind === "target" ? (reviews.find((p) => p.no === selection.no) ?? null) : null
  const material =
    selection.kind === "ref" ? (materials.find((m) => m.id === selection.materialId) ?? null) : null
  const title =
    selection.kind === "ref" && material
      ? handbookChapterLabel(material.chapter)
      : proc?.name ?? material?.name ?? "상세"

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="min-w-0 truncate text-[12px] font-semibold text-foreground">{title}</span>
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
      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-3 scrollbar-thin">
        {loading ? (
          <p className="px-1 py-6 text-center text-[11px] text-muted-foreground">불러오는 중…</p>
        ) : error ? (
          <p className="px-1 py-6 text-center text-[11px] text-destructive">{error}</p>
        ) : proc ? (
          <ProcedureDetailCard key={proc.no} proc={proc} />
        ) : material ? (
          <MaterialFilesPanel key={material.id} material={material} highlightKeyword={searchKeyword} />
        ) : (
          <p className="px-1 py-6 text-center text-[11px] text-muted-foreground">선택한 항목을 찾을 수 없습니다.</p>
        )}
      </div>
    </div>
  )
}
