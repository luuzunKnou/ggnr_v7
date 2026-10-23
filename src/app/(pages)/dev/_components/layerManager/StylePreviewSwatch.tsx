"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { call } from "@/lib/api"
import type { GeometryType, StyleProps } from "@/lib/geoserverStyleUtils"
import { toPublicSymbolPreviewUrl } from "@/lib/geoserverStyleUtils"
import { isPointSymbolLayerName } from "@/lib/mapLayerGeometryOrder"

/**
 * 체크보드 배경(외부 테두리) 위에 도형 타입별 심볼로 미리보기.
 * POINT: 중앙 점 / LINE: 대각선 / POLYGON: 내부 전체 면
 * 심볼 주소가 있으면 점·면 대신 아이콘 이미지를 보여 준다.
 * GeoServer WMS 범례(GetLegendGraphic)와 달리 CSS 파싱 값만으로 그려서,
 * 실제 DB 테이블이 없어 WMS 요청이 실패하는 레이어에도 미리보기를 보여줄 수 있다.
 */
export function StylePreviewSwatch({
  geometryType,
  fillColor,
  strokeColor,
  opacity,
  strokeOpacity,
  symbolUrl,
  showFrame = true,
  size = "md",
  cacheBust,
}: {
  geometryType: GeometryType
  fillColor?: string
  strokeColor?: string
  opacity?: number
  strokeOpacity?: number
  /** 외부 심볼 주소. 있으면 점/면 도형 대신 아이콘을 그린다 */
  symbolUrl?: string
  /** 체크보드 배경 + 테두리 표시 여부. WMS 범례 이미지와 나란히 섞여 보이는 곳(목록 등)에서는 false로 꺼서 톤을 맞춘다 */
  showFrame?: boolean
  /** "sm"(28px)은 목록 행 범례, "md"(32px, 기본)은 그 외 미리보기용 */
  size?: "sm" | "md"
  cacheBust?: number
}) {
  const fill = fillColor || "#808080"
  const stroke = strokeColor || "#000000"
  const fillAlpha = opacity ?? 1
  const strokeAlpha = strokeOpacity ?? 1
  const previewSrc = symbolUrl?.trim() ? toPublicSymbolPreviewUrl(symbolUrl) ?? symbolUrl.trim() : null
  const origSrc = symbolUrl?.trim() || null
  const [symbolBroken, setSymbolBroken] = useState(false)
  const [useOrig, setUseOrig] = useState(false)
  const baseSrc = useOrig && origSrc ? origSrc : previewSrc
  const imgSrc = baseSrc && cacheBust ? `${baseSrc}${baseSrc.includes("?") ? "&" : "?"}t=${cacheBust}` : baseSrc
  useLayoutEffect(() => {
    setSymbolBroken(false)
    setUseOrig(false)
  }, [symbolUrl, cacheBust, geometryType])

  const title = previewSrc && !symbolBroken
    ? `SYMBOL · ${previewSrc}`
    : geometryType === "LINE"
      ? `${geometryType} · 선색상 ${stroke}`
      : `${geometryType} · 색상 ${fill} · 투명도 ${opacity ?? 1}`
  const sizeClass = size === "sm" ? "h-7 w-7" : "h-8 w-8"
  return (
    <div
      className={
        showFrame
          ? `relative ${sizeClass} shrink-0 rounded border border-input overflow-hidden [background-image:repeating-conic-gradient(#ccc_0%_25%,#fff_0%_50%)] dark:[background-image:repeating-conic-gradient(#3f3f46_0%_25%,#27272a_0%_50%)] [background-size:10px_10px]`
          : `relative ${sizeClass} shrink-0 overflow-hidden`
      }
      title={title}
    >
      {imgSrc && !symbolBroken ? (
        <img
          key={imgSrc}
          src={imgSrc}
          alt=""
          className="absolute inset-0 h-full w-full object-contain p-0.5"
          onError={(e) => {
            if (e.currentTarget.getAttribute("src") !== imgSrc) return
            if (!useOrig && origSrc && origSrc !== previewSrc) {
              setUseOrig(true)
              return
            }
            setSymbolBroken(true)
          }}
        />
      ) : (
        <>
          {geometryType === "POINT" && (
            // GeoServer가 심볼 없는 point에 실제로 그리는 지름(기본 스케일 기준 mark-size ≈ 9.7px / 32px 캔버스)과 맞춤
            <div
              className="absolute rounded-full"
              style={{
                top: "50%",
                left: "50%",
                width: 10,
                height: 10,
                transform: "translate(-50%, -50%)",
                backgroundColor: withAlpha(fill, fillAlpha),
                border: `1px solid ${withAlpha(stroke, strokeAlpha)}`,
              }}
            />
          )}
          {geometryType === "LINE" && (
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 32 32" preserveAspectRatio="none">
              <line x1="6" y1="24" x2="24" y2="6" stroke={withAlpha(stroke, strokeAlpha)} strokeWidth={2.5} strokeLinecap="round" />
            </svg>
          )}
          {geometryType === "POLYGON" && (
            <div
              className="absolute inset-1"
              style={{ backgroundColor: withAlpha(fill, fillAlpha), border: `2px solid ${withAlpha(stroke, strokeAlpha)}` }}
            />
          )}
        </>
      )}
    </div>
  )
}

