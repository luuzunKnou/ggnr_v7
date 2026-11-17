'use client'

import { useCallback, useState } from 'react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import '../../../../_mapComponents/config/projections'
import {
  ParcelAnalysisBoundaryPicker,
  cloneBoundarySelection,
  countBoundarySelection,
  useParcelAnalysisBoundaryCatalog,
  type BoundaryEmdSelection,
} from '../../../../_mapComponents/analysisArea'
import { useWtlOutageGeomEdit, type OutageGeomEditMode } from './useWtlOutageGeomEdit'
import { wkt5181ToRing4326, type LonLat } from './wtlOutageGeom'
import type { WtlOutageResult } from './wtlOutageSample'

type EditKind = 'modify' | 'boundary' | 'draw'

type Props = {
  enabled: boolean
  result: WtlOutageResult | null
  onApplyZone: (ring: LonLat[], customers: WtlOutageResult['customers'], addresses: WtlOutageResult['addresses']) => void
  onNotice: (msg: string) => void
  onMapEditingChange?: (editing: boolean) => void
}

async function fetchBoundaryWkt5181(
  action: 'getEmdGeometry' | 'getRiGeometry',
  params: Record<string, string>
): Promise<string | null> {
  try {
    const res = await call('', 'POST', { service: 'devTestService', action, params })
    const data = res?.data ?? res
    return data?.wkt ? String(data.wkt) : null
  } catch {
    return null
  }
}

async function fetchUnionWkt5181(wkts: string[]): Promise<string | null> {
  try {
    const res = await call('', 'POST', {
      service: 'devTestService',
      action: 'unionWkts5181',
      params: { wkts },
    })
    const data = res?.data ?? res
    return data?.wkt ? String(data.wkt) : null
  } catch {
    return null
  }
}

async function refreshCustomers(ring: LonLat[]) {
  const res = await call('', 'POST', {
    service: 'wtlOutageService',
    action: 'refreshWtlOutageZone',
    params: { ring },
  })
  return (res?.data ?? res) as {
    customers?: WtlOutageResult['customers']
    addresses?: WtlOutageResult['addresses']
    error?: string
  }
}

/**
 * 하단 액션바와 같은 줄에 붙는 도형편집 토글 + 필요 시만 펼침 패널
 */
