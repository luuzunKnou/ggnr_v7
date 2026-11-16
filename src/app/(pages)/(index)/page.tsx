export const dynamic = "force-dynamic"
import { ParcelSlider } from "@/app/(pages)/(index)/parcel-slider"
import { MapViewLink } from "@/app/(pages)/(index)/map-view-link"
import { SystemManagementSection, type SystemItem } from "@/app/(pages)/(index)/system-management-section"
import { SiteIndexShell } from "@/app/(pages)/(index)/site-index-shell"
import { NoticeLibraryPreview } from "@/app/(pages)/(index)/notice-library-preview"
import {
  getSystemListDebug,
  getIndexSliderImages,
  getIndexSliderSlides,
  getSystemKorName,
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

/** 이미지 없을 때 슬라이드별 배경 (JSON 미관리) */
const PARCEL_SLIDE_GRADIENTS = [
  "linear-gradient(to bottom right, #1e293b, #0f172a)",
  "linear-gradient(to bottom right, #1e3a8a, #1e40af)",
  "linear-gradient(to bottom right, #065f46, #047857)",
  "linear-gradient(to bottom right, #7c2d12, #9a3412)",
]

function buildParcelSlides(): Array<{ title: string; description: string; image?: string; gradient?: string }> {
  const projectName = typeof process !== "undefined" ? (process.env.GGNR_PROJECT ?? "build_yy") : "build_yy"
  const texts = getIndexSliderSlides(projectName)
  const images = getIndexSliderImages(projectName)
  return texts.map((slide, i) => ({
    title: slide.title,
    description: slide.content,
    image: images[i] || undefined,
    gradient: PARCEL_SLIDE_GRADIENTS[i % PARCEL_SLIDE_GRADIENTS.length],
  }))
}

export default async function DashboardPage() {
  const projectName =
    typeof process !== "undefined" ? (process.env.GGNR_PROJECT ?? "build_yy").trim() : "build_yy"

  /** odor 전용 모듈은 분기 안에서만 import — 다른 프로젝트 `/` 컴파일에 OL 등이 묶이지 않게 */
  if (projectName === "odor_ph") {
    const [{ OdorIndexConsole }, { listSensors }] = await Promise.all([
      import("@/app/(pages)/(index)/odorPh/OdorIndexConsole"),
      import("@/service/odorSensorService"),
    ])
    let sensors: Awaited<ReturnType<typeof listSensors>> = []
    try {
      sensors = await listSensors()
    } catch {
      sensors = []
    }
    const { footerAddr, footerRss } = getIndexFooterConfig()
    return (
      <OdorIndexConsole
        title={getSystemKorName()}
        sensors={sensors}
        footerAddr={footerAddr}
        footerRss={footerRss}
      />
    )
  }

  const { systems: systemList, error: systemListError, debug: systemListDebug } = loadSystemList()

  return (
    <SiteIndexShell>
      <section className="mb-12 grid items-stretch gap-6 lg:h-[355px] lg:grid-cols-3">
        <div className="grid h-full min-h-[280px] gap-6 md:grid-cols-2 lg:col-span-2">
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
