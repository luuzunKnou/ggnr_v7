'use client'

import { useMemo } from 'react'
import {
  sampleTerrainStations,
  sectionPipeOf,
  WtlNetworkMapSectionFigure,
} from '../WtlNetworkMapSectionModal'

export type SectionGroundPt = { distM: number; elevM: number }

/** 횡단 좌측 — 켜진 급수구역·분구·블록 한 줄 */
export type SectionSupplyAreaLine = { label: string; name: string }

export type SectionFeatureMark = {
  id: string
  /** 절단선 시작점부터 거리(m) — 레거시 distance */
  distM: number
  /** 심도(m) — 레거시 pip_dep. 지표→관중심 */
  depthM: number
  /** 외경(m). 표시·스케일은 mm=×1000 */
  diameterM: number
  /** 관 라벨(pip_lbl 등) */
  label: string
  /** 레이어 한글명(관종) */
  layerKorName?: string
  color: string
  kind: 'pipe' | 'point'
  /** 종단: 거리축 구간 */
  spanFromM?: number
  spanToM?: number
  /** «기존» 탭 — 등고 지표 해발(m) */
  surfaceElevM?: number
}

const SECTION_LINE_COLOR = '#FF9100'
/** 절단선 양 끝 `|` 반높이(px) */
const SECTION_LINE_END_TICK = 6
const LABEL_ROW = 44
const LABEL_NEAR_PX = 56

/** 상단 주황 절단선 + 양 끝 수직 캡 */
function SectionCutLine({
  x1,
  x2,
  y,
}: {
  x1: number
  x2: number
  y: number
}) {
  const t = SECTION_LINE_END_TICK
  return (
    <g aria-hidden>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={SECTION_LINE_COLOR} strokeWidth={2} />
      <line
        x1={x1}
        y1={y - t}
        x2={x1}
        y2={y + t}
        stroke={SECTION_LINE_COLOR}
        strokeWidth={2}
        strokeLinecap="square"
      />
      <line
        x1={x2}
        y1={y - t}
        x2={x2}
        y2={y + t}
        stroke={SECTION_LINE_COLOR}
        strokeWidth={2}
        strokeLinecap="square"
      />
    </g>
  )
}

