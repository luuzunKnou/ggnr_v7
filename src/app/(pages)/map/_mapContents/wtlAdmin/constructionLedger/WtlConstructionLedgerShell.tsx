'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bell, FileText, ImageIcon, Search, X } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import {
  loadWtlConsProjects,
  matchProjectFilters,
  WTL_CONS_FIELD_LABEL,
  WTL_CONS_SUPPLY_BLOCKS,
  workAmountLabel,
  workHasChange,
  workListDisplayName,
  workPeriodLabel,
  type WtlConsAttachment,
  type WtlConsProject,
  type WtlConsWork,
} from './wtlConsSample'
import { useWtlConsMapLayer } from './useWtlConsMapLayer'
import { WtlConsAlertSettingsDialog } from './WtlConsAlertSettingsDialog'
import { WtlConsRelatedTabs, type ZoneMock } from './WtlConsRelatedTabs'

const LIST_DEFAULT = 460
const LIST_MIN = 380
const LIST_MAX = 700
const DETAIL_DEFAULT = 420
const DETAIL_MIN = 340
const DETAIL_MAX = 580

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

function AttrRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[96px_1fr] border-b border-slate-100 text-[11px] last:border-b-0">
      <div className="bg-slate-50 px-2 py-1.5 font-medium text-slate-600">{label}</div>
      <div className="px-2 py-1.5 text-slate-800 break-words">{value?.trim() ? value : '—'}</div>
    </div>
  )
}

/** 한 줄 말줄임 */
function AttrRowEllipsis({ label, value }: { label: string; value: string }) {
  const text = value?.trim() ? value : '—'
  return (
    <div className="grid grid-cols-[96px_1fr] border-b border-slate-100 text-[11px] last:border-b-0">
      <div className="bg-slate-50 px-2 py-1.5 font-medium text-slate-600">{label}</div>
      <div className="truncate px-2 py-1.5 text-slate-800" title={text}>
        {text}
      </div>
    </div>
  )
}

/** 날짜 등 2열 — 라벨 폭은 AttrRow(96px)와 동일하게 맞춤 */
function AttrPairRow({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
}: {
  leftLabel: string
  leftValue: string
  rightLabel: string
  rightValue: string
}) {
  return (
    <div className="grid grid-cols-2 border-b border-slate-100 text-[11px] last:border-b-0">
      <div className="grid min-w-0 grid-cols-[96px_1fr] border-r border-slate-100">
        <div className="bg-slate-50 px-2 py-1.5 font-medium text-slate-600">{leftLabel}</div>
        <div className="truncate px-2 py-1.5 text-slate-800" title={leftValue || undefined}>
          {leftValue?.trim() ? leftValue : '—'}
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-[96px_1fr]">
        <div className="bg-slate-50 px-2 py-1.5 font-medium text-slate-600">{rightLabel}</div>
        <div className="truncate px-2 py-1.5 text-slate-800" title={rightValue || undefined}>
          {rightValue?.trim() ? rightValue : '—'}
        </div>
      </div>
    </div>
  )
}

/** 엑셀에 geom 없으면 의성 인근 목업 폴리곤 */
const MOCK_ZONE_WKT =
  'MULTIPOLYGON (((351628.30991421745 318821.63138119463, 351622.73812080605 318837.13928520377, 351640.9827150246 318843.69433672976, 351646.55450843635 318828.186432722, 351628.30991421745 318821.63138119463)))'

/** 공사구역 목업 — 공사위치 / 비고 */
const ZONE_MOCK_ROWS: { location: string; note: string }[] = [
  { location: '춘산면 사미리 216-2', note: '춘산배수지' },
  { location: '춘산면 사미신감로 50-6', note: '사미2(가정급수관로)' },
  { location: '춘산면 사미리 1095', note: '사미3(가정급수관로)' },
  { location: '춘산면 사미신감로 121-21', note: '사미4(가정급수관로)' },
  { location: '춘산면 금성현서로 910', note: '사미1(가정급수관로)' },
  { location: '춘산면 효선리 1479', note: '불회8(가정급수관로)' },
  { location: '춘산면 효선1길 51-4', note: '불회9(가정급수관로)' },
  { location: '춘산면 효선리 산 62', note: '불회3(가정급수관로)' },
  { location: '춘산면 효선2길 12-11', note: '덕동6(가정급수관로)' },
  { location: '춘산면 효선2길 23', note: '덕동7(가정급수관로)' },
  { location: '춘산면 효선리 690-3', note: '효선10(가정급수관로)' },
  { location: '춘산면 사미신감로 312', note: '효선9(가정급수관로)' },
]

