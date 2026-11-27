'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapPin, Search, Trash2, X } from 'lucide-react'
import type { OdorSensorListItem } from '@/service/odorSensorService'
import {
  type OdorComplaintLinkMock,
  type OdorComplaintStatus,
} from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import { useMapContext } from '@/app/(pages)/map/_mapComponents/MapContext'
import { MapFloatingPanel } from '@/app/(pages)/map/_mapComponents/MapFloatingPanel'
import {
  searchAddress,
  type VWorldAddressItem,
} from '@/app/(pages)/map/_mapComponents/addressSearch/vworldAddressSearch'
import { fromLonLat } from 'ol/proj'
import { cn } from '@/lib/utils'

type FormState = {
  receivedAt: string
  dueAt: string
  type: string
  complainant: string
  phone: string
  emdNm: string
  sensorLabel: string
  locationNote: string
  title: string
  content: string
  status: OdorComplaintStatus
  lon: number | null
  lat: number | null
}

const TYPE_OPTIONS = ['악취', '시설', '기타'] as const

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

function fromDatetimeLocalValue(local: string): string {
  if (!local) return ''
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return local
  return d.toISOString()
}

function rowToForm(row: OdorComplaintLinkMock): FormState {
  return {
    receivedAt: toDatetimeLocalValue(row.receivedAt),
    dueAt: row.dueAt ? toDatetimeLocalValue(row.dueAt) : '',
    type: row.type ?? '악취',
    complainant: row.complainant ?? '',
    phone: row.phone ?? '',
    emdNm: row.emdNm,
    sensorLabel: row.sensorLabel ?? '',
    locationNote: row.locationNote ?? '',
    title: row.title,
    content: row.content ?? '',
    status: row.status,
    lon: row.lon ?? null,
    lat: row.lat ?? null,
  }
}

function emptyForm(): FormState {
  return {
    receivedAt: toDatetimeLocalValue(new Date().toISOString()),
    dueAt: toDatetimeLocalValue(new Date(Date.now() + 2 * 86400000).toISOString()),
    type: '악취',
    complainant: '',
    phone: '',
    emdNm: '',
    sensorLabel: '',
    locationNote: '',
    title: '',
    content: '',
    status: '접수',
    lon: null,
    lat: null,
  }
}

export type OdorComplaintEditor =
  | { mode: 'create' }
  | { mode: 'edit'; id: string }

type Props = {
  editor: OdorComplaintEditor | null
  items: OdorComplaintLinkMock[]
  sensors: OdorSensorListItem[]
  onClose: () => void
  onSave: (row: OdorComplaintLinkMock) => void
  onDelete?: (id: string) => void
  onGoActionHistory?: () => void
}

