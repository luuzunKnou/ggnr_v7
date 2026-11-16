'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, FileSearch, Pencil, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit/LayerRowPanelButton'
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll'
import { smallPublicCheckGroupScores } from '../SmallPublicCheckSheet'
import { smallPublicBtnDanger, smallPublicBtnGhost } from '../smallPublicConfig'
import type { SmallPublicFacility, SmallPublicFile, SmallPublicInspection } from '../smallPublicMock'
import { smallPublicActions } from '../smallPublicStore'
import {
  SmallPublicAttrTable,
  SmallPublicFileRow,
  SmallPublicGradeBadge,
  SmallPublicInspectionTable,
  SmallPublicPanelHeader,
  smallPublicDateLabel,
  smallPublicFacilityAttrEntries,
  useSmallPublicFilePreview,
} from '../smallPublicUi'

type Props = {
  facility: SmallPublicFacility
  inspections: SmallPublicInspection[]
  selectedInspectionId: string | null
  onSelectInspection: (id: string | null) => void
  /** 점검 등록·수정 모달 열기 */
  onRegisterInspection: () => void
  onEditInspection: (inspection: SmallPublicInspection) => void
  /** 평가표 전체 보기 모달 열기 */
  onOpenInspectionSheet: (inspection: SmallPublicInspection) => void
  onClose: () => void
}

/**
 * 고른 점검 — 간단한 상세(점검항목별 점수·합계·등급). 평가표 전체는 «평가표 보기» 모달.
 * 평가표 항목 값이 있으면(입력 점검, 항목이 넘어온 연계 점검) 요약·«평가표 보기», 없으면 합계·등급만.
 * 수정·삭제·원본 점검표는 입력 점검만.
 */
function InspectionDetail({
  inspection: i,
  facilityFiles,
  onEdit,
  onDelete,
  onOpenSheet,
}: {
  inspection: SmallPublicInspection
  /** 점검표를 열 때 미리보기 목록에 함께 넣는 시설 첨부파일 */
  facilityFiles: SmallPublicFile[]
  onEdit: () => void
  onDelete: () => void
  onOpenSheet: () => void
}) {
  const preview = useSmallPublicFilePreview()
  const editable = i.source === '입력'
  const group = i.sheet ? [i.sheet, ...facilityFiles] : []
  const hasSheet = Boolean(i.form && i.values)
  const groupScores = i.form && i.values ? smallPublicCheckGroupScores(i.form, i.values) : []
  return (
    <div className="mt-2 rounded border border-border bg-muted/30 px-2.5 py-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-xs font-semibold text-foreground/90">점검 상세</span>
        <span className="truncate text-muted-foreground">
          · {smallPublicDateLabel(i.date)} · {i.source}
        </span>
        {editable ? (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button type="button" className={smallPublicBtnGhost} onClick={onEdit}>
              <Pencil className="h-3 w-3" />
              수정
            </button>
            <button type="button" className={smallPublicBtnDanger} onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
              삭제
            </button>
          </div>
        ) : null}
      </div>
      <SmallPublicAttrTable
        entries={[
          { key: 'inspector', label: '점검자', value: i.inspector || '—' },
          { key: 'source', label: '구분', value: i.source },
          ...groupScores.map((g) => ({
            key: `group-${g.name}`,
            label: g.name,
            value: `${g.score}점 / ${g.max}`,
          })),
          { key: 'score', label: '합계점수', value: `${i.score}점` },
          { key: 'grade', label: '등급', value: <SmallPublicGradeBadge grade={i.grade} /> },
          { key: 'remark', label: '기타의견', value: i.remark || '—', full: true },
        ]}
      />
      {hasSheet ? (
        <button
          type="button"
          className={cn(smallPublicBtnGhost, 'mt-2 w-full justify-center')}
          onClick={onOpenSheet}
        >
          <FileSearch className="h-3 w-3" />
          평가표 보기
        </button>
      ) : null}
      {editable && i.sheet ? (
        <>
          <p className="mb-1 mt-2.5 text-[11px] font-semibold text-foreground/90">원본 점검표</p>
          <SmallPublicFileRow
            file={i.sheet}
            onPreview={() => i.sheet && preview.open(i.sheet, group)}
            onDownload={() => i.sheet && preview.download(i.sheet)}
          />
        </>
      ) : null}
      {preview.element}
    </div>
  )
}

export function SmallPublicInspectionDetailPanel({
  facility: f,
  inspections,
  selectedInspectionId,
  onSelectInspection,
  onRegisterInspection,
  onEditInspection,
  onOpenInspectionSheet,
  onClose,
}: Props) {
  const [attrsOpen, setAttrsOpen] = useState(true)
  const latest = inspections[0] ?? null
  const selected = inspections.find((i) => i.id === selectedInspectionId) ?? null

  const remove = (i: SmallPublicInspection) => {
    if (!window.confirm(`${i.date} 점검을 삭제할까요?`)) return
    smallPublicActions.deleteInspection(i.id)
    onSelectInspection(null)
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
          <div className="max-h-[34vh] overflow-y-auto px-3 pb-2.5 scrollbar-hide">
            <SmallPublicAttrTable entries={smallPublicFacilityAttrEntries(f, latest)} />
          </div>
        ) : null}
      </section>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs font-semibold text-foreground/90">점검이력</span>
        <LayerRowPanelButton onClick={onRegisterInspection}>
          <Plus className="h-3 w-3 shrink-0" aria-hidden />
          점검 등록
        </LayerRowPanelButton>
      </div>

      <MapSideDetailScroll className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[11px]">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-border bg-slate-50 px-2.5 py-2 dark:bg-muted">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            최근 등급
            <SmallPublicGradeBadge grade={latest?.grade} />
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            최근 점검일
            <span className="font-medium text-foreground">{latest?.date ?? '—'}</span>
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            총<span className="font-medium text-foreground">{inspections.length}건</span>
          </span>
        </div>

        <SmallPublicInspectionTable
          rows={inspections}
          selectedId={selectedInspectionId}
          onRowClick={(id) => onSelectInspection(selectedInspectionId === id ? null : id)}
          emptyText="점검 이력이 없습니다. «점검 등록»으로 첫 점검을 넣으세요."
        />

        {selected ? (
          <InspectionDetail
            key={selected.id}
            inspection={selected}
            facilityFiles={f.planFiles}
            onEdit={() => onEditInspection(selected)}
            onOpenSheet={() => onOpenInspectionSheet(selected)}
            onDelete={() => remove(selected)}
          />
        ) : inspections.length > 0 ? (
          <p className="mt-2 text-center text-muted-foreground">점검이력에서 점검을 고르면 상세가 보입니다.</p>
        ) : null}
      </MapSideDetailScroll>
    </div>
  )
}
