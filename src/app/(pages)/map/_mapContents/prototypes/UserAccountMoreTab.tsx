'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronLeft, ChevronRight, Plus, RotateCcw, Search, Settings2, X } from 'lucide-react'
import { call } from '@/lib/api'
import { withBasePath, withBasePathNav } from '@/lib/basePath'
import { getOpenedKeyForSerEng } from '@/lib/mapServiceOpened'
import { scrubMapSearchParamsOnSystemSwitch } from '@/lib/mapSystemSwitch'
import { openShapeEditorMapWindow } from '@/lib/shapeEditorWindow'

type Props = {
  onClosePanel: () => void
}

type ServiceItem = {
  ser_eng: string
  ser_kor: string
  ser_svg: string | null
}

type SystemItem = {
  sys_key: string
  sys_kor: string
  serviceList: string[]
}

const FAVORITES_STORAGE_KEY = 'ggnr.proto.moreFavorites'
const ALWAYS_SHOW_ENGS = ['notice', 'board'] as const
const SERVICE_ICON_ALIASES: Record<string, string> = {
  radiationShelter: 'radiation',
}
const PORTAL_LINKS: Record<string, string> = {
  notice: '/notice',
  board: '/library',
}
/** 추가 단추 테두리까지 포함한 칸 높이 — 비었을 때·있을 때 줄이 흔들리지 않게 */
const FAVORITE_SLOT =
  'box-border flex flex-col items-center justify-center gap-0.5 rounded-sm border px-0.5 py-1.5'
const ICON_LABEL = 'w-full truncate text-center text-[11px] leading-tight'

function loadFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(parsed)) return []
    return parsed.map((v) => String(v ?? '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

function saveFavorites(next: string[]) {
  window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next))
}

