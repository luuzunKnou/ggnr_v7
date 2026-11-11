'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, CheckSquare, Download, FileText, ImageIcon, RefreshCw, Search, Settings, Square, X } from 'lucide-react'
import { call } from '@/lib/api'
import { getConsLedgerVariant, type ConsLedgerKind } from '@/lib/consLedgerVariant'
import { cn } from '@/lib/utils'
import { Switch } from '@/app/shadcnComponents/ui/switch'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import {
  groupWtlConsProjects,
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
import { loadWtlConsGeoms, loadWtlConsLedger, loadWtlConsZones, type WtlConsGeom4326, type WtlConsLedgerItem, type WtlConsZoneItem } from './wtlConsLedgerApi'
import { useWtlConsMapLayer, type WtlConsMapFocus } from './useWtlConsMapLayer'
import { WtlConsAlertSettingsDialog } from './WtlConsAlertSettingsDialog'
import {
  CONS_ALERT_OPEN_EVENT,
  clearPendingConsAlert,
  peekPendingConsAlert,
} from './wtlConsAlertNotif'
import {
  ServiceFileImagePreview,
  downloadServiceFilePreviewBlob,
  downloadServiceFilePreviewItemsZip,
  type ServiceFilePreviewItem,
} from '../../../_mapComponents/standard/ServiceFileImagePreview'
import {
  ServiceFilePdfPreview,
  type ServiceFilePdfPreviewItem,
} from '../../../_mapComponents/standard/ServiceFilePdfPreview'
import {
  CONS_RELATED_UI_OPTIONS,
  WtlConsRelatedTabs,
  type ConsRelatedUi,
} from './WtlConsRelatedTabs'

const LIST_DEFAULT = 460
const LIST_MIN = 380
const LIST_MAX = 700
const DETAIL_DEFAULT = 420
const DETAIL_MIN = 340
const DETAIL_MAX = 580
/** 첨부 처음 높이·최소. 머리 + 썸네일 한 줄(약 96px) */
const ATTACH_MIN_HEIGHT = 200
/** v6 하단 첨부 칸 비율(47.5%) */
const ATTACH_MAX_RATIO = 0.475

function attachMaxHeight() {
  if (typeof window === 'undefined') return ATTACH_MIN_HEIGHT
  const cap = Math.round(window.innerHeight * ATTACH_MAX_RATIO)
  return Math.max(ATTACH_MIN_HEIGHT, cap)
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 예시 PDF 1쪽. 실제 파일이 붙기 전까지 PDF 뷰어가 열리게 한다 */
const SAMPLE_PDF_URL =
  'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAzOCA+PgpzdHJlYW0KQlQgL0YxIDE4IFRmIDcyIDc2MCBUZCAoU2FtcGxlKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMyOCAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjM5OAolJUVPRgo='

function attachmentImageUrl(file: WtlConsAttachment) {
  const label = escapeXml(file.name)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900"><rect width="100%" height="100%" fill="hsl(${file.thumbHue} 38% 28%)"/><text x="50%" y="48%" fill="white" font-size="42" text-anchor="middle" font-family="sans-serif">${label}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** 첨부 묶음 이름. 데이터조회와 같이 서울 시각_메뉴명 첨부파일 */
function consAttachmentZipName() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value?.padStart(2, '0') ?? '00'
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const stamp = `${year}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`
  return `${stamp}_공사대장 첨부파일.zip`
}

function attachmentFileUrl(file: WtlConsAttachment): { url: string; fileName: string } | null {
  if (file.kind === 'pdf') return { url: SAMPLE_PDF_URL, fileName: file.name }
  if (file.kind === 'image') return { url: attachmentImageUrl(file), fileName: file.name }
  return null
}

type LedgerKind = Extract<ConsLedgerKind, 'wtl' | 'swl'>

type Props = {
  kind?: LedgerKind
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

export function WtlConstructionLedgerShell({
  kind = 'wtl',
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
}: Props) {
  const [rows, setRows] = useState<WtlConsLedgerItem[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [listWidth, setListWidth] = useState(LIST_DEFAULT)
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT)
  const [projectQuery, setProjectQuery] = useState('')
  const [emdSelected, setEmdSelected] = useState('')
  const [riSelected, setRiSelected] = useState('')
  const [supplyBlock, setSupplyBlock] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [fitToken, setFitToken] = useState(0)
  const [alertJump, setAlertJump] = useState(0)
  const filterReadyRef = useRef(false)
  const pinProjectRef = useRef<string | null>(null)
  const keepWorkRef = useRef<string | null>(null)
  const [emdOptions, setEmdOptions] = useState<{ code: string; name: string }[]>([])
  const [riOptions, setRiOptions] = useState<{ code: string; name: string }[]>([])
  const [workId, setWorkId] = useState<string | null>(null)
  const [zones, setZones] = useState<WtlConsZoneItem[]>([])
  const [zoneLoading, setZoneLoading] = useState(false)
  const [zoneId, setZoneId] = useState<string | null>(null)
  const [geomByCode, setGeomByCode] = useState<Record<string, WtlConsGeom4326 | null>>({})
  const [mapFocus, setMapFocus] = useState<WtlConsMapFocus | null>(null)
  const [alertOpen, setAlertOpen] = useState(false)
  const [relatedUi, setRelatedUi] = useState<ConsRelatedUi>('v0')
  const [attachHeight, setAttachHeight] = useState(ATTACH_MIN_HEIGHT)
  const [attachSelectMode, setAttachSelectMode] = useState(false)
  const [attachSelectedIds, setAttachSelectedIds] = useState<string[]>([])
  const [imagePreviewIndex, setImagePreviewIndex] = useState<number | null>(null)
  const [pdfPreviewIndex, setPdfPreviewIndex] = useState<number | null>(null)
  const attachSelectAnchor = useRef<number | null>(null)
  const attachHeightRef = useRef(attachHeight)
  attachHeightRef.current = attachHeight
  const attachDraggingRef = useRef(false)
  const [mapBottomInset, setMapBottomInset] = useState(0)
  const [showAllProjectGeoms, setShowAllProjectGeoms] = useState(false)
  const [uiMenuOpen, setUiMenuOpen] = useState(false)
  const uiMenuRef = useRef<HTMLDivElement>(null)

  const startAttachResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    attachDraggingRef.current = true
    const startY = event.clientY
    const startH = attachHeightRef.current
    const maxH = attachMaxHeight()
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(maxH, Math.max(ATTACH_MIN_HEIGHT, startH + (startY - ev.clientY)))
      setAttachHeight(next)
    }
    const onUp = () => {
      attachDraggingRef.current = false
      setMapBottomInset(attachHeightRef.current)
      window.removeEventListener('mousemove', onMove)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp, { once: true })
  }, [])

  useEffect(() => {
    if (!uiMenuOpen) return
    const onPointer = (event: MouseEvent) => {
      if (!uiMenuRef.current?.contains(event.target as Node)) setUiMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [uiMenuOpen])

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

  useEffect(() => {
    let cancelled = false
    setListLoading(true)
    setListError(null)
    void loadWtlConsLedger(kind)
      .then((result) => {
        if (cancelled) return
        setRows(result.rows)
        setListError(result.error ?? null)
      })
      .catch((e: unknown) => {
        if (!cancelled) setListError(e instanceof Error ? e.message : '공사 목록을 불러오지 못했습니다.')
      })
      .finally(() => {
        if (!cancelled) setListLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind])

  const emdName = emdOptions.find((o) => o.code === emdSelected)?.name ?? ''
  const riName = riOptions.find((o) => o.code === riSelected)?.name ?? ''

  const projects = useMemo(() => groupWtlConsProjects(rows), [rows])

  const filteredProjects = useMemo(
    () =>
      projects.filter((project) =>
        matchProjectFilters(project, {
          query: projectQuery,
          emdName,
          riName,
          supplyBlock,
        })
      ),
    [projects, projectQuery, emdName, riName, supplyBlock]
  )

  const project = projects.find((item) => item.id === projectId) ?? null
  const work =
    rows.find((item) => item.id === workId && project?.works.some((w) => w.id === item.id)) ?? null

  useEffect(() => {
    setImagePreviewIndex(null)
    setPdfPreviewIndex(null)
    setAttachSelectMode(false)
    setAttachSelectedIds([])
    attachSelectAnchor.current = null
    if (!work) {
      setAttachHeight(ATTACH_MIN_HEIGHT)
      setMapBottomInset(0)
      return
    }
    if (!attachDraggingRef.current) setMapBottomInset(attachHeightRef.current)
  }, [work])

  const imagePreviewItems = useMemo((): ServiceFilePreviewItem[] => {
    if (!work) return []
    return work.attachments
      .filter((file) => file.kind === 'image')
      .map((file) => ({
        url: attachmentImageUrl(file),
        fileName: file.name,
        kind: 'image' as const,
      }))
  }, [work])

  const pdfPreviewItems = useMemo((): ServiceFilePdfPreviewItem[] => {
    if (!work) return []
    return work.attachments
      .filter((file) => file.kind === 'pdf')
      .map((file) => ({ url: SAMPLE_PDF_URL, fileName: file.name }))
  }, [work])

  const openAttachment = (file: WtlConsAttachment, index: number, shiftKey: boolean) => {
    if (!work) return
    if (attachSelectMode) {
      const anchor = attachSelectAnchor.current
      if (shiftKey && anchor != null) {
        const [from, to] = anchor < index ? [anchor, index] : [index, anchor]
        const range = work.attachments.slice(from, to + 1).map((item) => item.id)
        setAttachSelectedIds((prev) => [...new Set([...prev, ...range])])
      } else {
        setAttachSelectedIds((prev) =>
          prev.includes(file.id) ? prev.filter((id) => id !== file.id) : [...prev, file.id]
        )
        attachSelectAnchor.current = index
      }
      return
    }
    if (file.kind === 'pdf') {
      const pdfIndex = work.attachments.slice(0, index + 1).filter((item) => item.kind === 'pdf').length - 1
      setPdfPreviewIndex(pdfIndex)
      return
    }
    if (file.kind === 'image') {
      const imageIndex = work.attachments.slice(0, index + 1).filter((item) => item.kind === 'image').length - 1
      setImagePreviewIndex(imageIndex)
    }
  }

  const downloadAttachments = async (files: WtlConsAttachment[]) => {
    const items = files.flatMap((file) => {
      const item = attachmentFileUrl(file)
      return item ? [item] : []
    })
    if (items.length === 0) return
    if (items.length === 1) {
      await downloadServiceFilePreviewBlob(items[0].url, items[0].fileName)
      return
    }
    await downloadServiceFilePreviewItemsZip(items, consAttachmentZipName())
  }

  const activeZone = zones.find((z) => z.id === zoneId) ?? null
  const projectGeomKey = project?.works.map((item) => item.consCode).join(',') ?? ''

  useEffect(() => {
    if (!projectGeomKey) {
      setGeomByCode({})
      return
    }
    const codes = projectGeomKey.split(',').filter(Boolean)
    let cancelled = false
    void loadWtlConsGeoms(kind, codes).then((result) => {
      if (cancelled) return
      const next: Record<string, WtlConsGeom4326 | null> = {}
      for (const row of result.rows) next[row.consCode] = row.geom4326
      setGeomByCode(next)
    })
    return () => {
      cancelled = true
    }
  }, [kind, projectGeomKey])

  const projectGeoms = useMemo(
    () =>
      (project?.works ?? []).map((item) => ({
        id: item.consCode,
        geom4326: geomByCode[item.consCode] ?? null,
      })),
    [project, geomByCode]
  )
  const visibleProjectGeoms = useMemo(() => {
    if (!work || showAllProjectGeoms) return projectGeoms
    return projectGeoms.filter((item) => item.id === work.consCode)
  }, [projectGeoms, work, showAllProjectGeoms])

  useWtlConsMapLayer({
    projectGeoms: visibleProjectGeoms,
    selectedId: work?.consCode ?? null,
    zones,
    zoneId,
    focus: mapFocus,
    fitToken,
    bottomInset: mapBottomInset,
  })

  const detailOpen = Boolean(work)
  const total = listWidth + (detailOpen ? detailWidth : 0)

  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => {
    return () => onTotalWidthChange(0)
  }, [onTotalWidthChange])

  useEffect(() => {
    const keep = keepWorkRef.current
    keepWorkRef.current = null
    setMapFocus(null)
    setAlertOpen(false)
    if (keep) {
      setWorkId(keep)
      return
    }
    setWorkId(null)
  }, [projectId])

  useEffect(() => {
    const pinned = pinProjectRef.current
    if (pinned && projects.some((item) => item.id === pinned)) {
      if (projectId !== pinned) setProjectId(pinned)
      return
    }
    if (projectId && filteredProjects.some((item) => item.id === projectId)) return
    setProjectId(filteredProjects[0]?.id ?? null)
  }, [filteredProjects, projectId, projects])

  useEffect(() => {
    const ledgerKind = kind === 'swl' ? 'swl' : 'wtl'
    const take = () => {
      if (peekPendingConsAlert(ledgerKind)) setAlertJump((n) => n + 1)
    }
    take()
    window.addEventListener(CONS_ALERT_OPEN_EVENT, take)
    return () => window.removeEventListener(CONS_ALERT_OPEN_EVENT, take)
  }, [kind])

  useEffect(() => {
    const ledgerKind = kind === 'swl' ? 'swl' : 'wtl'
    const code = peekPendingConsAlert(ledgerKind)
    if (!code || projects.length === 0) return
    const hit = projects.find((item) =>
      item.works.some((workItem) => workItem.consCode === code || workItem.id === code)
    )
    const workItem = hit?.works.find((item) => item.consCode === code || item.id === code)
    if (!hit || !workItem) return
    clearPendingConsAlert(ledgerKind)
    pinProjectRef.current = hit.id
    if (projectId !== hit.id) {
      keepWorkRef.current = workItem.id
      setProjectId(hit.id)
    } else {
      setWorkId(workItem.id)
    }
    setFitToken((token) => token + 1)
  }, [alertJump, projects, projectId, kind])

  const filterKey = `${projectQuery}\u0000${emdSelected}\u0000${riSelected}\u0000${supplyBlock}`
  useEffect(() => {
    if (!filterReadyRef.current) {
      filterReadyRef.current = true
      return
    }
    pinProjectRef.current = null
    setWorkId(null)
    setMapFocus(null)
    setFitToken((token) => token + 1)
  }, [filterKey])

  useEffect(() => {
    setAlertOpen(false)
    setZoneId(null)
    setZones([])
    if (!workId) {
      setZoneLoading(false)
      return
    }
    setZoneLoading(true)
    let cancelled = false
    void loadWtlConsZones(workId, kind)
      .then((zoneResult) => {
        if (cancelled) return
        setZones(zoneResult.zones)
      })
      .catch(() => {
        if (!cancelled) setZones([])
      })
      .finally(() => {
        if (!cancelled) setZoneLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workId, kind])

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
              <span className="standard-panel-title">{getConsLedgerVariant(kind).title}</span>
              <div ref={uiMenuRef} className="relative flex items-center">
                <button
                  type="button"
                  className="standard-panel-close"
                  aria-label="화면 시안"
                  aria-expanded={uiMenuOpen}
                  onClick={() => setUiMenuOpen((open) => !open)}
                >
                  <Settings className="h-4 w-4" />
                </button>
                {uiMenuOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded border border-border bg-background p-2 shadow-md">
                    <label className="mb-1 block text-[11px] text-muted-foreground" htmlFor="wtl-cons-related-ui">
                      참고 메뉴
                    </label>
                    <select
                      id="wtl-cons-related-ui"
                      value={relatedUi}
                      onChange={(e) => setRelatedUi(e.target.value as ConsRelatedUi)}
                      className="h-8 w-full rounded border border-slate-200 bg-white px-1.5 text-[11px] outline-none focus:border-primary"
                    >
                      {CONS_RELATED_UI_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <button type="button" className="standard-panel-close" onClick={onClose} aria-label="닫기">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-[0.95] flex-col border-b border-border">
                <div className="shrink-0 space-y-1.5 border-b border-border px-3 py-2">
                  <div className="text-[11px] font-semibold text-slate-700">사업목록</div>
                  <div className="flex items-center gap-1.5">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        type="search"
                        value={projectQuery}
                        onChange={(e) => setProjectQuery(e.target.value)}
                        placeholder="사업명·위치 검색"
                        className="h-8 w-full rounded border border-slate-200 bg-white pl-7 pr-2 text-[11px] outline-none focus:border-primary"
                      />
                    </div>
                    <button
                      type="button"
                      title="검색·필터 초기화"
                      onClick={() => {
                        setProjectQuery('')
                        setEmdSelected('')
                        setRiSelected('')
                        setSupplyBlock('')
                      }}
                      className="inline-flex h-8 shrink-0 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      초기화
                    </button>
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
                      {WTL_CONS_SUPPLY_BLOCKS.map((block) => (
                        <option key={block} value={block}>
                          {block}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <ul className="min-h-0 flex-1 overflow-y-auto">
                  {listLoading ? (
                    <li className="px-3 py-8 text-center text-xs text-slate-400">사업 목록을 불러오는 중…</li>
                  ) : listError ? (
                    <li className="px-3 py-8 text-center text-xs text-slate-400">{listError}</li>
                  ) : filteredProjects.length === 0 ? (
                    <li className="px-3 py-8 text-center text-xs text-slate-400">검색 결과가 없습니다.</li>
                  ) : (
                    filteredProjects.map((item) => (
                      <ProjectRow
                        key={item.id}
                        project={item}
                        active={item.id === projectId}
                        onSelect={() => {
                          pinProjectRef.current = null
                          setMapFocus(null)
                          setWorkId(null)
                          setProjectId(item.id)
                          setFitToken((token) => token + 1)
                        }}
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
                  <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-1.5 text-[11px] font-semibold text-slate-700">
                    <div className="min-w-0 truncate">
                      공사목록
                      <span className="ml-1 font-normal text-slate-400">
                        {project.workCount}건
                        {project.changeCount > 0 ? ` · 변경 ${project.changeCount}` : ''}
                      </span>
                    </div>
                    <label className="flex shrink-0 items-center gap-1 font-normal text-slate-500">
                      사업 전체 도형
                      <Switch
                        checked={!work || showAllProjectGeoms}
                        disabled={!work}
                        onCheckedChange={setShowAllProjectGeoms}
                        aria-label="사업 전체 도형"
                        title="같은 사업의 다른 공사 도형을 함께 표시합니다"
                      />
                    </label>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                    <WorkList
                      works={project.works}
                      projectName={project.name}
                      selectedId={workId}
                      onSelect={(item) => {
                        setMapFocus(null)
                        setWorkId(item.id)
                      }}
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
                  onClick={() => {
                    setMapFocus(null)
                    setWorkId(null)
                  }}
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
                  onSelectZone={(id) => {
                    setMapFocus(null)
                    setZoneId((prev) => (prev === id ? null : id))
                  }}
                  onFocus={setMapFocus}
                  workGeom4326={work ? geomByCode[work.consCode] ?? null : null}
                  kind={kind}
                  consCode={work?.consCode ?? null}
                  activeZone={activeZone}
                  zoneLoading={zoneLoading}
                  ui={relatedUi}
                />
              </div>
            </div>
          </MapSideListPanel>
          <WtlConsAlertSettingsDialog
            open={alertOpen}
            onOpenChange={setAlertOpen}
            workId={work.id}
            workName={work.name}
            kind={kind === 'swl' ? 'swl' : 'wtl'}
            startDate={work.startDate}
            doneDate={work.doneDate || work.sdoneDate}
          />
        </div>
      )}

      {work &&
        typeof document !== 'undefined' &&
        createPortal(
        <div
          className="pointer-events-auto fixed bottom-0 z-[56] flex flex-col border-t border-slate-200 bg-white/95 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur-sm"
          style={{
            left: leftOffsetPx + total,
            right: 0,
            height: attachHeight,
            minHeight: ATTACH_MIN_HEIGHT,
            maxHeight: attachMaxHeight(),
          }}
        >
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="첨부 높이 조절"
            title="위아래로 끌어 높이를 조절합니다"
            className="absolute inset-x-0 top-0 z-10 flex h-2 -translate-y-1/2 cursor-row-resize items-center justify-center"
            onMouseDown={startAttachResize}
          >
            <span className="h-1 w-10 rounded-full bg-slate-300" />
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
              <span className="truncate text-xs font-semibold text-slate-800">첨부파일</span>
              <span className="shrink-0 text-[11px] text-slate-500">{work.attachments.length}건</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {attachSelectMode && (
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    const ids = work.attachments.map((file) => file.id)
                    const allOn = ids.length > 0 && ids.every((id) => attachSelectedIds.includes(id))
                    setAttachSelectedIds(allOn ? [] : ids)
                  }}
                >
                  {work.attachments.length > 0 &&
                  work.attachments.every((file) => attachSelectedIds.includes(file.id)) ? (
                    <CheckSquare className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Square className="h-3.5 w-3.5" aria-hidden />
                  )}
                  전체 선택
                </button>
              )}
              <button
                type="button"
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px]',
                  attachSelectMode
                    ? 'border-slate-600 bg-slate-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                )}
                onClick={() => {
                  setAttachSelectMode((on) => {
                    if (on) {
                      setAttachSelectedIds([])
                      attachSelectAnchor.current = null
                    }
                    return !on
                  })
                }}
              >
                <CheckSquare className="h-3.5 w-3.5" aria-hidden />
                {attachSelectMode ? '선택 취소' : '선택'}
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                disabled={attachSelectMode && attachSelectedIds.length === 0}
                onClick={() => {
                  const files = attachSelectMode
                    ? work.attachments.filter((file) => attachSelectedIds.includes(file.id))
                    : work.attachments
                  void downloadAttachments(files).then(() => {
                    if (attachSelectMode) {
                      setAttachSelectMode(false)
                      setAttachSelectedIds([])
                      attachSelectAnchor.current = null
                    }
                  })
                }}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                {attachSelectMode ? `선택 다운로드 (${attachSelectedIds.length})` : '전체 다운로드'}
              </button>
              <button
                type="button"
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
                aria-label="첨부 닫기"
                onClick={() => {
                    setMapFocus(null)
                    setWorkId(null)
                  }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {work.attachments.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">첨부파일이 없습니다.</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2.5">
                {work.attachments.map((file, index) => (
                  <AttachmentThumb
                    key={file.id}
                    file={file}
                    selectMode={attachSelectMode}
                    selected={attachSelectedIds.includes(file.id)}
                    onOpen={(shiftKey) => openAttachment(file, index, shiftKey)}
                    onDownload={() => void downloadAttachments([file])}
                  />
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body
        )}
      {imagePreviewIndex != null && imagePreviewItems.length > 0 && (
        <ServiceFileImagePreview
          items={imagePreviewItems}
          initialIndex={Math.min(imagePreviewIndex, imagePreviewItems.length - 1)}
          onClose={() => setImagePreviewIndex(null)}
        />
      )}
      {pdfPreviewIndex != null && pdfPreviewItems.length > 0 && (
        <ServiceFilePdfPreview
          items={pdfPreviewItems}
          initialIndex={Math.min(pdfPreviewIndex, pdfPreviewItems.length - 1)}
          onClose={() => setPdfPreviewIndex(null)}
        />
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
        const label = works.length === 1 ? w.name.trim() || '—' : workListDisplayName(w.name, projectName)
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

function AttachmentThumb({
  file,
  selectMode,
  selected,
  onOpen,
  onDownload,
}: {
  file: WtlConsAttachment
  selectMode: boolean
  selected: boolean
  onOpen: (shiftKey: boolean) => void
  onDownload: () => void
}) {
  const isImage = file.kind === 'image'
  const isPdf = file.kind === 'pdf'
  return (
    <div
      className={cn(
        'group relative min-w-0 text-left',
        selected && 'rounded bg-slate-100 ring-2 ring-slate-500'
      )}
    >
      <button
        type="button"
        onClick={(event) => onOpen(event.shiftKey)}
        className={cn('block w-full', selectMode ? 'cursor-pointer' : 'cursor-zoom-in')}
        title={selectMode ? '선택' : isPdf ? 'PDF 보기' : '크게 보기'}
      >
      <div
        className="relative flex aspect-square w-full flex-col items-center justify-center overflow-hidden rounded border border-slate-200"
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
        {selectMode && (
          <span className="absolute left-1 top-1 text-slate-700">
            {selected ? (
              <CheckSquare className="h-4 w-4 rounded bg-white" aria-hidden />
            ) : (
              <Square className="h-4 w-4 rounded bg-white" aria-hidden />
            )}
          </span>
        )}
      </div>
      <p className="mt-1 truncate text-[10px] text-slate-600" title={file.name}>
        {file.name}
      </p>
      <p className="truncate text-[9px] text-slate-400">
        {file.sizeLabel} · {file.registeredAt}
      </p>
      </button>
      {!selectMode && (
        <button
          type="button"
          className="absolute right-1 top-1 rounded bg-black/55 p-1 text-white opacity-0 group-hover:opacity-100"
          aria-label="다운로드"
          title="다운로드"
          onClick={onDownload}
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}
