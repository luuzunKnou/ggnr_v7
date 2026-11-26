'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Crosshair } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll'
import {
  SMALL_PUBLIC_CANDIDATES,
  SMALL_PUBLIC_FAC_TYPES,
  smallPublicBtnGhost,
  smallPublicFieldClass,
  type SmallPublicCandidate,
  type SmallPublicFacType,
} from '../smallPublicConfig'
import {
  spfFacAttrKey,
  spfFacFieldReadOnly,
  spfFacFieldRequired,
  spfFacFormFields,
  type SmallPublicDefineField,
} from '../smallPublicDefineFields'
import { isSmallPublicLine, type SmallPublicFacility } from '../smallPublicMock'
import { smallPublicActions } from '../smallPublicStore'
import { SmallPublicAttrTable, SmallPublicCrudBar, SmallPublicPanelHeader } from '../smallPublicUi'
import { smallPublicCoordToDms, useSmallPublicMapPick } from '../useSmallPublicMapPick'

/** 시점·종점을 선으로 잇는 유형 */
const LINE_TYPES: ReadonlySet<SmallPublicFacType> = new Set(['세천', '마을진입로', '농로'])

type PickKind = 'start' | 'end'

type Draft = {
  name: string
  geomCode: string
  type: SmallPublicFacType
  emd: string
  ri: string
  address: string
  benefitArea: string
  riskDate: string
  candidate: SmallPublicCandidate
  length: string
  width: string
  height: string
  start: [number, number] | null
  end: [number, number] | null
}

function draftCoords(d: Pick<Draft, 'start' | 'end' | 'type'>): SmallPublicFacility['coords'] {
  if (!d.start) return null
  return LINE_TYPES.has(d.type) && d.end ? [d.start, d.end] : d.start
}

function facilityToDraft(f: SmallPublicFacility): Draft {
  const coords = f.coords
  let start: [number, number] | null = null
  let end: [number, number] | null = null
  if (isSmallPublicLine(coords)) {
    start = coords[0] ?? null
    if (coords.length > 1) end = coords[coords.length - 1]!
  } else if (coords) {
    start = coords
  }
  return {
    name: f.name,
    geomCode: f.geomCode,
    type: f.type,
    emd: f.emd,
    ri: f.ri,
    address: f.address,
    benefitArea: f.benefitArea,
    riskDate: f.riskDate,
    candidate: f.candidate,
    length: f.length ? String(f.length) : '',
    width: f.width ? String(f.width) : '',
    height: f.height ? String(f.height) : '',
    start,
    end,
  }
}

function emptyDraft(initialType: SmallPublicFacType): Draft {
  return {
    name: '',
    geomCode: '',
    type: initialType,
    emd: '',
    ri: '',
    address: '',
    benefitArea: '',
    riskDate: '',
    candidate: '일반',
    length: '',
    width: '',
    height: '',
    start: null,
    end: null,
  }
}

type DraftTextKey = Exclude<keyof Draft, 'start' | 'end' | 'type' | 'candidate'>

/**
 * 후보지 등록·수정 — 레이어설정 상세·필수·읽기전용. 관리번호는 유형별 마지막+1 자동.
 */
