'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { call } from '@/lib/api'
import { useResolvedThemeSafe } from '@/app/(pages)/(index)/theme-provider'
import { WTL_LAYER_SHAPE_DEFS } from '@/lib/wtlLayerShapeDefs'
import { SECTION_DEFAULT_HALF_WIDTH_M } from '@/app/(pages)/dev/_components/threeJs/groundSection'
import { ViewportCompass } from '@/app/(pages)/dev/_components/threeJs/ViewportCompass'
import { DATA_QUERY_SELECTION_PULSE_STEP } from '@/lib/mapDataQueryMapHighlight'
import { cn } from '@/lib/utils'
import {
  getWtlNetLayerDef,
  type WtlNetLayerKey,
} from '../wtlNetworkLayerCatalog'
import { wtlNetKorNameForTable } from '../wtlNetworkMapSources'
import { prefetchWtlDefineDisplayBundles } from '../wtlNetworkDefineDisplayCache'
import type { SectionFeatureMark } from './wtlNetworkSectionSvg'
import {
  SectionFeatureLegendPanel,
  SectionFeatureLegendSkeleton,
  useSectionFeatureLegend,
} from './wtlNetworkSectionLegend'

/**
 * ThreeJs 뷰·씬 배경색 (조절 지점)
 * - light: 화이트모드 — 밝은 회색
 * - dark: 다크모드
 */
const THREEJS_VIEW_BG = {
  light: 0x555555, // #555555
  dark: 0x1a1a1e, // #1a1a1e
} as const

const THREEJS_VIEW_BG_CLASS = {
  light: 'bg-[#555555]',
  dark: 'bg-[#1a1a1e]',
} as const

/** ThreeJs 데이터 범례 — 지형 토글 키 */
const THREEJS_GROUND_FEATURE_ID = '__wtl_section_ground__'

import {
  buildThreeJsHoverTipHtml,
  type ThreeJsTipUserData,
} from './wtlNetworkSectionThreeJsTip'

type Pt3857 = [number, number]

