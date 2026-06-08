// src/app/(pages)/map/layout.tsx — 서버에서 프로젝트별 로고 URL 결정 후 클라이언트 레이아웃에 전달
import { getIndexLogoSrc } from "@/service/configService"
import MapLayoutClient from "./map-layout-client"

export default function MapLayout({ children }: { children: React.ReactNode }) {
  const indexLogoSrc = getIndexLogoSrc()
  return <MapLayoutClient indexLogoSrc={indexLogoSrc}>{children}</MapLayoutClient>
}
