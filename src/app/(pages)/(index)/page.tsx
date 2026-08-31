export const dynamic = "force-dynamic"
import { ParcelSlider } from "@/app/(pages)/(index)/parcel-slider"
import { MapViewLink } from "@/app/(pages)/(index)/map-view-link"
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
          <MapViewLink />
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
