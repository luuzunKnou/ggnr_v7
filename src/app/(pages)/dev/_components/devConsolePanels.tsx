import type { ReactNode } from "react"
import { DbManagerContent } from "./DbManagerContent"
import { SystemListManager } from "./SystemListManager"
import { ServiceListManager } from "./ServiceListManager"
import { LayerInfoManager } from "./LayerInfoManager"
import { LayerAttrManager } from "./LayerAttrManager"
import { LayerCodeManager } from "./LayerCodeManager"
import { GeoserverManagerContent } from "./GeoserverManagerContent"
import { LasFileUploaderContent } from "./LasFileUploaderContent"
import { ShpFileUploaderContent } from "./ShpFileUploaderContent"
import { ExlFileUploaderContent } from "./ExlFileUploaderContent"
import { DataFileUploaderContent } from "./DataFileUploaderContent"
import { LasFixerContent } from "./LasFixerContent"
import { OrthophotoManagerContent } from "./OrthophotoManagerContent"
import { PermissionFeatureManager } from "./PermissionFeatureManager"
import { AccessRequestQueue } from "./AccessRequestQueue"
import { UserManager } from "./UserManager"
import { RuntimeEnvEditor } from "./RuntimeEnvEditor"
import { SystemIntegrationManager } from "./SystemIntegrationManager"
import { GeocodingTestPanel } from "./GeocodingTestPanel"
import { SourceCodeUploaderContent } from "./SourceCodeUploaderContent"
import { VersionManagerContent } from "./VersionManagerContent"
import type { AdminConsoleMenuGroup } from "@/app/(pages)/_components/AdminConsoleLayout"

export const DEV_SUBMENUS = [
  { id: "systemList", label: "시스템 목록관리" },
  { id: "serviceList", label: "기능 목록관리" },
  { id: "systemIntegration", label: "시스템 연계" },
  { id: "geocodingTest", label: "지오코딩 테스트" },
  { id: "userManager", label: "사용자관리" },
  { id: "permissionFeature", label: "권한관리" },
  { id: "accessRequestQueue", label: "권한 신청 처리" },
  { id: "shpFileUploader", label: "SHP File Uploader" },
  { id: "exlFileUploader", label: "Excel File Uploader" },
  { id: "dataFileUploader", label: "Data File Upload" },
  { id: "sourceCodeUploader", label: "소스코드 업로더" },
  { id: "versionManager", label: "버전관리" },
  { id: "layerInfo", label: "레이어 정보관리" },
  { id: "layerAttr", label: "레이어 속성관리" },
  { id: "layerCode", label: "레이어 코드관리" },
  { id: "systemVar", label: "시스템 변수" },
  { id: "dbManager", label: "DB Manager" },
  { id: "geoserverManagerLayer", label: "Geoserver Manager [layer]" },
  { id: "geoserverManagerPublic", label: "Geoserver Manager [public]" },
  { id: "fileManager", label: "LAS File Uploader" },
  { id: "lasFixer", label: "LAS Fixer" },
  { id: "orthophotoManager", label: "정사영상관리" },
] as const

export const DEV_MENU_GROUPS: readonly AdminConsoleMenuGroup[] = [
  {
    id: "systemManagement",
    label: "시스템관리",
    menuIds: [
      "systemList",
      "serviceList",
      "userManager",
      "permissionFeature",
      "accessRequestQueue",
      "layerInfo",
      "layerAttr",
      "layerCode",
      "systemVar",
    ],
  },
  {
    id: "dataManagement",
    label: "데이터관리",
    menuIds: [
      "systemIntegration",
      "geocodingTest",
      "shpFileUploader",
      "exlFileUploader",
      "dataFileUploader",
      "orthophotoManager",
    ],
  },
  {
    id: "tools",
    label: "Tools",
    menuIds: [
      "dbManager",
      "geoserverManagerLayer",
      "geoserverManagerPublic",
      "fileManager",
      "lasFixer",
    ],
  },
  {
    id: "versionControl",
    label: "버전관리",
    menuIds: ["sourceCodeUploader", "versionManager"],
  },
]

export type DevSubmenuId = (typeof DEV_SUBMENUS)[number]["id"]

function devMenuLabel(menuId: string): string {
  return DEV_SUBMENUS.find((m) => m.id === menuId)?.label ?? menuId
}

