"use client"

import { type ReactNode, useEffect, useState } from "react"
import { Download, ExternalLink, FileText, Loader2, Scale } from "lucide-react"
import { cn } from "@/lib/utils"
import { call } from "@/lib/api"
import {
  explainHandbookExample,
  HANDBOOK_SCALE_FIELDS,
  handbookFileAccess,
  handbookFileOrg,
  handbookMaterialAccess,
  handbookMaterialOrg,
  handbookChapterLabel,
  parseHandbookLaw,
  type HandbookExampleNumberField,
  type HandbookFile,
  type HandbookFileAccess,
  type HandbookGuideLine,
  type HandbookMaterial,
  type HandbookOrg,
  type HandbookProcedure,
} from "./roadWorkHandbookData"
import { useHandbookMapPick, type HandbookMapDrawKind } from "./roadWorkHandbookMapContext"

function orgBadgeClass(org: HandbookOrg) {
  if (org === "과업포함") return "bg-primary text-white"
  if (org === "별도") return "bg-[#3B8DE0] text-white"
  return "bg-muted text-muted-foreground"
}

export function OrgBadge({ org }: { org: HandbookOrg }) {
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none", orgBadgeClass(org))}>
      {org}
    </span>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="border-b border-border/70 pb-1 text-[12px] font-semibold text-foreground">{children}</p>
  )
}

function GuideLineRow({ line }: { line: HandbookGuideLine }) {
  return (
    <li className="flex gap-2">
      <span
        className={cn(
          "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full",
          line.tone === "met" && "bg-primary",
          line.tone === "unmet" && "bg-muted-foreground/45",
          line.tone === "info" && "bg-border"
        )}
        aria-hidden
      />
      <p className="min-w-0 break-keep text-[11px] leading-relaxed text-foreground">{line.text}</p>
    </li>
  )
}

const fieldControlClass =
  "h-7 w-full rounded border border-border bg-background px-2 text-[12px] outline-none ring-offset-1 focus:border-border focus:ring-2 focus:ring-ring"

function mapKindForField(field: HandbookExampleNumberField): HandbookMapDrawKind | null {
  if (field.unit === "km") return "line"
  if (field.unit === "㎡") return "polygon"
  return null
}

