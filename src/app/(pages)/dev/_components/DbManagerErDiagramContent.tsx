"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { erDiagramMeta, type ErTable } from "@/database/erDiagramMeta"
import mermaid from "mermaid"

type DiagramMode = "physical" | "logical"

function escapeMermaidId(s: string): string {
  return s.replace(/\]/g, "\\]").replace(/\[/g, "\\[").replace(/"/g, "'")
}

/** Mermaid ER alias: 한글/공백 등은 대괄호 안에서 큰따옴표로 감싸야 파서 통과 */
function escapeAliasInQuotes(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function buildErDiagramCode(mode: DiagramMode): string {
  const { tables, relations } = erDiagramMeta
  const lines: string[] = ["erDiagram", "    direction LR"]

  const entityId = (t: ErTable) => t.tableName
  const entityLabel = (t: ErTable) =>
    mode === "physical" ? t.tableName : `${t.tableName}["${escapeAliasInQuotes(t.tableComment)}"]`
  const attrKey = (col: { pk: boolean; fk?: { table: string; column: string } }) => {
    const keys: string[] = []
    if (col.pk) keys.push("PK")
    if (col.fk) keys.push("FK")
    return keys.length ? ` ${keys.join(", ")}` : ""
  }

  for (const t of tables) {
    const label = entityLabel(t)
    lines.push(`    ${label} {`)
    for (const c of t.columns) {
      const colWithComment = c as { name: string; type: string; pk: boolean; fk?: { table: string; column: string }; comment?: string }
      // Mermaid ER: attribute is "type name [PK|FK] [\"comment\"]" — comment must be at end
      const namePart = mode === "physical" ? c.name : c.name
      const commentPart =
        mode === "logical" && colWithComment.comment
          ? ` "${escapeMermaidId(colWithComment.comment)}"`
          : ""
      lines.push(`        ${c.type} ${namePart}${attrKey(c)}${commentPart}`)
    }
    lines.push("    }")
  }

  for (const r of relations) {
    const fromTable = tables.find((t) => t.tableName === r.fromTable)
    const toTable = tables.find((t) => t.tableName === r.toTable)
    if (fromTable && toTable) {
      lines.push(`    ${entityId(fromTable)} ||--o{ ${entityId(toTable)} : ""`)
    }
  }

  return lines.join("\n")
}

export function DbManagerErDiagramContent({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<DiagramMode>("physical")
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const code = useMemo(() => buildErDiagramCode(mode), [mode])

  const renderDiagram = useCallback(async () => {
    setError(null)
    try {
      mermaid.initialize({
        startOnLoad: false,
        er: { useMaxWidth: true },
        securityLevel: "loose",
      })
      const { svg: result } = await mermaid.render(`er-${mode}-${Date.now()}`, code)
      setSvg(result)
    } catch (e) {
      setSvg(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [code, mode])

  useEffect(() => {
    renderDiagram()
  }, [renderDiagram])

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={mode === "physical" ? "default" : "outline"}
            className="rounded-none"
            onClick={() => setMode("physical")}
          >
            물리 다이어그램
          </Button>
          <Button
            size="sm"
            variant={mode === "logical" ? "default" : "outline"}
            className="rounded-none"
            onClick={() => setMode("logical")}
          >
            논리 다이어그램
          </Button>
        </div>
        <Button size="sm" variant="ghost" className="rounded-none" onClick={onBack}>
          닫기
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto border rounded-none bg-muted/30 p-4">
        {error && (
          <div className="text-destructive text-sm mb-2">
            {error}
          </div>
        )}
        {svg && (
          <div
            className="mermaid-container flex items-start justify-center"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>
    </div>
  )
}
