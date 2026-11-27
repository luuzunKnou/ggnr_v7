'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useResolvedThemeSafe } from '@/app/(pages)/(index)/theme-provider'
import {
  ODOR_SCADA_PALETTE_OPTIONS,
  applyOdorScadaPalette,
  clearOdorScadaPaletteAttr,
  readOdorScadaPalette,
  type OdorScadaPaletteId,
} from '@/app/(pages)/(index)/odorPhV2/odorScadaPalette'
import {
  ODOR_LIGHT_CHROME_OPTIONS,
  applyOdorLightChrome,
  clearOdorLightChromeAttr,
  readOdorLightChrome,
  type OdorLightChromeId,
} from '@/app/(pages)/(index)/odorPhV2/odorLightChrome'

type Props = {
  className?: string
  /** 라이트 A/B 변경 시 셸·패널 즉시 반영 */
  onLightChromeChange?: (id: OdorLightChromeId) => void
}

/**
 * 다크: 관제 팔레트 A/B (내부 id b/c)
 * 라이트: 크롬 A/B (수정전/수정후)
 */
export function OdorScadaPaletteSwitch({ className, onLightChromeChange }: Props) {
  const resolved = useResolvedThemeSafe()
  const [darkActive, setDarkActive] = useState<OdorScadaPaletteId>('c')
  const [lightActive, setLightActive] = useState<OdorLightChromeId>('b')
  /** SSR·첫 페인트는 null — localStorage 테마와 hydration mismatch 방지 */
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    if (resolved === 'dark') {
      const id = readOdorScadaPalette()
      setDarkActive(id)
      applyOdorScadaPalette(id)
      clearOdorLightChromeAttr()
      return
    }
    clearOdorScadaPaletteAttr()
    const lightId = readOdorLightChrome()
    setLightActive(lightId)
    applyOdorLightChrome(lightId)
    onLightChromeChange?.(lightId)
  }, [mounted, resolved, onLightChromeChange])

  if (!mounted || (resolved !== 'dark' && resolved !== 'light')) return null

  if (resolved === 'dark') {
    return (
      <div
        className={cn(
          'inline-flex shrink-0 overflow-hidden rounded border border-border bg-muted/40',
          className
        )}
        role="group"
        aria-label="관제 다크 팔레트"
        title="관제 다크 팔레트 비교"
      >
        {ODOR_SCADA_PALETTE_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            title={opt.title}
            aria-label={opt.title}
            aria-pressed={darkActive === opt.id}
            onClick={() => {
              setDarkActive(opt.id)
              applyOdorScadaPalette(opt.id)
            }}
            className={cn(
              'h-6 min-w-6 cursor-pointer px-1.5 text-[12px] font-semibold tabular-nums',
              darkActive === opt.id
                ? 'bg-sky-500/25 text-sky-300'
                : 'text-muted-foreground hover:bg-white/10 hover:text-foreground'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'inline-flex shrink-0 overflow-hidden rounded border border-border bg-muted/40',
        className
      )}
      role="group"
      aria-label="라이트 크롬 비교"
      title="라이트 수정전(A) / 수정후(B)"
    >
      {ODOR_LIGHT_CHROME_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          title={opt.title}
          aria-label={opt.title}
          aria-pressed={lightActive === opt.id}
          onClick={() => {
            setLightActive(opt.id)
            applyOdorLightChrome(opt.id)
            onLightChromeChange?.(opt.id)
          }}
          className={cn(
            'h-6 min-w-6 cursor-pointer px-1.5 text-[12px] font-semibold tabular-nums',
            lightActive === opt.id
              ? 'bg-sky-500/20 text-sky-700'
              : 'text-muted-foreground hover:bg-black/5 hover:text-foreground'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
