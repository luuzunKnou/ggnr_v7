"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { signOut, useSession } from "next-auth/react"
import { withBasePathNav } from "@/lib/basePath"
import { Users, Shield, Database, BarChart3 } from "lucide-react"
import { isSuperUser } from "@/lib/auth/superUser"
import { AdminConsoleLayout, type AdminConsoleMenuGroup } from "@/app/(pages)/_components/AdminConsoleLayout"
import { PermissionFeatureManager } from "@/app/(pages)/dev/_components/PermissionFeatureManager"
import { AccessRequestQueue } from "@/app/(pages)/dev/_components/AccessRequestQueue"
import { UserManager } from "@/app/(pages)/dev/_components/UserManager"
import { LayerManagerContent } from "@/app/(pages)/dev/_components/LayerManagerContent"
import { LayerManagerUploadButtons } from "@/app/(pages)/dev/_components/layerManager/LayerManagerUploadButtons"
import { DataHistoryManagerContent } from "@/app/(pages)/dev/_components/DataHistoryManagerContent"
import { SignUpApprove } from "@/app/(pages)/dev/_components/SignUpApprove"
import { UserMgmtHistory } from "@/app/(pages)/dev/_components/UserMgmtHistory"
import { UserAccessStats } from "@/app/(pages)/dev/_components/UserAccessStats"
import {
  SYS_MANAGER_CONSOLE_MENUS,
  type SysManagerConsoleMenuId,
} from "@/lib/consoleMenuAccess/menus/sysManager"

const SYS_ADMIN_MENUS = SYS_MANAGER_CONSOLE_MENUS

/** 캡쳐 대분류와 동일 그룹 (개발자 콘솔 menuGroups 패턴) */
export const SYS_MANAGER_MENU_GROUPS: readonly AdminConsoleMenuGroup[] = [
  {
    id: "userManagement",
    label: "사용자관리",
    icon: Users,
    menuIds: ["signUpApprove", "userManager"],
  },
  {
    id: "permissionManagement",
    label: "권한관리",
    icon: Shield,
    menuIds: ["permissionFeature", "accessRequestQueue"],
  },
  {
    id: "dataManagement",
    label: "데이터관리",
    icon: Database,
    menuIds: ["layerManager", "dataHistoryManager"],
  },
  {
    id: "usageStats",
    label: "시스템 사용현황",
    icon: BarChart3,
    menuIds: [
      "featureUsageStats",
      "userAccessStats",
      "userMgmtHistory",
      "userPermHistory",
    ],
  },
]

const SYS_AUTO_COLLAPSE_MENU_IDS: readonly SysManagerConsoleMenuId[] = ["layerManager"]

function PlaceholderPanel({ title }: { title: string }) {
  return (
    <div className="rounded-md border border-dashed border-muted-foreground/25 bg-muted/20 px-4 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">화면은 추후 연동 예정입니다.</p>
    </div>
  )
}

function menuLabel(menuId: string): string {
  return SYS_ADMIN_MENUS.find((m) => m.id === menuId)?.label ?? menuId
}

function getSysAdminDescription(menuId: string): string {
  switch (menuId) {
    case "signUpApprove":
      return "가입 신청 대기 목록을 승인·반려합니다."
    case "userManager":
      return "사용자관리 설정 화면입니다."
    case "permissionFeature":
      return "비공개 서비스·시스템에 대한 perm(역할) 매핑입니다."
    case "accessRequestQueue":
      return "비공개 리소스 개별 신청 승인·반려"
    case "layerManager":
      return "레이어 목록·SHP/Excel 업데이트 이력·설정(Layer/Field/Code)·오류수정 및 SHP·Excel 업로드 진입 화면입니다."
    case "dataHistoryManager":
      return "지도·SHP·Excel 데이터 변경·조회·내보내기 이력을 한곳에서 검색·조회합니다."
    case "featureUsageStats":
      return "기능(서비스)별 사용 횟수·현황 통계 (구현 예정)"
    case "userAccessStats":
      return "로그인 접속 이력·기간별 통계 그래프·도표를 조회합니다."
    case "userMgmtHistory":
      return "계정 생성·변경·삭제 등 사용자 관리 이력을 조회합니다."
    case "userPermHistory":
      return "권한 부여·변경 이력 조회 (구현 예정)"
    default:
      return ""
  }
}

function renderSysAdminContent(menuId: string): ReactNode {
  switch (menuId) {
    case "signUpApprove":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
          <SignUpApprove />
        </div>
      )
    case "userManager":
      return (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <UserManager />
        </div>
      )
    case "permissionFeature":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
          <PermissionFeatureManager />
        </div>
      )
    case "accessRequestQueue":
      return <AccessRequestQueue />
    case "layerManager":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-13rem)]">
          <LayerManagerContent />
        </div>
      )
    case "dataHistoryManager":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
          <DataHistoryManagerContent />
        </div>
      )
    case "featureUsageStats":
    case "userPermHistory":
      return <PlaceholderPanel title={menuLabel(menuId)} />
    case "userAccessStats":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
          <UserAccessStats />
        </div>
      )
    case "userMgmtHistory":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
          <UserMgmtHistory />
        </div>
      )
    default:
      return null
  }
}

export default function SysManagerPage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const deniedRef = useRef(false)

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/")
      return
    }
    if (status !== "authenticated") return
    if (isSuperUser(session?.user?.id)) return
    if (deniedRef.current) return
    deniedRef.current = true
    window.alert("권한이 없습니다")
    router.replace("/")
  }, [status, session?.user?.id, router])

  const handleLogout = async () => {
    await signOut({ redirect: false })
    window.location.assign(withBasePathNav("/"))
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        확인 중…
      </div>
    )
  }

  if (status === "unauthenticated") {
    return null
  }

  if (!isSuperUser(session?.user?.id)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        권한이 없습니다
      </div>
    )
  }

  return (
    <AdminConsoleLayout
      title="시스템 관리"
      menus={SYS_ADMIN_MENUS}
      menuGroups={SYS_MANAGER_MENU_GROUPS}
      stateStorageKey="sysManagerConsoleMenu"
      defaultMenuId="userManager"
      getDescription={getSysAdminDescription}
      renderContent={renderSysAdminContent}
      renderTitleExtra={(menuId) =>
        menuId === "layerManager" ? <LayerManagerUploadButtons /> : null
      }
      consoleArea="sysManager"
      autoCollapseMenuIds={SYS_AUTO_COLLAPSE_MENU_IDS}
      onLogout={handleLogout}
    />
  )
}
