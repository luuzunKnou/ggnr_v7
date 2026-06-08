import Link from "next/link"
import Image from "next/image"
import { Layers, Mouse } from "lucide-react"
import { DepartmentGrid } from "@/app/(pages)/(index)/department-grid"
import type { DepartmentData } from "@/app/(pages)/(index)/department-card"
import { ParcelSlider } from "@/app/(pages)/(index)/parcel-slider"
import { SystemManagementSection, type SystemItem } from "@/app/(pages)/(index)/system-management-section"
import { DevModeFooterTrigger } from "@/app/(pages)/(index)/dev-mode-footer-trigger"
import { ThemeToggle } from "@/app/(pages)/(index)/theme-toggle"
import { HeaderAuthLinks } from "@/app/(pages)/(index)/header-auth-links"
import {
  getSystemList,
  getSystemKorName,
  getSystemListDebug,
  getIndexSliderImages,
  getIndexLogoSrc,
  getIndexFooterConfig,
} from "@/service/configService"

function loadSystemList(): { systems: SystemItem[]; error?: string; debug?: string } {
  try {
    const result = getSystemListDebug()
    if (result.error) return { systems: [], error: result.error, debug: result.debug }
    return { systems: (result.systems ?? []) as SystemItem[], debug: result.debug }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { systems: [], error: msg }
  }
}

// 필지정보조회 슬라이드 데이터 (배경 이미지는 getIndexSliderImages로 프로젝트별 _01~04 적용)
const parcelSlideContents = [
  {
    title: "기본도 조회",
    description: "행정경계, 지목, 소유자 구분, 주제도, 연속지적도 등 행정데이터를 지도에서 확인합니다.",
    gradient: "linear-gradient(to bottom right, #1e293b, #0f172a)",
  },
  {
    title: "필지정보 조회",
    description: "필지에 대한 기본정보, 소유자정보, 토지 이용계획에 대한 정보를 조회합니다.",
    gradient: "linear-gradient(to bottom right, #1e3a8a, #1e40af)",
  },
  {
    title: "건축물 대장",
    description: "필지내 건물에 대한 총괄표제부, 표제부, 건축인허가 정보를 조회합니다.",
    gradient: "linear-gradient(to bottom right, #065f46, #047857)",
  },
  {
    title: "시계열 정사영상",
    description: "국토지리정보원의 연도별 정사영상 및 고화질 드론영상을 제공합니다.",
    gradient: "linear-gradient(to bottom right, #7c2d12, #9a3412)",
  },
]

function buildParcelSlides(): Array<{ title: string; description: string; image?: string; gradient?: string }> {
  const projectName = typeof process !== "undefined" ? (process.env.GGNR_PROJECT ?? "build_yy") : "build_yy"
  const images = getIndexSliderImages(projectName)
  return parcelSlideContents.map((slide, i) => ({
    ...slide,
    image: images[i] || undefined,
  }))
}

