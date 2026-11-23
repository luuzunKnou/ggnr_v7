'use client'

import { useEffect, useRef } from 'react'
import type MapBrowserEvent from 'ol/MapBrowserEvent'
import { unByKey } from 'ol/Observable'
import { call } from '@/lib/api'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import type { WtlTopoEditTarget } from './wtlTopologySample'
import { getViewProjectionCode, viewToLonLat } from './topoMapProjection'

/** 클릭 허용 거리(화면 px) — 해상도를 곱해 미터로 바꿔 서버에 넘긴다 */
const PICK_TOLERANCE_PX = 8

type Props = {
  /** true인 동안 지도 클릭으로 관로·시설을 고른다 */
  active: boolean
  /** 관로(상수관·급수관)만 고를지 */
  pipesOnly?: boolean
  /** 클릭 위치에서 찾은 대상. 없으면 null */
  onPick: (target: WtlTopoEditTarget | null) => void
}

/**
 * 위상검증 도구모음 — 지도에서 수정·방향 반전할 관로·시설 고르기.
 * 식별(속성조회)은 막지 않는다. 피처 선택과 속성 상세가 같이 열려도 된다.
 */
export function useWtlTopoMapPick({ active, pipesOnly = false, onPick }: Props) {
  const mapContext = useMapContext()
  const onPickRef = useRef(onPick)
  const pipesOnlyRef = useRef(pipesOnly)
  useEffect(() => {
    onPickRef.current = onPick
    pipesOnlyRef.current = pipesOnly
  })

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active) return
    let seq = 0

    const target = map.getTargetElement()
    const prevCursor = target?.style.cursor ?? ''
    if (target) target.style.cursor = 'crosshair'

    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      // 지도 좌표(3857 또는 카카오 배경 5181)를 경위도로 바꿔 보낸다. 해상도는 두 좌표계 모두 m/px
      const [lon, lat] = viewToLonLat(evt.coordinate, getViewProjectionCode(map))
      const resolution = map.getView().getResolution() ?? 1
      const mySeq = ++seq
      void call('', 'POST', {
        service: 'wtlTopologyService',
        action: 'findWtlTopoFeatureAt',
        params: { lon, lat, tolerance: resolution * PICK_TOLERANCE_PX, pipesOnly: pipesOnlyRef.current },
      })
        .then((res) => {
          if (mySeq !== seq) return
          const body = (res?.data ?? res) as { feature?: WtlTopoEditTarget | null }
          onPickRef.current(body?.feature ?? null)
        })
        .catch(() => {
          if (mySeq === seq) onPickRef.current(null)
        })
    }
    // 프로젝트 다른 지도 클릭 훅과 같은 방식 (OL 이벤트 타입 오버로드 회피)
    const key = map.on('singleclick', onClick as never)

    return () => {
      seq++
      unByKey(key)
      if (target) target.style.cursor = prevCursor
    }
  }, [active, mapContext?.mapReady, mapContext?.mapInstanceRef])
}