export function HandbookScaleCard() {
  const mapPick = useHandbookMapPick()
  const vals = mapPick?.scaleVals ?? {}
  const setScaleField = mapPick?.setScaleField

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] leading-snug text-muted-foreground">
        규모를 적은 뒤 적용하면 절차별 해당 여부가 갱신됩니다. 길이와 면적은 지도에서 그릴 수 있습니다.
      </p>
      <div className="space-y-1.5">
        {HANDBOOK_SCALE_FIELDS.map((field) => (
          <div key={field.key} className="flex items-center gap-1.5">
            <label
              htmlFor={`hb-scale-${field.key}`}
              className="w-[5.5rem] shrink-0 whitespace-nowrap text-[11px] font-medium leading-tight text-foreground"
            >
              {field.label}
            </label>
            {field.kind === "select" ? (
              <select
                id={`hb-scale-${field.key}`}
                value={vals[field.key] ?? ""}
                onChange={(e) => setScaleField?.(field.key, e.target.value)}
                className={cn(fieldControlClass, "min-w-0 flex-1")}
              >
                <option value="">선택</option>
                {field.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  id={`hb-scale-${field.key}`}
                  type="number"
                  min={0}
                  inputMode="decimal"
                  placeholder={field.placeholder}
                  value={vals[field.key] ?? ""}
                  onChange={(e) => setScaleField?.(field.key, e.target.value)}
                  className={cn(fieldControlClass, "min-w-0 flex-1")}
                />
                <span className="w-7 shrink-0 text-[11px] text-muted-foreground">{field.unit}</span>
                {mapPick && mapKindForField(field) ? (
                  <button
                    type="button"
                    title={mapKindForField(field) === "line" ? "지도에서 구간 그리기" : "지도에서 범위 그리기"}
                    className={cn(
                      "h-7 shrink-0 rounded border px-1.5 text-[11px]",
                      mapPick.activePick?.fieldKey === field.key
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-foreground hover:bg-muted/50"
                    )}
                    onClick={() => {
                      const kind = mapKindForField(field)
                      if (!kind) return
                      if (mapPick.activePick?.fieldKey === field.key) {
                        mapPick.cancelPick()
                        return
                      }
                      mapPick.startPick({ kind, fieldKey: field.key, label: field.label })
                    }}
                  >
                    {mapKindForField(field) === "line" ? "구간" : "범위"}
                  </button>
                ) : null}
                {mapPick?.drawnFieldKeys.includes(field.key) ? (
                  <button
                    type="button"
                    title="지도 도형 지우기"
                    className="h-7 shrink-0 rounded border border-border bg-background px-1.5 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    onClick={() => mapPick.clearDrawn(field.key)}
                  >
                    지우기
                  </button>
                ) : null}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProcedureGuideCard({ proc }: { proc: HandbookProcedure }) {
  const mapPick = useHandbookMapPick()
  const vals = mapPick?.scaleVals ?? {}
  const lines = explainHandbookExample(proc, vals)

  if (!proc.exampleKind) {
    return (
      <div className="rounded-[5px] border border-border/90 bg-card p-3 text-left shadow-sm">
        <p className="border-b border-border/70 pb-1 text-[12px] font-semibold text-foreground">규모로 본 결과</p>
        <p className="mt-2 break-keep text-[11px] leading-relaxed text-muted-foreground">
          이 절차는 길이·면적·공사비로 대상 여부를 정하지 않습니다. 대상 기준을 직접 확인합니다.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-[5px] border border-border/90 bg-card p-3 text-left shadow-sm">
      <p className="border-b border-border/70 pb-1 text-[12px] font-semibold text-foreground">규모로 본 결과</p>
      <div className="mt-2">
        {lines.length > 0 ? (
          <ul className="space-y-2">
            {lines.map((line) => (
              <GuideLineRow key={line.text} line={line} />
            ))}
          </ul>
        ) : (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            왼쪽에서 규모를 넣으면 이 절차 기준과 비교합니다.
          </p>
        )}
      </div>
    </div>
  )
}

export function ProcedureDetailCard({ proc }: { proc: HandbookProcedure }) {
  const law = parseHandbookLaw(proc.law)

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-[5px] border border-border/90 bg-card p-3 text-left shadow-sm">
        <div className="border-b border-border/60 pb-2">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
            <h3 className="min-w-0 flex-1 break-keep text-[12px] font-semibold leading-snug text-foreground">
              {proc.name}
            </h3>
            <OrgBadge org={proc.org} />
          </div>
          <p className="mt-1.5 break-keep text-[11px] leading-relaxed text-muted-foreground">{proc.criteria}</p>
        </div>

        <div className="mt-3 space-y-3.5">
          <section>
            <p className="border-b border-border/70 pb-1 text-[12px] font-semibold text-foreground">관련 법령</p>
            <div className="mt-2">
              <p className="break-keep text-[12px] font-semibold leading-snug text-foreground">{law.name}</p>
              {law.articles ? (
                <p className="mt-1 break-keep text-[11px] leading-relaxed text-muted-foreground">{law.articles}</p>
              ) : null}
            </div>
          </section>
          <section>
            <SectionLabel>대상 기준</SectionLabel>
            <ol className="mt-2 space-y-2">
              {proc.criteriaItems.map((item, index) => (
                <li key={item} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2">
                  <span className="text-[11px] font-medium leading-relaxed tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <p className="break-keep text-[11px] leading-relaxed text-foreground">{item}</p>
                </li>
              ))}
            </ol>
          </section>
          {proc.note ? (
            <section>
              <SectionLabel>추가 안내</SectionLabel>
              <p className="mt-2 break-keep text-[11px] leading-relaxed text-foreground">{proc.note}</p>
            </section>
          ) : null}
          <dl className="space-y-1.5 border-t border-b border-border/60 py-2.5">
            <div className="flex justify-between gap-2">
              <dt className="shrink-0 text-[12px] font-semibold text-foreground">수행시기</dt>
              <dd className="min-w-0 text-right text-[11px] text-foreground">{proc.when}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="shrink-0 text-[12px] font-semibold text-foreground">시행주체</dt>
              <dd className="min-w-0 text-right text-[11px] text-foreground">{proc.org}</dd>
            </div>
          </dl>
        </div>
      </div>
      <ProcedureGuideCard proc={proc} />
    </div>
  )
}

export const HANDBOOK_ACCESS_LABEL: Record<HandbookFileAccess, string> = {
  download: "내려받기",
  link: "원문",
  none: "준비중",
}

export function HandbookFileAccessBadge({
  access,
  label,
}: {
  access: HandbookFileAccess
  label?: string
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium leading-none",
        access === "download" && "bg-primary text-white",
        access === "link" && "bg-[#3B8DE0] text-white",
        access === "none" && "bg-muted text-muted-foreground"
      )}
    >
      {label ?? HANDBOOK_ACCESS_LABEL[access]}
    </span>
  )
}

function HandbookFileCardInner({
  file,
  extra,
  hideDownloadBadge,
}: {
  file: HandbookFile
  extra?: ReactNode
  /** 상세 자료 목록 — 내려받기 배지·아이콘 숨김 */
  hideDownloadBadge?: boolean
}) {
  const access = handbookFileAccess(file)
  const org = handbookFileOrg(file)
  const showDownloadBadge = access === "download" && !hideDownloadBadge
  const showLinkBadge = access === "link"
  return (
    <>
      <FileText className="h-4 w-4 shrink-0 text-destructive" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-foreground" title={file.name}>
          {file.name}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1">
          <span className="truncate text-[11px] text-muted-foreground" title={file.src}>
            {org}
            {extra}
          </span>
        </span>
      </span>
      {showDownloadBadge ? <HandbookFileAccessBadge access="download" /> : null}
      {showLinkBadge ? <HandbookFileAccessBadge access="link" /> : null}
      {access === "none" ? <HandbookFileAccessBadge access="none" /> : null}
      {showDownloadBadge ? (
        <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
      {showLinkBadge ? <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
    </>
  )
}

const fileRowClass =
  "flex min-h-[44px] w-full items-center gap-2 rounded border border-border bg-card px-2.5 py-2 text-left shadow-sm transition-colors hover:bg-muted/50"

function MaterialInfoCard({ material }: { material: HandbookMaterial }) {
  const labelClass = "font-semibold text-foreground"
  const valueClass = "font-normal leading-relaxed text-foreground"

  return (
    <div className="rounded-[5px] border border-border/90 bg-card p-3 text-left shadow-sm">
      <dl className="space-y-3">
        <div className="flex justify-between gap-2 border-b border-border/60 pb-2.5">
          <dt className={cn("shrink-0 text-[12px]", labelClass)}>제목</dt>
          <dd className={cn("min-w-0 text-right break-keep text-[11px]", valueClass)}>{material.name}</dd>
        </div>
        <div>
          <dt className={cn("border-b border-border/70 pb-1 text-[12px]", labelClass)}>비고</dt>
          <dd className={cn("mt-2 break-keep text-[11px]", valueClass)}>{material.source}</dd>
        </div>
      </dl>
      {material.desc ? (
        <p className={cn("mt-3 break-keep border-t border-border/60 pt-3 text-[11px]", valueClass)}>{material.desc}</p>
      ) : null}
    </div>
  )
}

export function HandbookFileActionRow({
  file,
  highlighted,
  hideDownloadBadge,
}: {
  file: HandbookFile
  highlighted?: boolean
  hideDownloadBadge?: boolean
}) {
  const access = handbookFileAccess(file)
  const inner = <HandbookFileCardInner file={file} hideDownloadBadge={hideDownloadBadge} />
  const className = cn(fileRowClass, highlighted && "border-primary bg-primary/10 dark:bg-primary/25")
  if (access === "download") {
    return (
      <a
        href={file.url}
        download={file.name}
        target="_blank"
        rel="noopener noreferrer"
        title={`${file.name} 내려받기`}
        className={className}
      >
        {inner}
      </a>
    )
  }
  if (access === "link") {
    return (
      <a href={file.url} target="_blank" rel="noopener noreferrer" title={file.src} className={className}>
        {inner}
      </a>
    )
  }
  return (
    <div className={className} title={file.src}>
      {inner}
    </div>
  )
}

export function HandbookMaterialListButton({
  material,
  selected,
  fileHint,
  onClick,
}: {
  material: HandbookMaterial
  selected: boolean
  fileHint?: string
  onClick: () => void
}) {
  const access = handbookMaterialAccess(material)
  const showAccessBadge = access !== "none"
  return (
    <button
      type="button"
      title={material.name}
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left transition-colors",
        selected ? "bg-primary/10 dark:bg-primary/25" : "hover:bg-muted/50"
      )}
    >
      <FileText
        className={cn("h-4 w-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")}
        strokeWidth={1.75}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {showAccessBadge ? <HandbookFileAccessBadge access={access} /> : null}
          <span
            className={cn(
              "min-w-0 truncate text-[12px] font-medium leading-snug",
              selected ? "text-primary" : "text-foreground"
            )}
          >
            {material.name}
          </span>
        </div>
        <span
          className="truncate text-[11px] text-muted-foreground"
          title={handbookChapterLabel(material.chapter)}
        >
          {handbookChapterLabel(material.chapter)}
          {fileHint ? ` · ${fileHint}` : ""}
        </span>
      </div>
    </button>
  )
}

export function MaterialFilesPanel({
  material,
  highlightKeyword,
}: {
  material: HandbookMaterial
  highlightKeyword?: string
}) {
  const kw = highlightKeyword?.trim().toLowerCase() ?? ""
  const [lawFiles, setLawFiles] = useState<HandbookFile[] | null>(null)
  const [lawLoading, setLawLoading] = useState(false)
  const [lawError, setLawError] = useState<string | null>(null)

  useEffect(() => {
    if (material.notesOnly || !material.xmlUrl) {
      setLawFiles(null)
      setLawError(null)
      setLawLoading(false)
      return
    }

    let cancelled = false
    setLawLoading(true)
    setLawError(null)
    setLawFiles(null)

    call("/road-work-handbook/law-attachments", "GET", { materialId: material.id })
      .then((res) => {
        if (cancelled) return
        const attachments: { name: string; url: string }[] = res?.attachments ?? []
        setLawFiles(
          attachments.map((att) => ({
            name: att.name,
            src: "법령정보센터 첨부",
            url: att.url,
          }))
        )
      })
      .catch(() => {
        if (!cancelled) setLawError("첨부파일을 불러오지 못했습니다.")
      })
      .finally(() => {
        if (!cancelled) setLawLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [material.id, material.xmlUrl, material.notesOnly])

  if (material.notesOnly) {
    return (
      <div className="flex flex-col gap-2">
        <MaterialInfoCard material={material} />
      </div>
    )
  }

  const staticFiles = material.files
  const resolvedLawFiles = lawFiles ?? []
  const displayFiles = material.xmlUrl ? resolvedLawFiles : staticFiles
  const showLawViewLink =
    Boolean(material.xmlUrl) &&
    !lawLoading &&
    resolvedLawFiles.length === 0 &&
    Boolean(material.lawViewUrl)
  const fileCountLabel = material.xmlUrl
    ? lawLoading
      ? "조회 중…"
      : resolvedLawFiles.length > 0
        ? `${resolvedLawFiles.length}건`
        : showLawViewLink
          ? "원문"
          : "0건"
    : `${staticFiles.length}건`

  return (
    <div className="flex flex-col gap-2">
      <MaterialInfoCard material={material} />
      {displayFiles.length > 0 || showLawViewLink ? (
        <p className="px-0.5 text-[12px] font-medium text-foreground">자료 {fileCountLabel}</p>
      ) : null}
      {lawLoading ? (
        <p className="flex items-center gap-1.5 px-0.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          첨부파일 조회 중…
        </p>
      ) : null}
      {lawError && !material.lawViewUrl ? (
        <p className="px-0.5 text-[11px] text-destructive">{lawError}</p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {displayFiles.map((file) => {
          const highlighted = Boolean(
            kw && (file.name.toLowerCase().includes(kw) || file.src.toLowerCase().includes(kw))
          )
          return (
            <li key={`${material.id}-${file.name}-${file.url ?? ""}`}>
              <HandbookFileActionRow file={file} highlighted={highlighted} hideDownloadBadge />
            </li>
          )
        })}
      </ul>
      {showLawViewLink ? (
        <ul className="flex flex-col gap-1">
          <li>
            <HandbookFileActionRow
              hideDownloadBadge
              file={{
                name: "원문",
                src: "법제처 국가법령정보센터",
                url: material.lawViewUrl,
              }}
            />
          </li>
        </ul>
      ) : null}
      {material.xmlUrl &&
      !lawLoading &&
      !lawError &&
      resolvedLawFiles.length === 0 &&
      !material.lawViewUrl ? (
        <p className="px-0.5 text-[11px] text-muted-foreground">등록된 첨부파일이 없습니다.</p>
      ) : null}
      {lawError && material.lawViewUrl ? (
        <p className="px-0.5 text-[11px] text-muted-foreground">
          첨부 조회에 실패했습니다. 원문 링크를 이용하세요.
        </p>
      ) : null}
    </div>
  )
}