export default function DashboardPage() {
  const { systems: systemList, error: systemListError, debug: systemListDebug } = loadSystemList()
  const projectName = typeof process !== "undefined" ? (process.env.GGNR_PROJECT ?? "build_yy") : "build_yy"
  const indexLogoSrc = getIndexLogoSrc(projectName)
  const siteTitle = getSystemKorName()
  const { footerAddr, footerRss } = getIndexFooterConfig()
  return (
    <div className="min-h-screen bg-background pb-[20px]">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src={indexLogoSrc}
              alt={siteTitle}
              width={100}
              height={38}
              className="h-9 w-auto max-w-[100px] max-h-[30px] object-contain object-left"
              priority
            />
            <h1 className="text-xl font-bold text-foreground">{siteTitle}</h1>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/sysManager"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors rounded-[5px]"
            >
              <svg className="w-4.5 h-4.5" viewBox="0 1 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span className="text-[13px]">시스템 관리</span>
            </Link>
            <HeaderAuthLinks />
          </div>
        </div>
      </header>

      {/* Main Content — pb로 푸터 높이만큼 여백 확보 */}
      <main className="container mx-auto px-4 py-8 pb-24">
        {/* Hero Section */}
        <section className="mb-12 grid lg:grid-cols-3 gap-6">
          {/* Left: 필지정보조회 & 지도보기 */}
          <div className="lg:col-span-2 grid md:grid-cols-2 gap-6 max-h-[355px]">
            <ParcelSlider slides={buildParcelSlides()} />

            <Link
              href="/map"
              className="group relative block min-h-[280px] cursor-pointer overflow-hidden rounded-[5px] bg-slate-900 p-8 text-center text-white transition-opacity hover:opacity-95 flex flex-col items-center justify-center"
            >
              <video
                src="/image/indexImage/backgroundVideo_02.mp4"
                className="pointer-events-none absolute inset-0 z-0 h-full w-full origin-center object-cover scale-[1.02]"
                muted
                loop
                autoPlay
                playsInline
                preload="auto"
                aria-hidden
              />
              <div
                className="absolute inset-0 z-[1] bg-gray-950/45 transition-colors group-hover:bg-gray-900/55"
                aria-hidden
              />
              <div className="relative z-10 flex flex-col items-center justify-center">
                <div className="mb-4 mt-4 flex h-24 w-24 items-center justify-center">
                  <Layers className="h-full w-full" strokeWidth={1.5} />
                </div>
                <h2 className="mb-4 mt-4 text-2xl font-bold">지도보기</h2>
                <p className="text-sm leading-relaxed text-gray-100">
                  사용자가 원하는 위치를 직관적으로 확인하고 <br />데이터를 시각화합니다.
                </p>
                <Mouse className="mt-10 h-5 w-5" />
              </div>
            </Link>
          </div>

          {/* Right: 공지사항 & 자료실 */}
          <div className="flex flex-col gap-[23px] max-h-[350px]">
            {/* 공지사항 */}
            <div className="bg-card border border-border p-5 flex-1 rounded-[5px]">
              <h3 className="text-base font-bold text-foreground mb-4 pb-2 border-b border-border">공지사항</h3>
              <ul className="space-y-3">
                {[
                  { title: "시스템 정기점검 안내 (1/27)", date: "2026.01.25" },
                  { title: "2026년 공간정보 활용교육 안내", date: "2026.01.20" },
                  { title: "신규 UAV 모니터링 기능 업데이트", date: "2026.01.15" },
                ].map((item, index) => (
                  <li key={index} className="flex items-center justify-between text-sm">
                    <a href="#" className="text-muted-foreground hover:text-foreground transition-colors truncate pr-4">
                      {item.title}
                    </a>
                    <span className="text-xs text-muted-foreground/70 shrink-0">{item.date}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* 자료실 */}
            <div className="bg-card border border-border p-5 flex-1 rounded-[5px]">
              <h3 className="text-base font-bold text-foreground mb-4 pb-2 border-b border-border">자료실</h3>
              <ul className="space-y-3">
                {[
                  { title: "공간정보 시스템 사용 매뉴얼 v2.1", date: "2026.01.22" },
                  { title: "2025년 연간 통계 보고서", date: "2026.01.18" },
                  { title: "지도 데이터 활용 가이드", date: "2026.01.12" },
                ].map((item, index) => (
                  <li key={index} className="flex items-center justify-between text-sm">
                    <a href="#" className="text-muted-foreground hover:text-foreground transition-colors truncate pr-4">
                      {item.title}
                    </a>
                    <span className="text-xs text-muted-foreground/70 shrink-0">{item.date}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* 시스템 목록 */}
        <section className="-mb-8 -mt-5">
          <SystemManagementSection systems={systemList} />
        </section>

        {/* systemList.config 오류 시에만 표시 */}
        {systemListError && (
          <section className="mb-12 rounded-lg border border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20 p-4">
            <h2 className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">systemList.config 로드 오류</h2>
            <p className="text-sm text-red-600 dark:text-red-400 mb-2 font-medium">{systemListError}</p>
            {systemListDebug && (
              <p className="text-xs text-red-700 dark:text-red-300 font-mono break-all">디버그: {systemListDebug}</p>
            )}
          </section>
        )}
      </main>

      {/* Footer — position fixed로 항상 화면 하단 고정 */}
      <div className="fixed bottom-0 left-0 right-0 z-10 max-h-[110px]">
        <DevModeFooterTrigger>
          <div className="container mx-auto text-center text-sm">
            <p className="-mt-[11px]">{footerAddr}</p>
            <p className="py-1 text-slate-400">{footerRss}</p>
          </div>
        </DevModeFooterTrigger>
      </div>
    </div>
  )
}
