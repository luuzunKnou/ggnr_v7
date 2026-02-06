import { readFileSync } from "fs"
import { join } from "path"
import Link from "next/link"
import { DepartmentGrid } from "@/app/(pages)/(index)/department-grid"
import type { DepartmentData } from "@/app/(pages)/(index)/department-card"
import { ParcelSlider } from "@/app/(pages)/(index)/parcel-slider"
import { SystemManagementSection } from "@/app/(pages)/(index)/system-management-section"
import { DevModeFooterTrigger } from "@/app/(pages)/(index)/dev-mode-footer-trigger"
import { ThemeToggle } from "@/app/(pages)/(index)/theme-toggle"

type SystemConfigItem = {
  sys_key: string
  sys_kor: string
  sys_eng?: string
  sys_detail?: string
  sys_img: string
  sys_idx: number
  sys_col: string
  sys_link: string
  serviceList: string[]
  layerList: string[]
}

function loadSystemList(): SystemConfigItem[] {
  try {
    const path = join(process.cwd(), "src/config/systemList.config")
    const raw = readFileSync(path, "utf-8")
    const data = JSON.parse(raw) as { sys?: SystemConfigItem[]; systems?: SystemConfigItem[] }
    return Array.isArray(data.sys) ? data.sys : Array.isArray(data.systems) ? data.systems : []
  } catch {
    return []
  }
}

// 샘플 데이터
const sampleDepartments: DepartmentData[] = [
  {
    key: "smart-city",
    name: "스마트 도시행정 시스템",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/></svg>`,
    color: "#3B82F6",
    url: "/smart-city",
    chartData: [
      { label: "월", value: 65 },
      { label: "화", value: 80 },
      { label: "수", value: 45 },
      { label: "목", value: 90 },
      { label: "금", value: 70 },
    ],
  },
  {
    key: "water-supply",
    name: "상수관리 시스템",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
    color: "#06B6D4",
    url: "/water-supply",
    chartData: [
      { label: "월", value: 40 },
      { label: "화", value: 55 },
      { label: "수", value: 75 },
      { label: "목", value: 60 },
      { label: "금", value: 85 },
    ],
  },
  {
    key: "sewage",
    name: "하수관리 시스템",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 14.69c1.47 0 2.67-1.22 2.67-2.7 0-.77-.38-1.51-1.14-2.13-.76-.61-1.28-1.42-1.53-2.36-.25.94-.77 1.75-1.53 2.36-.76.62-1.14 1.36-1.14 2.13 0 1.48 1.2 2.7 2.67 2.7z"/><path d="M17 18.5c1.83 0 3.33-1.52 3.33-3.38 0-.96-.47-1.89-1.43-2.66-.95-.77-1.6-1.78-1.9-2.96-.31 1.18-.96 2.19-1.9 2.96-.96.77-1.43 1.7-1.43 2.66 0 1.86 1.5 3.38 3.33 3.38z"/></svg>`,
    color: "#8B5CF6",
    url: "/sewage",
    chartData: [
      { label: "월", value: 30 },
      { label: "화", value: 50 },
      { label: "수", value: 65 },
      { label: "목", value: 45 },
      { label: "금", value: 55 },
    ],
  },
  {
    key: "agriculture",
    name: "농업시설관리 시스템",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 10a6 6 0 0 0 6-6H6a6 6 0 0 0 6 6Z"/><path d="M12 10v12"/><path d="M12 22c-4 0-6-2-6-6"/><path d="M12 22c4 0 6-2 6-6"/></svg>`,
    color: "#22C55E",
    url: "/agriculture",
    chartData: [
      { label: "월", value: 70 },
      { label: "화", value: 85 },
      { label: "수", value: 60 },
      { label: "목", value: 75 },
      { label: "금", value: 90 },
    ],
  },
  {
    key: "environment",
    name: "환경시설물 관리시스템",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/></svg>`,
    color: "#10B981",
    url: "/environment",
  },
  {
    key: "public-facility",
    name: "소규모 공공시설 관리 시스템",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>`,
    color: "#F59E0B",
    url: "/public-facility",
    chartData: [
      { label: "월", value: 55 },
      { label: "화", value: 70 },
      { label: "수", value: 45 },
      { label: "목", value: 80 },
      { label: "금", value: 65 },
    ],
  },
  {
    key: "permit",
    name: "인허가 의사결정 지원 시스템",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
    color: "#EC4899",
    url: "/permit",
  },
  {
    key: "disaster",
    name: "이재민 구호관리 시스템",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`,
    color: "#EF4444",
    url: "/disaster",
    chartData: [
      { label: "월", value: 20 },
      { label: "화", value: 35 },
      { label: "수", value: 15 },
      { label: "목", value: 40 },
      { label: "금", value: 25 },
    ],
  },
  {
    key: "construction",
    name: "건설행정 통합관리 시스템",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="8" rx="1"/><path d="M17 14v7"/><path d="M7 14v7"/><path d="M17 3v3"/><path d="M7 3v3"/><path d="M10 14 2.3 6.3"/><path d="m14 6 7.7 7.7"/><path d="m8 6 8 8"/></svg>`,
    color: "#F97316",
    url: "/construction",
  },
  {
    key: "uav",
    name: "UAV 공간정보 모니터링 시스템",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22a1 1 0 0 1-1-1v-3a1 1 0 0 1 1.31-.95l4 1.43a1 1 0 0 1 .69.95v1.57a1 1 0 0 1-1 1h-4Z"/><path d="M12 22a1 1 0 0 0 1-1v-3a1 1 0 0 0-1.31-.95l-4 1.43a1 1 0 0 0-.69.95v1.57a1 1 0 0 0 1 1h4Z"/><path d="M12 16V3"/><path d="m5 9 7-6 7 6"/></svg>`,
    color: "#6366F1",
    url: "/uav",
    chartData: [
      { label: "월", value: 85 },
      { label: "화", value: 90 },
      { label: "수", value: 75 },
      { label: "목", value: 95 },
      { label: "금", value: 80 },
    ],
  },
  {
    key: "civil",
    name: "대민관리 시스템",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    color: "#14B8A6",
    url: "/civil",
  },
  {
    key: "river",
    name: "지방하천 통합정보 시스템",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/></svg>`,
    color: "#0EA5E9",
    url: "/river",
  },
  {
    key: "park",
    name: "공원녹지 행정지원 시스템",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22v-7l-2-2"/><path d="M17 8v.8A6 6 0 0 1 13.8 20v0H10v0A6.5 6.5 0 0 1 7 8h0a5 5 0 0 1 10 0Z"/><path d="m14 14-2 2"/></svg>`,
    color: "#84CC16",
    url: "/park",
    chartData: [
      { label: "월", value: 60 },
      { label: "화", value: 75 },
      { label: "수", value: 50 },
      { label: "목", value: 85 },
      { label: "금", value: 70 },
    ],
  },
]

