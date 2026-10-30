'use client'

import { useEffect, useMemo, useState } from 'react'
import { call } from '@/lib/api'
import { WTL_LAYER_SHAPE_DEFS } from '@/lib/wtlLayerShapeDefs'
import { getWtlNetLayerDef, type WtlNetLayerKey } from '../wtlNetworkLayerCatalog'

type Pt3857 = [number, number]

type Props = {
  line3857: Pt3857[]
  /** 관망조회에서 켜진 레이어 키 → 지형 파생 도형 */
  enabledKeys: string[]
}

type TabImages = {
  /** 좌측 메인 — 절단선 정면 지형 3D */
  terrain: string
  cross: string
  long: string
}

/** 단면도 지형 — 절단선이 가로가 되도록 렌더 */
async function captureTerrainMainPng(
  THREE: typeof import('three'),
  shapesRoot: InstanceType<typeof import('three').Group>,
  groundGroup: InstanceType<typeof import('three').Group>,
  groundProps: import('@/app/(pages)/dev/_components/threeJs/shapeTypes').ShapeProps
): Promise<string> {
  const { fitSectionLineView } = await import(
    '@/app/(pages)/dev/_components/threeJs/fitGroundCamera'
  )
  const W = 1280
  const H = 960
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a1e)
  scene.add(new THREE.AmbientLight(0xffffff, 0.7))
  const key = new THREE.DirectionalLight(0xffffff, 0.9)
  key.position.set(50, 90, 40)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xaabbff, 0.35)
  fill.position.set(-40, 40, -30)
  scene.add(fill)
  scene.add(shapesRoot)

  const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 4000)
  const orbitStub = {
    target: new THREE.Vector3(0, 0, 0),
    update() {},
  }
  fitSectionLineView(
    camera,
    orbitStub as unknown as import('three/addons/controls/OrbitControls.js').OrbitControls,
    groundGroup,
    groundProps
  )

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: false,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(W, H)
  renderer.render(scene, camera)
  const url = renderer.domElement.toDataURL('image/png')
  renderer.dispose()
  return url
}

/**
 * 켜진 레이어 키 → Three.js «지형에서 파생» 가능한 도형 kind.
 * (분할 saa003/saa004/etc 는 wtl_pipe_lm 하나로 묶음)
 */
function resolveGroundLayerKinds(enabledKeys: string[]): string[] {
  const tables = new Set<string>()
  for (const key of enabledKeys) {
    const def = getWtlNetLayerDef(key as WtlNetLayerKey)
    const table = (def?.table ?? key).toLowerCase()
    if (table.startsWith('wtl_pipe_lm')) {
      tables.add('wtl_pipe_lm')
      continue
    }
    tables.add(table)
  }
  return WTL_LAYER_SHAPE_DEFS.filter(
    (d) => d.fromGround && tables.has(d.table.toLowerCase())
  ).map((d) => d.kind)
}