export function WtlOutageGeomEdit({
  enabled,
  result,
  onApplyZone,
  onNotice,
  onMapEditingChange,
}: Props) {
  const [kind, setKind] = useState<EditKind | null>(null)
  const [mapMode, setMapMode] = useState<OutageGeomEditMode>(null)
  const [draftRing, setDraftRing] = useState<LonLat[] | null>(null)
  const [boundaryDraft, setBoundaryDraft] = useState<BoundaryEmdSelection[]>([])
  const [applying, setApplying] = useState(false)

  const catalogOpen = enabled && kind === 'boundary'
  const { emdOptions, emdLoading, emdError, reloadEmdOptions } =
    useParcelAnalysisBoundaryCatalog(catalogOpen)

  useWtlOutageGeomEdit({
    mode: mapMode,
    ring: result?.ring ?? null,
    onRingChange: setDraftRing,
  })

  const cancelEdit = () => {
    setKind(null)
    setMapMode(null)
    setDraftRing(null)
    setBoundaryDraft([])
    onMapEditingChange?.(false)
  }

  const startKind = (next: EditKind) => {
    if (!enabled || !result) return
    if (kind === next) {
      cancelEdit()
      return
    }
    setKind(next)
    setDraftRing(null)
    if (next === 'modify') {
      setMapMode('modify')
      onMapEditingChange?.(true)
      onNotice('꼭짓점을 드래그한 뒤 «적용»하세요.')
    } else if (next === 'draw') {
      setMapMode('draw')
      onMapEditingChange?.(true)
      onNotice('다각형을 그린 뒤 «적용»하세요.')
    } else {
      setMapMode(null)
      onMapEditingChange?.(false)
      setBoundaryDraft([])
      onNotice('읍·면·동·리를 선택한 뒤 «적용»하세요.')
    }
  }

  const applyRing = useCallback(
    async (ring: LonLat[]) => {
      if (ring.length < 3) {
        onNotice('도형이 올바르지 않습니다.')
        return
      }
      setApplying(true)
      try {
        const body = await refreshCustomers(ring)
        if (body.error) {
          onNotice(body.error)
          return
        }
        onApplyZone(ring, body.customers ?? [], body.addresses ?? [])
        cancelEdit()
        onNotice(`도형 적용 · 수용가 ${(body.customers ?? []).length}건`)
      } catch {
        onNotice('도형 적용에 실패했습니다.')
      } finally {
        setApplying(false)
      }
    },
    [onApplyZone, onNotice]
  )

  const applyModifyOrDraw = () => {
    if (!draftRing || draftRing.length < 3) {
      onNotice(kind === 'draw' ? '지도를 먼저 그려 주세요.' : '수정된 도형이 없습니다.')
      return
    }
    void applyRing(draftRing)
  }

  const applyBoundary = async () => {
    const cloned = cloneBoundarySelection(boundaryDraft)
    if (countBoundarySelection(cloned) === 0) {
      onNotice('읍면동·리를 선택하세요.')
      return
    }
    setApplying(true)
    try {
      const wkts: string[] = []
      for (const sel of cloned) {
        if (sel.allRi) {
          const wkt = await fetchBoundaryWkt5181('getEmdGeometry', { emdCode: sel.emdCode })
          if (wkt) wkts.push(wkt)
        } else {
          for (const riCode of sel.riCodes) {
            const wkt = await fetchBoundaryWkt5181('getRiGeometry', { riCode })
            if (wkt) wkts.push(wkt)
          }
        }
      }
      if (wkts.length === 0) {
        onNotice('행정경계 도형을 가져오지 못했습니다.')
        return
      }
      let unionWkt = wkts[0]!
      if (wkts.length > 1) {
        const merged = await fetchUnionWkt5181(wkts)
        if (merged) unionWkt = merged
      }
      const ring = wkt5181ToRing4326(unionWkt)
      if (ring.length < 3) {
        onNotice('행정경계 도형을 변환하지 못했습니다.')
        return
      }
      const body = await refreshCustomers(ring)
      if (body.error) {
        onNotice(body.error)
        return
      }
      onApplyZone(ring, body.customers ?? [], body.addresses ?? [])
      cancelEdit()
      onNotice(`행정경계 적용 · 수용가 ${(body.customers ?? []).length}건`)
    } catch {
      onNotice('행정경계 적용에 실패했습니다.')
    } finally {
      setApplying(false)
    }
  }

  if (!enabled) return null

  const tools: { id: EditKind; label: string }[] = [
    { id: 'modify', label: '수정' },
    { id: 'boundary', label: '읍면동리' },
    { id: 'draw', label: '그리기' },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-0.5 text-[10px] text-muted-foreground">도형</span>
        {tools.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              'rounded border px-2 py-1 text-[11px] font-medium',
              kind === item.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-foreground hover:bg-muted'
            )}
            onClick={() => startKind(item.id)}
          >
            {item.label}
          </button>
        ))}
        {kind && (
          <>
            <button
              type="button"
              disabled={
                applying ||
                (kind === 'boundary'
                  ? countBoundarySelection(boundaryDraft) === 0
                  : !draftRing || draftRing.length < 3)
              }
              className="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-40"
              onClick={() => (kind === 'boundary' ? void applyBoundary() : applyModifyOrDraw())}
            >
              {applying ? '적용중…' : '적용'}
            </button>
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
              onClick={cancelEdit}
            >
              취소
            </button>
          </>
        )}
      </div>

      {kind === 'boundary' && (
        <div className="max-h-44 overflow-auto rounded border border-border p-2">
          <ParcelAnalysisBoundaryPicker
            initialSelection={boundaryDraft}
            onSelectionChange={setBoundaryDraft}
            emdOptions={emdOptions}
            emdLoading={emdLoading}
            emdError={emdError}
            onReloadEmd={reloadEmdOptions}
          />
        </div>
      )}
    </div>
  )
}