function shouldTryLocalSymbol(tableName: string, shpType?: string): boolean {
  const t = String(shpType ?? "").toUpperCase()
  if (t.includes("POINT")) return true
  return isPointSymbolLayerName(tableName)
}

function withAlpha(hex: string, alpha: number): string {
  const m = hex.match(/^#?([0-9a-fA-F]{6})$/)
  if (!m) return hex
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0")
  return `#${m[1]}${a}`
}

type LocalSymbolExt = "svg" | "png"

let publicSymbolIndexPromise: Promise<Record<string, LocalSymbolExt>> | null = null

/** public/symbol 파일 목록을 한 번만 읽어, 없는 심볼은 요청하지 않는다. */
function loadPublicSymbolIndex(): Promise<Record<string, LocalSymbolExt>> {
  if (!publicSymbolIndexPromise) {
    publicSymbolIndexPromise = call("", "POST", {
      service: "devTestService",
      action: "listPublicSymbolStems",
      params: {},
    })
      .then((res) => {
        const data = res?.data ?? res
        const stems = data?.stems
        if (!data?.success || !stems || typeof stems !== "object") return {}
        return stems as Record<string, LocalSymbolExt>
      })
      .catch(() => ({}))
  }
  return publicSymbolIndexPromise
}

/** 목록 행 스타일 칸. 범례 유무와 관계없이 28px(테두리 포함)로 고정한다. */
const LEGEND_SLOT_CLASS =
  "relative inline-flex h-7 w-7 shrink-0 box-border items-center justify-center overflow-hidden rounded border border-border/60 bg-muted/40 p-0.5 text-xs text-muted-foreground dark:bg-muted/60"

function LegendSpinner() {
  return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin pointer-events-none" aria-hidden />
}

/** 로드가 끝나기 전에는 스피너만 보여 깨진 아이콘이 노출되지 않게 한다. */
function LegendPendingImage({ src, onError }: { src: string; onError: () => void }) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    const img = imgRef.current
    setReady(Boolean(img?.complete && img.naturalWidth > 0))
  }, [src])

  return (
    <>
      {ready ? null : <LegendSpinner />}
      <img
        ref={imgRef}
        src={src}
        alt=""
        className={
          ready
            ? "h-full w-full object-contain pointer-events-none"
            : "pointer-events-none absolute h-px w-px opacity-0"
        }
        onLoad={() => setReady(true)}
        onError={onError}
      />
    </>
  )
}

/**
 * 행 스타일 칸 공통 미리보기.
 * 점형·심볼 레이어 중 public/symbol에 파일이 있을 때만 아이콘을 쓰고, 없으면 바로 WMS 범례를 받는다.
 */
export function StyleLegendThumb({
  tableName,
  shpType,
  legendUrl,
  canShowLegend,
  fallbackState,
  onNeedCssFallback,
  cacheBust,
}: {
  tableName: string
  shpType?: string
  legendUrl: string
  canShowLegend: boolean
  fallbackState: "loading" | "error" | (StyleProps & { geometryType: GeometryType }) | undefined
  onNeedCssFallback: () => void
  cacheBust?: number
}) {
  const tryLocal = shouldTryLocalSymbol(tableName, shpType)
  const [localExt, setLocalExt] = useState<LocalSymbolExt | "none" | null>(tryLocal ? null : "none")
  const q = cacheBust ? `?t=${cacheBust}` : ""

  useEffect(() => {
    if (!shouldTryLocalSymbol(tableName, shpType)) {
      setLocalExt("none")
      return
    }
    let cancelled = false
    setLocalExt(null)
    void loadPublicSymbolIndex().then((stems) => {
      if (cancelled) return
      const ext = stems[tableName.trim().toLowerCase()]
      setLocalExt(ext === "svg" || ext === "png" ? ext : "none")
    })
    return () => {
      cancelled = true
    }
  }, [tableName, shpType])

  if (localExt === null) {
    return (
      <span className={LEGEND_SLOT_CLASS}>
        <LegendSpinner />
      </span>
    )
  }
  if (localExt === "svg" || localExt === "png") {
    return (
      <span className={LEGEND_SLOT_CLASS}>
        <LegendPendingImage
          src={`/symbol/${tableName}.${localExt}${q}`}
          onError={() => setLocalExt("none")}
        />
      </span>
    )
  }

  const showImg = Boolean(legendUrl && canShowLegend && fallbackState === undefined)
  const showSwatch = fallbackState && typeof fallbackState === "object"
  const showLoading = fallbackState === "loading"
  return (
    <span className={`${LEGEND_SLOT_CLASS} [&>div]:!h-full [&>div]:!w-full`}>
      {showImg && <LegendPendingImage src={legendUrl} onError={onNeedCssFallback} />}
      {showSwatch && (
        <StylePreviewSwatch
          geometryType={fallbackState.geometryType}
          fillColor={fallbackState.fillColor}
          strokeColor={fallbackState.strokeColor}
          opacity={fallbackState.opacity}
          strokeOpacity={fallbackState.strokeOpacity}
          symbolUrl={fallbackState.symbolUrl}
          showFrame={false}
          size="sm"
          cacheBust={cacheBust}
        />
      )}
      {showLoading && <LegendSpinner />}
      {!showImg && !showSwatch && !showLoading && (
        <span className="pointer-events-none">—</span>
      )}
    </span>
  )
}
