'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileLock,
  Plus,
  RotateCcw,
  Settings2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { call } from '@/lib/api'
import { getBasePath, withBasePath, withBasePathNav } from '@/lib/basePath'
import { getOpenedKeyForSerEng } from '@/lib/mapServiceOpened'
import { scrubMapSearchParamsOnSystemSwitch } from '@/lib/mapSystemSwitch'
import { openShapeEditorMapWindow } from '@/lib/shapeEditorWindow'

type Props = {
  onClosePanel: () => void
  /** 바로가기 설정 옆 칸이 열려 있을 때 닫기용 */
  suppressSettings?: boolean
  onOpenSettings?: () => void
  matchHeightPx?: number | null
  /** 바깥 막에서 내 정보 칸을 빼 단추가 눌리게 함 */
  overlayClipPath?: string
  /** 시스템 불편신고 플로팅 모달 */
  onOpenSystemFeedback?: () => void
  /** 처리 대기 승인요청 건수 (내 메뉴 배너) */
  pendingApproveCount?: number
  /** 배너 클릭 → 승인요청 탭 */
  onOpenApproveTab?: () => void
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
const ALWAYS_SHOW_ENGS_BASE = ['notice', 'board', 'systemFeedback', 'dataRequest'] as const
const SYSTEM_FEEDBACK_ENG = 'systemFeedback'
const DATA_REQUEST_ENG = 'dataRequest'

type FavItem = ServiceItem & { token: string }

function settingFavToken(groupKey: string, eng: string) {
  return groupKey === 'basic' ? eng : `${groupKey}:${eng}`
}

function parseFavToken(token: string): { sysKey: string | null; eng: string } {
  const i = token.indexOf(':')
  if (i <= 0) return { sysKey: null, eng: token }
  return { sysKey: token.slice(0, i), eng: token.slice(i + 1) }
}

function migrateFavoriteTokens(tokens: string[], systems: SystemItem[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of tokens) {
    const { sysKey, eng } = parseFavToken(token)
    if (!eng) continue
    const next = sysKey
      ? token
      : eng === 'notice' ||
          eng === 'board' ||
          eng === SYSTEM_FEEDBACK_ENG ||
          eng === DATA_REQUEST_ENG
        ? eng
        : (() => {
            const first = systems.find((s) => s.serviceList.includes(eng))
            return first ? `${first.sys_key}:${eng}` : ''
          })()
    if (!next || seen.has(next)) continue
    seen.add(next)
    out.push(next)
  }
  return out
}
const SERVICE_ICON_ALIASES: Record<string, string> = {
  radiationShelter: 'radiation',
}
const PORTAL_LINKS: Record<string, string> = {
  notice: '/notice',
  board: '/library',
  dataRequest: '/data-request',
  dataRequestApprove: '/data-request-approve',
}

/** BASE_PATH(/uav_us)로 프로젝트 추정 — API 응답 전에 공통 메뉴가 비지 않게 */
function projectHintFromBasePath(): string {
  const base = getBasePath().replace(/^\/+|\/+$/g, '')
  return base || ''
}

/** 추가 단추 테두리까지 포함한 칸 높이 — 비었을 때·로딩·있을 때 동일 */
const FAVORITE_ROW_H = 'h-[78px]'
const FAVORITE_SLOT =
  `box-border ${FAVORITE_ROW_H} flex flex-col items-center justify-center gap-0.5 rounded-sm border px-0.5 py-1.5`
const FAVORITE_EMPTY_SLOT = FAVORITE_SLOT
const ICON_LABEL =
  'w-full whitespace-nowrap text-center text-[11px] font-normal leading-tight text-[#8A8A8A]'
/** 공통 메뉴 버튼 라벨 — 섹션 타이틀과 별개 */
const COMMON_MENU_LABEL =
  'w-full whitespace-nowrap text-center text-[11px] font-normal leading-tight text-[#1A1A1A]'
const COMMON_ITEM =
  'flex flex-col items-center gap-0.5 rounded-sm px-0.5 py-1 text-foreground hover:bg-muted/50'

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
  items: FavItem[]
  onOpen: (token: string) => void
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
    <div className={`relative min-w-0 ${FAVORITE_ROW_H}`}>
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
            key={item.token}
            type="button"
            onClick={() => {
              if (dragRef.current.moved) return
              onOpen(item.token)
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

/** 공통 메뉴 고정 아이콘 — PNG 마스크 (currentColor) */
const COMMON_MENU_ICON_EXT: Record<string, 'png'> = {
  notice: 'png',
  board: 'png',
  [SYSTEM_FEEDBACK_ENG]: 'png',
}

/** 공통 메뉴 Lucide 아이콘 */
const COMMON_MENU_LUCIDE: Record<string, LucideIcon> = {
  [DATA_REQUEST_ENG]: FileLock,
}

function MaskGlyph({ src }: { src: string }) {
  return (
    <span
      className="inline-block h-6 w-6 shrink-0 bg-current"
      style={{
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
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

function ServiceGlyph({ item }: { item: ServiceItem }) {
  const LucideGlyph = COMMON_MENU_LUCIDE[item.ser_eng]
  if (LucideGlyph) {
    return <LucideGlyph className="h-6 w-6 shrink-0" strokeWidth={1} aria-hidden />
  }
  const commonExt = COMMON_MENU_ICON_EXT[item.ser_eng]
  if (commonExt) {
    const iconKey = SERVICE_ICON_ALIASES[item.ser_eng] ?? item.ser_eng
    return <MaskGlyph src={withBasePath(`/image/serviceListIcon/${iconKey}.${commonExt}`)} />
  }
  const svgRaw = item.ser_svg?.trim() ?? ''
  if (svgRaw.startsWith('<')) {
    return (
      <span
        className="h-6 w-6 shrink-0 [&_svg]:h-full [&_svg]:w-full [&_svg]:fill-none [&_svg]:stroke-current"
        dangerouslySetInnerHTML={{ __html: svgRaw }}
      />
    )
  }
  const iconKey = SERVICE_ICON_ALIASES[item.ser_eng] ?? item.ser_eng
  return <MaskGlyph src={withBasePath(`/image/serviceListIcon/${iconKey}.svg`)} />
}

/** 내 정보 패널 — 더보기(즐겨찾기·검색·기능 목록) */
export function UserAccountMoreTab({
  onClosePanel,
  suppressSettings = false,
  onOpenSettings,
  matchHeightPx = null,
  overlayClipPath,
  onOpenSystemFeedback,
  pendingApproveCount = 0,
  onOpenApproveTab,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const systemKey = String(searchParams.get('system') ?? '').trim()

  const [services, setServices] = useState<ServiceItem[]>([])
  const [systems, setSystems] = useState<SystemItem[]>([])
  const [bootProject, setBootProject] = useState(projectHintFromBasePath)
  const [favorites, setFavorites] = useState<string[]>(() =>
    typeof window !== 'undefined' ? loadFavorites() : []
  )
  const [menuReady, setMenuReady] = useState(false)
  const [settingOpen, setSettingOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>([])

  const alwaysShowEngs = useMemo(() => [...ALWAYS_SHOW_ENGS_BASE], [])

  useEffect(() => {
    setFavorites(loadFavorites())
  }, [])

  useEffect(() => {
    if (!systems.length) return
    setFavorites((prev) => {
      const next = migrateFavoriteTokens(prev, systems)
      if (next.length === prev.length && next.every((v, i) => v === prev[i])) return prev
      saveFavorites(next)
      return next
    })
  }, [systems])

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
        setMenuReady(true)
      })
      .catch(() => {
        if (!cancelled) {
          setServices([])
          setSystems([])
          setMenuReady(true)
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
    if (!map.has(SYSTEM_FEEDBACK_ENG)) {
      map.set(SYSTEM_FEEDBACK_ENG, {
        ser_eng: SYSTEM_FEEDBACK_ENG,
        ser_kor: '시스템 불편신고',
        ser_svg: null,
      })
    }
    const dataReqExisting = map.get(DATA_REQUEST_ENG)
    map.set(DATA_REQUEST_ENG, {
      ser_eng: DATA_REQUEST_ENG,
      ser_kor: '데이터 요청',
      ser_svg: dataReqExisting?.ser_svg ?? null,
    })
    return map
  }, [services, bootProject])

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

  const basicItems = useMemo(() => {
    const items = alwaysShowEngs.map((eng) => serviceMap.get(eng)).filter(
      (s): s is ServiceItem => s != null
    )
    return items
  }, [serviceMap, bootProject, alwaysShowEngs])

  const settingGroups = useMemo(() => {
    const groups: { key: string; title: string; items: ServiceItem[] }[] = []
    const basics = [
      ...alwaysShowEngs
        .map((eng) => serviceMap.get(eng))
        .filter((s): s is ServiceItem => s != null),
    ]
    if (basics.length) {
      groups.push({ key: 'basic', title: '공통', items: basics })
    }
    for (const sys of systems) {
      const seenInSystem = new Set<string>()
      const items: ServiceItem[] = []
      for (const eng of sys.serviceList) {
        if (!visibleEng(eng) || seenInSystem.has(eng)) continue
        const item = serviceMap.get(eng)
        if (!item) continue
        seenInSystem.add(eng)
        items.push(item)
      }
      if (!items.length) continue
      groups.push({ key: sys.sys_key, title: sys.sys_kor, items })
    }
    return groups
  }, [serviceMap, systems, visibleEng, bootProject, alwaysShowEngs])

  useEffect(() => {
    if (suppressSettings) setSettingOpen(false)
  }, [suppressSettings])

  const openSettings = () => {
    if (settingOpen) {
      setSettingOpen(false)
      return
    }
    onOpenSettings?.()
    setDraft(favorites)
    setSettingOpen(true)
  }

  const toggleDraft = (token: string) => {
    setDraft((prev) => (prev.includes(token) ? prev.filter((v) => v !== token) : [...prev, token]))
  }

  const confirmDraft = () => {
    setFavorites(draft)
    saveFavorites(draft)
    setSettingOpen(false)
  }

  const openService = (token: string) => {
    const { sysKey, eng } = parseFavToken(token)
    if (eng === SYSTEM_FEEDBACK_ENG) {
      onClosePanel()
      onOpenSystemFeedback?.()
      return
    }
    const portal = PORTAL_LINKS[eng]
    if (portal) {
      onClosePanel()
      const fromPath =
        typeof window !== 'undefined'
          ? `${window.location.pathname}${window.location.search}`
          : ''
      const href =
        eng === 'dataRequest' && fromPath
          ? `${portal}?from=${encodeURIComponent(fromPath)}`
          : portal
      window.location.assign(withBasePathNav(href))
      return
    }
    if (eng === 'shapeEditor') {
      onClosePanel()
      openShapeEditorMapWindow(sysKey || homeSysByEng.get(eng) || systemKey || null)
      return
    }
    const current = new URLSearchParams(Array.from(searchParams.entries()))
    const home = sysKey || homeSysByEng.get(eng) || systemKey
    const target = systems.find((s) => s.sys_key === home)
    if (home && home !== systemKey) {
      current.set('system', home)
      scrubMapSearchParamsOnSystemSwitch(current, home, target?.serviceList ?? [])
    }
    current.set('opened', getOpenedKeyForSerEng(eng))
    onClosePanel()
    router.push(`/map?${current.toString()}`)
  }

  const favoriteItems = favorites.flatMap((token) => {
    const { sysKey, eng } = parseFavToken(token)
    const svc = serviceMap.get(eng)
    if (!svc) return []
    if (!sysKey) return [{ ...svc, token }]
    const sys = systems.find((s) => s.sys_key === sysKey)
    if (!sys || !sys.serviceList.includes(eng)) return []
    return [{ ...svc, token }]
  })

  const settingsModal =
    settingOpen && typeof document !== 'undefined'
      ? createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[120] bg-transparent"
              style={overlayClipPath ? { clipPath: overlayClipPath } : undefined}
              aria-label="바로가기 설정 닫기"
              onClick={() => setSettingOpen(false)}
            />
            <div
              className="fixed bottom-[7px] left-[419px] z-[130] flex w-[400px] flex-col overflow-hidden rounded-[5px] border border-border bg-background shadow-2xl"
              style={matchHeightPx ? { height: matchHeightPx } : undefined}
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
                        const token = settingFavToken(group.key, item.ser_eng)
                        const checked = draft.includes(token)
                        return (
                          <li key={token}>
                            <label className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-[11px] hover:bg-muted/50">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleDraft(token)}
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
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {settingsModal}
      {pendingApproveCount > 0 ? (
        <div className="shrink-0 border-b border-border p-[10px]">
          <button
            type="button"
            title="승인요청 탭 열기"
            onClick={() => onOpenApproveTab?.()}
            className="flex w-full items-center justify-between gap-2 rounded-[4px] border border-[#E3E3E3] px-2.5 py-2 text-left text-[10px] text-[#696969] hover:bg-muted/40"
          >
            <span className="min-w-0 flex-1">
              처리 대기 중인 승인요청이 {pendingApproveCount}건 있습니다.
            </span>
            <ChevronUp className="h-4 w-4 shrink-0 text-[#696969]" aria-hidden />
          </button>
        </div>
      ) : null}
      <div className="shrink-0 border-b border-border px-2.5 pb-1.5 pt-1.5">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] font-normal text-[#8A8A8A]">즐겨찾기</p>
          <button
            type="button"
            onClick={openSettings}
            className="rounded-sm p-0.5 text-[#8A8A8A] hover:bg-muted/60 hover:text-foreground"
            title="바로가기 설정"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
        {!menuReady && favorites.length > 0 ? (
          <div className={`${FAVORITE_ROW_H} flex w-full items-stretch gap-0`} aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex w-[25%] flex-col items-center justify-center gap-1.5 px-0.5"
              >
                <span className="h-8 w-8 animate-pulse rounded bg-muted" />
                <span className="h-2.5 w-10 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : favoriteItems.length === 0 ? (
          <button
            type="button"
            onClick={openSettings}
            className={`${FAVORITE_EMPTY_SLOT} w-full border-dashed border-border text-[#8A8A8A] hover:bg-muted/40`}
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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <p className="shrink-0 px-[10px] py-[6px] text-[11px] font-normal text-[#8A8A8A]">공통</p>
        {basicItems.length === 0 ? (
          <p className="flex min-h-0 flex-1 items-center justify-center px-3 text-center text-xs text-muted-foreground">
            표시할 기능이 없습니다.
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-[10px] pt-[4px] pb-[15px]">
            <div className="flex flex-wrap gap-x-2 gap-y-2">
              {basicItems.map((item) => (
                <button
                  key={item.ser_eng}
                  type="button"
                  onClick={() => openService(item.ser_eng)}
                  className={COMMON_ITEM}
                  title={item.ser_kor}
                >
                  <span className="flex h-[43px] w-[43px] shrink-0 items-center justify-center [&_svg]:h-6 [&_svg]:w-6">
                    <ServiceGlyph item={item} />
                  </span>
                  <span className={COMMON_MENU_LABEL}>{item.ser_kor}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