function FavoriteStrip({
  items,
  onOpen,
}: {
  items: ServiceItem[]
  onOpen: (eng: string) => void
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ active: false, startX: 0, startScroll: 0, moved: false })
  const [edge, setEdge] = useState({ left: false, right: false })

  const syncEdge = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setEdge({
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    })
  }, [])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    syncEdge()
    const ro = new ResizeObserver(syncEdge)
    ro.observe(el)
    el.addEventListener('scroll', syncEdge, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', syncEdge)
    }
  }, [items, syncEdge])

  const scrollPage = (dir: -1 | 1) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth, behavior: 'smooth' })
  }

  return (
    <div className="relative min-w-0">
      {edge.left ? (
        <button
          type="button"
          aria-label="이전 즐겨찾기"
          onClick={() => scrollPage(-1)}
          className="absolute left-0 top-1/2 z-[1] flex h-7 w-5 -translate-y-1/2 items-center justify-center rounded-sm bg-background/90 text-muted-foreground shadow-sm hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      ) : null}
      {edge.right ? (
        <button
          type="button"
          aria-label="다음 즐겨찾기"
          onClick={() => scrollPage(1)}
          className="absolute right-0 top-1/2 z-[1] flex h-7 w-5 -translate-y-1/2 items-center justify-center rounded-sm bg-background/90 text-muted-foreground shadow-sm hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      ) : null}
      <div
        ref={scrollerRef}
        className="flex w-full min-w-0 cursor-grab touch-pan-x overflow-x-auto overflow-y-hidden scrollbar-hide active:cursor-grabbing"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          const el = scrollerRef.current
          if (!el) return
          dragRef.current = { active: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false }
        }}
        onPointerMove={(e) => {
          if (!dragRef.current.active) return
          const el = scrollerRef.current
          if (!el) return
          const dx = e.clientX - dragRef.current.startX
          if (Math.abs(dx) <= 4) return
          if (!dragRef.current.moved) {
            dragRef.current.moved = true
            el.setPointerCapture(e.pointerId)
          }
          el.scrollLeft = dragRef.current.startScroll - dx
        }}
        onPointerUp={(e) => {
          if (dragRef.current.moved) {
            scrollerRef.current?.releasePointerCapture(e.pointerId)
          }
          dragRef.current.active = false
        }}
        onPointerCancel={(e) => {
          if (dragRef.current.moved) {
            scrollerRef.current?.releasePointerCapture(e.pointerId)
          }
          dragRef.current.active = false
        }}
        onWheel={(e) => {
          if (e.deltaY === 0) return
          const el = scrollerRef.current
          if (!el) return
          el.scrollLeft += e.deltaY
          e.preventDefault()
        }}
      >
        {items.map((item) => (
          <button
            key={item.ser_eng}
            type="button"
            onClick={() => {
              if (dragRef.current.moved) return
              onOpen(item.ser_eng)
            }}
            className={`${FAVORITE_SLOT} w-[25%] min-w-[25%] shrink-0 select-none border-transparent text-foreground hover:bg-muted/50`}
            title={item.ser_kor}
          >
            <span className="flex h-8 w-8 items-center justify-center text-foreground">
              <ServiceGlyph item={item} />
            </span>
            <span className={ICON_LABEL}>{item.ser_kor}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ServiceGlyph({ item }: { item: ServiceItem }) {
  const svgRaw = item.ser_svg?.trim() ?? ''
  if (svgRaw.startsWith('<')) {
    return (
      <span
        className="h-5 w-5 shrink-0 [&_svg]:h-full [&_svg]:w-full [&_svg]:fill-none [&_svg]:stroke-current"
        dangerouslySetInnerHTML={{ __html: svgRaw }}
      />
    )
  }
  const iconKey = SERVICE_ICON_ALIASES[item.ser_eng] ?? item.ser_eng
  const iconSrc = withBasePath(`/image/serviceListIcon/${iconKey}.svg`)
  return (
    <span
      className="inline-block h-5 w-5 shrink-0 bg-current"
      style={{
        WebkitMaskImage: `url(${iconSrc})`,
        maskImage: `url(${iconSrc})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
      aria-hidden
    />
  )
}

/** 내 정보 패널 — 더보기(즐겨찾기·검색·기능 목록) */
export function UserAccountMoreTab({ onClosePanel }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const systemKey = String(searchParams.get('system') ?? '').trim()

  const [services, setServices] = useState<ServiceItem[]>([])
  const [systems, setSystems] = useState<SystemItem[]>([])
  const [bootProject, setBootProject] = useState('')
  const [keyword, setKeyword] = useState('')
  const [favorites, setFavorites] = useState<string[]>([])
  const [settingOpen, setSettingOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>([])

  useEffect(() => {
    setFavorites(loadFavorites())
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      call('', 'POST', { service: 'configService', action: 'getServiceList', params: {} }),
      call('', 'POST', { service: 'configService', action: 'getSystemList', params: {} }),
      call('', 'POST', { service: 'configService', action: 'getBootProject', params: {} }),
    ])
      .then(([serRes, sysRes, bootRes]) => {
        if (cancelled) return
        const serData = serRes?.data ?? serRes
        const ser = Array.isArray(serData?.ser) ? serData.ser : []
        setServices(
          ser
            .map((s: { ser_eng?: string; ser_kor?: string; ser_svg?: string | null }) => ({
              ser_eng: String(s.ser_eng ?? '').trim(),
              ser_kor: String(s.ser_kor ?? '').trim(),
              ser_svg: s.ser_svg ?? null,
            }))
            .filter((s: ServiceItem) => s.ser_eng)
        )
        const sysData = sysRes?.data ?? sysRes
        const rows = Array.isArray(sysData?.systems) ? sysData.systems : []
        setSystems(
          rows.map((s: { sys_key?: string; sys_kor?: string; serviceList?: string[] }) => ({
            sys_key: String(s.sys_key ?? '').trim(),
            sys_kor: String(s.sys_kor ?? '').trim() || String(s.sys_key ?? '').trim(),
            serviceList: Array.isArray(s.serviceList) ? s.serviceList.map((k) => String(k).trim()) : [],
          }))
        )
        const boot = bootRes?.data ?? bootRes
        setBootProject(String(boot?.project ?? '').trim())
      })
      .catch(() => {
        if (!cancelled) {
          setServices([])
          setSystems([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const serviceMap = useMemo(() => {
    const map = new Map(services.map((s) => [s.ser_eng, s]))
    if (!map.has('notice')) {
      map.set('notice', { ser_eng: 'notice', ser_kor: '공지사항', ser_svg: null })
    }
    if (!map.has('board')) {
      map.set('board', { ser_eng: 'board', ser_kor: '자료실', ser_svg: null })
    }
    return map
  }, [services])

  const homeSysByEng = useMemo(() => {
    const map = new Map<string, string>()
    for (const sys of systems) {
      for (const eng of sys.serviceList) {
        if (eng && !map.has(eng)) map.set(eng, sys.sys_key)
      }
    }
    return map
  }, [systems])

  const visibleEng = useCallback(
    (eng: string) => {
      if (!eng) return false
      if (bootProject === 'build_uj' && eng === 'riverUseLedger') return false
      return serviceMap.has(eng)
    },
    [bootProject, serviceMap]
  )

  const allItems = useMemo(() => {
    const seen = new Set<string>()
    const out: ServiceItem[] = []
    for (const eng of ALWAYS_SHOW_ENGS) {
      const item = serviceMap.get(eng)
      if (!item || seen.has(eng)) continue
      seen.add(eng)
      out.push(item)
    }
    for (const sys of systems) {
      for (const eng of sys.serviceList) {
        if (!visibleEng(eng) || seen.has(eng)) continue
        const item = serviceMap.get(eng)
        if (!item) continue
        seen.add(eng)
        out.push(item)
      }
    }
    return out
  }, [serviceMap, systems, visibleEng])

  const filteredItems = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return allItems
    return allItems.filter(
      (s) => s.ser_kor.toLowerCase().includes(q) || s.ser_eng.toLowerCase().includes(q)
    )
  }, [allItems, keyword])

  const settingGroups = useMemo(() => {
    const used = new Set<string>()
    const groups: { key: string; title: string; items: ServiceItem[] }[] = []
    const basics = ALWAYS_SHOW_ENGS.map((eng) => serviceMap.get(eng)).filter(
      (s): s is ServiceItem => s != null
    )
    if (basics.length) {
      for (const s of basics) used.add(s.ser_eng)
      groups.push({ key: 'basic', title: '기본', items: basics })
    }
    for (const sys of systems) {
      const items = sys.serviceList
        .filter((eng) => visibleEng(eng) && !used.has(eng))
        .map((eng) => serviceMap.get(eng))
        .filter((s): s is ServiceItem => s != null)
      if (!items.length) continue
      for (const s of items) used.add(s.ser_eng)
      groups.push({ key: sys.sys_key, title: sys.sys_kor, items })
    }
    return groups
  }, [serviceMap, systems, visibleEng])

  const openSettings = () => {
    setDraft(favorites)
    setSettingOpen(true)
  }

  const toggleDraft = (eng: string) => {
    setDraft((prev) => (prev.includes(eng) ? prev.filter((v) => v !== eng) : [...prev, eng]))
  }

  const confirmDraft = () => {
    setFavorites(draft)
    saveFavorites(draft)
    setSettingOpen(false)
  }

  const openService = (eng: string) => {
    const portal = PORTAL_LINKS[eng]
    if (portal) {
      onClosePanel()
      window.location.assign(withBasePathNav(portal))
      return
    }
    if (eng === 'shapeEditor') {
      onClosePanel()
      openShapeEditorMapWindow(homeSysByEng.get(eng) || systemKey || null)
      return
    }
    const current = new URLSearchParams(Array.from(searchParams.entries()))
    const home = homeSysByEng.get(eng) ?? systemKey
    const target = systems.find((s) => s.sys_key === home)
    if (home && home !== systemKey) {
      current.set('system', home)
      scrubMapSearchParamsOnSystemSwitch(current, home, target?.serviceList ?? [])
    }
    current.set('opened', getOpenedKeyForSerEng(eng))
    onClosePanel()
    router.push(`/map?${current.toString()}`)
  }

  const favoriteItems = favorites
    .map((eng) => serviceMap.get(eng))
    .filter((s): s is ServiceItem => s != null)

  const settingsModal =
    settingOpen && typeof document !== 'undefined'
      ? createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[120] bg-transparent"
              aria-label="바로가기 설정 닫기"
              onClick={() => setSettingOpen(false)}
            />
            <div
              className="fixed bottom-[7px] left-[419px] z-[130] flex h-[min(520px,calc(100vh-80px))] w-[400px] flex-col overflow-hidden rounded-[5px] border border-border bg-background shadow-2xl"
              role="dialog"
              aria-label="바로가기 설정"
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-2.5 py-2">
                <p className="text-xs font-medium text-foreground">바로가기 설정</p>
                <span className="text-xs tabular-nums text-muted-foreground">{draft.length}개</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-3 py-1.5">
                {settingGroups.map((group) => (
                  <section key={group.key} className="mb-2 last:mb-0">
                    <h3 className="py-1 text-[11px] font-medium text-muted-foreground">{group.title}</h3>
                    <ul className="grid grid-cols-2 gap-x-1">
                      {group.items.map((item) => {
                        const checked = draft.includes(item.ser_eng)
                        return (
                          <li key={item.ser_eng}>
                            <label className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-[11px] hover:bg-muted/50">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleDraft(item.ser_eng)}
                                className="h-3.5 w-3.5 shrink-0"
                              />
                              <span className="truncate">{item.ser_kor}</span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ))}
              </div>
              <div className="flex shrink-0 items-center justify-between gap-1 border-t border-border px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => setDraft([])}
                  className="inline-flex items-center gap-1 rounded-sm border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  초기화
                </button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={confirmDraft}
                    className="inline-flex items-center gap-1 rounded-sm border border-foreground bg-foreground px-2 py-1 text-[11px] text-background"
                  >
                    <Check className="h-3.5 w-3.5" />
                    확인
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettingOpen(false)}
                    className="inline-flex items-center gap-1 rounded-sm border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                    취소
                  </button>
                </div>
              </div>
            </div>
          </>,
          document.body
        )
      : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {settingsModal}
      <div className="shrink-0 border-b border-border px-2.5 pb-1.5 pt-1.5">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] font-medium text-muted-foreground">즐겨찾기</p>
          <button
            type="button"
            onClick={openSettings}
            className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            title="바로가기 설정"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
        {favoriteItems.length === 0 ? (
          <button
            type="button"
            onClick={openSettings}
            className={`${FAVORITE_SLOT} w-full border-dashed border-border text-muted-foreground hover:bg-muted/40`}
          >
            <span className="flex h-8 w-8 items-center justify-center">
              <Plus className="h-5 w-5" />
            </span>
            <span className={ICON_LABEL}>추가</span>
          </button>
        ) : (
          <FavoriteStrip items={favoriteItems} onOpen={openService} />
        )}
      </div>

      <div className="shrink-0 border-b border-border px-2.5 py-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="기능을 검색하세요"
            className="h-8 w-full rounded-md border border-border bg-background py-1 pl-8 pr-2 text-[11px] outline-none focus:ring-2 focus:ring-border"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {filteredItems.length === 0 ? (
          <p className="px-3 py-5 text-center text-xs text-muted-foreground">
            {keyword.trim() ? '검색된 기능이 없습니다.' : '표시할 기능이 없습니다.'}
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-y-0.5 px-1 py-1.5">
            {filteredItems.map((item) => (
              <button
                key={item.ser_eng}
                type="button"
                onClick={() => openService(item.ser_eng)}
                className="flex flex-col items-center gap-0.5 rounded-sm px-0.5 py-1.5 text-foreground hover:bg-muted/50"
                title={item.ser_kor}
              >
                <span className="flex h-8 w-8 items-center justify-center">
                  <ServiceGlyph item={item} />
                </span>
                <span className={ICON_LABEL}>{item.ser_kor}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
