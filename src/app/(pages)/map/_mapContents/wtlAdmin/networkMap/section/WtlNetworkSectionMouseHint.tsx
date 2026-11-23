'use client'

import { cn } from '@/lib/utils'

type Highlight = 'left' | 'wheel' | 'middle'

const BLUE = '#3b82f6'
const BODY = '#94a3b8'
const OUTLINE = '#e2e8f0'
const IDLE = '#64748b'

/** 미니 마우스 — highlight 부위만 파란색 (본체 clip 안) */
function MouseGlyph({
  highlight,
  className,
}: {
  highlight: Highlight
  className?: string
}) {
  const left = highlight === 'left' ? BLUE : IDLE
  const right = IDLE
  const wheel = highlight === 'wheel' || highlight === 'middle' ? BLUE : IDLE
  const clipId = `mouse-body-${highlight}`
  const showWheelArrows = highlight === 'wheel'
  const arrowPaths = (
    <>
      <path d="M26 4.5 L26 13.5" />
      <path d="M24.2 6.2 L26 4.5 L27.8 6.2" />
      <path d="M24.2 11.8 L26 13.5 L27.8 11.8" />
    </>
  )

  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('h-7 w-7 shrink-0', className)}
      aria-hidden
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="3" y="1" width="18" height="30" rx="9" ry="9" />
        </clipPath>
      </defs>
      {/* 본체 */}
      <rect
        x="3"
        y="1"
        width="18"
        height="30"
        rx="9"
        ry="9"
        fill={BODY}
        fillOpacity="0.45"
        stroke={OUTLINE}
        strokeWidth="1.2"
      />
      {/* 좌·우 버튼 — clip으로 둥근 본체 밖으로 안 나감 */}
      <g clipPath={`url(#${clipId})`}>
        <rect x="3" y="1" width="9" height="12" fill={left} />
        <rect x="12" y="1" width="9" height="12" fill={right} />
        <line
          x1="12"
          y1="1"
          x2="12"
          y2="13"
          stroke={OUTLINE}
          strokeWidth="1"
        />
        <line
          x1="3"
          y1="13"
          x2="21"
          y2="13"
          stroke={OUTLINE}
          strokeWidth="1"
        />
      </g>
      {/* 휠 */}
      <rect
        x="10"
        y="5"
        width="4"
        height="7"
        rx="2"
        fill={wheel}
        stroke={OUTLINE}
        strokeWidth="0.6"
      />
      {/* 휠업 — 휠 옆 ↕ (흰 border + 파란 선), 비휠 행은 동일 viewBox로 라벨 정렬 */}
      {showWheelArrows ? (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <g stroke="#ffffff" strokeWidth="2.6" opacity="0.9">
            {arrowPaths}
          </g>
          <g stroke={BLUE} strokeWidth="1.4">
            {arrowPaths}
          </g>
        </g>
      ) : null}
    </svg>
  )
}

const ROWS: { highlight: Highlight; label: string }[] = [
  { highlight: 'left', label: '좌클릭: 이동' },
  { highlight: 'wheel', label: '휠업: 확대/축소' },
  { highlight: 'middle', label: '휠클릭: 회전' },
]

/**
 * 단면도 3D — 우측 나침반 위 마우스 조작 안내.
 * OrbitControls: 좌클릭=이동, 휠=줌, 휠클릭=회전
 */
export function WtlNetworkSectionMouseHint() {
  return (
    <div
      className="pointer-events-none absolute bottom-[4.75rem] right-2 z-10 flex flex-col gap-1"
      aria-label="3D 마우스 조작 안내"
    >
      {ROWS.map((row) => (
        <div key={row.label} className="flex items-center gap-1.5">
          <MouseGlyph highlight={row.highlight} />
          <span className="whitespace-nowrap text-[10px] font-medium leading-none text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]">
            {row.label}
          </span>
        </div>
      ))}
    </div>
  )
}
