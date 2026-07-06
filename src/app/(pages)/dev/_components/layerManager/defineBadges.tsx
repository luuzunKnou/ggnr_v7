import { cn } from "@/lib/utils"

const SCHEMA_STYLES: Record<string, string> = {
  layer: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  public_layer: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
}

const SOURCE_STYLES: Record<string, string> = {
  shp: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  excel: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
}

function badgeClass(extra?: string) {
  return cn(
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
    extra
  )
}

export function SchemaBadge({ value }: { value: string }) {
  const schema = (value || "layer").trim() || "layer"
  return (
    <span
      className={badgeClass(SCHEMA_STYLES[schema] ?? "bg-muted text-muted-foreground")}
      title={schema}
    >
      {schema}
    </span>
  )
}

export function SourceBadge({ value }: { value: string }) {
  const raw = value.trim()
  if (!raw) return <span className="text-xs text-muted-foreground">—</span>
  const key = raw.toLowerCase()
  const label = key === "excel" ? "Excel" : key === "shp" ? "SHP" : raw
  return (
    <span
      className={badgeClass(SOURCE_STYLES[key] ?? "bg-muted text-muted-foreground")}
      title={label}
    >
      {label}
    </span>
  )
}