function normalizeStroke(stroke?: string | null): string | null {
  if (!stroke) return null
  const value = String(stroke).trim()
  if (!value || value === '#' || value.toLowerCase() === 'undefined') return null
  const withHash = value.startsWith('#') ? value : `#${value}`
  if (!/^#[0-9A-Fa-f]{6}$/.test(withHash)) return null
  return withHash.toUpperCase()
}

/** 절단선 거리 → 등고 지반고 보간 */
function groundElevAt(ground: SectionGroundPt[], distM: number): number | null {
  if (!ground.length) return null
  if (distM <= ground[0]!.distM) return ground[0]!.elevM
  const last = ground[ground.length - 1]!
  if (distM >= last.distM) return last.elevM
  for (let i = 1; i < ground.length; i++) {
    const a = ground[i - 1]!
    const b = ground[i]!
    if (distM <= b.distM) {
      const t = (distM - a.distM) / Math.max(1e-6, b.distM - a.distM)
      return a.elevM + (b.elevM - a.elevM) * t
    }
  }
  return last.elevM
}

/**
 * 관경 반경(px) — 등고 세로스케일 실비율(과장 없음) + 상한 축소.
 */
function radiusPx(stdDipMm: number, elevPxPerM: number) {
  const dip = Number(stdDipMm)
  if (!dip || Number.isNaN(dip) || dip <= 0) return 1.5
  const byElev = (dip / 1000 / 2) * elevPxPerM
  return Math.min(5, Math.max(1.2, byElev))
}

/**
 * 횡단면도 — 등고 지반고 라인 + 교차 관(원)·심도·⌞ 라벨
 */
function CrossSectionLegacySvg({
  ground,
  features,
  totalLengthM,
  supplyAreaLines = [],
}: {
  ground: SectionGroundPt[]
  features: SectionFeatureMark[]
  totalLengthM: number
  supplyAreaLines?: SectionSupplyAreaLine[]
}) {
  const width = 640
  const padL = 64
  const padR = 36
  /** 상단 절단선·치수 영역 */
  const padT = 56
  /** 단면도(지형) 구역 높이 — 라벨 위까지 최대한 사용 */
  const plotH = 240
  /** 좌하단 급수구역·분구·블록 표기 줄 수 */
  const supplyFooterH = supplyAreaLines.length > 0 ? 8 + supplyAreaLines.length * 14 : 0

  const layout = useMemo(() => {
    if (!ground.length) return null
    const geometryLength = Math.max(
      totalLengthM,
      ground[ground.length - 1]?.distM ?? 0,
      0.01
    )
    const pipes = features.filter((f) => f.kind === 'pipe' || f.kind === 'point')

    const groundElevs = ground.map((g) => g.elevM)
    const pipeBottoms: number[] = []
    for (const p of pipes) {
      const surf = p.surfaceElevM ?? groundElevAt(ground, p.distM)
      if (surf == null) continue
      pipeBottoms.push(surf - (Number(p.depthM) || 0) - (Number(p.diameterM) || 0) / 2)
    }
    // 지형 상·하한이 단면도 구역을 거의 꽉 채우도록 여유 최소화
    const elevMax = Math.max(...groundElevs)
    const elevMin = Math.min(
      ...groundElevs,
      ...(pipeBottoms.length ? pipeBottoms : groundElevs)
    )
    const elevSpan = Math.max(elevMax - elevMin, 0.2)
    const elevPxPerM = plotH / elevSpan
    const xOf = (d: number) => padL + (d / geometryLength) * (width - padL - padR)
    const yOf = (e: number) => padT + plotH - ((e - elevMin) / elevSpan) * plotH
    const plotBottom = padT + plotH

    // 절단 전구간(0~길이)에 지형선 맞춤
    const g0 = groundElevAt(ground, 0) ?? ground[0]!.elevM
    const g1 = groundElevAt(ground, geometryLength) ?? ground[ground.length - 1]!.elevM
    const groundPts: SectionGroundPt[] = [
      { distM: 0, elevM: g0 },
      ...ground.filter((g) => g.distM > 0.001 && g.distM < geometryLength - 0.001),
      { distM: geometryLength, elevM: g1 },
    ]
    const groundPath = groundPts
      .map((g, i) => `${i === 0 ? 'M' : 'L'}${xOf(g.distM).toFixed(1)},${yOf(g.elevM).toFixed(1)}`)
      .join(' ')
    const soilPath =
      groundPath +
      ` L${xOf(geometryLength).toFixed(1)},${plotBottom}` +
      ` L${xOf(0).toFixed(1)},${plotBottom} Z`

    const midElev = ground[Math.floor(ground.length / 2)]?.elevM
    const leftGroundY = yOf(g0)

    type Mark = {
      item: SectionFeatureMark
      origIdx: number
      startX: number
      surfY: number
      centerY: number
      r: number
      surf: number
    }
    const marks: Mark[] = []
    pipes.forEach((item, origIdx) => {
      const surf = item.surfaceElevM ?? groundElevAt(ground, item.distM)
      if (surf == null || !Number.isFinite(surf)) return
      const dep = Number(item.depthM) || 0
      const r = radiusPx(item.diameterM * 1000, elevPxPerM)
      marks.push({
        item,
        origIdx,
        startX: xOf(item.distM),
        surfY: yOf(surf),
        centerY: yOf(surf - dep),
        r,
        surf,
      })
    })

    const maxCircleBottom = marks.length
      ? Math.max(...marks.map((m) => m.centerY + m.r + 8))
      : plotBottom
    const firstElbowY = Math.max(maxCircleBottom + 16, plotBottom + 20)

    const placementByIdx = new Map<number, { labelOnLeft: boolean; row: number }>()
    let leftRowCount = 0
    let rightRowCount = 0
    const placedSides: { startX: number; labelOnLeft: boolean }[] = []
    ;[...marks]
      .sort((a, b) => a.item.distM - b.item.distM || a.origIdx - b.origIdx)
      .forEach((entry) => {
        const conflictsLeft = placedSides.some(
          (p) => p.labelOnLeft && Math.abs(p.startX - entry.startX) < LABEL_NEAR_PX
        )
        const labelOnLeft = !conflictsLeft
        const row = labelOnLeft ? leftRowCount++ : rightRowCount++
        placedSides.push({ startX: entry.startX, labelOnLeft })
        placementByIdx.set(entry.origIdx, { labelOnLeft, row })
      })

    const maxLabelRows = Math.max(leftRowCount, rightRowCount, marks.length > 0 ? 1 : 0)
    const lastElbowY =
      marks.length > 0 ? firstElbowY + LABEL_ROW * Math.max(maxLabelRows - 1, 0) : firstElbowY
    const svgHeight = Math.min(
      520,
      Math.max(280, lastElbowY + 28 + supplyFooterH)
    )

    const uniqueDistances = marks
      .map((m) => Number(m.item.distM))
      .filter((d) => !Number.isNaN(d))
      .sort((a, b) => a - b)
      .filter((d, i, arr) => i === 0 || Math.abs(d - arr[i - 1]!) > 0.001)

    return {
      geometryLength,
      groundPath,
      soilPath,
      midElev,
      leftGroundY,
      firstElbowY,
      placementByIdx,
      svgHeight,
      uniqueDistances,
      marks,
      xOf,
      yOf,
      elevPxPerM,
      plotH,
    }
  }, [ground, features, totalLengthM, padT, supplyFooterH])

  if (!layout) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        등고 지반고를 읽지 못했습니다. 절단선을 다시 그려 주세요.
      </p>
    )
  }

  const {
    geometryLength,
    groundPath,
    soilPath,
    midElev,
    leftGroundY,
    firstElbowY,
    placementByIdx,
    svgHeight,
    uniqueDistances,
    marks,
    xOf,
  } = layout
  const DIM_Y = padT - 10
  const DIM_TICK = 5
  /** 제목·끝캡·미터 라벨이 겹치지 않도록 절단선 Y */
  const axisY = 22
  const supplyFooterBaseY = svgHeight - 10

  return (
    <div className="overflow-auto rounded border-2 border-[#787878] bg-white">
      <svg
        viewBox={`0 0 ${width} ${svgHeight}`}
        width="100%"
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        className="block w-full"
        role="img"
        aria-label="횡단면도"
      >
        <rect width={width} height={svgHeight} fill="#ffffff" />
        <defs>
          <marker
            id="wtl-section-arrowhead"
            markerWidth="3"
            markerHeight="3"
            refX="3"
            refY="1.5"
            orient="auto-start-reverse"
          >
            <polygon points="0 0, 3 1.5, 0 3" fill="#7A7A7A" />
          </marker>
        </defs>

        {/* 절단선(거리축) — 제목은 선 위, 미터는 선·끝캡 아래 */}
        <text
          x={(padL + width - padR) / 2}
          y={axisY - SECTION_LINE_END_TICK - 4}
          textAnchor="middle"
          fill={SECTION_LINE_COLOR}
          fontSize={12}
          fontWeight={600}
        >
          절단선 (거리)
        </text>
        <SectionCutLine x1={padL} x2={width - padR} y={axisY} />
        <text
          x={padL}
          y={axisY + SECTION_LINE_END_TICK + 12}
          textAnchor="start"
          fill={SECTION_LINE_COLOR}
          fontSize={13}
        >
          0m
        </text>
        <text
          x={width - padR}
          y={axisY + SECTION_LINE_END_TICK + 12}
          textAnchor="end"
          fill={SECTION_LINE_COLOR}
          fontSize={13}
        >
          {geometryLength.toFixed(2)}m
        </text>

        {/* 등고 지반고 — 단면도 구역 전체 채움 */}
        <path d={soilPath} fill="#efe6d6" stroke="none" />
        <path d={groundPath} fill="none" stroke="#111" strokeWidth={1.6} />
        <text x={8} y={leftGroundY + 4} fill="#3d5560" fontSize={12} fontWeight={600}>
          지반고 {midElev != null ? `${midElev.toFixed(1)}m` : ''}
        </text>
        {supplyAreaLines.length > 0
          ? supplyAreaLines.map((line, i) => (
              <text
                key={line.label}
                x={8}
                y={supplyFooterBaseY - (supplyAreaLines.length - 1 - i) * 14}
                fill="#3d5560"
                fontSize={11}
                fontWeight={600}
              >
                {line.label} {line.name}
              </text>
            ))
          : null}

        {uniqueDistances.length >= 2
          ? uniqueDistances.slice(0, -1).map((d1, i) => {
              const d2 = uniqueDistances[i + 1]!
              const gapM = d2 - d1
              if (gapM <= 0) return null
              const x1 = xOf(d1)
              const x2 = xOf(d2)
              const midX = (x1 + x2) / 2
              return (
                <g key={`seg-${i}`}>
                  <line x1={x1} y1={DIM_Y} x2={x2} y2={DIM_Y} stroke="#7A7A7A" strokeWidth={1} />
                  <line
                    x1={x1}
                    y1={DIM_Y - DIM_TICK}
                    x2={x1}
                    y2={DIM_Y + DIM_TICK}
                    stroke="#7A7A7A"
                    strokeWidth={1}
                  />
                  <line
                    x1={x2}
                    y1={DIM_Y - DIM_TICK}
                    x2={x2}
                    y2={DIM_Y + DIM_TICK}
                    stroke="#7A7A7A"
                    strokeWidth={1}
                  />
                  <text x={midX} y={DIM_Y - 4} textAnchor="middle" fill="#7A7A7A" fontSize={11}>
                    {gapM.toFixed(2)}m
                  </text>
                </g>
              )
            })
          : null}

        {marks.map((m) => {
          const item = m.item
          const dep = Number(item.depthM) || 0
          const hasDep = dep > 0
          const color = normalizeStroke(item.color) || '#7A7A7A'
          const fillColor =
            color.startsWith('#') && color.length === 7 ? `${color}33` : color
          const korName = item.layerKorName || ''
          const place = placementByIdx.get(m.origIdx) || { labelOnLeft: true, row: 0 }
          const labelOnLeft = place.labelOnLeft
          const labelLen = Math.max(
            item.label ? item.label.length * 6.5 : 50,
            (korName?.length || 4) * 8
          )
          const polylineX = labelOnLeft
            ? Math.min(Math.max(8, m.startX - labelLen), m.startX - 8)
            : Math.max(Math.min(width - 8, m.startX + labelLen), m.startX + 8)
          const polylineY = firstElbowY + LABEL_ROW * place.row
          const textAnchor = labelOnLeft ? 'start' : 'end'
          const dipGap = Math.max(m.r, 2) + 6
          const depthLabelX = labelOnLeft ? m.startX - 54 : m.startX + 8
          const dipLabelX = labelOnLeft ? m.startX - dipGap : m.startX + dipGap
          const dipAnchor = labelOnLeft ? 'end' : 'start'
          const stdDipMm = Math.round(item.diameterM * 1000)
          const circle2Y = m.centerY + m.r + 4

          return (
            <g key={item.id}>
              <title>{item.label}</title>
              {hasDep ? (
                <>
                  <line
                    x1={m.startX}
                    y1={m.surfY}
                    x2={m.startX}
                    y2={m.centerY}
                    stroke="#7A7A7A"
                    strokeWidth={2}
                    markerStart="url(#wtl-section-arrowhead)"
                    markerEnd="url(#wtl-section-arrowhead)"
                  />
                  <text
                    x={depthLabelX}
                    y={(m.surfY + m.centerY) / 2}
                    dy={5}
                    fill="#7A7A7A"
                    fontSize={12}
                  >
                    {Math.round(dep * 1000)}mm
                  </text>
                </>
              ) : null}
              <circle
                cx={m.startX}
                cy={m.centerY}
                r={Math.max(m.r, 0.5)}
                fill={fillColor}
                stroke={color}
                strokeWidth={2}
              />
              {stdDipMm > 0 ? (
                <text
                  x={dipLabelX}
                  y={m.centerY}
                  dy={4}
                  textAnchor={dipAnchor}
                  fill={color}
                  fontSize={12}
                >
                  {stdDipMm}mm
                </text>
              ) : null}
              <polygon
                points={`${m.startX},${circle2Y - 5} ${m.startX - 4},${circle2Y + 3} ${m.startX + 4},${circle2Y + 3}`}
                fill={color}
              />
              <polyline
                points={`${m.startX},${circle2Y} ${m.startX},${polylineY} ${polylineX},${polylineY}`}
                stroke={color}
                strokeWidth={1}
                fill="none"
              />
              {korName ? (
                <text
                  x={polylineX}
                  y={polylineY - 6}
                  textAnchor={textAnchor}
                  fill={color}
                  fontSize={14}
                >
                  {korName}
                </text>
              ) : null}
              <text
                x={polylineX}
                y={polylineY + 14}
                textAnchor={textAnchor}
                fill={color}
                fontSize={12}
              >
                {item.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/**
 * 종단면도 — 등고 지형 + 관별 심도 LINE 그래프(지표−심도)
 */
function LongSectionSvg({
  ground,
  features,
  totalLengthM,
}: {
  ground: SectionGroundPt[]
  features: SectionFeatureMark[]
  totalLengthM: number
}) {
  const width = 640
  const padL = 56
  const padR = 28
  const padT = 52
  const padB = 36
  const cutY = 22
  const LONG_LABEL_STEP = 14
  const LONG_LABEL_NEAR = 52

  const layout = useMemo(() => {
    if (!ground.length) return null
    const len = Math.max(totalLengthM, ground[ground.length - 1]?.distM ?? 0, 0.01)
    const pipes = features.filter((f) => f.kind === 'pipe')

    const elevs = ground.map((g) => g.elevM)
    for (const p of pipes) {
      const from = p.spanFromM ?? p.distM
      const to = p.spanToM ?? p.distM
      for (const g of ground) {
        if (g.distM < from - 0.01 || g.distM > to + 0.01) continue
        elevs.push(g.elevM - (Number(p.depthM) || 0))
      }
      const midSurf = p.surfaceElevM ?? groundElevAt(ground, p.distM)
      if (midSurf != null) elevs.push(midSurf - (Number(p.depthM) || 0))
    }
    const elevMin = Math.min(...elevs) - 0.3
    const elevMax = Math.max(...elevs) + 0.3
    const elevSpan = Math.max(elevMax - elevMin, 0.5)
    const basePlotH = 268
    const plotW = width - padL - padR
    const xOf = (d: number) => padL + (d / len) * plotW

    const rawLines = pipes.map((p) => {
      const from = Math.max(0, p.spanFromM ?? p.distM - 0.5)
      const to = Math.min(len, p.spanToM ?? p.distM + 0.5)
      const dep = Number(p.depthM) || 0
      const elevPts: { distM: number; elevM: number }[] = []
      for (const g of ground) {
        if (g.distM < from || g.distM > to) continue
        elevPts.push({ distM: g.distM, elevM: g.elevM - dep })
      }
      if (elevPts.length < 2) {
        const s0 = groundElevAt(ground, from) ?? elevMax
        const s1 = groundElevAt(ground, to) ?? elevMax
        elevPts.push({ distM: from, elevM: s0 - dep }, { distM: to, elevM: s1 - dep })
      }
      const midX = xOf((from + to) / 2)
      const midElev =
        elevPts[Math.floor(elevPts.length / 2)]?.elevM ?? (elevMin + elevMax) / 2
      return {
        id: p.id,
        color: normalizeStroke(p.color) || '#7A7A7A',
        label: p.label || p.layerKorName || '',
        elevPts,
        midX,
        midElev,
        depthM: dep,
      }
    })

    /** 가로로 가까운 라벨을 계단식(위쪽) 행으로 배치 */
    const placed: { midX: number; row: number }[] = []
    const withRows = [...rawLines]
      .sort((a, b) => a.midX - b.midX)
      .map((dl) => {
        let row = 0
        while (
          placed.some(
            (p) => Math.abs(p.midX - dl.midX) < LONG_LABEL_NEAR && p.row === row
          )
        ) {
          row += 1
        }
        placed.push({ midX: dl.midX, row })
        return { ...dl, labelRow: row }
      })
    const maxLabelRow = withRows.reduce((m, d) => Math.max(m, d.labelRow), 0)
    const labelHeadroom = maxLabelRow * LONG_LABEL_STEP
    const plotH = basePlotH
    const height = padT + plotH + padB + labelHeadroom
    const yOf = (e: number) =>
      padT + labelHeadroom + plotH - ((e - elevMin) / elevSpan) * plotH

    const groundPath = ground
      .map((g, i) => `${i === 0 ? 'M' : 'L'}${xOf(g.distM).toFixed(1)},${yOf(g.elevM).toFixed(1)}`)
      .join(' ')
    const soilPath =
      groundPath +
      ` L${xOf(ground[ground.length - 1]!.distM).toFixed(1)},${padT + labelHeadroom + plotH}` +
      ` L${xOf(ground[0]!.distM).toFixed(1)},${padT + labelHeadroom + plotH} Z`

    const depthLines = withRows.map((dl) => {
      const pts = dl.elevPts.map((q) => ({ x: xOf(q.distM), y: yOf(q.elevM) }))
      const midY = yOf(dl.midElev)
      return {
        id: dl.id,
        color: dl.color,
        label: dl.label,
        path: pts.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' '),
        midX: dl.midX,
        midY,
        labelY: midY - 6 - dl.labelRow * LONG_LABEL_STEP,
        depthM: dl.depthM,
      }
    })

    return { len, height, groundPath, soilPath, depthLines, labelHeadroom }
  }, [ground, features, totalLengthM])

  if (!layout) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        등고 지반고를 읽지 못했습니다. 절단선을 다시 그려 주세요.
      </p>
    )
  }

  return (
    <div className="overflow-auto rounded border-2 border-[#787878] bg-white">
      <svg
        viewBox={`0 0 ${width} ${layout.height}`}
        width="100%"
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        className="block w-full"
        role="img"
        aria-label="종단면도"
      >
        <rect width={width} height={layout.height} fill="#ffffff" />
        <SectionCutLine x1={padL} x2={width - padR} y={cutY} />
        <text
          x={padL}
          y={cutY + SECTION_LINE_END_TICK + 12}
          textAnchor="start"
          fill={SECTION_LINE_COLOR}
          fontSize={14}
        >
          0m
        </text>
        <text
          x={width - padR}
          y={cutY + SECTION_LINE_END_TICK + 12}
          textAnchor="end"
          fill={SECTION_LINE_COLOR}
          fontSize={14}
        >
          {layout.len.toFixed(2)}m
        </text>

        <path d={layout.soilPath} fill="#efe6d6" stroke="none" />
        <path d={layout.groundPath} fill="none" stroke="#111" strokeWidth={1.8} />
        <text x={8} y={padT + layout.labelHeadroom + 4} fill="#3d5560" fontSize={11}>
          지형(등고)
        </text>

        {layout.depthLines.map((dl) => (
          <g key={dl.id}>
            <path d={dl.path} fill="none" stroke={dl.color} strokeWidth={2.2} />
            <text
              x={dl.midX}
              y={dl.labelY}
              textAnchor="middle"
              fill={dl.color}
              fontSize={11}
              fontWeight={600}
            >
              {dl.label}
              {dl.depthM > 0 ? ` · ${dl.depthM.toFixed(2)}m` : ''}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

/**
 * «기존» 탭 — git HEAD `WtlNetworkMapSectionModal` SectionFigure 그대로.
 * (이번 작업 이전 예시 지형 SVG)
 */
function PrevOriginalSectionSvg({
  lineLonLat,
  diameterMm,
}: {
  /** EPSG:4326 [lon,lat][] — 없으면 샘플 관로 */
  lineLonLat?: [number, number][] | null
  diameterMm?: number
}) {
  const sample = sectionPipeOf(null)
  const line =
    lineLonLat && lineLonLat.length >= 2
      ? lineLonLat
      : (sample?.line as [number, number][] | undefined)
  const points = useMemo(() => {
    if (!line || line.length < 2) return null
    return sampleTerrainStations(line)
  }, [line])
  const dip = Number.isFinite(diameterMm) && (diameterMm ?? 0) > 0 ? diameterMm! : Number(sample?.diameter) || 150

  if (!points) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        기존 단면도를 그릴 라인이 없습니다.
      </p>
    )
  }

  return (
    <div className="overflow-auto">
      <WtlNetworkMapSectionFigure points={points} diameterMm={dip} />
      <p className="mt-2 text-[11px] text-muted-foreground">
        위 지표면은 예시 지형 높이를 따릅니다. 원은 관이고, 그 자리 지면에서 관 위까지가 토피 1.2m입니다.
      </p>
    </div>
  )
}

export function WtlNetworkSectionSvg({
  mode,
  ground = [],
  features,
  totalLengthM,
  lineLonLat = null,
  supplyAreaLines = [],
}: {
  mode: 'cross' | 'long' | 'prev' | 'threejs'
  ground?: SectionGroundPt[]
  features: SectionFeatureMark[]
  totalLengthM: number
  /** «기존» 탭용 — 절단선 lon/lat */
  lineLonLat?: [number, number][] | null
  /** 횡단 좌측 지반고 위 — 켜진 급수구역·분구·블록 */
  supplyAreaLines?: SectionSupplyAreaLine[]
}) {
  if (mode === 'cross') {
    return (
      <CrossSectionLegacySvg
        ground={ground}
        features={features}
        totalLengthM={totalLengthM}
        supplyAreaLines={supplyAreaLines}
      />
    )
  }
  if (mode === 'prev') {
    const pipeFeat = features.find((f) => f.kind === 'pipe')
    const dipMm = pipeFeat ? Math.round(pipeFeat.diameterM * 1000) : undefined
    return <PrevOriginalSectionSvg lineLonLat={lineLonLat} diameterMm={dipMm} />
  }
  return (
    <LongSectionSvg ground={ground} features={features} totalLengthM={totalLengthM} />
  )
}
