import Link from "next/link"
import { Layers, Mouse } from "lucide-react"

export const dynamic = "force-dynamic"
import { ParcelSlider } from "@/app/(pages)/(index)/parcel-slider"
import { SystemManagementSection, type SystemItem } from "@/app/(pages)/(index)/system-management-section"
import { SiteIndexShell } from "@/app/(pages)/(index)/site-index-shell"
import { NoticeLibraryPreview } from "@/app/(pages)/(index)/notice-library-preview"
import {
  getSystemList,
  getSystemListDebug,
  getIndexSliderImages,
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

  return (
    <SiteIndexShell>
      <section className="mb-12 grid lg:grid-cols-3 gap-6">
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

        <NoticeLibraryPreview />
      </section>

      <section className="-mb-8 -mt-5">
        <SystemManagementSection systems={systemList} />
      </section>

      {systemListError && (
        <section className="mb-12 rounded-lg border border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20 p-4">
          <h2 className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">systemList.config 로드 오류</h2>
          <p className="text-sm text-red-600 dark:text-red-400 mb-2 font-medium">{systemListError}</p>
          {systemListDebug && (
            <p className="text-xs text-red-700 dark:text-red-300 font-mono break-all">디버그: {systemListDebug}</p>
          )}
        </section>
      )}
    </SiteIndexShell>
  )
}