/** 민원 등록·수정 — 기존 민원관리처럼 지도 위 플로팅 모달 */
export function OdorComplaintFormModal({
  editor,
  items,
  sensors,
  onClose,
  onSave,
  onDelete,
  onGoActionHistory,
}: Props) {
  const mapContext = useMapContext()
  const floatingLeftPx = (mapContext?.mapPaddingLeft ?? 0) + 20
  const [form, setForm] = useState<FormState>(emptyForm)
  const [msg, setMsg] = useState<string | null>(null)
  const [msgTone, setMsgTone] = useState<'ok' | 'err'>('ok')
  const [focusToken, setFocusToken] = useState(0)
  const [addrLoading, setAddrLoading] = useState(false)
  const [addrResults, setAddrResults] = useState<VWorldAddressItem[]>([])
  const [addrDropRect, setAddrDropRect] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)
  const addrFieldRef = useRef<HTMLDivElement | null>(null)

  const editRow =
    editor?.mode === 'edit' ? items.find((c) => c.id === editor.id) ?? null : null

  const syncAddrDropRect = useCallback(() => {
    const el = addrFieldRef.current
    if (!el || addrResults.length === 0) {
      setAddrDropRect(null)
      return
    }
    const r = el.getBoundingClientRect()
    setAddrDropRect({ top: r.bottom + 4, left: r.left, width: r.width })
  }, [addrResults.length])

  useLayoutEffect(() => {
    syncAddrDropRect()
  }, [syncAddrDropRect, addrResults])

  useEffect(() => {
    if (addrResults.length === 0) return
    const onReposition = () => syncAddrDropRect()
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [addrResults.length, syncAddrDropRect])

  useEffect(() => {
    if (addrResults.length === 0) return
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (addrFieldRef.current?.contains(t)) return
      const drop = document.getElementById('odor-cmp-addr-dropdown')
      if (drop?.contains(t)) return
      setAddrResults([])
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [addrResults.length])

  useEffect(() => {
    if (!editor) {
      setAddrResults([])
      return
    }
    setMsg(null)
    setAddrResults([])
    setFocusToken((n) => n + 1)
    if (editor.mode === 'create') {
      setForm(emptyForm())
    } else if (editRow) {
      setForm(rowToForm(editRow))
    }
  }, [editor, editRow])

  const sensorOptions = useMemo(() => {
    const labels = new Set<string>()
    for (const s of sensors) {
      const label = (s.sensorKorNm || s.sensorNm || '').trim()
      if (label) labels.add(label)
    }
    for (const c of items) {
      if (c.sensorLabel) labels.add(c.sensorLabel)
    }
    return [...labels].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [sensors, items])

  const flyTo = useCallback(
    (lon: number, lat: number) => {
      const map = mapContext?.mapInstanceRef?.current
      if (!map || !Number.isFinite(lon) || !Number.isFinite(lat)) return
      const view = map.getView()
      view.animate({
        center: fromLonLat([lon, lat]),
        zoom: Math.max(view.getZoom() ?? 14, 16),
        duration: 350,
      })
    },
    [mapContext?.mapInstanceRef]
  )

  const applyAddress = useCallback(
    (item: VWorldAddressItem) => {
      const lon = item.point.x
      const lat = item.point.y
      const address =
        item.address || item.roadAddress || item.jibunAddress || form.locationNote
      setForm((prev) => ({
        ...prev,
        lon,
        lat,
        locationNote: address,
      }))
      setAddrResults([])
      setMsgTone('ok')
      setMsg('주소를 위치로 반영했습니다. 저장하면 지도에 남습니다.')
      flyTo(lon, lat)
    },
    [flyTo, form.locationNote]
  )

  const handleAddressSearch = useCallback(async () => {
    const q = form.locationNote.trim()
    if (!q) {
      setMsgTone('err')
      setMsg('주소를 입력한 뒤 위치 찾기를 누르세요.')
      return
    }
    setAddrLoading(true)
    setAddrResults([])
    setMsg(null)
    try {
      const apiKey = mapContext?.vworldApiKey?.trim() ?? ''
      const items = await searchAddress(q, {
        apiKey: apiKey || undefined,
        maxResults: 6,
        type: 'address',
        category: 'both',
      })
      if (items.length === 0) {
        setMsgTone('err')
        setMsg('검색된 주소가 없습니다. 도로명·지번을 확인해 주세요.')
        return
      }
      if (items.length === 1) {
        applyAddress(items[0]!)
        return
      }
      setAddrResults(items)
      setMsgTone('ok')
      setMsg(`${items.length}건이 검색되었습니다. 주소를 선택하세요.`)
    } catch {
      setMsgTone('err')
      setMsg('주소 검색에 실패했습니다. 잠시 후 다시 시도하세요.')
    } finally {
      setAddrLoading(false)
    }
  }, [form.locationNote, mapContext?.vworldApiKey, applyAddress])

  if (!editor) return null

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = () => {
    if (!form.title.trim()) {
      setMsgTone('err')
      setMsg('민원 제목을 입력하세요.')
      return
    }
    if (!form.receivedAt) {
      setMsgTone('err')
      setMsg('접수일을 입력하세요.')
      return
    }
    const id = editor.mode === 'edit' ? editor.id : `cp-${Date.now()}`
    onSave({
      id,
      title: form.title.trim(),
      emdNm: form.emdNm.trim() || '미지정',
      status: form.status,
      receivedAt: fromDatetimeLocalValue(form.receivedAt),
      dueAt: form.dueAt ? fromDatetimeLocalValue(form.dueAt) : undefined,
      sensorLabel: form.sensorLabel.trim() || undefined,
      type: form.type.trim() || undefined,
      complainant: form.complainant.trim() || undefined,
      phone: form.phone.trim() || undefined,
      content: form.content.trim() || undefined,
      locationNote: form.locationNote.trim() || undefined,
      lon: form.lon,
      lat: form.lat,
    })
  }

  const handleDelete = () => {
    if (editor.mode !== 'edit' || !onDelete) return
    if (!window.confirm('이 민원 접수를 삭제할까요?')) return
    onDelete(editor.id)
  }

  const inputClass =
    'h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:border-primary'
  const labelClass = 'mb-1 block text-[12px] font-medium text-muted-foreground'

  return (
    <MapFloatingPanel
      viewport
      zLayer="detailFloating"
      focusToken={focusToken}
      width="560px"
      maxHeight="92vh"
      defaultPosition={{ top: 60, left: floatingLeftPx }}
      header={
        <div className="flex w-full items-center gap-2">
          <span className="text-[14px] font-bold text-foreground">
            {editor.mode === 'create' ? '민원 등록' : '민원 수정'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      }
    >
      <div className="flex max-h-[calc(92vh-52px)] flex-col">
        <div className="min-h-0 flex-1 space-y-2.5 overflow-auto p-4">
          <div>
            <label className={labelClass} htmlFor="odor-cmp-title">
              제목
            </label>
            <input
              id="odor-cmp-title"
              className={inputClass}
              value={form.title}
              onChange={(e) => patch('title', e.target.value)}
              placeholder="민원 제목"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass} htmlFor="odor-cmp-received">
                접수일
              </label>
              <input
                id="odor-cmp-received"
                type="datetime-local"
                className={inputClass}
                value={form.receivedAt}
                onChange={(e) => patch('receivedAt', e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="odor-cmp-due">
                처리기한
              </label>
              <input
                id="odor-cmp-due"
                type="datetime-local"
                className={inputClass}
                value={form.dueAt}
                onChange={(e) => patch('dueAt', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass} htmlFor="odor-cmp-type">
                유형
              </label>
              <select
                id="odor-cmp-type"
                className={inputClass}
                value={form.type}
                onChange={(e) => patch('type', e.target.value)}
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="odor-cmp-status">
                상태
              </label>
              <select
                id="odor-cmp-status"
                className={inputClass}
                value={form.status}
                onChange={(e) => patch('status', e.target.value as OdorComplaintStatus)}
              >
                <option value="접수">접수</option>
                <option value="처리중">처리중</option>
                <option value="완료">처리완료</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass} htmlFor="odor-cmp-name">
                민원인
              </label>
              <input
                id="odor-cmp-name"
                className={inputClass}
                value={form.complainant}
                onChange={(e) => patch('complainant', e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="odor-cmp-phone">
                연락처
              </label>
              <input
                id="odor-cmp-phone"
                className={inputClass}
                value={form.phone}
                onChange={(e) => patch('phone', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass} htmlFor="odor-cmp-emd">
                행정동
              </label>
              <input
                id="odor-cmp-emd"
                className={inputClass}
                value={form.emdNm}
                onChange={(e) => patch('emdNm', e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="odor-cmp-sensor">
                측정지점
              </label>
              <select
                id="odor-cmp-sensor"
                className={inputClass}
                value={form.sensorLabel}
                onChange={(e) => patch('sensorLabel', e.target.value)}
              >
                <option value="">선택 안 함</option>
                {sensorOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="odor-cmp-loc">
              위치(주소)
            </label>
            <div ref={addrFieldRef} className="flex gap-1.5">
              <input
                id="odor-cmp-loc"
                className={inputClass}
                value={form.locationNote}
                onChange={(e) => {
                  patch('locationNote', e.target.value)
                  setAddrResults([])
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleAddressSearch()
                  }
                }}
                placeholder="도로명 또는 지번 주소"
                autoComplete="off"
              />
              <button
                type="button"
                title="주소로 위치 찾기"
                disabled={addrLoading}
                onClick={() => void handleAddressSearch()}
                className={cn(
                  'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border px-2 text-[12px] font-semibold text-sky-400 hover:bg-muted/50',
                  addrLoading && 'cursor-wait opacity-60'
                )}
              >
                <Search className="h-3.5 w-3.5" aria-hidden />
                {addrLoading ? '검색…' : '위치 찾기'}
              </button>
            </div>
            {form.lon != null && form.lat != null ? (
              <div className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground">
                <span className="tabular-nums">
                  {form.lon.toFixed(5)}, {form.lat.toFixed(5)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({ ...prev, lon: null, lat: null }))
                  }
                  className="cursor-pointer text-red-400 hover:underline"
                >
                  위치 지우기
                </button>
              </div>
            ) : (
              <p className="mt-1 text-[12px] text-muted-foreground">
                주소를 입력하고 «위치 찾기»로 좌표를 반영하세요.
              </p>
            )}
          </div>

          <div>
            <label className={labelClass} htmlFor="odor-cmp-content">
              내용
            </label>
            <textarea
              id="odor-cmp-content"
              rows={4}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-primary"
              value={form.content}
              onChange={(e) => patch('content', e.target.value)}
            />
          </div>

          {msg ? (
            <p
              className={cn(
                'text-[12px] font-medium',
                msgTone === 'err' ? 'text-red-400' : 'text-emerald-500'
              )}
            >
              {msg}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          {editor.mode === 'edit' && onDelete ? (
            <button
              type="button"
              onClick={handleDelete}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-red-500/40 px-2.5 py-1.5 text-[12px] font-semibold text-red-400 hover:bg-red-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              삭제
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onGoActionHistory?.()}
            className="cursor-pointer rounded-md border border-border px-2.5 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted/50"
          >
            ＋ 조치 등록
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="ml-auto cursor-pointer rounded-md bg-sky-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-sky-500"
          >
            저장
          </button>
        </div>
      </div>

      {typeof document !== 'undefined' &&
      addrResults.length > 0 &&
      addrDropRect
        ? createPortal(
            <ul
              id="odor-cmp-addr-dropdown"
              role="listbox"
              className="fixed z-[10050] max-h-40 overflow-auto rounded-md border border-border bg-popover shadow-lg"
              style={{
                top: addrDropRect.top,
                left: addrDropRect.left,
                width: addrDropRect.width,
              }}
            >
              {addrResults.map((item) => {
                const key =
                  item.id ??
                  `${item.point.x.toFixed(5)},${item.point.y.toFixed(5)}`
                const label =
                  item.address ||
                  item.roadAddress ||
                  item.jibunAddress ||
                  '주소'
                return (
                  <li key={key} role="option">
                    <button
                      type="button"
                      onClick={() => applyAddress(item)}
                      className="flex w-full cursor-pointer items-start gap-2 border-b border-border/50 px-2.5 py-2 text-left text-[12px] hover:bg-muted/50 last:border-b-0"
                    >
                      <MapPin
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 leading-snug text-foreground">
                        {label}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>,
            document.body
          )
        : null}
    </MapFloatingPanel>
  )
}
