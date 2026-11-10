'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { call } from '@/lib/api'
import { WTL_LAYER_SHAPE_DEFS } from '@/lib/wtlLayerShapeDefs'
import { getWtlNetLayerDef, type WtlNetLayerKey } from '../wtlNetworkLayerCatalog'

type Pt3857 = [number, number]

type Props = {
  line3857: Pt3857[]
  /** 관망조회에서 켜진 레이어 키 → 지형 파생 도형 */
  enabledKeys: string[]
}

type CadImages = { cross: string; long: string }

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
  const hostRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [cad, setCad] = useState<CadImages | null>(null)
  const [error, setError] = useState('')
  const [viewReady, setViewReady] = useState(false)

  const kinds = useMemo(() => resolveGroundLayerKinds(enabledKeys), [enabledKeys])
  const kindsSig = kinds.slice().sort().join('\u0001')
  const lineSig = line3857.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(';')

  useEffect(() => {
    if (line3857.length < 2) {
      setError('절단선이 없습니다.')
      setCad(null)
      setViewReady(false)
      return
    }

    let cancelled = false
    let raf = 0
    let renderer: import('three').WebGLRenderer | null = null
    let orbit: import('three/addons/controls/OrbitControls.js').OrbitControls | null = null
    let resizeObs: ResizeObserver | null = null
    let shapesRoot: import('three').Object3D | null = null

    const disposeSceneGraph = (root: import('three').Object3D) => {
      root.traverse((obj) => {
        const mesh = obj as import('three').Mesh
        mesh.geometry?.dispose?.()
        const mat = mesh.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.())
        else mat?.dispose?.()
      })
    }

    ;(async () => {
      setBusy(true)
      setError('')
      setStatus('ThreeJs 지형·단면도 생성 중…')
      setCad(null)
      setViewReady(false)

      try {
        const [
          THREE,
          { OrbitControls },
          { createShapeObject },
          { cloneDefaults },
          {
            SECTION_DEFAULT_HALF_WIDTH_M,
            SECTION_STEP_M,
            sectionCoverRadiusM,
            sectionLineLengthM,
            sectionRectCenter3857,
            sectionRectRing3857,
          },
          { captureSectionCadViews },
          { fitSectionLineView },
          {
            SHAPE_NAME_KEY,
            isLineLayerShape,
            isPointLayerShape,
          },
        ] = await Promise.all([
          import('three'),
          import('three/addons/controls/OrbitControls.js'),
          import('@/app/(pages)/dev/_components/threeJs/createShapeObject'),
          import('@/app/(pages)/dev/_components/threeJs/shapeCatalog'),
          import('@/app/(pages)/dev/_components/threeJs/groundSection'),
          import('@/app/(pages)/dev/_components/threeJs/sectionCadDraw'),
          import('@/app/(pages)/dev/_components/threeJs/fitGroundCamera'),
          import('@/app/(pages)/dev/_components/threeJs/shapeTypes'),
        ])
        type ShapeKind = import('@/app/(pages)/dev/_components/threeJs/shapeTypes').ShapeKind
        type GroundHeightField =
          import('@/app/(pages)/dev/_components/threeJs/shapeTypes').GroundHeightField
        type PipeSegment = import('@/app/(pages)/dev/_components/threeJs/shapeTypes').PipeSegment
        type ManholeFeature =
          import('@/app/(pages)/dev/_components/threeJs/shapeTypes').ManholeFeature
        type ShapeProps = import('@/app/(pages)/dev/_components/threeJs/shapeTypes').ShapeProps

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

        // 고도장=덮개 정사각(샘플). 지형·관로 발자국=절단선 중심 띠(polygon3857)
        const field: GroundHeightField = {
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
        if (!field.heights.some((h) => h != null)) {
          throw new Error('절단 범위 내 고도 샘플이 없습니다')
        }

        const root = new THREE.Group()
        shapesRoot = root
        const groundProps = cloneDefaults('ground') as ShapeProps
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
            // 범위(사각형) 파생 관로와 동일 생성 경로
            props.groundDrawMode = 'extent'
            props.groundSectionLine = null
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
            props.groundDrawMode = 'extent'
            props.groundSectionLine = null
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
        setStatus('CAD 단면도 렌더 중…')
        const cadImages = captureSectionCadViews(root)
        if (cancelled) return
        setCad(cadImages)

        const host = hostRef.current
        if (!host) throw new Error('3D 뷰 영역을 찾지 못했습니다')

        const scene = new THREE.Scene()
        scene.background = new THREE.Color(0x1a1a1e)
        scene.add(new THREE.AmbientLight(0xffffff, 0.7))
        const keyLight = new THREE.DirectionalLight(0xffffff, 0.9)
        keyLight.position.set(50, 90, 40)
        scene.add(keyLight)
        const fill = new THREE.DirectionalLight(0xaabbff, 0.35)
        fill.position.set(-40, 40, -30)
        scene.add(fill)
        scene.add(root)

        const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 4000)
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.domElement.className = 'block h-full w-full'
        renderer.domElement.style.touchAction = 'none'
        // host는 React 자식을 두지 않는 전용 노드 — replaceChildren/React reconcile 충돌 방지
        host.replaceChildren(renderer.domElement)

        orbit = new OrbitControls(camera, renderer.domElement)
        orbit.enableDamping = true
        orbit.dampingFactor = 0.08
        fitSectionLineView(camera, orbit, groundGroup, groundProps)

        const resize = () => {
          if (!renderer || cancelled) return
          const w = Math.max(1, host.clientWidth)
          const h = Math.max(1, host.clientHeight)
          camera.aspect = w / h
          camera.updateProjectionMatrix()
          renderer.setSize(w, h, false)
        }
        resize()
        resizeObs = new ResizeObserver(resize)
        resizeObs.observe(host)

        const tick = () => {
          if (cancelled || !renderer) return
          orbit?.update()
          renderer.render(scene, camera)
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)

        const lenM = Math.round(sectionLineLengthM(sectionLine))
        setStatus(
          `절단 ${lenM} m · 깊이 ±${SECTION_DEFAULT_HALF_WIDTH_M} m` +
            (kinds.length ? ` · 레이어 ${kinds.length}` : ' · 켜진 레이어 없음') +
            (notes.length ? ` · ${notes.join(', ')}` : '')
        )
        setViewReady(true)
        setBusy(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'ThreeJs 단면도 생성 오류')
          setCad(null)
          setViewReady(false)
          setBusy(false)
        }
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      resizeObs?.disconnect()
      resizeObs = null
      orbit?.dispose()
      orbit = null
      if (renderer) {
        const canvas = renderer.domElement
        renderer.dispose()
        const parent = canvas.parentNode
        if (parent) parent.removeChild(canvas)
        renderer = null
      }
      if (shapesRoot) {
        disposeSceneGraph(shapesRoot)
        shapesRoot = null
      }
    }
    // lineSig·kindsSig로 내용 동일성 보장 (배열 참조 deps면 불필요 재마운트)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- line3857/kinds는 sig와 동기
  }, [lineSig, kindsSig])

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {error ? (
        <p className="py-10 text-center text-[12px] text-destructive">{error}</p>
      ) : (
        <p className="shrink-0 text-[11px] text-muted-foreground">
          {busy ? status || 'ThreeJs 단면도 준비 중…' : status}
        </p>
      )}
      {/* 메인(3D) | 횡단 / 종단 — hostRef는 Three.js 전용(React 자식 금지) */}
      <div className={error ? 'hidden' : 'flex min-h-[440px] gap-2'}>
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded border border-border bg-[#1a1a1e]">
          <header className="shrink-0 border-b border-border/60 px-2 py-1 text-[11px] font-semibold text-slate-200">
            3D
          </header>
          <div className="relative min-h-0 flex-1 bg-[#1a1a1e]">
            <div ref={hostRef} className="absolute inset-0" />
            {busy || !viewReady ? (
              <p className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center text-[11px] text-slate-400">
                {status || '3D 뷰 준비 중…'}
              </p>
            ) : null}
          </div>
        </section>
        <div className="flex w-[min(42%,320px)] shrink-0 flex-col gap-2">
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-[#1a1a1e]">
            <header className="shrink-0 border-b border-border/60 px-2 py-1 text-[11px] font-semibold text-slate-200">
              횡단면도
            </header>
            <div className="min-h-0 flex-1 overflow-auto">
              {cad?.cross ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cad.cross}
                  alt="ThreeJs 횡단면도"
                  className="block h-full w-full object-contain"
                  title="횡단면도"
                />
              ) : (
                <p className="p-2 text-[11px] text-slate-400">준비 중…</p>
              )}
            </div>
          </section>
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-[#1a1a1e]">
            <header className="shrink-0 border-b border-border/60 px-2 py-1 text-[11px] font-semibold text-slate-200">
              종단면도
            </header>
            <div className="min-h-0 flex-1 overflow-auto">
              {cad?.long ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cad.long}
                  alt="ThreeJs 종단면도"
                  className="block h-full w-full object-contain"
                  title="종단면도"
                />
              ) : (
                <p className="p-2 text-[11px] text-slate-400">준비 중…</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
