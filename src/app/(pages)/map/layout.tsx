// src/app/(pages)/map/layout.tsx — 서버에서 프로젝트별 로고 URL 결정 후 클라이언트 레이아웃에 전달
import { Suspense } from "react"

export const dynamic = "force-dynamic"
import { getIndexLogoSrc } from "@/service/configService"
import MapLayoutClient from "./map-layout-client"

export default function MapLayout({ children }: { children: React.ReactNode }) {
  const indexLogoSrc = getIndexLogoSrc()
  return (
    <Suspense fallback={<div className="flex h-full min-h-screen items-center justify-center text-sm text-muted-foreground">지도 로딩 중...</div>}>
      <MapLayoutClient indexLogoSrc={indexLogoSrc}>{children}</MapLayoutClient>
    </Suspense>
  )
}
