import type { LayerSetupIssueType } from "@/service/devTestService"

export const LAYER_SETUP_ISSUE_LABELS: Record<LayerSetupIssueType, string> = {
  geoserver_layer: "GeoServer Layer 없음",
  geoserver_style: "GeoServer Style 없음",
  define_layer: "레이어 설정 (Layer) 누락",
  define_field: "레이어 설정 (Field) 누락",
  define_code: "레이어 설정 (Code) 누락",
}

export const LAYER_SETUP_ISSUE_ORDER: LayerSetupIssueType[] = [
  "define_layer",
  "define_field",
  "define_code",
  "geoserver_layer",
  "geoserver_style",
]
