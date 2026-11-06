'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { SectionFeatureMark } from './wtlNetworkSectionSvg'
import { useWtlSectionLayerStyles } from './useWtlSectionLayerStyles'

export type LongPipeLegendItem = {
  key: string
  label: string
  color: string
  kind?: 'pipe' | 'point'
  layerKey?: string
  styleCode?: string
}

export type LongPipeLegendGroup = {
  layerName: string
  items: LongPipeLegendItem[]
}

function layerLegendName(f: SectionFeatureMark): string {
  return String(f.layerKorName || f.label || '레이어').trim() || '레이어'
}

function normalizeStroke(stroke?: string | null): string {
  if (!stroke) return '#888888'
  const value = String(stroke).trim()
  if (!value || value === '#' || value.toLowerCase() === 'undefined') {
    return '#888888'
  }
  const withHash = value.startsWith('#') ? value : `#${value}`
  if (!/^#[0-9A-Fa-f]{6}$/.test(withHash)) return '#888888'
  return withHash.toUpperCase()
}

/** 횡·종단 우측 데이터 범례 — 관로·점시설 등 켜진 레이어 전부 */
export function buildLongFeatureLegendGroups(
  features: SectionFeatureMark[]
): LongPipeLegendGroup[] {
  const used = new Map<string, number>()
  const byLayer = new Map<string, LongPipeLegendItem[]>()
  for (const f of features) {
    const layerName = layerLegendName(f)
    const baseName = (f.label || layerName).trim() || layerName
    const n = (used.get(baseName) ?? 0) + 1
    used.set(baseName, n)
    const label = n === 1 ? baseName : `${baseName} (${n})`
    const arr = byLayer.get(layerName)
    const item: LongPipeLegendItem = {
      key: f.id || `${layerName}-${label}`,
      label,
      color: normalizeStroke(f.color),
      kind: f.kind,
      layerKey: f.layerKey,
      styleCode: f.styleCode,
    }
    if (arr) arr.push(item)
    else byLayer.set(layerName, [item])
  }
  return [...byLayer.entries()].map(([layerName, items]) => ({
    layerName,
    items,
  }))
}

export function legendLabelByFeatureId(
  groups: LongPipeLegendGroup[]
): Map<string, string> {
  const map = new Map<string, string>()
  for (const g of groups) {
    for (const it of g.items) map.set(it.key, it.label)
  }
  return map
}

/** 횡·종단 공통 — 레이어/하위 항목 체크박스로 표시 토글 */
export function SectionFeatureLegendPanel({
  groups,
  stylesByKey,
  hiddenKeys,
  onToggleItem,
  onToggleLayer,
}: {
  groups: LongPipeLegendGroup[]
  stylesByKey: Record<
    string,
    {
      strokeColor: string
      fillColor: string
      strokeWidth: number
      legendSrc: string
      symbolByCode?: Record<
        string,
        { symbolImg: HTMLImageElement | null; legendSrc: string }
      >
    }
  >
  hiddenKeys: Set<string>
  onToggleItem: (key: string) => void
  onToggleLayer: (group: LongPipeLegendGroup) => void
}) {
  const [collapsedLayers, setCollapsedLayers] = useState<Set<string>>(
    () => new Set()
  )

  const toggleCollapse = (layerName: string) => {
    setCollapsedLayers((prev) => {
      const next = new Set(prev)
      if (next.has(layerName)) next.delete(layerName)
      else next.add(layerName)
      return next
    })
  }

  if (!groups.length) return null

  return (
    <div
      className="flex w-[180px] shrink-0 flex-col self-stretch overflow-hidden rounded border border-border bg-background"
      title="데이터 범례"
    >
      <div className="shrink-0 border-b-2 border-border bg-muted px-1.5 py-1 text-[10px] font-semibold text-muted-foreground">
        데이터 범례
      </div>
      <div className="min-h-0 max-h-[490px] flex-1 overflow-y-auto bg-background">
        {groups.map((g, gi) => {
          const allHidden =
            g.items.length > 0 && g.items.every((it) => hiddenKeys.has(it.key))
          const someVisible = g.items.some((it) => !hiddenKeys.has(it.key))
          const someHidden = g.items.some((it) => hiddenKeys.has(it.key))
          const collapsed = collapsedLayers.has(g.layerName)
          const isLast = gi === groups.length - 1
          return (
            <div key={g.layerName}>
              <div
                className={
                  isLast
                    ? 'flex items-center gap-1 border-t border-b border-border bg-muted px-1.5 py-0.5'
                    : 'flex items-center gap-1 border-t border-border bg-muted px-1.5 py-0.5'
                }
              >
                <button
                  type="button"
                  className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent"
                  title={
                    collapsed ? `${g.layerName} 펼치기` : `${g.layerName} 접기`
                  }
                  aria-label={
                    collapsed ? `${g.layerName} 펼치기` : `${g.layerName} 접기`
                  }
                  aria-expanded={!collapsed}
                  onClick={() => toggleCollapse(g.layerName)}
                >
                  {collapsed ? (
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
                <span
                  className="min-w-0 flex-1 truncate text-[10px] font-semibold text-foreground"
                  title={g.layerName}
                >
                  {g.layerName}
                </span>
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
                  checked={someVisible}
                  ref={(el) => {
                    if (el) el.indeterminate = someHidden && someVisible
                  }}
                  title={
                    allHidden
                      ? `${g.layerName} 표시`
                      : `${g.layerName} 숨기기`
                  }
                  onChange={() => onToggleLayer(g)}
                />
              </div>
              {!collapsed ? (
                <ul className="space-y-0.5 bg-background px-1.5 py-0.5">
                  {g.items.map((it) => {
                    const hidden = hiddenKeys.has(it.key)
                    const isPoint = it.kind === 'point'
                    const baseSt = it.layerKey
                      ? stylesByKey[String(it.layerKey).toLowerCase()]
                      : undefined
                    const code = String(it.styleCode ?? '').trim().toUpperCase()
                    const codeSym =
                      code && baseSt?.symbolByCode?.[code]
                        ? baseSt.symbolByCode[code]
                        : undefined
                    const stroke = baseSt?.strokeColor ?? it.color
                    const fill = baseSt?.fillColor ?? stroke
                    const legendSrc =
                      codeSym?.legendSrc || baseSt?.legendSrc || ''
                    return (
                      <li
                        key={it.key}
                        className="flex items-center gap-1 rounded py-0.5 hover:bg-muted"
                      >
                        <div
                          className={`flex min-w-0 flex-1 items-center gap-1 ${hidden ? 'text-muted-foreground opacity-55' : 'text-foreground'}`}
                        >
                          {isPoint && legendSrc ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={legendSrc}
                              alt=""
                              width={14}
                              height={14}
                              className="h-3.5 w-3.5 shrink-0 object-contain"
                              style={{ opacity: hidden ? 0.3 : 1 }}
                              aria-hidden
                            />
                          ) : isPoint ? (
                            <span
                              className="inline-block h-3 w-3 shrink-0 rounded-full"
                              style={{
                                backgroundColor: fill,
                                border: `${Math.max(1, baseSt?.strokeWidth ?? 1.5)}px solid ${stroke}`,
                                opacity: hidden ? 0.3 : 1,
                              }}
                              aria-hidden
                            />
                          ) : (
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 14 14"
                              className="shrink-0"
                              aria-hidden
                              style={{ opacity: hidden ? 0.3 : 1 }}
                            >
                              <line
                                x1="1"
                                y1="7"
                                x2="13"
                                y2="7"
                                stroke={stroke}
                                strokeWidth={2}
                                strokeLinecap="round"
                              />
                            </svg>
                          )}
                          <span
                            className="truncate text-[10px]"
                            style={{
                              textDecoration: hidden ? 'line-through' : 'none',
                            }}
                            title={it.label}
                          >
                            {it.label}
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
                          checked={!hidden}
                          title={
                            hidden ? `${it.label} 표시` : `${it.label} 숨기기`
                          }
                          onChange={() => onToggleItem(it.key)}
                        />
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 차트·SVG 공통 — 범례 그룹·숨김·스타일 */
export function useSectionFeatureLegend(features: SectionFeatureMark[]) {
  const { stylesByKey, revision: styleRevision } =
    useWtlSectionLayerStyles(features)
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set())
  const featureLegendGroups = useMemo(
    () => buildLongFeatureLegendGroups(features),
    [features]
  )
  const featureLegendKey = useMemo(
    () =>
      featureLegendGroups
        .flatMap((g) => g.items.map((it) => it.key))
        .join('|'),
    [featureLegendGroups]
  )

  useEffect(() => {
    setHiddenKeys(new Set())
  }, [featureLegendKey])

  const visibleFeatures = useMemo(
    () => features.filter((f) => !hiddenKeys.has(f.id)),
    [features, hiddenKeys]
  )

  const toggleLegendItem = useCallback((key: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleLegendLayer = useCallback((group: LongPipeLegendGroup) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev)
      const allHidden =
        group.items.length > 0 && group.items.every((it) => next.has(it.key))
      for (const it of group.items) {
        if (allHidden) next.delete(it.key)
        else next.add(it.key)
      }
      return next
    })
  }, [])

  return {
    stylesByKey,
    styleRevision,
    hiddenKeys,
    featureLegendGroups,
    visibleFeatures,
    toggleLegendItem,
    toggleLegendLayer,
  }
}
