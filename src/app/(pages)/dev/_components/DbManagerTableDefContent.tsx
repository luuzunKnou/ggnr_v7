"use client"

import { Button } from "@/app/shadcnComponents/ui/button"
import { erDiagramMeta, type ErTable } from "@/database/erDiagramMeta"

export function DbManagerTableDefContent({ onBack }: { onBack: () => void }) {
  const { tables } = erDiagramMeta

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <h2 className="text-lg font-semibold">테이블 정의서</h2>
        <Button size="sm" variant="ghost" className="rounded-none" onClick={onBack}>
          닫기
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto border rounded-none bg-muted/20 p-4 space-y-6">
        {tables.map((t) => (
          <TableDefBlock key={t.tableName} table={t} />
        ))}
      </div>
    </div>
  )
}

function TableDefBlock({ table }: { table: ErTable }) {
  return (
    <section className="border rounded-none bg-background p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h3 className="font-mono font-semibold text-base">{table.tableName}</h3>
        {table.tableComment && (
          <span className="text-muted-foreground text-sm">{table.tableComment}</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left py-2 px-3 font-medium">No</th>
              <th className="text-left py-2 px-3 font-medium">컬럼명</th>
              <th className="text-left py-2 px-3 font-medium">한글명</th>
              <th className="text-left py-2 px-3 font-medium">타입</th>
              <th className="text-left py-2 px-3 font-medium w-24">키</th>
              <th className="text-left py-2 px-3 font-medium">참조</th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((col, i) => (
              <tr key={col.name} className="border-b border-border/50">
                <td className="py-1.5 px-3 text-muted-foreground">{i + 1}</td>
                <td className="py-1.5 px-3 font-mono">{col.name}</td>
                <td className="py-1.5 px-3">{col.comment ?? "-"}</td>
                <td className="py-1.5 px-3 text-muted-foreground">{col.type}</td>
                <td className="py-1.5 px-3">
                  {col.pk && "PK"}
                  {col.pk && col.fk && " / "}
                  {col.fk && "FK"}
                  {!col.pk && !col.fk && "-"}
                </td>
                <td className="py-1.5 px-3 text-muted-foreground">
                  {col.fk ? `${col.fk.table}.${col.fk.column}` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