export function SmallPublicCandidateForm({
  initial = null,
  initialType,
  defineFields = [],
  onCancel,
  onSaved,
  onDraftChange,
}: {
  initial?: SmallPublicFacility | null
  initialType: SmallPublicFacType
  defineFields?: SmallPublicDefineField[]
  onCancel: () => void
  onSaved: (facility: SmallPublicFacility) => void
  /** 지도에 미리 보여 줄 위치와 지금 위치 찍는 중인지 */
  onDraftChange: (draft: { coords: SmallPublicFacility['coords']; type: SmallPublicFacType; picking: boolean }) => void
}) {
  const editing = initial != null
  const [draft, setDraft] = useState<Draft>(() => (initial ? facilityToDraft(initial) : emptyDraft(initialType)))
  const [picking, setPicking] = useState<PickKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** 신규 — 유형별 다음 관리번호(읽기전용 표시). 저장 때 서버가 다시 발급 */
  const [nextConsCode, setNextConsCode] = useState('')
  const isLine = LINE_TYPES.has(draft.type)
  const formFields = useMemo(() => spfFacFormFields(defineFields), [defineFields])
  const mngNoDisplay = editing ? String(initial?.mngNo ?? '').trim() || '없음' : nextConsCode

  useSmallPublicMapPick(picking != null, (coord) => {
    setDraft((d) => (picking === 'end' ? { ...d, end: coord } : { ...d, start: coord }))
    setPicking(null)
  })

  const { start, end, type } = draft
  const coords = useMemo(() => draftCoords({ start, end, type }), [start, end, type])
  useEffect(() => {
    onDraftChange({ coords, type: draft.type, picking: picking != null })
  }, [coords, draft.type, picking, onDraftChange])

  useEffect(() => {
    if (editing) {
      setNextConsCode('')
      return
    }
    let cancelled = false
    setNextConsCode('')
    void call('', 'POST', {
      service: 'smallPublicService',
      action: 'allocateNextConsCode',
      params: { type },
    }).then((res) => {
      if (cancelled) return
      const data = (res?.data ?? res) as { success?: boolean; consCode?: string }
      if (data?.success && data.consCode) setNextConsCode(data.consCode)
    })
    return () => {
      cancelled = true
    }
  }, [editing, type])

  const text = (key: DraftTextKey, opts?: { readOnly?: boolean; type?: string }) => (
    <input
      type={opts?.type ?? 'text'}
      className={smallPublicFieldClass}
      value={String(draft[key] ?? '')}
      readOnly={opts?.readOnly}
      disabled={opts?.readOnly}
      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
    />
  )

  const pickField = (kind: PickKind): ReactNode => {
    const coord = kind === 'start' ? draft.start : draft.end
    const active = picking === kind
    return (
      <div className="flex min-w-0 items-center gap-1">
        <span className={cn('min-w-0 flex-1 truncate text-[11px]', coord ? 'text-foreground/80' : 'text-muted-foreground')}>
          {coord ? smallPublicCoordToDms(coord) : '위치를 지도에서 찍으세요'}
        </span>
        <button
          type="button"
          className={cn(smallPublicBtnGhost, 'h-6 shrink-0 px-1.5', active && 'border-primary text-primary')}
          onClick={() => setPicking(active ? null : kind)}
        >
          <Crosshair className="h-3 w-3" />
          {active ? '찍는 중' : '지도에서 찍기'}
        </button>
      </div>
    )
  }

  const draftValue = (attrKey: string): string => {
    switch (attrKey) {
      case 'name':
        return draft.name
      case 'geomCode':
        return draft.geomCode
      case 'emd':
        return draft.emd
      case 'ri':
        return draft.ri
      case 'address':
        return draft.address
      case 'benefitArea':
        return draft.benefitArea
      case 'riskDate':
        return draft.riskDate
      case 'length':
        return draft.length
      case 'width':
        return draft.width
      case 'height':
        return draft.height
      case 'candidate':
        return draft.candidate
      case 'type':
        return draft.type
      case 'mngNo':
        return mngNoDisplay === '없음' ? '' : mngNoDisplay
      default:
        return ''
    }
  }

  const setDraftAttr = (attrKey: string, value: string) => {
    setDraft((d) => {
      switch (attrKey) {
        case 'name':
          return { ...d, name: value }
        case 'geomCode':
          return { ...d, geomCode: value }
        case 'emd':
          return { ...d, emd: value }
        case 'ri':
          return { ...d, ri: value }
        case 'address':
          return { ...d, address: value }
        case 'benefitArea':
          return { ...d, benefitArea: value }
        case 'riskDate':
          return { ...d, riskDate: value }
        case 'length':
          return { ...d, length: value }
        case 'width':
          return { ...d, width: value }
        case 'height':
          return { ...d, height: value }
        default:
          return d
      }
    })
  }

  const save = async () => {
    if (saving) return
    for (const f of formFields) {
      const fname = String(f.define_field_name ?? '')
        .trim()
        .toLowerCase()
      if (fname === 'cons_code') continue
      if (!spfFacFieldRequired(f)) continue
      const attr = spfFacAttrKey(fname)
      if (!attr) continue
      if (!String(draftValue(attr) ?? '').trim()) {
        const label = String(f.define_field_kor_name ?? '').trim() || fname
        setError(`${label}을(를) 넣으세요.`)
        return
      }
    }
    if (!draft.name.trim()) {
      setError('시설명을 넣으세요.')
      return
    }
    if (!start) {
      setError('위치를 지도에서 찍으세요.')
      return
    }
    if (isLine && !end) {
      setError('종점 위치를 지도에서 찍으세요.')
      return
    }

    setError(null)
    setSaving(true)
    try {
      const res = await call('', 'POST', {
        service: 'smallPublicService',
        action: 'saveFacility',
        params: {
          facilityId: editing && initial ? initial.id : undefined,
          type,
          name: draft.name.trim(),
          geomCode: draft.geomCode,
          emd: draft.emd,
          ri: draft.ri,
          address: draft.address,
          benefitArea: draft.benefitArea,
          riskDate: draft.riskDate,
          candidate: draft.candidate,
          length: draft.length,
          width: draft.width,
          height: draft.height,
          startXy: smallPublicCoordToDms(start),
          endXy: isLine && end ? smallPublicCoordToDms(end) : smallPublicCoordToDms(start),
          coords,
          parentFacId: initial?.parentFacId ?? null,
          parentFacName: initial?.parentFacName ?? '',
        },
      })
      const data = (res?.data ?? res) as { success?: boolean; facility?: SmallPublicFacility; error?: string }
      if (!data?.success || !data.facility) {
        setError(data?.error || '저장에 실패했습니다.')
        return
      }
      smallPublicActions.upsertFacility(data.facility)
      setPicking(null)
      onSaved(data.facility)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const fieldInput = (df: SmallPublicDefineField): ReactNode => {
    const fname = String(df.define_field_name ?? '')
      .trim()
      .toLowerCase()
    const attr = spfFacAttrKey(fname)
    const readOnly = spfFacFieldReadOnly(df) || fname === 'cons_code'

    if (fname === 'cons_code') {
      return (
        <input
          type="text"
          className={cn(smallPublicFieldClass, 'bg-muted/40 text-foreground/80')}
          value={mngNoDisplay}
          readOnly
          disabled
          aria-readonly
        />
      )
    }
    if (fname === 'type' || attr === 'type') {
      return (
        <select
          className={smallPublicFieldClass}
          value={draft.type}
          disabled={editing}
          onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as SmallPublicFacType, end: null }))}
        >
          {SMALL_PUBLIC_FAC_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )
    }
    if (fname === 'candidate' || attr === 'candidate') {
      return (
        <select
          className={smallPublicFieldClass}
          value={draft.candidate}
          onChange={(e) => setDraft((d) => ({ ...d, candidate: e.target.value as SmallPublicCandidate }))}
        >
          {SMALL_PUBLIC_CANDIDATES.map((c) => (
            <option key={c} value={c}>
              {c === '제외' ? '제외' : `${c}시설`}
            </option>
          ))}
        </select>
      )
    }
    if (!attr) return <span className="text-[11px] text-muted-foreground">—</span>
    const inputType = attr === 'riskDate' ? 'date' : 'text'
    return (
      <input
        type={inputType}
        className={smallPublicFieldClass}
        value={draftValue(attr)}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => setDraftAttr(attr, e.target.value)}
      />
    )
  }

  const typeSelect = (
    <select
      className={smallPublicFieldClass}
      value={draft.type}
      disabled={editing}
      onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as SmallPublicFacType, end: null }))}
    >
      {SMALL_PUBLIC_FAC_TYPES.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  )

  const entries: { key: string; label: string; value: ReactNode; full?: boolean }[] = []

  if (formFields.length === 0) {
    entries.push(
      {
        key: 'mngNo',
        label: '관리번호 *',
        value: (
          <input
            type="text"
            className={cn(smallPublicFieldClass, 'bg-muted/40 text-foreground/80')}
            value={mngNoDisplay}
            readOnly
            disabled
            aria-readonly
          />
        ),
      },
      { key: 'type', label: '유형 *', value: typeSelect },
      { key: 'name', label: '시설명 *', value: text('name') },
      { key: 'geomCode', label: '도형코드', value: text('geomCode') },
      {
        key: 'candidate',
        label: '후보지',
        value: (
          <select
            className={smallPublicFieldClass}
            value={draft.candidate}
            onChange={(e) => setDraft((d) => ({ ...d, candidate: e.target.value as SmallPublicCandidate }))}
          >
            {SMALL_PUBLIC_CANDIDATES.map((c) => (
              <option key={c} value={c}>
                {c === '제외' ? '제외' : `${c}시설`}
              </option>
            ))}
          </select>
        ),
      },
      { key: 'emd', label: '읍면명', value: text('emd') },
      { key: 'ri', label: '리명', value: text('ri') },
      { key: 'address', label: '주소', value: text('address'), full: true },
      { key: 'benefitArea', label: '수혜지역', value: text('benefitArea') },
      { key: 'riskDate', label: '위험시설지정일', value: text('riskDate', { type: 'date' }) },
      { key: 'length', label: '연장(m)', value: text('length') },
      { key: 'width', label: '폭(m)', value: text('width') },
      { key: 'height', label: '높이(m)', value: text('height') }
    )
  } else {
    let typeInserted = false
    for (const df of formFields) {
      const fname = String(df.define_field_name ?? '')
        .trim()
        .toLowerCase()
      const attr = spfFacAttrKey(fname) ?? fname
      const kor = String(df.define_field_kor_name ?? '').trim() || fname
      const req = spfFacFieldRequired(df) && fname !== 'cons_code'
      const full = attr === 'address' || attr === 'name' || attr === 'mngNo'
      entries.push({
        key: attr,
        label: req ? `${kor} *` : kor,
        value: fieldInput(df),
        full,
      })
      if (!typeInserted && (fname === 'cons_code' || entries.length === 1)) {
        entries.push({ key: 'type', label: '유형 *', value: typeSelect })
        typeInserted = true
      }
    }
    if (!typeInserted) entries.unshift({ key: 'type', label: '유형 *', value: typeSelect })
  }

  entries.push({
    key: 'start',
    label: isLine ? '시점좌표 *' : '위치 *',
    value: pickField('start'),
    full: true,
  })
  if (isLine) {
    entries.push({ key: 'end', label: '종점좌표 *', value: pickField('end'), full: true })
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <SmallPublicPanelHeader title={editing ? '후보지 수정' : '후보지 등록'} onClose={onCancel} />
      <MapSideDetailScroll className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        <SmallPublicAttrTable entries={entries} />
        {picking ? (
          <p className="mt-2 rounded border border-primary/30 bg-primary/5 px-2 py-1.5 text-[11px] text-primary">
            지도에서 {picking === 'start' ? (isLine ? '시점' : '시설 위치') : '종점'}을 누르세요.
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 rounded border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            {error}
          </p>
        ) : null}
      </MapSideDetailScroll>
      <SmallPublicCrudBar onSave={() => void save()} onCancel={onCancel} saveDisabled={saving} />
    </div>
  )
}