type Props = {
  line3857: Pt3857[]
  /** 관망조회에서 켜진 레이어 키 → 지형 파생 도형 */
  enabledKeys: string[]
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

/** 횡·종단과 동일 — 관로를 define_table(송수·배수·기타)로 나눔 */
function resolvePipeLayerMeta(
  table: string,
  saaCde: string | undefined,
  enabledKeys: Set<string>
): { key: string; kor: string; defineTable: string } | null {
  if (table === 'wtl_pipe_lm') {
    const code = String(saaCde ?? '').toUpperCase()
    if (code === 'SAA003') {
      if (!enabledKeys.has('wtl_pipe_lm_saa003')) return null
      return {
        key: 'wtl_pipe_lm_saa003',
        defineTable: 'wtl_pipe_lm_saa003',
        kor:
          wtlNetKorNameForTable('wtl_pipe_lm_saa003') || '송수관로',
      }
    }
    if (code === 'SAA004') {
      if (!enabledKeys.has('wtl_pipe_lm_saa004')) return null
      return {
        key: 'wtl_pipe_lm_saa004',
        defineTable: 'wtl_pipe_lm_saa004',
        kor:
          wtlNetKorNameForTable('wtl_pipe_lm_saa004') || '배수관로',
      }
    }
    if (!enabledKeys.has('wtl_pipe_lm_etc')) return null
    return {
      key: 'wtl_pipe_lm_etc',
      defineTable: 'wtl_pipe_lm_etc',
      kor: wtlNetKorNameForTable('wtl_pipe_lm_etc') || '상수관로(기타)',
    }
  }
  const keyHit = [...enabledKeys].find((k) => {
    const def = getWtlNetLayerDef(k as WtlNetLayerKey)
    return def?.table === table || k === table
  })
  if (!keyHit) return null
  const def = getWtlNetLayerDef(keyHit as WtlNetLayerKey)
  const defineTable = def?.defineTable || keyHit
  return {
    key: keyHit,
    defineTable,
    kor:
      wtlNetKorNameForTable(defineTable) ||
      wtlNetKorNameForTable(table) ||
      keyHit,
  }
}

function resolvePointLayerMeta(
  table: string,
  enabledKeys: Set<string>
): { key: string; kor: string; defineTable: string } | null {
  const keyHit =
    [...enabledKeys].find((k) => {
      const def = getWtlNetLayerDef(k as WtlNetLayerKey)
      return def?.table === table || k === table
    }) ?? (enabledKeys.has(table) ? table : null)
  if (!keyHit) return null
  const def = getWtlNetLayerDef(keyHit as WtlNetLayerKey)
  const defineTable = def?.defineTable || keyHit
  return {
    key: keyHit,
    defineTable,
    kor:
      wtlNetKorNameForTable(defineTable) ||
      wtlNetKorNameForTable(table) ||
      keyHit,
  }
}

function featureIdOf(ud: {
  featureId?: string
  pipeId?: string
  manholeId?: string
}): string {
  return String(ud.featureId || ud.pipeId || ud.manholeId || '').trim()
}

export function WtlNetworkSectionThreeJsTab({ line3857, enabledKeys }: Props) {
  const theme = useResolvedThemeSafe()
  const isDark = theme === 'dark'
  const viewBgHex = isDark ? THREEJS_VIEW_BG.dark : THREEJS_VIEW_BG.light
  const viewBgClass = isDark
    ? THREEJS_VIEW_BG_CLASS.dark
    : THREEJS_VIEW_BG_CLASS.light
  const hostRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<import('three').PerspectiveCamera | null>(null)
  const orbitRef =
    useRef<import('three/addons/controls/OrbitControls.js').OrbitControls | null>(
      null
    )
  const shapesRootRef = useRef<import('three').Object3D | null>(null)
  const sceneRef = useRef<import('three').Scene | null>(null)
  const hiddenKeysRef = useRef<Set<string>>(new Set())
  const tipGenRef = useRef(0)
  const selectRafRef = useRef(0)
  const selectPhaseRef = useRef(0)
  const selectOverlaysRef = useRef<
    Array<{
      line: import('three').Line | import('three').LineSegments
      dispose: () => void
    }>
  >([])
  const selectedFeatureIdRef = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [viewReady, setViewReady] = useState(false)
  const [legendFeatures, setLegendFeatures] = useState<SectionFeatureMark[]>([])

  const kinds = useMemo(() => resolveGroundLayerKinds(enabledKeys), [enabledKeys])
  const kindsSig = kinds.slice().sort().join('\u0001')
  const lineSig = line3857.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(';')

  const {
    stylesByKey,
    hiddenKeys,
    featureLegendGroups,
    toggleLegendItem,
    toggleLegendLayer,
  } = useSectionFeatureLegend(legendFeatures)
  hiddenKeysRef.current = hiddenKeys

  useEffect(() => {
    prefetchWtlDefineDisplayBundles(kinds)
  }, [kindsSig, kinds])

  const getCamera = useCallback(
    () => cameraRef.current,
    []
  )

  const faceNorth = useCallback(() => {
    const camera = cameraRef.current
    const orbit = orbitRef.current
    if (!camera || !orbit) return
    void import('@/app/(pages)/dev/_components/threeJs/fitGroundCamera').then(
      ({ faceNorthView }) => {
        faceNorthView(camera, orbit)
      }
    )
  }, [])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    void import('three').then((THREE) => {
      scene.background = new THREE.Color(viewBgHex)
    })
  }, [viewBgHex])

  useEffect(() => {
    const root = shapesRootRef.current
    if (!root) return
    root.traverse((obj) => {
      const ud = obj.userData as {
        featureId?: string
        pipeId?: string
        manholeId?: string
        isFill?: boolean
        isEdge?: boolean
        isInner?: boolean
        isGroundGroup?: boolean
      }
      if (ud.isGroundGroup) {
        const gid = featureIdOf(ud) || THREEJS_GROUND_FEATURE_ID
        obj.visible = !hiddenKeys.has(gid)
        return
      }
      const fid = featureIdOf(ud)
      if (!fid) return
      if (!(ud.isFill || ud.isEdge || ud.isInner)) return
      obj.visible = !hiddenKeys.has(fid)
    })
  }, [hiddenKeys])

  const clearSelectionPulse = useCallback(() => {
    if (selectRafRef.current) {
      cancelAnimationFrame(selectRafRef.current)
      selectRafRef.current = 0
    }
    for (const o of selectOverlaysRef.current) o.dispose()
    selectOverlaysRef.current = []
    selectedFeatureIdRef.current = null
  }, [])

  const flashFeature = useCallback(
    (featureId: string) => {
      const root = shapesRootRef.current
      if (!root || !featureId) return
      if (selectedFeatureIdRef.current === featureId) {
        clearSelectionPulse()
        return
      }
      clearSelectionPulse()
      selectedFeatureIdRef.current = featureId

      void import('three').then((THREE) => {
        if (selectedFeatureIdRef.current !== featureId) return
        type PulseHost = {
          parent: import('three').Object3D
          geometry: import('three').BufferGeometry
          mode: 'edges' | 'line'
        }
        const hosts: PulseHost[] = []

        /** 관로(튜브) — 와이어프레임 대신 양쪽 림 + 끝원만 */
        const pushTubeRim = (
          mesh: import('three').Mesh,
          geo: import('three').BufferGeometry
        ) => {
          const params = (
            geo as {
              parameters?: {
                path?: {
                  getPointAt: (u: number) => import('three').Vector3
                  getTangentAt: (u: number) => import('three').Vector3
                }
                radius?: number
                tubularSegments?: number
              }
            }
          ).parameters
          const path = params?.path
          const radius = Number(params?.radius)
          if (!path || !(radius > 0)) {
            hosts.push({ parent: mesh, geometry: geo, mode: 'edges' })
            return
          }
          const segs = Math.max(8, Math.min(64, Number(params?.tubularSegments) || 32))
          const left: import('three').Vector3[] = []
          const right: import('three').Vector3[] = []
          for (let i = 0; i <= segs; i++) {
            const u = i / segs
            const p = path.getPointAt(u)
            const t = path.getTangentAt(u)
            const out = new THREE.Vector3(-t.z, 0, t.x)
            if (out.lengthSq() < 1e-10) out.set(1, 0, 0)
            else out.normalize()
            left.push(p.clone().addScaledVector(out, radius + 0.01))
            right.push(p.clone().addScaledVector(out, -(radius + 0.01)))
          }
          if (left.length >= 2) {
            hosts.push({
              parent: mesh,
              geometry: new THREE.BufferGeometry().setFromPoints(left),
              mode: 'line',
            })
          }
          if (right.length >= 2) {
            hosts.push({
              parent: mesh,
              geometry: new THREE.BufferGeometry().setFromPoints(right),
              mode: 'line',
            })
          }
          hosts.push({ parent: mesh, geometry: geo, mode: 'edges' })
        }

        const fillMeshes: import('three').Mesh[] = []
        root.traverse((obj) => {
          const ud = obj.userData as {
            featureId?: string
            pipeId?: string
            manholeId?: string
            isFill?: boolean
            isEdge?: boolean
            isGroundGroup?: boolean
          }
          if (featureIdOf(ud) !== featureId) return
          if (ud.isGroundGroup) {
            obj.traverse((child) => {
              const mesh = child as import('three').Mesh
              if (!mesh.isMesh || !mesh.geometry) return
              fillMeshes.push(mesh)
              hosts.push({
                parent: mesh,
                geometry: mesh.geometry,
                mode: 'edges',
              })
            })
            return
          }
          if (ud.isFill) {
            const mesh = obj as import('three').Mesh
            if (!mesh.isMesh || !mesh.geometry) return
            fillMeshes.push(mesh)
            const isTube =
              mesh.geometry.type === 'TubeGeometry' ||
              Boolean(
                (mesh.geometry as { parameters?: { path?: unknown } }).parameters
                  ?.path
              )
            if (isTube) {
              pushTubeRim(mesh, mesh.geometry)
            } else {
              hosts.push({
                parent: mesh,
                geometry: mesh.geometry,
                mode: 'edges',
              })
            }
            return
          }
          if (ud.isEdge) return
        })
        if (!hosts.length) return

        // 선택 도형으로 카메라·궤도 타깃 이동
        const camera = cameraRef.current
        const orbit = orbitRef.current
        if (camera && orbit && fillMeshes.length) {
          const box = new THREE.Box3()
          for (const mesh of fillMeshes) {
            box.expandByObject(mesh)
          }
          if (!box.isEmpty()) {
            const center = box.getCenter(new THREE.Vector3())
            const size = box.getSize(new THREE.Vector3())
            const radius = Math.max(size.length() * 0.5, 0.8)
            const fov = (camera.fov * Math.PI) / 180
            const dist = Math.max(
              (radius * 1.15) / Math.tan(fov / 2),
              radius * 2.2,
              4
            )
            const dir = camera.position.clone().sub(orbit.target)
            if (dir.lengthSq() < 1e-8) dir.set(0.45, 0.75, 0.55)
            else dir.normalize()
            camera.position.copy(center).addScaledVector(dir, dist)
            camera.near = 0.1
            camera.far = Math.max(800, dist * 40)
            camera.updateProjectionMatrix()
            orbit.target.copy(center)
            orbit.update()
          }
        }

        const overlays: typeof selectOverlaysRef.current = []
        for (const host of hosts) {
          const outlineGeo =
            host.mode === 'edges'
              ? new THREE.EdgesGeometry(host.geometry, 25)
              : host.geometry
          const ownGeo = true
          const mat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.85,
            depthTest: false,
            linewidth: 2,
          })
          const line =
            host.mode === 'line'
              ? new THREE.Line(outlineGeo, mat)
              : new THREE.LineSegments(outlineGeo, mat)
          line.renderOrder = 999
          line.userData.__wtlSelectPulse = true
          host.parent.add(line)
          overlays.push({
            line,
            dispose: () => {
              host.parent.remove(line)
              if (ownGeo) outlineGeo.dispose()
              mat.dispose()
            },
          })
        }
        selectOverlaysRef.current = overlays
        selectPhaseRef.current = 0

        const tick = () => {
          selectPhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP
          const t = Math.sin(selectPhaseRef.current)
          const op = 0.35 + 0.65 * ((t + 1) / 2)
          for (const o of selectOverlaysRef.current) {
            const m = o.line.material as import('three').LineBasicMaterial
            m.opacity = op
            m.needsUpdate = true
          }
          selectRafRef.current = requestAnimationFrame(tick)
        }
        selectRafRef.current = requestAnimationFrame(tick)
      })
    },
    [clearSelectionPulse]
  )

  const metaLine = useMemo(() => {
    if (line3857.length < 2) return ''
    let len = 0
    for (let i = 1; i < line3857.length; i++) {
      const a = line3857[i - 1]!
      const b = line3857[i]!
      len += Math.hypot(b[0] - a[0], b[1] - a[1])
    }
    return `절단 ${Math.round(len)} m · 깊이 ±${SECTION_DEFAULT_HALF_WIDTH_M} m`
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lineSig가 line3857 내용 동일성 보장
  }, [lineSig])

  useEffect(() => {
    if (line3857.length < 2) {
      setError('절단선이 없습니다.')
      setViewReady(false)
      setLegendFeatures([])
      return
    }

    let cancelled = false
    let raf = 0
    let renderer: import('three').WebGLRenderer | null = null
    let orbit: import('three/addons/controls/OrbitControls.js').OrbitControls | null = null
    let resizeObs: ResizeObserver | null = null
    let shapesRoot: import('three').Object3D | null = null
    shapesRootRef.current = null
    clearSelectionPulse()
    setLegendFeatures([])

    const disposeSceneGraph = (root: import('three').Object3D) => {
      root.traverse((obj) => {
        const mesh = obj as import('three').Mesh
        const sprite = obj as import('three').Sprite
        mesh.geometry?.dispose?.()
        const mat = mesh.material ?? sprite.material
        if (Array.isArray(mat)) {
          mat.forEach((m) => {
            ;(m as import('three').Material & { map?: { dispose?: () => void } }).map?.dispose?.()
            m.dispose?.()
          })
        } else if (mat) {
          ;(mat as import('three').Material & { map?: { dispose?: () => void } }).map?.dispose?.()
          mat.dispose?.()
        }
      })
    }

    ;(async () => {
      setBusy(true)
      setError('')
      setStatus('지형·단면도 생성 중…')
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
            sectionRectCenter3857,
            sectionRectRing3857,
          },
          { fitSectionLineView },
          {
            SHAPE_NAME_KEY,
            isLineLayerShape,
            isPointLayerShape,
          },
          { captureExtentTileImage, extent3857FromCenterRadius },
        ] = await Promise.all([
          import('three'),
          import('three/addons/controls/OrbitControls.js'),
          import('@/app/(pages)/dev/_components/threeJs/createShapeObject'),
          import('@/app/(pages)/dev/_components/threeJs/shapeCatalog'),
          import('@/app/(pages)/dev/_components/threeJs/groundSection'),
          import('@/app/(pages)/dev/_components/threeJs/fitGroundCamera'),
          import('@/app/(pages)/dev/_components/threeJs/shapeTypes'),
          import('@/app/(pages)/dev/_components/threeJs/captureExtentTileImage'),
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

        setStatus('지도 항공 타일 불러오는 중…')
        let mapTex: string | null = null
        try {
          mapTex = await captureExtentTileImage(
            extent3857FromCenterRadius(field.centerX, field.centerY, field.radiusM),
            { targetPx: 1280 }
          )
        } catch {
          mapTex = null
        }
        if (cancelled) return

        const root = new THREE.Group()
        shapesRoot = root
        const groundProps = cloneDefaults('ground') as ShapeProps
        groundProps.kind = 'ground'
        groundProps.groundDrawMode = 'section'
        groundProps.groundSectionLine = sectionLine
        groundProps.groundHeightField = field
        groundProps.groundMapTextureUrl = mapTex
        if (mapTex) {
          groundProps.color = '#ffffff'
          groundProps.opacity = 1
        }
        groundProps.groundCenterX = field.centerX
        groundProps.groundCenterY = field.centerY
        groundProps.groundRadiusM = field.radiusM
        groundProps.posX = 0
        groundProps.posZ = 0
        groundProps.floorHeight = 0
        const groundGroup = createShapeObject('wtl-section-ground', groundProps)
        groundGroup.userData[SHAPE_NAME_KEY] = '지형_단면도'
        groundGroup.userData.featureId = THREEJS_GROUND_FEATURE_ID
        groundGroup.userData.isGroundGroup = true
        root.add(groundGroup)

        const extentParams = {
          x: field.centerX,
          y: field.centerY,
          srid: 3857,
          radiusM: field.radiusM,
          polygon3857,
        }
        const collected: SectionFeatureMark[] = [
          {
            id: THREEJS_GROUND_FEATURE_ID,
            distM: 0,
            depthM: 0,
            diameterM: 1,
            label: '지형',
            layerKorName: '지형',
            layerKey: THREEJS_GROUND_FEATURE_ID,
            color: '#84cc16',
            kind: 'point',
          },
        ]
        const enabledSet = new Set(enabledKeys)

        for (const kind of kinds) {
          if (cancelled) return
          const sk = kind as ShapeKind
          const layerDef = WTL_LAYER_SHAPE_DEFS.find((d) => d.kind === kind)
          const layerKorFallback = layerDef?.label ?? kind
          const layerColor = layerDef?.fallbackColor ?? '#888888'
          if (isLineLayerShape(sk)) {
            setStatus(`${layerKorFallback} 관로 조회 중…`)
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
            if (!pipeData?.success) continue
            const pipesRaw = Array.isArray(pipeData.pipes) ? pipeData.pipes : []
            if (!pipesRaw.length) continue
            // 횡·종단과 동일 — define_table(송수·배수·기타)로 필터·표기
            const pipes: PipeSegment[] = []
            for (const pipe of pipesRaw) {
              const meta = resolvePipeLayerMeta(kind, pipe.saaCde, enabledSet)
              if (!meta) continue
              pipes.push({
                ...pipe,
                layerKorName: meta.kor,
                fieldsTable: pipe.fieldsTable || meta.defineTable,
              })
              collected.push({
                id: pipe.id,
                distM: 0,
                depthM: pipe.depthM,
                diameterM: pipe.diameterM,
                label: (pipe.label && pipe.label.trim()) || pipe.id,
                layerKorName: meta.kor,
                layerKey: meta.defineTable,
                color: pipe.color || layerColor,
                kind: 'pipe',
                styleCode: pipe.saaCde,
              })
            }
            if (!pipes.length) continue
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
          } else if (isPointLayerShape(sk)) {
            const pointMeta = resolvePointLayerMeta(kind, enabledSet)
            const pointKor =
              pointMeta?.kor ||
              wtlNetKorNameForTable(kind) ||
              layerKorFallback
            const pointLayerKey = pointMeta?.defineTable || kind
            setStatus(`${pointKor} 점시설 조회 중…`)
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
            if (!manhData?.success) continue
            const manholes = Array.isArray(manhData.manholes)
              ? manhData.manholes
              : []
            if (!manholes.length) continue
            if (!pointMeta) continue
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
            for (const m of manholes) {
              collected.push({
                id: m.id,
                distM: 0,
                depthM: m.depthM,
                diameterM: m.diameterM,
                label: String(m.label ?? '').trim() || m.id,
                layerKorName: pointKor,
                layerKey: pointLayerKey,
                color: m.color || layerColor,
                kind: 'point',
              })
            }
          }
        }

        if (cancelled) return
        if (!cancelled) setLegendFeatures(collected)

        const host = hostRef.current
        if (!host) throw new Error('3D 뷰 영역을 찾지 못했습니다')

        const scene = new THREE.Scene()
        // 배경색: 파일 상단 THREEJS_VIEW_BG (라이트/다크)
        scene.background = new THREE.Color(
          document.documentElement.classList.contains('dark')
            ? THREEJS_VIEW_BG.dark
            : THREEJS_VIEW_BG.light
        )
        sceneRef.current = scene
        scene.add(new THREE.AmbientLight(0xffffff, 0.7))
        const keyLight = new THREE.DirectionalLight(0xffffff, 0.9)
        keyLight.position.set(50, 90, 40)
        scene.add(keyLight)
        const fill = new THREE.DirectionalLight(0xaabbff, 0.35)
        fill.position.set(-40, 40, -30)
        scene.add(fill)
        scene.add(root)
        shapesRootRef.current = root
        root.traverse((obj) => {
          const ud = obj.userData as {
            featureId?: string
            pipeId?: string
            manholeId?: string
            isFill?: boolean
            isEdge?: boolean
            isInner?: boolean
            isGroundGroup?: boolean
          }
          if (ud.isGroundGroup) {
            const gid = featureIdOf(ud) || THREEJS_GROUND_FEATURE_ID
            obj.visible = !hiddenKeysRef.current.has(gid)
            return
          }
          const fid = featureIdOf(ud)
          if (!fid) return
          if (!(ud.isFill || ud.isEdge || ud.isInner)) return
          obj.visible = !hiddenKeysRef.current.has(fid)
        })

        const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 4000)
        cameraRef.current = camera
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.domElement.className = 'block h-full w-full'
        renderer.domElement.style.touchAction = 'none'
        // host는 React 자식을 두지 않는 전용 노드 — replaceChildren/React reconcile 충돌 방지
        host.replaceChildren(renderer.domElement)

        orbit = new OrbitControls(camera, renderer.domElement)
        orbit.enableDamping = true
        orbit.dampingFactor = 0.08
        orbitRef.current = orbit
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

        // 관로·시설 fill 호버 툴팁
        const raycaster = new THREE.Raycaster()
        const pointer = new THREE.Vector2()
        const hideTip = () => {
          tipGenRef.current += 1
          const tip = tipRef.current
          if (tip) tip.style.display = 'none'
        }
        const onPointerMove = (ev: PointerEvent) => {
          if (cancelled || !renderer) return
          const rect = renderer.domElement.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) return
          pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
          pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
          raycaster.setFromCamera(pointer, camera)
          const hits = raycaster.intersectObjects(root.children, true)
          let hit: (typeof hits)[number] | undefined
          for (const h of hits) {
            const ud = h.object.userData as ThreeJsTipUserData & {
              isFill?: boolean
            }
            if (ud?.isFill && (ud.tooltipLayer || ud.tooltipLabel)) {
              hit = h
              break
            }
          }
          const tip = tipRef.current
          if (!tip || !hit) {
            hideTip()
            return
          }
          const ud = hit.object.userData as ThreeJsTipUserData
          const gen = ++tipGenRef.current
          const localX = ev.clientX - rect.left + 12
          const localY = ev.clientY - rect.top + 12
          void buildThreeJsHoverTipHtml(ud).then((html) => {
            if (cancelled || tipGenRef.current !== gen) return
            const el = tipRef.current
            if (!el) return
            el.innerHTML = html
            el.style.display = 'block'
            el.style.left = `${Math.min(localX, rect.width - el.offsetWidth - 8)}px`
            el.style.top = `${Math.min(localY, rect.height - el.offsetHeight - 8)}px`
          })
        }
        const onPointerLeave = () => hideTip()
        renderer.domElement.addEventListener('pointermove', onPointerMove)
        renderer.domElement.addEventListener('pointerleave', onPointerLeave)

        const tick = () => {
          if (cancelled || !renderer) return
          orbit?.update()
          renderer.render(scene, camera)
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)

        // cleanup hooks for listeners (effect return below also clears renderer)
        ;(renderer.domElement as HTMLCanvasElement & {
          __wtlTipCleanup?: () => void
        }).__wtlTipCleanup = () => {
          renderer?.domElement.removeEventListener('pointermove', onPointerMove)
          renderer?.domElement.removeEventListener('pointerleave', onPointerLeave)
          hideTip()
        }

        setStatus('')
        setViewReady(true)
        setBusy(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'ThreeJs 단면도 생성 오류')
          setViewReady(false)
          setBusy(false)
        }
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      if (selectRafRef.current) {
        cancelAnimationFrame(selectRafRef.current)
        selectRafRef.current = 0
      }
      for (const o of selectOverlaysRef.current) o.dispose()
      selectOverlaysRef.current = []
      selectedFeatureIdRef.current = null
      resizeObs?.disconnect()
      resizeObs = null
      orbit?.dispose()
      orbit = null
      orbitRef.current = null
      shapesRootRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      if (renderer) {
        const canvas = renderer.domElement as HTMLCanvasElement & {
          __wtlTipCleanup?: () => void
        }
        canvas.__wtlTipCleanup?.()
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
  }, [lineSig, kindsSig, clearSelectionPulse])

  const showLegendSkeleton =
    !error && featureLegendGroups.length === 0 && (busy || !viewReady)

  return (
    <div className="flex h-full min-h-0 gap-2">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
        {error ? (
          <p className="py-10 text-center text-[12px] text-destructive">{error}</p>
        ) : metaLine ? (
          <p className="shrink-0 text-[11px] text-muted-foreground">{metaLine}</p>
        ) : null}
        {/* hostRef는 Three.js 전용(React 자식 금지) */}
        <section
          className={
            error
              ? 'hidden'
              : cn(
                  'relative min-h-0 flex-1 overflow-hidden rounded border border-border',
                  viewBgClass
                )
          }
        >
          <div ref={hostRef} className="absolute inset-0" />
          <div
            ref={tipRef}
            className="pointer-events-none absolute z-[2] hidden max-w-[320px] min-w-[200px] rounded border border-border bg-background px-2.5 py-2 shadow-md"
            style={{ display: 'none' }}
          />
          {viewReady && !error ? (
            <ViewportCompass getCamera={getCamera} onClick={faceNorth} />
          ) : null}
          {busy || !viewReady ? (
            <p
              className={cn(
                'pointer-events-none absolute inset-0 z-[1] flex items-center justify-center text-[11px]',
                isDark ? 'text-slate-400' : 'text-slate-500'
              )}
            >
              {status || '3D 뷰 준비 중…'}
            </p>
          ) : null}
        </section>
      </div>
      {featureLegendGroups.length > 0 ? (
        <SectionFeatureLegendPanel
          groups={featureLegendGroups}
          stylesByKey={stylesByKey}
          hiddenKeys={hiddenKeys}
          onToggleItem={toggleLegendItem}
          onToggleLayer={toggleLegendLayer}
          onItemClick={flashFeature}
        />
      ) : showLegendSkeleton ? (
        <SectionFeatureLegendSkeleton />
      ) : null}
    </div>
  )
}