function buildZoneMocks(work: WtlConsWork): ZoneMock[] {
  const geom = work.geomWkt5181?.trim() || MOCK_ZONE_WKT
  return ZONE_MOCK_ROWS.map((row, i) => ({
    id: `${work.id}-z${i + 1}`,
    location: row.location,
    note: row.note,
    geomWkt5181: i === 0 ? geom : MOCK_ZONE_WKT,
  }))
}

export function WtlConstructionLedgerShell({
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
}: Props) {
  const projects = useMemo(() => loadWtlConsProjects(), [])
  const [listWidth, setListWidth] = useState(LIST_DEFAULT)
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT)
  const [projectQuery, setProjectQuery] = useState('')
  const [emdSelected, setEmdSelected] = useState('')
  const [riSelected, setRiSelected] = useState('')
  const [supplyBlock, setSupplyBlock] = useState('')
  const [emdOptions, setEmdOptions] = useState<{ code: string; name: string }[]>([])
  const [riOptions, setRiOptions] = useState<{ code: string; name: string }[]>([])
  const [projectId, setProjectId] = useState<string | null>(projects[0]?.id ?? null)
  const [workId, setWorkId] = useState<string | null>(null)
  const [zoneId, setZoneId] = useState<string | null>(null)
  const [alertOpen, setAlertOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void call('', 'POST', {
      service: 'devTestService',
      action: 'getEmdRiOptions',
      params: {},
    })
      .then((res) => {
        if (cancelled) return
        const data = res?.data ?? res
        setEmdOptions(Array.isArray(data?.emd) ? data.emd : [])
      })
      .catch(() => {
        if (!cancelled) setEmdOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!emdSelected) {
      setRiOptions([])
      setRiSelected('')
      return
    }
    let cancelled = false
    void call('', 'POST', {
      service: 'devTestService',
      action: 'getRiOptionsByEmd',
      params: { emdCode: emdSelected },
    })
      .then((res) => {
        if (cancelled) return
        const data = res?.data ?? res
        setRiOptions(Array.isArray(data?.ri) ? data.ri : [])
        setRiSelected('')
      })
      .catch(() => {
        if (!cancelled) {
          setRiOptions([])
          setRiSelected('')
        }
      })
    return () => {
      cancelled = true
    }
  }, [emdSelected])

  const emdName = emdOptions.find((o) => o.code === emdSelected)?.name ?? ''
  const riName = riOptions.find((o) => o.code === riSelected)?.name ?? ''

  const filteredProjects = useMemo(
    () =>
      projects.filter((p) =>
        matchProjectFilters(p, {
          query: projectQuery,
          emdName,
          riName,
          supplyBlock,
        })
      ),
    [projects, projectQuery, emdName, riName, supplyBlock]
  )

  const project = projects.find((p) => p.id === projectId) ?? null
  const work =
    project?.works.find((w) => w.id === workId) ??
    projects.flatMap((p) => p.works).find((w) => w.id === workId) ??
    null

  const zones = useMemo(() => (work ? buildZoneMocks(work) : []), [work])
  const activeZone = zones.find((z) => z.id === zoneId) ?? zones[0] ?? null
  const mapWork = useMemo(() => {
    if (!work || !activeZone) return null
    return { ...work, geomWkt5181: activeZone.geomWkt5181 }
  }, [work, activeZone])

  useWtlConsMapLayer(mapWork)

  const detailOpen = Boolean(work)
  const total = listWidth + (detailOpen ? detailWidth : 0)

  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => {
    return () => onTotalWidthChange(0)
  }, [onTotalWidthChange])

  useEffect(() => {
    setWorkId(null)
    setZoneId(null)
    setAlertOpen(false)
  }, [projectId])

  useEffect(() => {
    setAlertOpen(false)
  }, [workId])

  useEffect(() => {
    if (!work) {
      setZoneId(null)
      return
    }
    setZoneId(buildZoneMocks(work)[0]?.id ?? null)
  }, [work])

  useEffect(() => {
    if (projectId && !filteredProjects.some((p) => p.id === projectId)) {
      setProjectId(filteredProjects[0]?.id ?? null)
    }
  }, [filteredProjects, projectId])

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={listWidth}
          minWidth={LIST_MIN}
          maxWidth={LIST_MAX}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setListWidth}
        >
          <div className="standard-panel-root">
            <div className="standard-panel-header">
              <span className="standard-panel-title">공사대장</span>
              <button type="button" className="standard-panel-close" onClick={onClose} aria-label="닫기">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-[0.95] flex-col border-b border-border">
                <div className="shrink-0 space-y-1.5 border-b border-border px-3 py-2">
                  <div className="text-[11px] font-semibold text-slate-700">사업목록</div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="search"
                      value={projectQuery}
                      onChange={(e) => setProjectQuery(e.target.value)}
                      placeholder="사업명·위치 검색"
                      className="h-8 w-full rounded border border-slate-200 bg-white pl-7 pr-2 text-[11px] outline-none focus:border-primary"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <select
                      value={emdSelected}
                      onChange={(e) => setEmdSelected(e.target.value)}
                      className="h-8 min-w-0 rounded border border-slate-200 bg-white px-1.5 text-[11px] outline-none focus:border-primary"
                      aria-label="읍면동"
                    >
                      <option value="">읍면동</option>
                      {emdOptions.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          {opt.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={riSelected}
                      onChange={(e) => setRiSelected(e.target.value)}
                      disabled={!emdSelected}
                      className="h-8 min-w-0 rounded border border-slate-200 bg-white px-1.5 text-[11px] outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label="리"
                    >
                      <option value="">리</option>
                      {riOptions.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          {opt.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={supplyBlock}
                      onChange={(e) => setSupplyBlock(e.target.value)}
                      className="h-8 min-w-0 rounded border border-slate-200 bg-white px-1.5 text-[11px] outline-none focus:border-primary"
                      aria-label="급수블록"
                    >
                      <option value="">급수블록</option>
                      {WTL_CONS_SUPPLY_BLOCKS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <ul className="min-h-0 flex-1 overflow-y-auto">
                  {filteredProjects.length === 0 ? (
                    <li className="px-3 py-8 text-center text-xs text-slate-400">검색 결과가 없습니다.</li>
                  ) : (
                    filteredProjects.map((p) => (
                      <ProjectRow
                        key={p.id}
                        project={p}
                        active={p.id === projectId}
                        onSelect={() => setProjectId(p.id)}
                      />
                    ))
                  )}
                </ul>
              </div>

              {project && (
                <div className="flex min-h-0 flex-[1.2] flex-col overflow-hidden">
                  <div className="shrink-0 border-b border-border px-3 py-1.5 text-[11px] font-semibold text-slate-700">
                    사업 상세정보
                  </div>
                  <div className="shrink-0 max-h-[38%] overflow-y-auto border-b border-border p-2">
                    <ProjectInfo project={project} />
                  </div>
                  <div className="shrink-0 px-3 py-1.5 text-[11px] font-semibold text-slate-700">
                    공사목록
                    <span className="ml-1 font-normal text-slate-400">
                      {project.workCount}건
                      {project.changeCount > 0 ? ` · 변경 ${project.changeCount}` : ''}
                    </span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                    <WorkList
                      works={project.works}
                      projectName={project.name}
                      selectedId={workId}
                      onSelect={(w) => setWorkId(w.id)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </MapSideListPanel>
      </div>

      {detailOpen && work && (
        <div className="pointer-events-auto shrink-0">
          <MapSideListPanel
            width={detailWidth}
            minWidth={DETAIL_MIN}
            maxWidth={DETAIL_MAX}
            leftOffsetPx={leftOffsetPx + listWidth}
            onWidthChange={setDetailWidth}
            contentClassName="overflow-hidden"
          >
            <div className="standard-panel-root">
              <div className="standard-panel-header">
                <span className="standard-panel-title truncate pr-2">{work.name}</span>
                <button
                  type="button"
                  className="standard-panel-close"
                  aria-label="닫기"
                  onClick={() => setWorkId(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-slate-700">공사정보</p>
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-700 hover:bg-slate-50"
                      onClick={() => setAlertOpen(true)}
                    >
                      <Bell className="h-3.5 w-3.5 text-primary" aria-hidden />
                      알림설정
                    </button>
                  </div>
                  <div className="overflow-hidden rounded border border-slate-200">
                    <AttrRowEllipsis label={WTL_CONS_FIELD_LABEL.name} value={work.name} />
                    <AttrRow label={WTL_CONS_FIELD_LABEL.location} value={work.location} />
                    <AttrRowEllipsis label={WTL_CONS_FIELD_LABEL.volume} value={work.volume} />
                    <AttrRow label={WTL_CONS_FIELD_LABEL.amountPre} value={work.amountPre} />
                    <AttrRow label={WTL_CONS_FIELD_LABEL.amountVar} value={work.amountVar} />
                    <AttrRow label={WTL_CONS_FIELD_LABEL.amountCha} value={work.amountCha} />
                    <AttrRow label={WTL_CONS_FIELD_LABEL.amountAft} value={work.amountAft} />
                    <AttrPairRow
                      leftLabel={WTL_CONS_FIELD_LABEL.contDate}
                      leftValue={work.contDate}
                      rightLabel={WTL_CONS_FIELD_LABEL.startDate}
                      rightValue={work.startDate}
                    />
                    <AttrPairRow
                      leftLabel={WTL_CONS_FIELD_LABEL.doneDate}
                      leftValue={work.doneDate}
                      rightLabel={WTL_CONS_FIELD_LABEL.sdoneDate}
                      rightValue={work.sdoneDate}
                    />
                    <AttrRow label={WTL_CONS_FIELD_LABEL.company} value={work.company} />
                    <AttrRow label={WTL_CONS_FIELD_LABEL.ceo} value={work.ceo} />
                    <AttrRowEllipsis label={WTL_CONS_FIELD_LABEL.companyAddr} value={work.companyAddr} />
                    <AttrRow label={WTL_CONS_FIELD_LABEL.companyPhone} value={work.companyPhone} />
                    <AttrRow label={WTL_CONS_FIELD_LABEL.directorPos} value={work.directorPos} />
                    <AttrRow label={WTL_CONS_FIELD_LABEL.directorName} value={work.directorName} />
                    <AttrRow label={WTL_CONS_FIELD_LABEL.reason} value={work.reason} />
                    <AttrRow label={WTL_CONS_FIELD_LABEL.descript} value={work.descript} />
                  </div>
                </div>
                <WtlConsRelatedTabs
                  zones={zones}
                  zoneId={zoneId}
                  onSelectZone={setZoneId}
                  activeZone={activeZone}
                />
              </div>
            </div>
          </MapSideListPanel>
          <WtlConsAlertSettingsDialog
            open={alertOpen}
            onOpenChange={setAlertOpen}
            workId={work.id}
            workName={work.name}
            startDate={work.startDate}
            doneDate={work.doneDate || work.sdoneDate}
          />
        </div>
      )}

      {work && (
        <div
          className="pointer-events-auto absolute bottom-0 z-30 flex flex-col border-t border-slate-200 bg-white/95 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur-sm"
          style={{
            left: leftOffsetPx + total,
            right: 0,
            height: '50%',
          }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
              <span className="truncate text-xs font-semibold text-slate-800">첨부파일</span>
              <span className="shrink-0 text-[11px] text-slate-500">
                {work.attachments.length}건 · {work.name}
              </span>
            </div>
            <button
              type="button"
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
              aria-label="첨부 닫기"
              onClick={() => setWorkId(null)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {work.attachments.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">첨부파일이 없습니다.</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2.5">
                {work.attachments.map((file) => (
                  <AttachmentThumb key={file.id} file={file} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function ProjectRow({
  project,
  active,
  onSelect,
}: {
  project: WtlConsProject
  active: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-left text-[11px]',
          active ? 'bg-slate-100' : 'hover:bg-slate-50'
        )}
      >
        <span className="min-w-0 flex-1 truncate font-medium text-slate-800" title={project.name}>
          {project.name}
        </span>
        <span className="shrink-0 tabular-nums text-slate-500" title="기간">
          {project.periodLabel}
        </span>
        <span className="w-[7.5rem] shrink-0 truncate text-right tabular-nums text-slate-600" title="총괄금액">
          {project.totalAmountLabel}
        </span>
      </button>
    </li>
  )
}

function ProjectInfo({ project }: { project: WtlConsProject }) {
  return (
    <div className="overflow-hidden rounded border border-slate-200">
      <AttrRow label={WTL_CONS_FIELD_LABEL.projectName} value={project.name} />
      <AttrRow label={WTL_CONS_FIELD_LABEL.location} value={project.location} />
      <AttrRow label={WTL_CONS_FIELD_LABEL.amountPre} value={project.amountPreLabel} />
      <AttrRow label={WTL_CONS_FIELD_LABEL.amountAft} value={project.amountAftLabel} />
      <AttrRow label={WTL_CONS_FIELD_LABEL.startDate} value={project.startDate} />
      <AttrRow label={WTL_CONS_FIELD_LABEL.doneDate} value={project.doneDate} />
      <AttrRow label={WTL_CONS_FIELD_LABEL.descript} value={project.descript} />
    </div>
  )
}

function WorkList({
  works,
  projectName,
  selectedId,
  onSelect,
  empty = '공사가 없습니다.',
}: {
  works: WtlConsWork[]
  projectName: string
  selectedId: string | null
  onSelect: (work: WtlConsWork) => void
  empty?: string
}) {
  if (works.length === 0) {
    return <p className="py-8 text-center text-xs text-slate-400">{empty}</p>
  }
  return (
    <ul className="overflow-hidden rounded border border-slate-200">
      {works.map((w) => {
        const label = workListDisplayName(w.name, projectName)
        return (
        <li key={w.id}>
          <button
            type="button"
            onClick={() => onSelect(w)}
            className={cn(
              'flex w-full items-center gap-2 border-b border-slate-100 px-2 py-1.5 text-left text-[11px] last:border-b-0',
              selectedId === w.id ? 'bg-slate-100' : 'hover:bg-slate-50'
            )}
          >
            <span className="min-w-0 flex-1 truncate font-medium text-slate-800" title={w.name}>
              {workHasChange(w) ? (
                <span className="mr-1 inline-block rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-800">
                  변경
                </span>
              ) : null}
              {label}
            </span>
            <span className="w-[4.5rem] shrink-0 truncate tabular-nums text-slate-500" title={workPeriodLabel(w)}>
              {workPeriodLabel(w)}
            </span>
            <span className="w-[6.5rem] shrink-0 truncate text-right tabular-nums text-slate-600" title={workAmountLabel(w)}>
              {workAmountLabel(w)}
            </span>
          </button>
        </li>
        )
      })}
    </ul>
  )
}

function AttachmentThumb({ file }: { file: WtlConsAttachment }) {
  const isImage = file.kind === 'image'
  const isPdf = file.kind === 'pdf'
  return (
    <div className="min-w-0">
      <div
        className="flex aspect-square w-full flex-col items-center justify-center overflow-hidden rounded border border-slate-200"
        style={
          isImage
            ? {
                background: `linear-gradient(145deg, hsl(${file.thumbHue} 55% 72%), hsl(${file.thumbHue} 40% 48%))`,
              }
            : undefined
        }
        title={file.name}
      >
        {isImage ? (
          <ImageIcon className="h-7 w-7 text-white/90 drop-shadow" aria-hidden />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-slate-50 text-slate-500">
            <FileText className="h-6 w-6" aria-hidden />
            <span className="text-[10px] font-semibold">{isPdf ? 'PDF' : '파일'}</span>
          </div>
        )}
      </div>
      <p className="mt-1 truncate text-[10px] text-slate-600" title={file.name}>
        {file.name}
      </p>
      <p className="truncate text-[9px] text-slate-400">
        {file.sizeLabel} · {file.registeredAt}
      </p>
    </div>
  )
}