export function WtlNetworkSectionThreeJsTab({ line3857, enabledKeys }: Props) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [images, setImages] = useState<TabImages | null>(null)
  const [error, setError] = useState('')

  const kinds = useMemo(() => resolveGroundLayerKinds(enabledKeys), [enabledKeys])
  const kindsSig = kinds.slice().sort().join('\u0001')
  const lineSig = line3857.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(';')

  useEffect(() => {
    if (line3857.length < 2) {
      setError('절단선이 없습니다.')
      setImages(null)
      return
    }
    let cancelled = false
    ;(async () => {
      setBusy(true)
      setError('')
      setStatus('ThreeJs 지형·단면도 생성 중…')
      setImages(null)
      try {
        const [
          THREE,
          { createShapeObject },
          { cloneDefaults },
          {
            SECTION_DEFAULT_HALF_WIDTH_M,
            SECTION_STEP_M,
            clipHeightFieldToSectionRect,
            sectionCoverRadiusM,
            sectionLineLengthM,
            sectionRectCenter3857,
            sectionRectRing3857,
          },
          { captureSectionCadViews },
          {
            SHAPE_NAME_KEY,
            isLineLayerShape,
            isPointLayerShape,
          },
        ] = await Promise.all([
          import('three'),
          import('@/app/(pages)/dev/_components/threeJs/createShapeObject'),
          import('@/app/(pages)/dev/_components/threeJs/shapeCatalog'),
          import('@/app/(pages)/dev/_components/threeJs/groundSection'),
          import('@/app/(pages)/dev/_components/threeJs/sectionCadDraw'),
          import('@/app/(pages)/dev/_components/threeJs/shapeTypes'),
        ])
        type ShapeKind = import('@/app/(pages)/dev/_components/threeJs/shapeTypes').ShapeKind
        type GroundHeightField =
          import('@/app/(pages)/dev/_components/threeJs/shapeTypes').GroundHeightField
        type PipeSegment = import('@/app/(pages)/dev/_components/threeJs/shapeTypes').PipeSegment
        type ManholeFeature =
          import('@/app/(pages)/dev/_components/threeJs/shapeTypes').ManholeFeature

        const start = line3857[0]!
        const end = line3857[line3857.length - 1]!
        const sectionLine = {
          start3857: start,
          end3857: end,
          halfWidthM: SECTION_DEFAULT_HALF_WIDTH_M,
        }
        const center = sectionRectCenter3857(sectionLine)
        const radiusM = sectionCoverRadiusM(sectionLine)
        const polygon3857 = sectionRectRing3857(sectionLine)

        setStatus('등고 격자 조회 중…')
        const elevRes = await call('', 'POST', {
          service: 'elevationService',
          action: 'getElevationGrid',
          params: {
            x: center[0],
            y: center[1],
            srid: 3857,
            radiusM,
            stepM: SECTION_STEP_M,
          },
        })
        const elevData = (elevRes?.data ?? elevRes) as {
          success?: boolean
          error?: string
          size?: number
          stepM?: number
          radiusM?: number
          centerX?: number
          centerY?: number
          baseElevM?: number
          heights?: (number | null)[]
          levels?: number[]
          contours?: GroundHeightField['contours']
          rivers?: GroundHeightField['rivers']
        }
        if (cancelled) return
        if (!elevData?.success || !elevData.heights?.length || !elevData.size) {
          throw new Error(elevData?.error ?? '지형 격자 조회 실패')
        }

        let field: GroundHeightField = {
          size: elevData.size,
          stepM: elevData.stepM ?? SECTION_STEP_M,
          radiusM: elevData.radiusM ?? radiusM,
          centerX: elevData.centerX ?? center[0],
          centerY: elevData.centerY ?? center[1],
          baseElevM: elevData.baseElevM ?? 0,
          heights: elevData.heights,
          levels: elevData.levels ?? [],
          contours: elevData.contours ?? [],
          rivers: elevData.rivers ?? [],
        }
        field = clipHeightFieldToSectionRect(field, sectionLine)
        if (!field.heights.some((h) => h != null)) {
          throw new Error('절단 범위 내 고도 샘플이 없습니다')
        }

        const root = new THREE.Group()
        const groundProps = cloneDefaults('ground')
        groundProps.kind = 'ground'
        groundProps.groundDrawMode = 'section'
        groundProps.groundSectionLine = sectionLine
        groundProps.groundHeightField = field
        groundProps.groundCenterX = field.centerX
        groundProps.groundCenterY = field.centerY
        groundProps.groundRadiusM = field.radiusM
        groundProps.posX = 0
        groundProps.posZ = 0
        groundProps.floorHeight = 0
        const groundGroup = createShapeObject('wtl-section-ground', groundProps)
        groundGroup.userData[SHAPE_NAME_KEY] = '지형_단면도'
        root.add(groundGroup)

        const extentParams = {
          x: field.centerX,
          y: field.centerY,
          srid: 3857,
          radiusM: field.radiusM,
          polygon3857,
        }
        const notes: string[] = []

        for (const kind of kinds) {
          if (cancelled) return
          const sk = kind as ShapeKind
          if (isLineLayerShape(sk)) {
            setStatus(`${kind} 관로 조회 중…`)
            const pipeRes = await call('', 'POST', {
              service: 'elevationService',
              action: 'getWtlLineLayerInExtent',
              params: { ...extentParams, table: kind },
            })
            const pipeData = (pipeRes?.data ?? pipeRes) as {
              success?: boolean
              pipes?: PipeSegment[]
              error?: string
            }
            if (!pipeData?.success) {
              notes.push(pipeData?.error ?? `${kind} 조회 실패`)
              continue
            }
            const pipes = Array.isArray(pipeData.pipes) ? pipeData.pipes : []
            if (!pipes.length) {
              notes.push(`${kind} 없음`)
              continue
            }
            const props = cloneDefaults(sk)
            props.pipeCenterX = field.centerX
            props.pipeCenterY = field.centerY
            props.pipeRadiusM = field.radiusM
            props.pipeSegments = pipes
            props.pipeHeightField = field
            props.groundDrawMode = 'section'
            props.groundSectionLine = sectionLine
            props.posX = 0
            props.posZ = 0
            props.floorHeight = 0
            const g = createShapeObject(`wtl-section-${kind}`, props)
            g.userData[SHAPE_NAME_KEY] = kind
            root.add(g)
            notes.push(`${kind} ${pipes.length}건`)
          } else if (isPointLayerShape(sk)) {
            setStatus(`${kind} 점시설 조회 중…`)
            const manhRes = await call('', 'POST', {
              service: 'elevationService',
              action: 'getWtlPointLayerInExtent',
              params: { ...extentParams, table: kind },
            })
            const manhData = (manhRes?.data ?? manhRes) as {
              success?: boolean
              manholes?: ManholeFeature[]
              error?: string
            }
            if (!manhData?.success) {
              notes.push(manhData?.error ?? `${kind} 조회 실패`)
              continue
            }
            const manholes = Array.isArray(manhData.manholes) ? manhData.manholes : []
            if (!manholes.length) {
              notes.push(`${kind} 없음`)
              continue
            }
            const props = cloneDefaults(sk)
            props.manhCenterX = field.centerX
            props.manhCenterY = field.centerY
            props.manhRadiusM = field.radiusM
            props.manholeFeatures = manholes
            props.manhHeightField = field
            props.groundDrawMode = 'section'
            props.groundSectionLine = sectionLine
            props.posX = 0
            props.posZ = 0
            props.floorHeight = 0
            const g = createShapeObject(`wtl-section-${kind}`, props)
            g.userData[SHAPE_NAME_KEY] = kind
            root.add(g)
            notes.push(`${kind} ${manholes.length}건`)
          }
        }

        if (cancelled) return
        setStatus('지형·CAD 단면도 렌더 중…')
        const cad = captureSectionCadViews(root)
        const terrain = await captureTerrainMainPng(THREE, root, groundGroup, groundProps)
        root.traverse((obj) => {
          const mesh = obj as InstanceType<typeof THREE.Mesh>
          if (mesh.geometry) mesh.geometry.dispose?.()
          const mat = mesh.material
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.())
          else if (mat) mat.dispose?.()
        })

        if (cancelled) return
        setImages({ terrain, cross: cad.cross, long: cad.long })
        const lenM = Math.round(sectionLineLengthM(sectionLine))
        setStatus(
          `절단 ${lenM} m · 깊이 ${SECTION_DEFAULT_HALF_WIDTH_M} m` +
            (kinds.length ? ` · 레이어 ${kinds.length}` : ' · 켜진 레이어 없음') +
            (notes.length ? ` · ${notes.join(', ')}` : '')
        )
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'ThreeJs 단면도 생성 오류')
          setImages(null)
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [lineSig, kindsSig, line3857, kinds])

  if (error) {
    return <p className="py-10 text-center text-[12px] text-destructive">{error}</p>
  }
  if (busy || !images) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        {status || 'ThreeJs 단면도 준비 중…'}
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <p className="shrink-0 text-[11px] text-muted-foreground">{status}</p>
      {/* 메인(지형) | 횡단 / 종단 */}
      <div className="flex min-h-[440px] gap-2">
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded border border-border bg-[#1a1a1e]">
          <header className="shrink-0 border-b border-border/60 px-2 py-1 text-[11px] font-semibold text-slate-200">
            지형
          </header>
          <div className="min-h-0 flex-1 overflow-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={images.terrain}
              alt="ThreeJs 지형 단면도"
              className="block h-full w-full object-contain"
              title="지형"
            />
          </div>
        </section>
        <div className="flex w-[min(42%,320px)] shrink-0 flex-col gap-2">
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-[#1a1a1e]">
            <header className="shrink-0 border-b border-border/60 px-2 py-1 text-[11px] font-semibold text-slate-200">
              횡단면도
            </header>
            <div className="min-h-0 flex-1 overflow-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={images.cross}
                alt="ThreeJs 횡단면도"
                className="block h-full w-full object-contain"
                title="횡단면도"
              />
            </div>
          </section>
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-[#1a1a1e]">
            <header className="shrink-0 border-b border-border/60 px-2 py-1 text-[11px] font-semibold text-slate-200">
              종단면도
            </header>
            <div className="min-h-0 flex-1 overflow-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={images.long}
                alt="ThreeJs 종단면도"
                className="block h-full w-full object-contain"
                title="종단면도"
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