// 필지정보조회 슬라이드 데이터
const parcelSlides = [
  {
    title: "기본도 조회",
    description: "행정경계, 지목, 소유자 구분, 주제도, 연속지적도 등 행정데이터를 지도에서 확인합니다.",
    gradient: "linear-gradient(to bottom right, #1e293b, #0f172a)",
  },
  {
    title: "필지정보 조회회",
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

const systemList = loadSystemList()

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-blue-500 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a10 10 0 0 0 0 20" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-foreground">공간정보 통합관리 플랫폼</h1>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/sysManager"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>시스템 관리</span>
            </Link>
            <button className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" x2="9" y1="12" y2="12" />
              </svg>
              <span>로그인</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Hero Section */}
        <section className="mb-12 grid lg:grid-cols-3 gap-6">
          {/* Left: 필지정보조회 & 지도보기 */}
          <div className="lg:col-span-2 grid md:grid-cols-2 gap-6">
            <ParcelSlider slides={parcelSlides} />
            
            <Link
              href="/map"
              className="relative overflow-hidden bg-blue-600 p-8 text-white min-h-[280px] flex flex-col items-center justify-center text-center block hover:bg-blue-700 transition-colors cursor-pointer"
            >
              <div className="w-24 h-24 mb-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-full h-full">
                  <rect x="3" y="3" width="18" height="18" rx="0" transform="rotate(45 12 12)" />
                  <rect x="6" y="6" width="12" height="12" rx="0" transform="rotate(45 12 12)" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold mb-2">지도보기</h2>
              <p className="text-blue-100 text-sm leading-relaxed">
                사용자가 원하는 위치를 직관적으로 확인<br />
                하고 데이터를 시각화합니다.
              </p>
            </Link>
          </div>

          {/* Right: 공지사항 & 자료실 */}
          <div className="flex flex-col gap-6">
            {/* 공지사항 */}
            <div className="bg-card border border-border p-5 flex-1">
              <h3 className="text-base font-bold text-foreground mb-4 pb-2 border-b border-border">공지사항</h3>
              <ul className="space-y-3">
                {[
                  { title: "시스템 정기점검 안내 (1/27)", date: "2026.01.25" },
                  { title: "2026년 공간정보 활용교육 안내", date: "2026.01.20" },
                  { title: "신규 UAV 모니터링 기능 업데이트", date: "2026.01.15" },
                  { title: "개인정보처리방침 개정 안내", date: "2026.01.10" },
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
            <div className="bg-card border border-border p-5 flex-1">
              <h3 className="text-base font-bold text-foreground mb-4 pb-2 border-b border-border">자료실</h3>
              <ul className="space-y-3">
                {[
                  { title: "공간정보 시스템 사용 매뉴얼 v2.1", date: "2026.01.22" },
                  { title: "2025년 연간 통계 보고서", date: "2026.01.18" },
                  { title: "지도 데이터 활용 가이드", date: "2026.01.12" },
                  { title: "시설물 관리 표준 양식", date: "2026.01.05" },
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
        <section className="mb-12">
          <SystemManagementSection systems={systemList} />
        </section>

        {/* 시스템 목록 (아래쪽) - 숨김 */}
        <section className="bg-muted/30 p-0" style={{ display: "none" }}>
          <DepartmentGrid departments={sampleDepartments}/>
        </section>
      </main>

      {/* Footer — 5회 연속 클릭 시 개발자 모드(/dev)로 이동 */}
      <DevModeFooterTrigger>
        <div className="container mx-auto px-4 text-center text-sm">
          <p>안동시 토지정보과 | 054-840-6371 | 36691 경상북도 안동시 퇴계로 115 (명륜동)</p>
          <p className="mt-2 text-slate-400">Copyright (c) 2024. ALL RIGHTS RESERVED</p>
        </div>
      </DevModeFooterTrigger>
    </div>
  )
}
