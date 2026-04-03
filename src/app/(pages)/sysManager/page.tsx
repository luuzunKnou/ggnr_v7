"use client"

import type { ReactNode } from "react"
import { AdminConsoleLayout } from "@/app/(pages)/_components/AdminConsoleLayout"
import { PermissionFeatureManager } from "@/app/(pages)/dev/_components/PermissionFeatureManager"
import { AccessRequestQueue } from "@/app/(pages)/dev/_components/AccessRequestQueue"
import { UserManager } from "@/app/(pages)/dev/_components/UserManager"

const SYS_ADMIN_MENUS = [
  { id: "userManager", label: "사용자관리" },
  { id: "permissionFeature", label: "권한관리" },
  { id: "accessRequestQueue", label: "권한신청 처리" },
  { id: "uploadHistory", label: "데이터 업로드 이력" },
  { id: "dataAccessLog", label: "데이터 접근기록" },
  { id: "userMgmtHistory", label: "사용자 관리 이력" },
  { id: "userAccessStats", label: "사용자 접속 통계" },
  { id: "featureUsageStats", label: "기능별 사용현황 통계" },
] as const

function PlaceholderPanel({ title }: { title: string }) {
  return (
    <div className="rounded-md border border-dashed border-muted-foreground/25 bg-muted/20 px-4 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">화면은 추후 연동 예정입니다.</p>
    </div>
  )
}

function getSysAdminDescription(menuId: string): string {
  switch (menuId) {
    case "userManager":
      return "사용자관리 설정 화면입니다."
    case "permissionFeature":
      return "비공개 서비스·시스템에 대한 perm(역할) 매핑입니다."
    case "accessRequestQueue":
      return "비공개 리소스 개별 신청 승인·반려"
    case "uploadHistory":
      return "LAS·SHP·Excel 등 데이터 업로드 이력 조회"
    case "dataAccessLog":
      return "레이어·속성 등 데이터 접근 기록 조회"
    case "userMgmtHistory":
      return "계정 생성·권한 변경 등 사용자 관리 이력 조회"
    case "userAccessStats":
      return "로그인·접속 건수 등 사용자 접속 통계"
    case "featureUsageStats":
      return "기능(서비스)별 사용 횟수·현황 통계"
    default:
      return ""
  }
}

function renderSysAdminContent(menuId: string): ReactNode {
  switch (menuId) {
    case "userManager":
      return <UserManager />
    case "permissionFeature":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
          <PermissionFeatureManager />
        </div>
      )
    case "accessRequestQueue":
      return <AccessRequestQueue />
    case "uploadHistory":
      return <PlaceholderPanel title="데이터 업로드 이력" />
    case "dataAccessLog":
      return <PlaceholderPanel title="데이터 접근기록" />
    case "userMgmtHistory":
      return <PlaceholderPanel title="사용자 관리 이력" />
    case "userAccessStats":
      return <PlaceholderPanel title="사용자 접속 통계" />
    case "featureUsageStats":
      return <PlaceholderPanel title="기능별 사용현황 통계" />
    default:
      return null
  }
}

export default function SysManagerPage() {
  return (
    <AdminConsoleLayout
      title="시스템 관리"
      menus={SYS_ADMIN_MENUS}
      defaultMenuId="userManager"
      getDescription={getSysAdminDescription}
      renderContent={renderSysAdminContent}
    />
  )
}
