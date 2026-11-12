'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Crosshair } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll'
import {
  SMALL_PUBLIC_CANDIDATES,
  SMALL_PUBLIC_FAC_TYPES,
  smallPublicBtnGhost,
  smallPublicBtnPrimary,
  smallPublicFieldClass,
  type SmallPublicCandidate,
  type SmallPublicFacType,
} from '../smallPublicConfig'
import { isSmallPublicLine, type SmallPublicFacility } from '../smallPublicMock'
import { smallPublicActions } from '../smallPublicStore'
import { SmallPublicAttrTable, SmallPublicPanelHeader } from '../smallPublicUi'
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
  surveyDate: string
  surveyor: string
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
  const line = isSmallPublicLine(f.coords)
  const start = line ? f.coords[0]! : Array.isArray(f.coords) && typeof f.coords[0] === 'number' ? (f.coords as [number, number]) : null
  const end = line && f.coords.length > 1 ? f.coords[f.coords.length - 1]! : null
  return {
    name: f.name,
    geomCode: f.geomCode,
    type: f.type,
    emd: f.emd,
    ri: f.ri,
    address: f.address,
    benefitArea: f.benefitArea,
    riskDate: f.riskDate,
    surveyDate: f.surveyDate,
    surveyor: f.surveyor,
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
    surveyDate: '',
    surveyor: '',
    candidate: '일반',
    length: '',
    width: '',
    height: '',
    start: null,
    end: null,
  }
}

/**
 * 후보지 등록·수정 — 속성과 위치(지도에서 시점·종점 찍기).
 * initial 이 있으면 수정, 없으면 등록.
 */
export function SmallPublicCandidateForm({
  initial = null,
  initialType,
  onCancel,
  onSaved,
  onDraftChange,
}: {
  initial?: SmallPublicFacility | null
  initialType: SmallPublicFacType
  onCancel: () => void
  onSaved: (facility: SmallPublicFacility) => void
  /** 지도에 미리 보여 줄 위치와 지금 위치 찍는 중인지 */
  onDraftChange: (draft: { coords: SmallPublicFacility['coords']; type: SmallPublicFacType; picking: boolean }) => void
}) {
  const editing = initial != null
  const [draft, setDraft] = useState<Draft>(() => (initial ? facilityToDraft(initial) : emptyDraft(initialType)))
  const [picking, setPicking] = useState<PickKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isLine = LINE_TYPES.has(draft.type)

  useSmallPublicMapPick(picking != null, (coord) => {
    setDraft((d) => (picking === 'end' ? { ...d, end: coord } : { ...d, start: coord }))
    setPicking(null)
  })

  const { start, end, type } = draft
  const coords = useMemo(() => draftCoords({ start, end, type }), [start, end, type])
  useEffect(() => {
    onDraftChange({ coords, type: draft.type, picking: picking != null })
  }, [coords, draft.type, picking, onDraftChange])

  const text = (key: keyof Draft, type = 'text') => (
    <input
      type={type}
      className={smallPublicFieldClass}
      value={String(draft[key] ?? '')}
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

  const save = () => {
    if (!draft.name.trim()) return setError('시설명을 넣으세요.')
    if (!start) return setError('시점 위치를 지도에서 찍으세요.')
    const patch = {
      name: draft.name.trim(),
      geomCode: draft.geomCode,
      type,
      emd: draft.emd,
      ri: draft.ri,
      address: draft.address,
      benefitArea: draft.benefitArea,
      riskDate: draft.riskDate,
      surveyDate: draft.surveyDate,
      surveyor: draft.surveyor,
      candidate: draft.candidate,
      length: draft.length,
      width: draft.width,
      height: draft.height,
      startXy: smallPublicCoordToDms(start),
      endXy: isLine && end ? smallPublicCoordToDms(end) : smallPublicCoordToDms(start),
      coords,
    }
    if (editing && initial) {
      smallPublicActions.updateFacility(initial.id, patch)
      const next = { ...initial, ...patch }
      setPicking(null)
      onSaved(next)
      return
    }
    const facility = smallPublicActions.addFacility({
      ...patch,
      riskRank: '',
      riskScore: '',
    })
    setPicking(null)
    onSaved(facility)
  }

  const entries: { key: string; label: string; value: ReactNode; full?: boolean }[] = [
    { key: 'name', label: '시설명 *', value: text('name') },
    {
      key: 'type',
      label: '유형',
      value: (
        <select
          className={smallPublicFieldClass}
          value={draft.type}
          onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as SmallPublicFacType, end: null }))}
        >
          {SMALL_PUBLIC_FAC_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      ),
    },
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
    { key: 'start', label: isLine ? '시점좌표 *' : '위치 *', value: pickField('start'), full: true },
    ...(isLine ? [{ key: 'end', label: '종점좌표', value: pickField('end'), full: true }] : []),
    { key: 'benefitArea', label: '수혜지역', value: text('benefitArea') },
    { key: 'riskDate', label: '위험시설지정일', value: text('riskDate', 'date') },
    { key: 'surveyDate', label: '현장조사일자', value: text('surveyDate', 'date') },
    { key: 'surveyor', label: '현장조사자', value: text('surveyor') },
    { key: 'length', label: '연장(m)', value: text('length') },
    { key: 'width', label: '폭(m)', value: text('width') },
    { key: 'height', label: '높이(m)', value: text('height') },
  ]

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <SmallPublicPanelHeader
        title={editing ? '후보지 수정' : '후보지 등록'}
        onClose={onCancel}
        actions={
          <div className="flex items-center gap-2.5">
            <button type="button" className={smallPublicBtnPrimary} onClick={save}>
              저장
            </button>
            <button type="button" className={smallPublicBtnGhost} onClick={onCancel}>
              취소
            </button>
          </div>
        }
      />
      <MapSideDetailScroll className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        <p className="mb-2 text-[11px] text-muted-foreground">
          {editing
            ? '시설명·유형·위치 등 속성을 고칩니다. 관리번호·위험도등급·점수는 그대로 둡니다.'
            : '새 후보지를 등록합니다. 관리번호는 저장할 때 임시 번호로 붙고, 위험도등급·점수는 안전점검에서 점검을 등록하면 채워집니다.'}
        </p>
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
    </div>
  )
}
