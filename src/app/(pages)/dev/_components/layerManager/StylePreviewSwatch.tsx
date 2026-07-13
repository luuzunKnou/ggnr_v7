"use client"

import type { GeometryType } from "@/lib/geoserverStyleUtils"

/**
 * 체크보드 배경(외부 테두리) 위에 도형 타입별 심볼로 미리보기.
 * POINT: 중앙 점 / LINE: 대각선 / POLYGON: 내부 전체 면
 * GeoServer WMS 범례(GetLegendGraphic)와 달리 CSS 파싱 값만으로 그려서,
 * 실제 DB 테이블이 없어 WMS 요청이 실패하는 레이어에도 미리보기를 보여줄 수 있다.
 */
export function StylePreviewSwatch({
  geometryType,
  fillColor,
  strokeColor,
  opacity,
  showFrame = true,
}: {
  geometryType: GeometryType
  fillColor?: string
  strokeColor?: string
  opacity?: number
  /** 체크보드 배경 + 테두리 표시 여부. WMS 범례 이미지와 나란히 섞여 보이는 곳(목록 등)에서는 false로 꺼서 톤을 맞춘다 */
  showFrame?: boolean
}) {
  const fill = fillColor || "#808080"
  const stroke = strokeColor || "#000000"
  const title =
    geometryType === "LINE"
      ? `${geometryType} · 선색상 ${stroke}`
      : `${geometryType} · 색상 ${fill} · 투명도 ${opacity ?? 1}`
  return (
    <div
      className={showFrame ? "relative h-8 w-8 shrink-0 rounded border border-input overflow-hidden" : "relative h-8 w-8 shrink-0 overflow-hidden"}
      style={
        showFrame
          ? { backgroundImage: "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0 0/10px 10px" }
          : undefined
      }
      title={title}
    >
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
            backgroundColor: fill,
            opacity: opacity ?? 1,
            border: `1px solid ${stroke}`,
          }}
        />
      )}
      {geometryType === "LINE" && (
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 32 32" preserveAspectRatio="none">
          <line x1="6" y1="24" x2="24" y2="6" stroke={stroke} strokeWidth={2.5} strokeLinecap="round" />
        </svg>
      )}
      {geometryType === "POLYGON" && (
        <div
          className="absolute inset-1"
          style={{ backgroundColor: fill, opacity: opacity ?? 1, border: `2px solid ${stroke}` }}
        />
      )}
    </div>
  )
}
