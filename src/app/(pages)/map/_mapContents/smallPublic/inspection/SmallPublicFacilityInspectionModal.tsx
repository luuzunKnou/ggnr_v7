'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SmallPublicFacility, SmallPublicFile, SmallPublicInspection } from '../smallPublicMock'
import { smallPublicActions } from '../smallPublicStore'
import {
  SmallPublicAttrTable,
  SmallPublicClassBadge,
  SmallPublicCrudBar,
  SmallPublicGradeBadge,
  SmallPublicInlineFilePreview,
  SmallPublicPanelHeader,
  smallPublicAttachmentDisplayName,
  smallPublicDateLabel,
  smallPublicSelectedRowClass,
  useSmallPublicFilePreview,
} from '../smallPublicUi'

/**
 * 점검 완료 시설 상세 — 목록 옆 붙는 패널(후보지 상세와 동일).
 * 속성 + 첨부 목록 + 인라인 미리보기.
 */
export function SmallPublicFacilityInspectionModal({
  facility: f,
  inspection: i,
  onEdit,
  onClose,
}: {
  facility: SmallPublicFacility
  inspection: SmallPublicInspection
  year: number
  onEdit: (inspection: SmallPublicInspection) => void
  onClose: () => void
  /** @deprecated 호환용 */
  overlayLeftPx?: number
  overlayWidthPx?: number
}) {
  const preview = useSmallPublicFilePreview()
  const files = useMemo(() => {
    return [i.file, i.classFile].filter((x): x is SmallPublicFile => !!x)
  }, [i])
  const [attrsOpen, setAttrsOpen] = useState(true)
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)

  useEffect(() => {
    setSelectedFileId(files[0]?.id ?? null)
  }, [i.id, files])

  const selectedFile = files.find((x) => x.id === selectedFileId) ?? files[0] ?? null

  const remove = () => {
    if (!window.confirm(`${i.date} 점검을 삭제할까요?`)) return
    smallPublicActions.deleteInspection(i.id)
    onClose()
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <SmallPublicPanelHeader
        title={f.name}
        onClose={onClose}
        badge={
          <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold leading-none text-foreground/80">
            {f.type}
          </span>
        }
      />

      <section className="shrink-0 border-b border-border">
        <button
          type="button"
          onClick={() => setAttrsOpen((o) => !o)}
          className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-xs font-semibold text-foreground/90"
        >
          {attrsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          속성정보
        </button>
        {attrsOpen ? (
          <div className="max-h-[32vh] overflow-y-auto px-3 pb-2.5 scrollbar-hide">
            <SmallPublicAttrTable
              stacked
              entries={[
                { key: 'date', label: '조사일', value: smallPublicDateLabel(i.date) },
                { key: 'inspector', label: '조사자', value: i.inspector || '—' },
                { key: 'score', label: '평가점수', value: String(i.score ?? '—') },
                { key: 'grade', label: '평가등급', value: <SmallPublicGradeBadge grade={i.grade} /> },
                {
                  key: 'class',
                  label: '평가구분',
                  value: <SmallPublicClassBadge candidate={i.classResult} />,
                },
                {
                  key: 'remark',
                  label: '기타의견',
                  value: (
                    <span className="block min-h-[3.25rem] whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground/80">
                      {i.remark || '—'}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        ) : null}
      </section>

      <div className="flex min-h-0 flex-1 flex-col px-3 py-2 text-xs">
        <p className="mb-1.5 shrink-0 text-[11px] font-semibold text-foreground/90">첨부</p>
        <div className="max-h-[28%] shrink-0 overflow-y-auto scrollbar-hide">
          {files.length === 0 ? (
            <div className="rounded border border-dashed border-border py-4 text-center text-[11px] text-muted-foreground">
              첨부 파일이 없습니다.
            </div>
          ) : (
            <div className="overflow-hidden rounded-[5px] border border-border">
              <ul className="divide-y divide-border text-[11px]">
                {files.map((file) => {
                  const active = selectedFile?.id === file.id
                  const label = smallPublicAttachmentDisplayName(file.name, f.name)
                  return (
                    <li key={file.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedFileId(file.id)}
                        className={cn(
                          'flex w-full items-center px-2 py-1.5 text-left transition-colors',
                          active ? smallPublicSelectedRowClass : 'hover:bg-muted/50'
                        )}
                        title={file.name}
                      >
                        <span className="min-w-0 flex-1 truncate text-foreground/80">{label}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
        <div className="mt-2 min-h-0 flex-1 overflow-hidden">
          <SmallPublicInlineFilePreview
            file={selectedFile}
            emptyText="목록에서 첨부를 선택하면 아래에 미리보기가 나타납니다."
            onOpenFull={
              selectedFile ? (page) => preview.open(selectedFile, files, { page }) : undefined
            }
          />
        </div>
      </div>

      <SmallPublicCrudBar onEdit={() => onEdit(i)} onDelete={remove} />
      {preview.element}
    </div>
  )
}