export function getDevMenuDescription(menuId: string): string {
  switch (menuId) {
    case "systemList":
      return "시스템 목록관리 설정 화면입니다."
    case "serviceList":
      return "기능 목록관리 설정 화면입니다."
    case "systemIntegration":
      return "외부 시스템 연계 실행 및 로그 확인"
    case "geocodingTest":
      return "VWorld Address API GetCoord(도로명/지번) — runtime VWORLD_API_KEY 로 좌표 조회"
    case "userManager":
      return "사용자관리 설정 화면입니다."
    case "permissionFeature":
      return "비공개 서비스·시스템에 대한 perm(역할) 매핑입니다."
    case "accessRequestQueue":
      return "비공개 리소스 개별 신청 승인·반려"
    case "layerInfo":
      return "레이어 정보관리 설정 화면입니다."
    case "layerAttr":
      return "레이어 속성관리 설정 화면입니다."
    case "layerCode":
      return "레이어 코드관리 설정 화면입니다."
    case "systemVar":
      return "현재 프로젝트 runtime.env (GGNR_PROJECT) 를 표에서 바로 편집합니다."
    case "dbManager":
      return "데이터 가져오기 / 백업 / 업데이트"
    case "geoserverManagerLayer":
      return "GeoServer 연결·레이어·스타일 상태 및 로그 (스키마: layer)"
    case "geoserverManagerPublic":
      return "GeoServer 연결·레이어·스타일 상태 및 로그 (스키마: public_layer)"
    case "fileManager":
      return "LAS 파일 업로드 및 2D GeoTIFF·ECEF·3D pnts 변환 이력"
    case "shpFileUploader":
      return "SHP 파일 업로드 및 GeoServer·스타일 확인·후처리"
    case "dataFileUploader":
      return "첨부 file_data 폴더 업로드·테이블·키 검증·이력"
    case "sourceCodeUploader":
      return "현재 워크스페이스 소스코드를 압축/청크 전송 방식으로 원격 서버에 업로드"
    case "versionManager":
      return "GNMS 최신 소스코드 다운로드/덮어쓰기/재시작"
    case "lasFixer":
      return "WKT/비표준 좌표계 LAS를 EPSG:4326으로 변환"
    case "orthophotoManager":
      return "GeoTIFF 그룹 목록 기반 일괄 변환(VRT합본) 및 XYZ JPEG 타일(service_data/2dtiles)"
    default:
      return `${devMenuLabel(menuId)} 설정 화면입니다. (구현 예정)`
  }
}

export function renderDevMenuContent(menuId: string): ReactNode {
  switch (menuId) {
    case "systemList":
      return <SystemListManager />
    case "serviceList":
      return <ServiceListManager />
    case "systemIntegration":
      return <SystemIntegrationManager />
    case "geocodingTest":
      return (
        <div className="flex flex-col overflow-auto min-h-0 max-h-[calc(100vh-14rem)] p-2">
          <GeocodingTestPanel />
        </div>
      )
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
    case "layerInfo":
      return <LayerInfoManager />
    case "layerAttr":
      return <LayerAttrManager />
    case "layerCode":
      return (
        <div className="overflow-hidden max-h-[calc(100vh-10rem)] min-h-0">
          <LayerCodeManager />
        </div>
      )
    case "systemVar":
      return <RuntimeEnvEditor />
    case "dbManager":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
          <DbManagerContent />
        </div>
      )
    case "geoserverManagerLayer":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
          <GeoserverManagerContent schema="layer" />
        </div>
      )
    case "geoserverManagerPublic":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
          <GeoserverManagerContent schema="public_layer" />
        </div>
      )
    case "fileManager":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
          <LasFileUploaderContent />
        </div>
      )
    case "shpFileUploader":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
          <ShpFileUploaderContent />
        </div>
      )
    case "exlFileUploader":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
          <ExlFileUploaderContent />
        </div>
      )
    case "dataFileUploader":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
          <DataFileUploaderContent />
        </div>
      )
    case "sourceCodeUploader":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
          <SourceCodeUploaderContent />
        </div>
      )
    case "versionManager":
      return <VersionManagerContent />
    case "lasFixer":
      return <LasFixerContent />
    case "orthophotoManager":
      return (
        <div className="flex flex-col overflow-hidden min-h-0 h-[calc(100vh-14rem)]">
          <OrthophotoManagerContent />
        </div>
      )
    default:
      return (
        <p className="text-sm text-muted-foreground">
          {devMenuLabel(menuId)} 설정을 위한 화면이 여기에 표시됩니다.
        </p>
      )
  }
}
