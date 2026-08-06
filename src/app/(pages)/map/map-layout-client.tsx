// src/app/(pages)/map/map-layout-client.tsx
"use client"

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { X } from "lucide-react"
import Map3DDataPanel from "./_mapComponents/Map3DDataPanel"
import StandardList from "./_mapComponents/standard/StandardList"
import { LayerDataPanel } from "./_mapComponents/standard/LayerDataPanel"
import StandardDetail from "./_mapComponents/standard/StandardDetail"
import ComplaintListPanel from "./_mapComponents/complaint/ComplaintListPanel"
import ComplaintDetail from "./_mapComponents/complaint/ComplaintDetail"
import AddressInfoDetail from "./_mapComponents/AddressInfoDetail"
import { RiverBasicPlanListPanel } from "./_mapContents/river/riverBasicPlan/RiverBasicPlanListPanel"
import { RiverBasicPlanDetailPanel } from "./_mapContents/river/riverBasicPlan/RiverBasicPlanDetailPanel"
import { RiverBasicPlanMapDrawingFromMapHandler } from "./_mapContents/river/riverBasicPlan/RiverBasicPlanMapDrawingFromMapHandler"
import { RoadLedgerListPanel } from "./_mapContents/road/roadLedger/RoadLedgerListPanel"
import { RoadLedgerDetailPanel } from "./_mapContents/road/roadLedger/RoadLedgerDetailPanel"
import { RoadLedgerFacilityAttrModal } from "./_mapContents/road/roadLedger/RoadLedgerFacilityAttrModal"
import { RoadNetworkListPanel } from "./_mapContents/road/roadNetwork/RoadNetworkListPanel"
import { RoadNetworkDetailPanel } from "./_mapContents/road/roadNetwork/RoadNetworkDetailPanel"
import { SafetyMapLayerPanel } from "./_mapContents/safty/safetyMap/SafetyMapLayerPanel"
import { SafetyInfoLayerPanel } from "./_mapContents/safty/safetyInfo/SafetyInfoLayerPanel"
import { SafetyWaterShell } from "./_mapContents/safty/safetyWater/SafetyWaterShell"
import type { SafetyWaterStationKind } from "./_mapContents/safty/safetyWater/safetyWaterTypes"
import { SafetyFacPanel } from "./_mapContents/safty/safetyFac/SafetyFacPanel"
import { SafetyHospitalBadPanel } from "./_mapContents/safty/safetyHospitalBad/SafetyHospitalBadPanel"
import { SafetyJsjReservoirPanel } from "./_mapContents/safty/saftyJsj/SafetyJsjReservoirPanel"
import { RoadDocManualPanel } from "./_mapContents/road/roadDoc/roadDocManualPanel"
import { RoadCctvPanel } from "./_mapContents/road/roadCCTV/RoadCctvPanel"
import { RoadInfraPanel } from "./_mapContents/road/roadInfra/RoadInfraPanel"
import { RoadDataFlowAnalysisOrchestrator } from "./_mapContents/road/roadDataFlow/RoadDataFlowAnalysisOrchestrator"
import {
  ParcelAnalysisOrchestrator,
  ParcelAnalysisMapSidePanel,
  PARCEL_ANALYSIS_PANEL_DEFAULT_WIDTH,
  PARCEL_ANALYSIS_PANEL_MAX_WIDTH,
  PARCEL_ANALYSIS_PANEL_MIN_WIDTH,
} from "./_mapContents/parcelAnalysis/ParcelAnalysis.shell"
import {
  PARCEL_ANALYSIS_OPENED_KEY,
  ParcelAnalysisProvider,
  useParcelAnalysis,
} from "./_mapContents/parcelAnalysis/parcelAnalysisContext"
import { RoadUseLedgerListPanel } from "./_mapContents/road/roadUseLedger/RoadUseLedgerListPanel"
import { RoadUseLedgerDetailPanel } from "./_mapContents/road/roadUseLedger/RoadUseLedgerDetailPanel"
import { RiverUseLedgerListPanel } from "./_mapContents/river/riverUseLedger/RiverUseLedgerListPanel"
import { RiverUseLedgerDetailPanel } from "./_mapContents/river/riverUseLedger/RiverUseLedgerDetailPanel"
import { AerialManagePanel } from "./_mapContents/aerialView/AerialManagePanel"
import type { AerialKind } from "./_mapContents/aerialView/aerialMediaTypes"
import { ShootingRequestPanel } from "./_mapContents/shootingRequest/ShootingRequestPanel"
import { ShootingRequestDetailPanel } from "./_mapContents/shootingRequest/ShootingRequestDetailPanel"
import { ShootingRequestFormModal } from "./_mapContents/shootingRequest/ShootingRequestFormModal"
import {
  SHOOTING_REQUEST_NEW_ID,
  beginMediaRegistration,
  findShootingRequest,
} from "./_mapContents/shootingRequest/shootingRequestMockStore"
import { SHOOTING_REQUEST_UI_ENABLED } from "./_mapContents/shootingRequest/shootingRequestUiFlag"
import {
  aerialKindToOpenedKey,
  shootTypeToAerialKind,
} from "./_mapContents/shootingRequest/shootTypeToAerialKind"
import { RiverConstructionLedgerListPanel } from "./_mapContents/river/riverConstructionLedger/RiverConstructionLedgerListPanel"
import { RiverConstructionLedgerDetailPanel } from "./_mapContents/river/riverConstructionLedger/RiverConstructionLedgerDetailPanel"
import { UsageDataAsListPanel } from "./_mapContents/river/usageDataAs/UsageDataAsListPanel"
import { UsageDataAsDetailPanel } from "./_mapContents/river/usageDataAs/UsageDataAsDetailPanel"
import { clearUsageDataAsWmsLayers } from "./_mapContents/river/usageDataAs/usageDataAsMapSync"
import { RoadRewardListPanel } from "./_mapContents/road/roadReward/RoadRewardListPanel"
import { RoadRewardDetailPanel } from "./_mapContents/road/roadReward/RoadRewardDetailPanel"
import { type RoadRewardCase } from "./_mapContents/road/roadReward/roadRewardMock"
import { UsageDataAsNotifBootstrap } from "./_mapComponents/UsageDataAsNotifBootstrap"
import { OccupationLedgerListPanel } from "./_mapContents/occupationLedger/OccupationLedgerListPanel"
import { OccupationLedgerDetailPanel } from "./_mapContents/occupationLedger/OccupationLedgerDetailPanel"
import { clearOccupationLedgerWmsLayers } from "./_mapContents/occupationLedger/occupationLedgerMapSync"
import {
  findOpenedOccupationLedgerSerEng,
  isOccupationLedgerOpenedToken,
} from "@/lib/occupationLedgerBinding"
import { BuildPublicLandListPanel } from "./_mapContents/buildPublicLand/BuildPublicLandListPanel"
import { BuildPublicLandDetailPanel } from "./_mapContents/buildPublicLand/BuildPublicLandDetailPanel"
import { MemoListPanel } from "./_mapContents/memo/MemoListPanel"
import { MemoDetailPanel } from "./_mapContents/memo/MemoDetailPanel"
// 점용대장(프) 더미 — 대장↔점사용료 실연동 전까지 비활성
// import {
//   UseLedgerProtoListPanel,
//   UseLedgerProtoDetailPanel,
//   UseLedgerProtoLinkedPanel,
// } from "./_mapContents/prototypes/UseLedgerProtoPanels"
import { LAYER_ROW_NEW_ID } from "./_mapComponents/layerRowEdit"
import { UseFeeListPanel } from "./_mapContents/useFee/UseFeeListPanel"
import { UseFeeDetailPanel } from "./_mapContents/useFee/UseFeeDetailPanel"
import { GroundwaterPermitListPanel } from "./_mapContents/groundwaterPermit/GroundwaterPermitListPanel"
import { GroundwaterPermitDetailPanel } from "./_mapContents/groundwaterPermit/GroundwaterPermitDetailPanel"
import {
  UserAccountProtoPanel,
} from "./_mapContents/prototypes/UserAccountProtoPanel"
// import { PROTO_LEDGERS, type ProtoLedgerRow } from "./_mapContents/prototypes/dummyData"
// import { flyToProtoLedger } from "./_mapContents/prototypes/protoMapNavigation"
import { ROAD_LEDGER_SUMMARY_LAYER_ID } from "./_mapContents/road/roadLedger/roadLedgerDocLayerMap"
import {
  clearServiceMenuLayerState,
  ensureRoadLedgerSummaryLayer,
} from "@/lib/mapServiceMenuLayers"
import { MapSidebar } from "./_mapComponents/map-sidebar"
import { MapSearchBar } from "./_mapComponents/map-search-bar"
import { MapContextProvider, useMapContext } from "./_mapComponents/MapContext"
import { applyViewPaddingPreservingVisualCenter } from "./_mapComponents/config/mapVisualCenter"
import { MapSideListPanel } from "./_mapComponents/MapSideListPanel"
import { SearchBarOffsetContext } from "./searchBarOffsetContext"

const SIDEBAR_WIDTH = 65
const SEARCH_BAR_MARGIN = 20
/** 주소/지번 검색창과 같은 위치(px)에 맞출 때 사용. left = SIDEBAR_WIDTH + listPanelWidth + SEARCH_BAR_MARGIN, top = 16 */
export { useSearchBarOffset } from "./searchBarOffsetContext"

const STANDARD_LIST_MIN_WIDTH = 280
const STANDARD_LIST_DEFAULT_WIDTH = STANDARD_LIST_MIN_WIDTH
const STANDARD_LIST_MAX_WIDTH = 900

const COMPLAINT_PANEL_DEFAULT_WIDTH = 460
const COMPLAINT_PANEL_MIN_WIDTH = 320
const COMPLAINT_PANEL_MAX_WIDTH = 900

const MEMO_PANEL_DEFAULT_WIDTH = 420
const MEMO_PANEL_MIN_WIDTH = 320
const MEMO_PANEL_MAX_WIDTH = 720
const MEMO_DETAIL_DEFAULT_WIDTH = 400
const MEMO_DETAIL_MIN_WIDTH = 320
const MEMO_DETAIL_MAX_WIDTH = 640

const MAP_3D_DATA_PANEL_DEFAULT_WIDTH = 360
const MAP_3D_DATA_PANEL_MIN_WIDTH = 280
const MAP_3D_DATA_PANEL_MAX_WIDTH = 600

const RIVER_BASIC_PLAN_LIST_DEFAULT_WIDTH = 320
const RIVER_BASIC_PLAN_LIST_MIN_WIDTH = 280
const RIVER_BASIC_PLAN_LIST_MAX_WIDTH = 680

const RIVER_BASIC_PLAN_DETAIL_DEFAULT_WIDTH = 460
const RIVER_BASIC_PLAN_DETAIL_MIN_WIDTH = 360
const RIVER_BASIC_PLAN_DETAIL_MAX_WIDTH = 900

const ROAD_LEDGER_LIST_DEFAULT_WIDTH = 400
const ROAD_LEDGER_LIST_MIN_WIDTH = 300
const ROAD_LEDGER_LIST_MAX_WIDTH = 680

const ROAD_LEDGER_DETAIL_DEFAULT_WIDTH = 460
const ROAD_LEDGER_DETAIL_MIN_WIDTH = 360
const ROAD_LEDGER_DETAIL_MAX_WIDTH = 900

const ROAD_NETWORK_LIST_DEFAULT_WIDTH = 400
const ROAD_NETWORK_LIST_MIN_WIDTH = 300
const ROAD_NETWORK_LIST_MAX_WIDTH = 680

const ROAD_NETWORK_DETAIL_DEFAULT_WIDTH = 420
const ROAD_NETWORK_DETAIL_MIN_WIDTH = 340
const ROAD_NETWORK_DETAIL_MAX_WIDTH = 720

const SAFETY_MAP_PANEL_DEFAULT_WIDTH = 360
const SAFETY_MAP_PANEL_MIN_WIDTH = 280
const SAFETY_MAP_PANEL_MAX_WIDTH = 600

const SAFETY_INFO_PANEL_DEFAULT_WIDTH = 720
const SAFETY_INFO_PANEL_MIN_WIDTH = 560
const SAFETY_INFO_PANEL_MAX_WIDTH = 1200

const SAFETY_WATER_PANEL_DEFAULT_WIDTH = 360
const SAFETY_WATER_PANEL_MIN_WIDTH = 280
const SAFETY_WATER_PANEL_MAX_WIDTH = 600

const SAFETY_WATER_STATS_DEFAULT_WIDTH = 460
const SAFETY_WATER_STATS_MIN_WIDTH = 360
const SAFETY_WATER_STATS_MAX_WIDTH = 900

const SAFETY_FAC_PANEL_DEFAULT_WIDTH = 360
const SAFETY_FAC_PANEL_MIN_WIDTH = 280
const SAFETY_FAC_PANEL_MAX_WIDTH = 600

const SAFETY_HOSPITAL_BED_PANEL_DEFAULT_WIDTH = 420
const SAFETY_HOSPITAL_BED_PANEL_MIN_WIDTH = 320
const SAFETY_HOSPITAL_BED_PANEL_MAX_WIDTH = 720

const JSJ_RESERVOIR_PANEL_DEFAULT_WIDTH = 420
const JSJ_RESERVOIR_PANEL_MIN_WIDTH = 320
const JSJ_RESERVOIR_PANEL_MAX_WIDTH = 720

const ROAD_DOC_PANEL_DEFAULT_WIDTH = 380
const ROAD_DOC_PANEL_MIN_WIDTH = 280
const ROAD_DOC_PANEL_MAX_WIDTH = 640

const ROAD_CCTV_PANEL_DEFAULT_WIDTH = 380
const ROAD_CCTV_PANEL_MIN_WIDTH = 300
const ROAD_CCTV_PANEL_MAX_WIDTH = 560

const ROAD_INFRA_PANEL_DEFAULT_WIDTH = STANDARD_LIST_DEFAULT_WIDTH
const ROAD_INFRA_PANEL_MIN_WIDTH = STANDARD_LIST_MIN_WIDTH
const ROAD_INFRA_PANEL_MAX_WIDTH = STANDARD_LIST_MAX_WIDTH

const ROAD_USE_LEDGER_PANEL_DEFAULT_WIDTH = 700
const ROAD_USE_LEDGER_PANEL_MIN_WIDTH = 520
const ROAD_USE_LEDGER_PANEL_MAX_WIDTH = 960

const ROAD_USE_LEDGER_DETAIL_DEFAULT_WIDTH = 400
const ROAD_USE_LEDGER_DETAIL_MIN_WIDTH = 320
const ROAD_USE_LEDGER_DETAIL_MAX_WIDTH = 640

const BUILD_PUBLIC_LAND_PANEL_DEFAULT_WIDTH = ROAD_USE_LEDGER_PANEL_DEFAULT_WIDTH
const BUILD_PUBLIC_LAND_PANEL_MIN_WIDTH = ROAD_USE_LEDGER_PANEL_MIN_WIDTH
const BUILD_PUBLIC_LAND_PANEL_MAX_WIDTH = ROAD_USE_LEDGER_PANEL_MAX_WIDTH
const BUILD_PUBLIC_LAND_DETAIL_DEFAULT_WIDTH = ROAD_USE_LEDGER_DETAIL_DEFAULT_WIDTH
const BUILD_PUBLIC_LAND_DETAIL_MIN_WIDTH = ROAD_USE_LEDGER_DETAIL_MIN_WIDTH
const BUILD_PUBLIC_LAND_DETAIL_MAX_WIDTH = ROAD_USE_LEDGER_DETAIL_MAX_WIDTH

const LAYER_DATA_PANEL_DEFAULT_WIDTH = 400
const LAYER_DATA_PANEL_MIN_WIDTH = 360
const LAYER_DATA_PANEL_MAX_WIDTH = 900

const STANDARD_LIST_OPENED_KEY = "standardList"
const LIST_VIEW_OPENED_KEY = "listView"
const COMPLAINT_OPENED_KEY = "complaintManagement"
const MEMO_OPENED_KEY = "memoManagement"
const MAP_3D_DATA_OPENED_KEY = "map3dData"
const RIVER_BASIC_PLAN_OPENED_KEY = "riverBasicPlan"
const ROAD_LEDGER_OPENED_KEY = "roadLedger"
const ROAD_NETWORK_OPENED_KEY = "roadNetwork"
const SAFETY_MAP_OPENED_KEY = "safetyMap"
const SAFETY_INFO_OPENED_KEY = "safetyInfo"
const SAFETY_WATER_OPENED_KEY = "safetyWater"
const SAFETY_FAC_OPENED_KEY = "safetyFac"
const SAFETY_HOSPITAL_BED_OPENED_KEY = "safetyBedState"
/** serviceList `ser_eng`: jsjWaterLevel — 저수지 수위(saftyJsj) */
const JSJ_WATER_LEVEL_OPENED_KEY = "jsjWaterLevel"
const ROAD_DOC_OPENED_KEY = "roadDoc"
const ROAD_CCTV_OPENED_KEY = "roadCCTV"
const ROAD_INFRA_OPENED_KEY = "roadInfra"
const ROAD_USE_LEDGER_OPENED_KEY = "roadUseLedger"
const BUILD_PUBLIC_LAND_OPENED_KEY = "buildPublicLand"
const RIVER_USE_LEDGER_OPENED_KEY = "riverUseLedger"
const AERIAL_VIEW_OPENED_KEY = "aerialView"
/** 레거시 통합 키 — UAV는 종류별 키 사용 */
const AERIAL_MANAGE_OPENED_KEY = "aerialManage"
const AERIAL_ORTHO_OPENED_KEY = "aerialOrtho"
const AERIAL_DRONE_OPENED_KEY = "aerialDrone"
const AERIAL_PANORAMA_OPENED_KEY = "aerialPanorama"
const AERIAL_SATELLITE_OPENED_KEY = "aerialSatellite"
const AERIAL_MANAGE_KIND_KEYS = [
  AERIAL_MANAGE_OPENED_KEY,
  AERIAL_ORTHO_OPENED_KEY,
  AERIAL_DRONE_OPENED_KEY,
  AERIAL_PANORAMA_OPENED_KEY,
  AERIAL_SATELLITE_OPENED_KEY,
] as const
const SHOOTING_REQUEST_OPENED_KEY = "shootingRequest"
const SHOOTING_APPROVAL_OPENED_KEY = "shootingApproval"
const SHOOTING_PANEL_KEYS = [SHOOTING_REQUEST_OPENED_KEY, SHOOTING_APPROVAL_OPENED_KEY] as const
const USAGE_DATA_AS_OPENED_KEY = "usageDataAs"
// 점용대장(프) 더미 — 대장↔점사용료 실연동 전까지 비활성
// const USE_LEDGER_PROTO_OPENED_KEY = "useLedgerProto"
// const USE_LEDGER_PROTO_PANEL_DEFAULT_WIDTH = 466
// const USE_LEDGER_PROTO_PANEL_MIN_WIDTH = 466
// const USE_LEDGER_PROTO_PANEL_MAX_WIDTH = 960
// const USE_LEDGER_PROTO_DETAIL_DEFAULT_WIDTH = 340
// const USE_LEDGER_PROTO_DETAIL_MIN_WIDTH = 340
// const USE_LEDGER_PROTO_DETAIL_MAX_WIDTH = 480
const USE_FEE_OPENED_KEY = "useFee"
/** 점용상세(343)와 동일 기준 */
const USE_FEE_DETAIL_DEFAULT_WIDTH = 343
const USE_FEE_DETAIL_MIN_WIDTH = 343
const USE_FEE_DETAIL_MAX_WIDTH = 480
/** 하천점용 목록(466)과 동일 기준 */
const USE_FEE_PANEL_DEFAULT_WIDTH = 466
const USE_FEE_PANEL_MIN_WIDTH = 466
const USE_FEE_PANEL_MAX_WIDTH = 960

/** serviceList.ser_eng / systemList 메뉴 키와 동일 */
const GROUNDWATER_PERMIT_OPENED_KEY = "underWaterUse"
const GROUNDWATER_PERMIT_PANEL_DEFAULT_WIDTH = 720
const GROUNDWATER_PERMIT_PANEL_MIN_WIDTH = 560
const GROUNDWATER_PERMIT_PANEL_MAX_WIDTH = 960
const GROUNDWATER_PERMIT_DETAIL_DEFAULT_WIDTH = 400
const GROUNDWATER_PERMIT_DETAIL_MIN_WIDTH = 320
const GROUNDWATER_PERMIT_DETAIL_MAX_WIDTH = 640

const RIVER_USE_LEDGER_PANEL_DEFAULT_WIDTH = 660
const RIVER_USE_LEDGER_PANEL_MIN_WIDTH = 480
const RIVER_USE_LEDGER_PANEL_MAX_WIDTH = 960
const RIVER_USE_LEDGER_DETAIL_DEFAULT_WIDTH = 400
const RIVER_USE_LEDGER_DETAIL_MIN_WIDTH = 320
const RIVER_USE_LEDGER_DETAIL_MAX_WIDTH = 640
const AERIAL_MANAGE_PANEL_DEFAULT_WIDTH = 360
const AERIAL_MANAGE_PANEL_MIN_WIDTH = 300
const AERIAL_MANAGE_PANEL_MAX_WIDTH = 1200
const SHOOTING_REQUEST_PANEL_DEFAULT_WIDTH = 340
const SHOOTING_REQUEST_PANEL_MIN_WIDTH = 280
const SHOOTING_REQUEST_PANEL_MAX_WIDTH = 480
const SHOOTING_REQUEST_DETAIL_DEFAULT_WIDTH = 520
const SHOOTING_REQUEST_DETAIL_MIN_WIDTH = 420
const SHOOTING_REQUEST_DETAIL_MAX_WIDTH = 720
const RIVER_CONSTRUCTION_LEDGER_OPENED_KEY = "riverConstructionLedger"
const RIVER_CONSTRUCTION_LEDGER_PANEL_DEFAULT_WIDTH = 560
const RIVER_CONSTRUCTION_LEDGER_PANEL_MIN_WIDTH = 420
const RIVER_CONSTRUCTION_LEDGER_PANEL_MAX_WIDTH = 900
const RIVER_CONSTRUCTION_LEDGER_DETAIL_DEFAULT_WIDTH = 400
const RIVER_CONSTRUCTION_LEDGER_DETAIL_MIN_WIDTH = 320
const RIVER_CONSTRUCTION_LEDGER_DETAIL_MAX_WIDTH = 640

const USAGE_DATA_AS_PANEL_DEFAULT_WIDTH = 466
const USAGE_DATA_AS_PANEL_MIN_WIDTH = 466
const USAGE_DATA_AS_PANEL_MAX_WIDTH = 960
const USAGE_DATA_AS_DETAIL_DEFAULT_WIDTH = 400
const USAGE_DATA_AS_DETAIL_MIN_WIDTH = 320
const USAGE_DATA_AS_DETAIL_MAX_WIDTH = 640

const OCCUPATION_LEDGER_PANEL_DEFAULT_WIDTH = 466
const OCCUPATION_LEDGER_PANEL_MIN_WIDTH = 466
const OCCUPATION_LEDGER_PANEL_MAX_WIDTH = 960
const OCCUPATION_LEDGER_DETAIL_DEFAULT_WIDTH = 400
const OCCUPATION_LEDGER_DETAIL_MIN_WIDTH = 320
const OCCUPATION_LEDGER_DETAIL_MAX_WIDTH = 640

/** serviceList `ser_eng`: roadReward — 보상편입용지 */
const ROAD_REWARD_OPENED_KEY = "roadReward"
const ROAD_REWARD_PANEL_DEFAULT_WIDTH = 320
const ROAD_REWARD_PANEL_MIN_WIDTH = 260
const ROAD_REWARD_PANEL_MAX_WIDTH = 480
const ROAD_REWARD_DETAIL_DEFAULT_WIDTH = 480
const ROAD_REWARD_DETAIL_MIN_WIDTH = 380
const ROAD_REWARD_DETAIL_MAX_WIDTH = 720

function MapLayoutContent({
  children,
  indexLogoSrc,
}: {
  children: React.ReactNode
  indexLogoSrc: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const mapContext = useMapContext()
  /** Provider `value`는 매 렌더 새 객체 — effect deps에 `mapContext` 넣으면 visibleLayerNames만 바뀌어도 재실행됨 */
  const mapInstanceRef = mapContext?.mapInstanceRef
  const setMapPaddingLeft = mapContext?.setMapPaddingLeft
  const applyMapViewPaddingRef = mapContext?.applyMapViewPaddingRef
  const mapViewPaddingOverrideRef = mapContext?.mapViewPaddingOverrideRef
  const mapSplitSecondaryKind = mapContext?.mapSplitSecondaryKind
  const setRiverBasicPlanPanelOpen = mapContext?.setRiverBasicPlanPanelOpen
  const setRiverBasicPlanSelectedRiver = mapContext?.setRiverBasicPlanSelectedRiver
  const setUsageDataAsPanelOpen = mapContext?.setUsageDataAsPanelOpen
  const setOccupationLedgerPanelOpen = mapContext?.setOccupationLedgerPanelOpen
  const setRoadLedgerPanelOpen = mapContext?.setRoadLedgerPanelOpen
  const setRoadLedgerIdentifyRow = mapContext?.setRoadLedgerIdentifyRow
  const setRoadLedgerFacilityModal = mapContext?.setRoadLedgerFacilityModal
  const setRoadNetworkSelectedId = mapContext?.setRoadNetworkSelectedId
  const setRoadNetworkPanelOpen = mapContext?.setRoadNetworkPanelOpen
  const setRoadNetworkOverlayRows = mapContext?.setRoadNetworkOverlayRows
  const setSpatialDrawRequest = mapContext?.setSpatialDrawRequest
  const setRoadNetworkPointPickActive = mapContext?.setRoadNetworkPointPickActive
  const setRoadNetworkDraftSitePoint = mapContext?.setRoadNetworkDraftSitePoint
  const setRoadNetworkSitePointKind = mapContext?.setRoadNetworkSitePointKind
  const setRoadNetworkEndpointMarkers = mapContext?.setRoadNetworkEndpointMarkers
  const setRoadNetworkFocusedSitePointKey = mapContext?.setRoadNetworkFocusedSitePointKey
  const setRiverConstructionLedgerSelectedId = mapContext?.setRiverConstructionLedgerSelectedId
  const setRiverConstructionLedgerPanelOpen = mapContext?.setRiverConstructionLedgerPanelOpen
  const setRiverConstructionLedgerOverlayRows = mapContext?.setRiverConstructionLedgerOverlayRows
  const setRiverConstructionLedgerSelectedRiver = mapContext?.setRiverConstructionLedgerSelectedRiver
  const setRiverConstructionLedgerRiverFocus = mapContext?.setRiverConstructionLedgerRiverFocus
  const setRiverConstructionLedgerGeomEditingId =
    mapContext?.setRiverConstructionLedgerGeomEditingId
  const setRoadCctvPanelOpen = mapContext?.setRoadCctvPanelOpen
  const setRoadCctvOverlay = mapContext?.setRoadCctvOverlay
  const setRoadCctvUnderlayMode = mapContext?.setRoadCctvUnderlayMode
  const setRoadCctvExtentWgs84 = mapContext?.setRoadCctvExtentWgs84
  const setVisibleLayerNames = mapContext?.setVisibleLayerNames
  const setIdentifyResultList = mapContext?.setIdentifyResultList
  const setIdentifySelectedRow = mapContext?.setIdentifySelectedRow
  const setSafetyMapLayerVisibility = mapContext?.setSafetyMapLayerVisibility
  const setSpatialFilterWkt = mapContext?.setSpatialFilterWkt
  const setSpatialFilteredLayerNames = mapContext?.setSpatialFilteredLayerNames
  /** 색인도 식별 시 하천·탭을 동기 갱신 (상세 패널 effect보다 먼저 반영되도록 ref에 등록) */
  if (mapContext?.applyRiverBasicPlanMapPickRef) {
    mapContext.applyRiverBasicPlanMapPickRef.current = (pick) => {
      setRiverPlanTab(pick.tab)
      setSelectedRiverName(pick.riverName)
    }
  }
  const rawOpened = searchParams.get("opened")?.split(",").filter(Boolean) || []
  const openedWindows = rawOpened.map((w) => (w === "dataQuery" ? STANDARD_LIST_OPENED_KEY : w))
  const serviceMenuKey = useMemo(
    () => openedWindows.find((w) => w !== LIST_VIEW_OPENED_KEY && w !== "layerSetting") ?? "",
    [rawOpened.join(",")]
  )

  const dataTableFromUrl = searchParams.get("dataTable") ?? ""
  const dataKeyFromUrl = searchParams.get("dataKey") ?? ""

  const layerListVisible = openedWindows.includes(STANDARD_LIST_OPENED_KEY)
  const dataPanelOpened = openedWindows.includes(LIST_VIEW_OPENED_KEY)
  const layerDataPanelOpen = dataPanelOpened && dataTableFromUrl !== ""

  const complaintManagementOpen = openedWindows.includes(COMPLAINT_OPENED_KEY)
  const memoManagementOpen = openedWindows.includes(MEMO_OPENED_KEY)
  const map3dDataOpen = openedWindows.includes(MAP_3D_DATA_OPENED_KEY)
  const riverBasicPlanOpen = openedWindows.includes(RIVER_BASIC_PLAN_OPENED_KEY)
  const roadLedgerOpen = openedWindows.includes(ROAD_LEDGER_OPENED_KEY)
  const roadLedgerDetailOpen =
    roadLedgerOpen && Boolean(mapContext?.roadLedgerIdentifyRow)
  const roadNetworkOpen = openedWindows.includes(ROAD_NETWORK_OPENED_KEY)
  const roadNetworkDetailOpen =
    roadNetworkOpen && Boolean(mapContext?.roadNetworkSelectedId)
  const roadNetworkSelectedRow =
    mapContext?.roadNetworkRows?.find((r) => r.id === mapContext?.roadNetworkSelectedId) ?? null
  const safetyMapOpen = openedWindows.includes(SAFETY_MAP_OPENED_KEY)
  const safetyInfoOpen = openedWindows.includes(SAFETY_INFO_OPENED_KEY)
  const safetyWaterOpen = openedWindows.includes(SAFETY_WATER_OPENED_KEY)
  const safetyFacOpen = openedWindows.includes(SAFETY_FAC_OPENED_KEY)
  const safetyHospitalBedOpen = openedWindows.includes(SAFETY_HOSPITAL_BED_OPENED_KEY)
  const jsjWaterLevelOpen = openedWindows.includes(JSJ_WATER_LEVEL_OPENED_KEY)
  const roadDocOpen = openedWindows.includes(ROAD_DOC_OPENED_KEY)
  const roadCctvOpen = openedWindows.includes(ROAD_CCTV_OPENED_KEY)
  const roadInfraOpen = openedWindows.includes(ROAD_INFRA_OPENED_KEY)
  const parcelAnalysisOpen = openedWindows.includes(PARCEL_ANALYSIS_OPENED_KEY)
  const { sidePanelOpen: parcelAnalysisSidePanelOpen } = useParcelAnalysis()
  const buildPublicLandOpen = openedWindows.includes(BUILD_PUBLIC_LAND_OPENED_KEY)
  const roadUseLedgerOpen = openedWindows.includes(ROAD_USE_LEDGER_OPENED_KEY)
  const riverUseLedgerOpen = openedWindows.includes(RIVER_USE_LEDGER_OPENED_KEY)
  const aerialManageOpenedKey =
    AERIAL_MANAGE_KIND_KEYS.find((k) => openedWindows.includes(k)) ?? null
  const aerialManageOpen = aerialManageOpenedKey != null
  const aerialManageKind: AerialKind | undefined =
    aerialManageOpenedKey === AERIAL_ORTHO_OPENED_KEY
      ? "ortho"
      : aerialManageOpenedKey === AERIAL_DRONE_OPENED_KEY
        ? "drone"
        : aerialManageOpenedKey === AERIAL_PANORAMA_OPENED_KEY
          ? "panorama"
          : aerialManageOpenedKey === AERIAL_SATELLITE_OPENED_KEY
            ? "satellite"
            : undefined
  const shootingApprovalOpen =
    SHOOTING_REQUEST_UI_ENABLED && openedWindows.includes(SHOOTING_APPROVAL_OPENED_KEY)
  const shootingRequestOpen =
    SHOOTING_REQUEST_UI_ENABLED && openedWindows.includes(SHOOTING_REQUEST_OPENED_KEY)
  const shootingListOpen = shootingApprovalOpen
  const shootingPanelOpen = shootingApprovalOpen || shootingRequestOpen
  const [shootingRequestDetailId, setShootingRequestDetailId] = useState<string | null>(null)
  const [shootingRequestListMode, setShootingRequestListMode] = useState<'mine' | 'approval'>('mine')
  /** 내 정보 → 촬영요청 목록에서 연 신청서 모달 id (사이드 패널 아님) */
  const [myInfoShootingModalId, setMyInfoShootingModalId] = useState<string | null>(null)
  const shootingRequestDetailOpen =
    shootingPanelOpen &&
    Boolean(shootingRequestDetailId) &&
    shootingRequestDetailId !== SHOOTING_REQUEST_NEW_ID
  const riverConstructionLedgerOpen = openedWindows.includes(RIVER_CONSTRUCTION_LEDGER_OPENED_KEY)
  const riverConstructionLedgerSelectedRow =
    mapContext?.riverConstructionLedgerRows?.find(
      (r) => r.id === mapContext?.riverConstructionLedgerSelectedId
    ) ?? null
  const riverConstructionLedgerDetailOpen =
    riverConstructionLedgerOpen && Boolean(riverConstructionLedgerSelectedRow)
  const usageDataAsOpen = openedWindows.includes(USAGE_DATA_AS_OPENED_KEY)
  const occupationLedgerSerEng = findOpenedOccupationLedgerSerEng(openedWindows)
  const occupationLedgerOpen = Boolean(occupationLedgerSerEng)
  const roadRewardOpen = openedWindows.includes(ROAD_REWARD_OPENED_KEY)
  const useFeeOpen = openedWindows.includes(USE_FEE_OPENED_KEY)
  const groundwaterPermitOpen = openedWindows.includes(GROUNDWATER_PERMIT_OPENED_KEY)
  const [buildPublicLandSelectedId, setBuildPublicLandSelectedId] = useState<string | null>(null)
  const [buildPublicLandListRefreshKey, setBuildPublicLandListRefreshKey] = useState(0)
  const buildPublicLandDetailOpen = buildPublicLandOpen && Boolean(buildPublicLandSelectedId)
  const [roadUseLedgerDetailId, setRoadUseLedgerDetailId] = useState<string | null>(null)
  const [roadUseLedgerListRefreshKey, setRoadUseLedgerListRefreshKey] = useState(0)
  const roadUseLedgerDetailOpen = roadUseLedgerOpen && Boolean(roadUseLedgerDetailId)
  const [riverUseLedgerDetailId, setRiverUseLedgerDetailId] = useState<string | null>(null)
  const [riverUseLedgerListRefreshKey, setRiverUseLedgerListRefreshKey] = useState(0)
  const riverUseLedgerDetailOpen = riverUseLedgerOpen && Boolean(riverUseLedgerDetailId)
  const [usageDataAsDetailId, setUsageDataAsDetailId] = useState<string | null>(null)
  const [usageDataAsListRefreshKey, setUsageDataAsListRefreshKey] = useState(0)
  const usageDataAsDetailOpen = usageDataAsOpen && Boolean(usageDataAsDetailId)
  const [occupationLedgerDetailId, setOccupationLedgerDetailId] = useState<string | null>(null)
  const [occupationLedgerListRefreshKey, setOccupationLedgerListRefreshKey] = useState(0)
  const occupationLedgerDetailOpen = occupationLedgerOpen && Boolean(occupationLedgerDetailId)
  /** 보상편입용지 — DB(road_reward) 조회·저장 */
  const [roadRewardCases, setRoadRewardCases] = useState<RoadRewardCase[]>([])
  const [roadRewardSelectedId, setRoadRewardSelectedId] = useState<string | null>(null)
  const roadRewardDetailOpen = roadRewardOpen && Boolean(roadRewardSelectedId)
  // 점용대장(프) 더미 state 비활성
  // const useLedgerProtoOpen = openedWindows.includes(USE_LEDGER_PROTO_OPENED_KEY)
  // const [useLedgerProtoDetailId, setUseLedgerProtoDetailId] = useState<string | null>(null)
  // const [useLedgerProtoFeeId, setUseLedgerProtoFeeId] = useState<string | null>(null)
  // const [useLedgerProtoRows, setUseLedgerProtoRows] = useState<ProtoLedgerRow[]>(() => [...PROTO_LEDGERS])
  const [useFeeDetailId, setUseFeeDetailId] = useState<string | null>(null)
  const useFeeDetailOpen = useFeeOpen && Boolean(useFeeDetailId)
  const [groundwaterPermitDetailId, setGroundwaterPermitDetailId] = useState<string | null>(null)
  const groundwaterPermitDetailOpen =
    groundwaterPermitOpen && Boolean(groundwaterPermitDetailId)
  const [protoUserAccountOpen, setProtoUserAccountOpen] = useState(false)

  const [memoDetailId, setMemoDetailId] = useState<string | null>(null)
  const [memoListRefreshKey, setMemoListRefreshKey] = useState(0)
  const memoDetailOpen = memoManagementOpen && Boolean(memoDetailId)
  const [complaintListRefreshKey, setComplaintListRefreshKey] = useState(0)
  const roadCctvUnderlayMode = mapContext?.roadCctvUnderlayMode ?? "traffic"

  /** 좌측 서비스 메뉴 전환 시 서비스 레이어 초기화 — 도로대장·시설관리는 총괄(a0020000) 즉시 유지 */
  const prevServiceMenuRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    const skipRoadLedgerSummary =
      serviceMenuKey === ROAD_INFRA_OPENED_KEY &&
      roadCctvOpen &&
      roadCctvUnderlayMode === "traffic"
    const layerCtx = {
      setVisibleLayerNames,
      setSafetyMapLayerVisibility,
      setSpatialFilterWkt,
      setSpatialFilteredLayerNames,
      setIdentifyResultList,
      setIdentifySelectedRow,
    }

    if (prevServiceMenuRef.current !== null && prevServiceMenuRef.current !== serviceMenuKey) {
      clearServiceMenuLayerState(layerCtx, {
        nextServiceMenuKey: serviceMenuKey,
        skipRoadLedgerSummary,
      })
    } else if (!skipRoadLedgerSummary) {
      if (serviceMenuKey === ROAD_LEDGER_OPENED_KEY || serviceMenuKey === ROAD_INFRA_OPENED_KEY) {
        ensureRoadLedgerSummaryLayer(layerCtx)
      }
    }
    prevServiceMenuRef.current = serviceMenuKey
  }, [
    serviceMenuKey,
    roadCctvOpen,
    roadCctvUnderlayMode,
    setVisibleLayerNames,
    setSafetyMapLayerVisibility,
    setSpatialFilterWkt,
    setSpatialFilteredLayerNames,
    setIdentifyResultList,
    setIdentifySelectedRow,
  ])

  const [riverPlanTab, setRiverPlanTab] = useState<"river" | "smallRiver">("river")
  const [selectedRiverName, setSelectedRiverName] = useState("")
  const [standardListPanelWidth, setStandardListPanelWidth] = useState(STANDARD_LIST_DEFAULT_WIDTH)
  const [complaintPanelWidth, setComplaintPanelWidth] = useState(COMPLAINT_PANEL_DEFAULT_WIDTH)
  const [map3dDataPanelWidth, setMap3dDataPanelWidth] = useState(MAP_3D_DATA_PANEL_DEFAULT_WIDTH)
  const [riverBasicPlanListWidth, setRiverBasicPlanListWidth] = useState(RIVER_BASIC_PLAN_LIST_DEFAULT_WIDTH)
  const [riverBasicPlanDetailWidth, setRiverBasicPlanDetailWidth] = useState(RIVER_BASIC_PLAN_DETAIL_DEFAULT_WIDTH)
  const [roadLedgerListWidth, setRoadLedgerListWidth] = useState(ROAD_LEDGER_LIST_DEFAULT_WIDTH)
  const [roadLedgerDetailWidth, setRoadLedgerDetailWidth] = useState(ROAD_LEDGER_DETAIL_DEFAULT_WIDTH)
  const [roadNetworkListWidth, setRoadNetworkListWidth] = useState(ROAD_NETWORK_LIST_DEFAULT_WIDTH)
  const [roadNetworkDetailWidth, setRoadNetworkDetailWidth] = useState(ROAD_NETWORK_DETAIL_DEFAULT_WIDTH)
  const [safetyMapPanelWidth, setSafetyMapPanelWidth] = useState(SAFETY_MAP_PANEL_DEFAULT_WIDTH)
  const [safetyInfoPanelWidth, setSafetyInfoPanelWidth] = useState(SAFETY_INFO_PANEL_DEFAULT_WIDTH)
  const [safetyWaterPanelWidth, setSafetyWaterPanelWidth] = useState(SAFETY_WATER_PANEL_DEFAULT_WIDTH)
  const [safetyWaterStatsWidth, setSafetyWaterStatsWidth] = useState(SAFETY_WATER_STATS_DEFAULT_WIDTH)
  const [safetyWaterStatsKinds, setSafetyWaterStatsKinds] = useState<SafetyWaterStationKind[]>([])
  const safetyWaterStatsOpen = safetyWaterStatsKinds.length > 0
  const [safetyFacPanelWidth, setSafetyFacPanelWidth] = useState(SAFETY_FAC_PANEL_DEFAULT_WIDTH)
  const [safetyHospitalBedPanelWidth, setSafetyHospitalBedPanelWidth] = useState(
    SAFETY_HOSPITAL_BED_PANEL_DEFAULT_WIDTH
  )
  const [jsjReservoirPanelWidth, setJsjReservoirPanelWidth] = useState(JSJ_RESERVOIR_PANEL_DEFAULT_WIDTH)
  const [roadDocPanelWidth, setRoadDocPanelWidth] = useState(ROAD_DOC_PANEL_DEFAULT_WIDTH)
  const [roadCctvPanelWidth, setRoadCctvPanelWidth] = useState(ROAD_CCTV_PANEL_DEFAULT_WIDTH)
  const [roadInfraPanelWidth, setRoadInfraPanelWidth] = useState(ROAD_INFRA_PANEL_DEFAULT_WIDTH)
  const [parcelAnalysisPanelWidth, setParcelAnalysisPanelWidth] = useState(PARCEL_ANALYSIS_PANEL_DEFAULT_WIDTH)
  const [buildPublicLandPanelWidth, setBuildPublicLandPanelWidth] = useState(BUILD_PUBLIC_LAND_PANEL_DEFAULT_WIDTH)
  const [buildPublicLandDetailWidth, setBuildPublicLandDetailWidth] = useState(BUILD_PUBLIC_LAND_DETAIL_DEFAULT_WIDTH)
  const [roadUseLedgerPanelWidth, setRoadUseLedgerPanelWidth] = useState(ROAD_USE_LEDGER_PANEL_DEFAULT_WIDTH)
  const [roadUseLedgerDetailWidth, setRoadUseLedgerDetailWidth] = useState(ROAD_USE_LEDGER_DETAIL_DEFAULT_WIDTH)
  const [riverUseLedgerPanelWidth, setRiverUseLedgerPanelWidth] = useState(RIVER_USE_LEDGER_PANEL_DEFAULT_WIDTH)
  const [riverUseLedgerDetailWidth, setRiverUseLedgerDetailWidth] = useState(RIVER_USE_LEDGER_DETAIL_DEFAULT_WIDTH)
  const [aerialManagePanelWidth, setAerialManagePanelWidth] = useState(AERIAL_MANAGE_PANEL_DEFAULT_WIDTH)
  const [shootingRequestPanelWidth, setShootingRequestPanelWidth] = useState(
    SHOOTING_REQUEST_PANEL_DEFAULT_WIDTH
  )
  const [shootingRequestDetailWidth, setShootingRequestDetailWidth] = useState(
    SHOOTING_REQUEST_DETAIL_DEFAULT_WIDTH
  )
  const [riverConstructionLedgerPanelWidth, setRiverConstructionLedgerPanelWidth] = useState(
    RIVER_CONSTRUCTION_LEDGER_PANEL_DEFAULT_WIDTH
  )
  const [riverConstructionLedgerDetailWidth, setRiverConstructionLedgerDetailWidth] = useState(
    RIVER_CONSTRUCTION_LEDGER_DETAIL_DEFAULT_WIDTH
  )
  const [usageDataAsPanelWidth, setUsageDataAsPanelWidth] = useState(USAGE_DATA_AS_PANEL_DEFAULT_WIDTH)
  const [usageDataAsDetailWidth, setUsageDataAsDetailWidth] = useState(USAGE_DATA_AS_DETAIL_DEFAULT_WIDTH)
  const [occupationLedgerPanelWidth, setOccupationLedgerPanelWidth] = useState(
    OCCUPATION_LEDGER_PANEL_DEFAULT_WIDTH
  )
  const [occupationLedgerDetailWidth, setOccupationLedgerDetailWidth] = useState(
    OCCUPATION_LEDGER_DETAIL_DEFAULT_WIDTH
  )
  const [roadRewardPanelWidth, setRoadRewardPanelWidth] = useState(ROAD_REWARD_PANEL_DEFAULT_WIDTH)
  const [roadRewardDetailWidth, setRoadRewardDetailWidth] = useState(ROAD_REWARD_DETAIL_DEFAULT_WIDTH)
  // const [useLedgerProtoPanelWidth, setUseLedgerProtoPanelWidth] = useState(USE_LEDGER_PROTO_PANEL_DEFAULT_WIDTH)
  // const [useLedgerProtoDetailWidth, setUseLedgerProtoDetailWidth] = useState(USE_LEDGER_PROTO_DETAIL_DEFAULT_WIDTH)
  // const [useLedgerProtoFeeWidth, setUseLedgerProtoFeeWidth] = useState(USE_FEE_DETAIL_DEFAULT_WIDTH)
  const [useFeePanelWidth, setUseFeePanelWidth] = useState(USE_FEE_PANEL_DEFAULT_WIDTH)
  const [useFeeDetailWidth, setUseFeeDetailWidth] = useState(USE_FEE_DETAIL_DEFAULT_WIDTH)
  const [groundwaterPermitPanelWidth, setGroundwaterPermitPanelWidth] = useState(
    GROUNDWATER_PERMIT_PANEL_DEFAULT_WIDTH
  )
  const [groundwaterPermitDetailWidth, setGroundwaterPermitDetailWidth] = useState(
    GROUNDWATER_PERMIT_DETAIL_DEFAULT_WIDTH
  )
  const [memoPanelWidth, setMemoPanelWidth] = useState(MEMO_PANEL_DEFAULT_WIDTH)
  const [memoDetailWidth, setMemoDetailWidth] = useState(MEMO_DETAIL_DEFAULT_WIDTH)
  const [layerDataPanelWidth, setLayerDataPanelWidth] = useState(LAYER_DATA_PANEL_DEFAULT_WIDTH)
  const [searchBarInputBottomPx, setSearchBarInputBottomPx] = useState(16 + 30)

  /** 열린 MapSideListPanel 너비 합 → 검색창/레이어바 left 기준 (패널 추가 시 여기만 합산) */
  const totalListPanelWidth =
    (roadInfraOpen ? roadInfraPanelWidth : 0) +
    (parcelAnalysisOpen && parcelAnalysisSidePanelOpen ? parcelAnalysisPanelWidth : 0) +
    (layerListVisible ? standardListPanelWidth : 0) +
    (layerDataPanelOpen ? layerDataPanelWidth : 0) +
    (riverBasicPlanOpen ? riverBasicPlanListWidth : 0) +
    (riverBasicPlanOpen && selectedRiverName ? riverBasicPlanDetailWidth : 0) +
    (roadLedgerOpen ? roadLedgerListWidth : 0) +
    (roadLedgerDetailOpen ? roadLedgerDetailWidth : 0) +
    (roadNetworkOpen ? roadNetworkListWidth : 0) +
    (roadNetworkDetailOpen ? roadNetworkDetailWidth : 0) +
    (buildPublicLandOpen ? buildPublicLandPanelWidth : 0) +
    (buildPublicLandDetailOpen ? buildPublicLandDetailWidth : 0) +
    (roadUseLedgerOpen ? roadUseLedgerPanelWidth : 0) +
    (roadUseLedgerDetailOpen ? roadUseLedgerDetailWidth : 0) +
    (riverUseLedgerOpen ? riverUseLedgerPanelWidth : 0) +
    (riverUseLedgerDetailOpen ? riverUseLedgerDetailWidth : 0) +
    (aerialManageOpen ? aerialManagePanelWidth : 0) +
    (shootingListOpen ? shootingRequestPanelWidth : 0) +
    (shootingRequestDetailOpen ? shootingRequestDetailWidth : 0) +
    (riverConstructionLedgerOpen ? riverConstructionLedgerPanelWidth : 0) +
    (riverConstructionLedgerDetailOpen ? riverConstructionLedgerDetailWidth : 0) +
    (usageDataAsOpen ? usageDataAsPanelWidth : 0) +
    (usageDataAsDetailOpen ? usageDataAsDetailWidth : 0) +
    (occupationLedgerOpen ? occupationLedgerPanelWidth : 0) +
    (occupationLedgerDetailOpen ? occupationLedgerDetailWidth : 0) +
    (roadRewardOpen ? roadRewardPanelWidth : 0) +
    (roadRewardDetailOpen ? roadRewardDetailWidth : 0) +
    (memoManagementOpen ? memoPanelWidth : 0) +
    (memoDetailOpen ? memoDetailWidth : 0) +
    (complaintManagementOpen ? complaintPanelWidth : 0) +
    (map3dDataOpen ? map3dDataPanelWidth : 0) +
    (safetyMapOpen ? safetyMapPanelWidth : 0) +
    (safetyInfoOpen ? safetyInfoPanelWidth : 0) +
    (safetyWaterOpen ? safetyWaterPanelWidth : 0) +
    (safetyWaterOpen && safetyWaterStatsOpen ? safetyWaterStatsWidth : 0) +
    (safetyFacOpen ? safetyFacPanelWidth : 0) +
    (safetyHospitalBedOpen ? safetyHospitalBedPanelWidth : 0) +
    (jsjWaterLevelOpen ? jsjReservoirPanelWidth : 0) +
    (roadDocOpen ? roadDocPanelWidth : 0) +
    (roadCctvOpen ? roadCctvPanelWidth : 0) +
    // (useLedgerProtoOpen ? useLedgerProtoPanelWidth : 0) +
    // (useLedgerProtoDetailOpen ? useLedgerProtoDetailWidth : 0) +
    // (useLedgerProtoFeeDetailOpen ? useLedgerProtoFeeWidth : 0) +
    (useFeeOpen ? useFeePanelWidth : 0) +
    (useFeeDetailOpen ? useFeeDetailWidth : 0) +
    (groundwaterPermitOpen ? groundwaterPermitPanelWidth : 0) +
    (groundwaterPermitDetailOpen ? groundwaterPermitDetailWidth : 0)
  const searchBarOffset = {
    leftPx: SIDEBAR_WIDTH + totalListPanelWidth + SEARCH_BAR_MARGIN,
    topPx: 16,
    inputBottomPx: searchBarInputBottomPx,
  }

  /** 패널별 왼쪽 경계(px). 드래그 시 해당 패널 너비 = clientX - leftOffset */
  const roadInfraPanelLeftPx = SIDEBAR_WIDTH
  const parcelAnalysisPanelLeftPx = SIDEBAR_WIDTH + (roadInfraOpen ? roadInfraPanelWidth : 0)
  const standardListLeftPx =
    parcelAnalysisPanelLeftPx +
    (parcelAnalysisOpen && parcelAnalysisSidePanelOpen ? parcelAnalysisPanelWidth : 0)
  const layerDataPanelLeftPx =
    standardListLeftPx + (layerListVisible ? standardListPanelWidth : 0)
  const riverBasicPlanListLeftPx = layerDataPanelLeftPx + (layerDataPanelOpen ? layerDataPanelWidth : 0)
  const riverBasicPlanDetailLeftPx =
    riverBasicPlanListLeftPx + (riverBasicPlanOpen ? riverBasicPlanListWidth : 0)
  const roadLedgerListLeftPx =
    riverBasicPlanDetailLeftPx + (riverBasicPlanOpen && selectedRiverName ? riverBasicPlanDetailWidth : 0)
  const roadLedgerDetailLeftPx =
    roadLedgerListLeftPx + (roadLedgerOpen ? roadLedgerListWidth : 0)
  const afterRoadLedgerPanelsLeftPx =
    roadLedgerDetailLeftPx + (roadLedgerDetailOpen ? roadLedgerDetailWidth : 0)
  const roadNetworkListLeftPx = afterRoadLedgerPanelsLeftPx
  const roadNetworkDetailLeftPx =
    roadNetworkListLeftPx + (roadNetworkOpen ? roadNetworkListWidth : 0)
  const buildPublicLandPanelLeftPx =
    roadNetworkDetailLeftPx + (roadNetworkDetailOpen ? roadNetworkDetailWidth : 0)
  const buildPublicLandDetailLeftPx =
    buildPublicLandPanelLeftPx + (buildPublicLandOpen ? buildPublicLandPanelWidth : 0)
  const roadUseLedgerPanelLeftPx =
    buildPublicLandDetailLeftPx + (buildPublicLandDetailOpen ? buildPublicLandDetailWidth : 0)
  const roadUseLedgerDetailLeftPx =
    roadUseLedgerPanelLeftPx + (roadUseLedgerOpen ? roadUseLedgerPanelWidth : 0)
  const riverUseLedgerPanelLeftPx =
    roadUseLedgerDetailLeftPx + (roadUseLedgerDetailOpen ? roadUseLedgerDetailWidth : 0)
  const riverUseLedgerDetailLeftPx =
    riverUseLedgerPanelLeftPx + (riverUseLedgerOpen ? riverUseLedgerPanelWidth : 0)
  const aerialManagePanelLeftPx =
    riverUseLedgerDetailLeftPx + (riverUseLedgerDetailOpen ? riverUseLedgerDetailWidth : 0)
  const shootingRequestPanelLeftPx =
    aerialManagePanelLeftPx + (aerialManageOpen ? aerialManagePanelWidth : 0)
  const shootingRequestDetailLeftPx =
    shootingRequestPanelLeftPx + (shootingListOpen ? shootingRequestPanelWidth : 0)
  const riverConstructionLedgerPanelLeftPx =
    shootingRequestDetailLeftPx + (shootingRequestDetailOpen ? shootingRequestDetailWidth : 0)
  const riverConstructionLedgerDetailLeftPx =
    riverConstructionLedgerPanelLeftPx +
    (riverConstructionLedgerOpen ? riverConstructionLedgerPanelWidth : 0)
  const usageDataAsPanelLeftPx =
    riverConstructionLedgerDetailLeftPx +
    (riverConstructionLedgerDetailOpen ? riverConstructionLedgerDetailWidth : 0)
  const usageDataAsDetailLeftPx =
    usageDataAsPanelLeftPx + (usageDataAsOpen ? usageDataAsPanelWidth : 0)
  const occupationLedgerPanelLeftPx =
    usageDataAsDetailLeftPx + (usageDataAsDetailOpen ? usageDataAsDetailWidth : 0)
  const occupationLedgerDetailLeftPx =
    occupationLedgerPanelLeftPx + (occupationLedgerOpen ? occupationLedgerPanelWidth : 0)
  const roadRewardPanelLeftPx =
    occupationLedgerDetailLeftPx +
    (occupationLedgerDetailOpen ? occupationLedgerDetailWidth : 0)
  const roadRewardDetailLeftPx =
    roadRewardPanelLeftPx + (roadRewardOpen ? roadRewardPanelWidth : 0)
  const memoPanelLeftPx =
    roadRewardDetailLeftPx + (roadRewardDetailOpen ? roadRewardDetailWidth : 0)
  const memoDetailLeftPx = memoPanelLeftPx + (memoManagementOpen ? memoPanelWidth : 0)
  const complaintPanelLeftPx =
    memoDetailLeftPx + (memoDetailOpen ? memoDetailWidth : 0)
  const map3dPanelLeftPx = complaintPanelLeftPx + (complaintManagementOpen ? complaintPanelWidth : 0)
  const safetyMapPanelLeftPx = map3dPanelLeftPx + (map3dDataOpen ? map3dDataPanelWidth : 0)
  const safetyInfoPanelLeftPx = safetyMapPanelLeftPx + (safetyMapOpen ? safetyMapPanelWidth : 0)
  const safetyWaterPanelLeftPx = safetyInfoPanelLeftPx + (safetyInfoOpen ? safetyInfoPanelWidth : 0)
  const safetyWaterStatsLeftPx = safetyWaterPanelLeftPx + (safetyWaterOpen ? safetyWaterPanelWidth : 0)
  const safetyFacPanelLeftPx =
    safetyWaterStatsLeftPx + (safetyWaterOpen && safetyWaterStatsOpen ? safetyWaterStatsWidth : 0)
  const safetyHospitalBedPanelLeftPx =
    safetyFacPanelLeftPx + (safetyFacOpen ? safetyFacPanelWidth : 0)
  const jsjReservoirPanelLeftPx =
    safetyHospitalBedPanelLeftPx + (safetyHospitalBedOpen ? safetyHospitalBedPanelWidth : 0)
  const roadDocPanelLeftPx = jsjReservoirPanelLeftPx + (jsjWaterLevelOpen ? jsjReservoirPanelWidth : 0)
  const roadCctvPanelLeftPx = roadDocPanelLeftPx + (roadDocOpen ? roadDocPanelWidth : 0)
  // 점용대장(프) 더미 leftPx 비활성 — 점사용료는 CCTV 다음에 바로 배치
  // const useLedgerProtoPanelLeftPx =
  //   roadCctvPanelLeftPx + (roadCctvOpen ? roadCctvPanelWidth : 0)
  // const useLedgerProtoDetailLeftPx =
  //   useLedgerProtoPanelLeftPx + (useLedgerProtoOpen ? useLedgerProtoPanelWidth : 0)
  // const useLedgerProtoFeeLeftPx =
  //   useLedgerProtoDetailLeftPx + (useLedgerProtoDetailOpen ? useLedgerProtoDetailWidth : 0)
  const useFeePanelLeftPx =
    roadCctvPanelLeftPx + (roadCctvOpen ? roadCctvPanelWidth : 0)
  const useFeeDetailLeftPx =
    useFeePanelLeftPx + (useFeeOpen ? useFeePanelWidth : 0)
  const groundwaterPermitPanelLeftPx =
    useFeeDetailLeftPx + (useFeeDetailOpen ? useFeeDetailWidth : 0)
  const groundwaterPermitDetailLeftPx =
    groundwaterPermitPanelLeftPx +
    (groundwaterPermitOpen ? groundwaterPermitPanelWidth : 0)

  const mapPaddingLeft = SIDEBAR_WIDTH + totalListPanelWidth
  /** 패딩은 useLayoutEffect — 자식 useEffect(도로대장 fit 등)보다 먼저 적용되어야 함.
   * 거리뷰 ON일 때만 맵 중심(A)을 새 센터마크 위치에 맞춤.
   * 상하 분할 override([0,0,0,0])가 있으면 왼쪽 패딩을 넣지 않음(스페이서와 이중 패딩 방지). */
  useLayoutEffect(() => {
    const apply = () => {
      const map = mapInstanceRef?.current
      if (!map) return
      const override = mapViewPaddingOverrideRef?.current
      const padding: [number, number, number, number] =
        override ?? [0, 0, 0, mapPaddingLeft]
      if (mapSplitSecondaryKind === "streetView") {
        applyViewPaddingPreservingVisualCenter(map, padding)
      } else {
        map.getView().padding = padding
      }
      setMapPaddingLeft?.((prev) => (prev === mapPaddingLeft ? prev : mapPaddingLeft))
    }
    if (applyMapViewPaddingRef) {
      applyMapViewPaddingRef.current = apply
    }
    apply()
    return () => {
      if (applyMapViewPaddingRef) applyMapViewPaddingRef.current = null
    }
  }, [
    applyMapViewPaddingRef,
    mapViewPaddingOverrideRef,
    mapPaddingLeft,
    mapInstanceRef,
    setMapPaddingLeft,
    mapSplitSecondaryKind,
  ])

  useEffect(() => {
    setRiverBasicPlanPanelOpen?.(riverBasicPlanOpen)
    setRiverBasicPlanSelectedRiver?.(selectedRiverName)
  }, [setRiverBasicPlanPanelOpen, setRiverBasicPlanSelectedRiver, riverBasicPlanOpen, selectedRiverName])

  useEffect(() => {
    setUsageDataAsPanelOpen?.(usageDataAsOpen)
    // 패널 닫힘·시스템(메인) 이탈 후 재진입 시 점용 레이어만 켜져 클릭 무반응 되는 것 방지
    if (!usageDataAsOpen) {
      clearUsageDataAsWmsLayers(setVisibleLayerNames)
    }
  }, [setUsageDataAsPanelOpen, usageDataAsOpen, setVisibleLayerNames])

  useEffect(() => {
    setOccupationLedgerPanelOpen?.(occupationLedgerOpen)
    if (!occupationLedgerOpen) {
      clearOccupationLedgerWmsLayers(setVisibleLayerNames, {
        serEng: occupationLedgerSerEng,
      })
    }
  }, [
    setOccupationLedgerPanelOpen,
    occupationLedgerOpen,
    setVisibleLayerNames,
    occupationLedgerSerEng,
  ])

  useEffect(() => {
    setRoadLedgerPanelOpen?.(roadLedgerOpen)
  }, [setRoadLedgerPanelOpen, roadLedgerOpen])

  useEffect(() => {
    setRoadNetworkPanelOpen?.(roadNetworkOpen)
    if (!roadNetworkOpen) {
      setRoadNetworkSelectedId?.(null)
      setRoadNetworkOverlayRows?.([])
      setSpatialDrawRequest?.(null)
      setSpatialFilterWkt?.(null)
      setRoadNetworkPointPickActive?.(false)
      setRoadNetworkDraftSitePoint?.(null)
      setRoadNetworkSitePointKind?.(null)
      setRoadNetworkEndpointMarkers?.(null)
      setRoadNetworkFocusedSitePointKey?.(null)
      if (mapContext?.roadNetworkPointPickRef) {
        mapContext.roadNetworkPointPickRef.current = null
      }
    }
  }, [
    roadNetworkOpen,
    setRoadNetworkPanelOpen,
    setRoadNetworkSelectedId,
    setRoadNetworkOverlayRows,
    setSpatialDrawRequest,
    setSpatialFilterWkt,
    setRoadNetworkPointPickActive,
    setRoadNetworkDraftSitePoint,
    setRoadNetworkSitePointKind,
    setRoadNetworkEndpointMarkers,
    setRoadNetworkFocusedSitePointKey,
    mapContext?.roadNetworkPointPickRef,
  ])

  useEffect(() => {
    setRiverConstructionLedgerPanelOpen?.(riverConstructionLedgerOpen)
    if (!riverConstructionLedgerOpen) {
      setRiverConstructionLedgerSelectedId?.(null)
      setRiverConstructionLedgerOverlayRows?.([])
      setRiverConstructionLedgerSelectedRiver?.(null)
      setRiverConstructionLedgerRiverFocus?.(null)
      setRiverConstructionLedgerGeomEditingId?.(null)
      setSpatialDrawRequest?.(null)
      setSpatialFilterWkt?.(null)
    }
  }, [
    riverConstructionLedgerOpen,
    setRiverConstructionLedgerPanelOpen,
    setRiverConstructionLedgerSelectedId,
    setRiverConstructionLedgerOverlayRows,
    setRiverConstructionLedgerSelectedRiver,
    setRiverConstructionLedgerRiverFocus,
    setRiverConstructionLedgerGeomEditingId,
    setSpatialDrawRequest,
    setSpatialFilterWkt,
  ])

  useEffect(() => {
    if (!roadLedgerOpen) {
      setRoadLedgerIdentifyRow?.(null)
      setRoadLedgerFacilityModal?.(null)
    }
  }, [roadLedgerOpen, setRoadLedgerIdentifyRow, setRoadLedgerFacilityModal])

  useEffect(() => {
    setRoadCctvPanelOpen?.(roadCctvOpen)
  }, [setRoadCctvPanelOpen, roadCctvOpen])

  useEffect(() => {
    if (!roadCctvOpen) {
      setRoadCctvOverlay?.(null)
      setRoadCctvUnderlayMode?.("traffic")
      setRoadCctvExtentWgs84?.(null)
      const id = ROAD_LEDGER_SUMMARY_LAYER_ID.toLowerCase()
      if (roadInfraOpen) {
        setVisibleLayerNames?.((prev) => {
          if (prev.has(id)) return prev
          return new Set(prev).add(id)
        })
      } else if (!roadLedgerOpen) {
        /** 도로대장 목록이 열려 있으면 RoadLedgerListPanel이 총괄 레이어를 관리하므로 건드리지 않음 */
        setVisibleLayerNames?.((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    }
  }, [
    roadCctvOpen,
    roadInfraOpen,
    roadLedgerOpen,
    setRoadCctvOverlay,
    setRoadCctvUnderlayMode,
    setRoadCctvExtentWgs84,
    setVisibleLayerNames,
  ])

  /** CCTV 전용 모드: 지도 식별·데이터조회 선택 상태 초기화 */
  useEffect(() => {
    if (!roadCctvOpen) return
    setIdentifyResultList?.(null)
    setIdentifySelectedRow?.(null)
  }, [roadCctvOpen, setIdentifyResultList, setIdentifySelectedRow])

  /** 시설관리 진입 시 도로대장 총괄(a0020000) 레이어 표시 — CCTV가 통행 모드일 때는 제외(배타) */
  useEffect(() => {
    if (!roadInfraOpen || !setVisibleLayerNames) return
    if (roadCctvOpen && roadCctvUnderlayMode === "traffic") return
    ensureRoadLedgerSummaryLayer({ setVisibleLayerNames })
  }, [roadInfraOpen, roadCctvOpen, roadCctvUnderlayMode, setVisibleLayerNames])

  /**
   * CCTV 패널: 통행 타일 vs 도로대장 총괄(a0020000) 배타.
   * 도로대장 목록 패널이 동시에 열려 있으면 총괄 레이어는 목록 패널이 유지하므로 여기서 제거하지 않음.
   */
  useEffect(() => {
    if (!roadCctvOpen || !setVisibleLayerNames) return
    const id = ROAD_LEDGER_SUMMARY_LAYER_ID.toLowerCase()
    if (roadCctvUnderlayMode === "roadLedgerSummary") {
      setVisibleLayerNames((prev) => {
        if (prev.has(id)) return prev
        return new Set(prev).add(id)
      })
    } else if (!roadLedgerOpen) {
      setVisibleLayerNames((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [roadCctvOpen, roadCctvUnderlayMode, roadLedgerOpen, setVisibleLayerNames])

  const handleCloseMap3dData = () => {
    const current = new URLSearchParams(Array.from(searchParams.entries()))
    const opened = openedWindows.filter((w) => w !== MAP_3D_DATA_OPENED_KEY)
    if (opened.length > 0) current.set("opened", opened.join(","))
    else current.delete("opened")
    router.push(`/map?${current.toString()}`)
  }

  type MapUrlUpdates = {
    opened?: string[]
    dataTable?: string | null
    dataKey?: string | number | null
  }

  const updateMapUrl = (updates: MapUrlUpdates) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()))
    if (updates.opened !== undefined) {
      if (updates.opened.length > 0) current.set("opened", updates.opened.join(","))
      else current.delete("opened")
    }
    if (updates.dataTable !== undefined) {
      if (updates.dataTable != null && updates.dataTable !== "") current.set("dataTable", updates.dataTable)
      else current.delete("dataTable")
    }
    if (updates.dataKey !== undefined) {
      if (updates.dataKey != null && updates.dataKey !== "") current.set("dataKey", String(updates.dataKey))
      else current.delete("dataKey")
    }
    router.push(`/map?${current.toString()}`)
  }

  const setOpened = (keys: string[]) => {
    updateMapUrl({ opened: keys })
  }

  const handleHideLayerList = () => {
    const next = openedWindows.filter((w) => w !== STANDARD_LIST_OPENED_KEY)
    setOpened(next)
  }

  const handleHideRiverBasicPlan = () => {
    const next = openedWindows.filter((w) => w !== RIVER_BASIC_PLAN_OPENED_KEY)
    setOpened(next)
    setSelectedRiverName("")
  }

  const handleHideRoadLedger = () => {
    mapContext?.setRoadLedgerIdentifyRow?.(null)
    mapContext?.setRoadLedgerFacilityModal?.(null)
    const next = openedWindows.filter((w) => w !== ROAD_LEDGER_OPENED_KEY)
    setOpened(next)
  }

  const handleHideRoadNetwork = () => {
    setRoadNetworkSelectedId?.(null)
    setRoadNetworkOverlayRows?.([])
    setSpatialDrawRequest?.(null)
    setSpatialFilterWkt?.(null)
    const next = openedWindows.filter((w) => w !== ROAD_NETWORK_OPENED_KEY)
    setOpened(next)
  }

  const handleCloseRoadUseLedger = () => {
    setRoadUseLedgerDetailId(null)
    const next = openedWindows.filter((w) => w !== ROAD_USE_LEDGER_OPENED_KEY)
    setOpened(next)
  }

  const handleCloseRiverUseLedger = () => {
    setRiverUseLedgerDetailId(null)
    const next = openedWindows.filter((w) => w !== RIVER_USE_LEDGER_OPENED_KEY)
    setOpened(next)
  }

  const handleCloseAerialManage = () => {
    const next = openedWindows.filter(
      (w) => !(AERIAL_MANAGE_KIND_KEYS as readonly string[]).includes(w)
    )
    setOpened(next)
  }

  const handleCloseShootingRequest = () => {
    setShootingRequestDetailId(null)
    setShootingRequestListMode('mine')
    const next = openedWindows.filter(
      (w) => !(SHOOTING_PANEL_KEYS as readonly string[]).includes(w)
    )
    setOpened(next)
  }

  const handleCloseRiverConstructionLedger = () => {
    setRiverConstructionLedgerSelectedId?.(null)
    setRiverConstructionLedgerSelectedRiver?.(null)
    setRiverConstructionLedgerRiverFocus?.(null)
    setRiverConstructionLedgerGeomEditingId?.(null)
    setRiverConstructionLedgerOverlayRows?.([])
    setSpatialDrawRequest?.(null)
    setSpatialFilterWkt?.(null)
    const next = openedWindows.filter((w) => w !== RIVER_CONSTRUCTION_LEDGER_OPENED_KEY)
    setOpened(next)
  }

  const handleCloseUsageDataAs = () => {
    setUsageDataAsDetailId(null)
    const next = openedWindows.filter((w) => w !== USAGE_DATA_AS_OPENED_KEY)
    setOpened(next)
  }

  const handleCloseOccupationLedger = () => {
    setOccupationLedgerDetailId(null)
    const next = openedWindows.filter((w) => !isOccupationLedgerOpenedToken(w))
    setOpened(next)
  }

  const handleCloseRoadReward = () => {
    setRoadRewardSelectedId(null)
    const next = openedWindows.filter((w) => w !== ROAD_REWARD_OPENED_KEY)
    setOpened(next)
  }

  const handleCloseMemoManagement = () => {
    setMemoDetailId(null)
    const next = openedWindows.filter((w) => w !== MEMO_OPENED_KEY)
    setOpened(next)
  }

  const handleCloseBuildPublicLand = () => {
    setBuildPublicLandSelectedId(null)
    const next = openedWindows.filter((w) => w !== BUILD_PUBLIC_LAND_OPENED_KEY)
    setOpened(next)
  }

  // const handleCloseUseLedgerProto = () => { ... } // 점용대장(프) 더미 비활성

  const handleCloseUseFee = () => {
    setUseFeeDetailId(null)
    const next = openedWindows.filter((w) => w !== USE_FEE_OPENED_KEY)
    setOpened(next)
  }

  const handleCloseGroundwaterPermit = () => {
    setGroundwaterPermitDetailId(null)
    const next = openedWindows.filter((w) => w !== GROUNDWATER_PERMIT_OPENED_KEY)
    setOpened(next)
  }

  useEffect(() => {
    if (!roadUseLedgerOpen) setRoadUseLedgerDetailId(null)
  }, [roadUseLedgerOpen])

  useEffect(() => {
    if (
      roadNetworkOpen &&
      mapContext?.roadNetworkSelectedId &&
      !(mapContext.roadNetworkRows ?? []).some((r) => r.id === mapContext.roadNetworkSelectedId)
    ) {
      setRoadNetworkSelectedId?.(null)
    }
  }, [
    roadNetworkOpen,
    mapContext?.roadNetworkSelectedId,
    mapContext?.roadNetworkRows,
    setRoadNetworkSelectedId,
  ])

  useEffect(() => {
    if (!riverUseLedgerOpen) setRiverUseLedgerDetailId(null)
  }, [riverUseLedgerOpen])

  useEffect(() => {
    if (
      riverConstructionLedgerOpen &&
      mapContext?.riverConstructionLedgerSelectedId &&
      !(mapContext.riverConstructionLedgerRows ?? []).some(
        (r) => r.id === mapContext.riverConstructionLedgerSelectedId
      )
    ) {
      setRiverConstructionLedgerSelectedId?.(null)
    }
  }, [
    riverConstructionLedgerOpen,
    mapContext?.riverConstructionLedgerSelectedId,
    mapContext?.riverConstructionLedgerRows,
    setRiverConstructionLedgerSelectedId,
  ])

  useEffect(() => {
    if (!usageDataAsOpen) setUsageDataAsDetailId(null)
  }, [usageDataAsOpen])

  useEffect(() => {
    if (!occupationLedgerOpen) setOccupationLedgerDetailId(null)
  }, [occupationLedgerOpen])

  useEffect(() => {
    setOccupationLedgerDetailId(null)
  }, [occupationLedgerSerEng])

  useEffect(() => {
    if (!roadRewardOpen) setRoadRewardSelectedId(null)
  }, [roadRewardOpen])

  // 점용대장(프) 더미 effects 비활성
  // useEffect(() => { if (!useLedgerProtoOpen) { setUseLedgerProtoDetailId(null); setUseLedgerProtoFeeId(null) } }, [useLedgerProtoOpen])
  // useEffect(() => { if (useLedgerProtoOpen) setUseLedgerProtoPanelWidth(...) }, [useLedgerProtoOpen])
  // useEffect(() => { if (useLedgerProtoDetailOpen) setUseLedgerProtoDetailWidth(...) }, [useLedgerProtoDetailOpen])
  // useEffect(() => { if (useLedgerProtoFeeDetailOpen) setUseLedgerProtoFeeWidth(...) }, [useLedgerProtoFeeDetailOpen])
  // useEffect(() => { ... map resize when proto fee open ... }, [...])

  useEffect(() => {
    if (!useFeeOpen) {
      setUseFeeDetailId(null)
      return
    }
    setUseFeePanelWidth(USE_FEE_PANEL_DEFAULT_WIDTH)
  }, [useFeeOpen])

  useEffect(() => {
    if (useFeeDetailOpen) {
      setUseFeeDetailWidth(USE_FEE_DETAIL_DEFAULT_WIDTH)
    }
  }, [useFeeDetailOpen])

  useEffect(() => {
    if (!groundwaterPermitOpen) setGroundwaterPermitDetailId(null)
  }, [groundwaterPermitOpen])

  useEffect(() => {
    const onToggle = () => {
      setProtoUserAccountOpen((v) => !v)
    }
    const onOpenNotif = () => {
      setProtoUserAccountOpen(true)
    }
    window.addEventListener('ggnr-proto-user-account-toggle', onToggle)
    window.addEventListener('ggnr-proto-user-account-open-notif', onOpenNotif)
    return () => {
      window.removeEventListener('ggnr-proto-user-account-toggle', onToggle)
      window.removeEventListener('ggnr-proto-user-account-open-notif', onOpenNotif)
    }
  }, [])

  useEffect(() => {
    if (!memoManagementOpen) setMemoDetailId(null)
  }, [memoManagementOpen])

  useEffect(() => {
    if (!shootingPanelOpen) {
      setShootingRequestDetailId(null)
      setShootingRequestListMode('mine')
      return
    }
    if (shootingApprovalOpen) {
      setShootingRequestListMode('approval')
    } else if (shootingRequestOpen) {
      setShootingRequestListMode('mine')
    }
  }, [shootingPanelOpen, shootingApprovalOpen, shootingRequestOpen])

  useEffect(() => {
    if (!shootingRequestOpen) return
    if (searchParams.get('shotForm') !== 'new') return
    setShootingRequestListMode('mine')
    setShootingRequestDetailId(SHOOTING_REQUEST_NEW_ID)
    const current = new URLSearchParams(Array.from(searchParams.entries()))
    current.delete('shotForm')
    router.replace(`/map?${current.toString()}`)
  }, [shootingRequestOpen, searchParams, router])

  const openShootingRequestForm = useCallback(() => {
    const current = new URLSearchParams(Array.from(searchParams.entries()))
    current.set('opened', SHOOTING_REQUEST_OPENED_KEY)
    current.set('shotForm', 'new')
    router.push(`/map?${current.toString()}`)
  }, [router, searchParams])

  /** 승인 건 → 촬영형태에 맞는 영상관리 + 활성 신청 연결 */
  const openMediaRegisterFromRequest = useCallback(
    (requestId: string) => {
      const req = findShootingRequest(requestId)
      if (!req) return
      const started = beginMediaRegistration(requestId)
      if (!started) return

      setShootingRequestDetailId(null)

      const kindKey = aerialKindToOpenedKey(shootTypeToAerialKind(req.shootType))
      const next = openedWindows.filter(
        (w) =>
          !(SHOOTING_PANEL_KEYS as readonly string[]).includes(w) &&
          !(AERIAL_MANAGE_KIND_KEYS as readonly string[]).includes(w) &&
          w !== AERIAL_VIEW_OPENED_KEY
      )
      next.push(kindKey)
      setOpened(next)
    },
    [openedWindows]
  )

  useEffect(() => {
    if (!buildPublicLandOpen) setBuildPublicLandSelectedId(null)
  }, [buildPublicLandOpen])

  const handleCloseSafetyMap = () => {
    const next = openedWindows.filter((w) => w !== SAFETY_MAP_OPENED_KEY)
    setOpened(next)
  }

  const handleCloseSafetyInfo = () => {
    const next = openedWindows.filter((w) => w !== SAFETY_INFO_OPENED_KEY)
    setOpened(next)
  }

  const handleCloseSafetyWater = () => {
    setSafetyWaterStatsKinds([])
    const next = openedWindows.filter((w) => w !== SAFETY_WATER_OPENED_KEY)
    setOpened(next)
  }

  useEffect(() => {
    if (!safetyWaterOpen) setSafetyWaterStatsKinds([])
  }, [safetyWaterOpen])

  const handleCloseSafetyFac = () => {
    const next = openedWindows.filter((w) => w !== SAFETY_FAC_OPENED_KEY)
    setOpened(next)
  }

  const handleCloseSafetyHospitalBed = () => {
    const next = openedWindows.filter((w) => w !== SAFETY_HOSPITAL_BED_OPENED_KEY)
    setOpened(next)
  }

  const handleCloseJsjWaterLevel = () => {
    const next = openedWindows.filter((w) => w !== JSJ_WATER_LEVEL_OPENED_KEY)
    setOpened(next)
  }

  const handleCloseRoadDoc = () => {
    const next = openedWindows.filter((w) => w !== ROAD_DOC_OPENED_KEY)
    setOpened(next)
  }

  const handleCloseRoadCctv = () => {
    const next = openedWindows.filter((w) => w !== ROAD_CCTV_OPENED_KEY)
    setOpened(next)
  }

  const handleCloseRoadInfra = () => {
    const next = openedWindows.filter((w) => w !== ROAD_INFRA_OPENED_KEY)
    setOpened(next)
  }

  const handleOpenDataPanel = useCallback(
    (tableName: string) => {
      const rawOpened = searchParams.get("opened")?.split(",").filter(Boolean) || []
      const opened = rawOpened.map((w) => (w === "dataQuery" ? STANDARD_LIST_OPENED_KEY : w))
      const nextOpened = opened.includes(LIST_VIEW_OPENED_KEY) ? opened : [...opened, LIST_VIEW_OPENED_KEY]
      const current = new URLSearchParams(Array.from(searchParams.entries()))
      if (nextOpened.length > 0) current.set("opened", nextOpened.join(","))
      else current.delete("opened")
      if (tableName) current.set("dataTable", tableName)
      else current.delete("dataTable")
      current.delete("dataKey")
      router.push(`/map?${current.toString()}`)
    },
    [searchParams, router]
  )

  const handleClearDataSelection = useCallback(() => {
    const rawOpened = searchParams.get("opened")?.split(",").filter(Boolean) || []
    const opened = rawOpened.map((w) => (w === "dataQuery" ? STANDARD_LIST_OPENED_KEY : w))
    const next = opened.filter((w) => w !== LIST_VIEW_OPENED_KEY)
    const current = new URLSearchParams(Array.from(searchParams.entries()))
    if (next.length > 0) current.set("opened", next.join(","))
    else current.delete("opened")
    current.delete("dataTable")
    current.delete("dataKey")
    router.push(`/map?${current.toString()}`)
  }, [searchParams, router])

  const handleDataKeyChange = (keyValue: string | number | null) => {
    updateMapUrl({ dataKey: keyValue })
  }

  const handleCloseDataPanel = () => {
    const next = openedWindows.filter((w) => w !== LIST_VIEW_OPENED_KEY)
    updateMapUrl({ opened: next, dataTable: null, dataKey: null })
    mapContext?.setIdentifyResultList?.(null)
  }

  return (
    <SearchBarOffsetContext.Provider value={searchBarOffset}>
      <div className="relative w-full h-screen overflow-hidden bg-slate-100">
        {mapContext?.layerRowGeomEdit && (
          <div
            className="pointer-events-none fixed inset-0 z-[100] box-border border-2 border-red-500"
            aria-hidden
          />
        )}
        <div className="absolute inset-0 z-0">{children}</div>

        <MapSidebar indexLogoSrc={indexLogoSrc} />
        <UsageDataAsNotifBootstrap />
        <RoadDataFlowAnalysisOrchestrator />
        <ParcelAnalysisOrchestrator />

        <div className="relative z-10 pl-[65px] flex h-full pointer-events-none">
          {roadInfraOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={roadInfraPanelWidth}
                minWidth={ROAD_INFRA_PANEL_MIN_WIDTH}
                maxWidth={ROAD_INFRA_PANEL_MAX_WIDTH}
                leftOffsetPx={roadInfraPanelLeftPx}
                onWidthChange={setRoadInfraPanelWidth}
                className="shadow-none"
              >
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 shrink-0 bg-white">
                    <span className="text-sm font-semibold text-slate-800">시설관리</span>
                    <button
                      type="button"
                      onClick={handleCloseRoadInfra}
                      className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                      title="닫기"
                      aria-label="닫기"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    <RoadInfraPanel
                      activeTableName={dataTableFromUrl}
                      onOpenDataPanel={handleOpenDataPanel}
                      onClearDataSelection={handleClearDataSelection}
                    />
                  </div>
                </div>
              </MapSideListPanel>
            </div>
          )}
          {parcelAnalysisOpen && parcelAnalysisSidePanelOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={parcelAnalysisPanelWidth}
                minWidth={PARCEL_ANALYSIS_PANEL_MIN_WIDTH}
                maxWidth={PARCEL_ANALYSIS_PANEL_MAX_WIDTH}
                leftOffsetPx={parcelAnalysisPanelLeftPx}
                onWidthChange={setParcelAnalysisPanelWidth}
              >
                <ParcelAnalysisMapSidePanel />
              </MapSideListPanel>
            </div>
          )}
          {layerListVisible && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={standardListPanelWidth}
                minWidth={STANDARD_LIST_MIN_WIDTH}
                maxWidth={STANDARD_LIST_MAX_WIDTH}
                leftOffsetPx={standardListLeftPx}
                onWidthChange={setStandardListPanelWidth}
              >
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 shrink-0 bg-white">
                    <span className="text-sm font-semibold text-slate-800">레이어 목록</span>
                    <button
                      type="button"
                      onClick={handleHideLayerList}
                      className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                      title="닫기"
                      aria-label="닫기"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    <StandardList
                      activeTableName={dataTableFromUrl}
                      onOpenDataPanel={handleOpenDataPanel}
                      onClearDataSelection={handleClearDataSelection}
                    />
                  </div>
                </div>
              </MapSideListPanel>
            </div>
          )}
          {layerDataPanelOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={layerDataPanelWidth}
                minWidth={LAYER_DATA_PANEL_MIN_WIDTH}
                maxWidth={LAYER_DATA_PANEL_MAX_WIDTH}
                leftOffsetPx={layerDataPanelLeftPx}
                onWidthChange={setLayerDataPanelWidth}
              >
                <LayerDataPanel
                  dataTable={dataTableFromUrl}
                  onClose={handleCloseDataPanel}
                  onDataKeyChange={handleDataKeyChange}
                  initialDataKey={dataKeyFromUrl || undefined}
                  useRoadLedgerFacilityListColumns={roadInfraOpen}
                />
              </MapSideListPanel>
            </div>
          )}
          {riverBasicPlanOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={riverBasicPlanListWidth}
                minWidth={RIVER_BASIC_PLAN_LIST_MIN_WIDTH}
                maxWidth={RIVER_BASIC_PLAN_LIST_MAX_WIDTH}
                leftOffsetPx={riverBasicPlanListLeftPx}
                onWidthChange={setRiverBasicPlanListWidth}
              >
                <RiverBasicPlanListPanel
                  tab={riverPlanTab}
                  onTabChange={(nextTab) => {
                    setRiverPlanTab(nextTab)
                    setSelectedRiverName("")
                  }}
                  selectedRiver={selectedRiverName}
                  onSelectRiver={setSelectedRiverName}
                  onClose={handleHideRiverBasicPlan}
                />
              </MapSideListPanel>
            </div>
          )}
          {riverBasicPlanOpen && selectedRiverName && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={riverBasicPlanDetailWidth}
                minWidth={RIVER_BASIC_PLAN_DETAIL_MIN_WIDTH}
                maxWidth={RIVER_BASIC_PLAN_DETAIL_MAX_WIDTH}
                leftOffsetPx={riverBasicPlanDetailLeftPx}
                onWidthChange={setRiverBasicPlanDetailWidth}
              >
                <RiverBasicPlanDetailPanel
                  tab={riverPlanTab}
                  riverName={selectedRiverName}
                  onClose={() => setSelectedRiverName("")}
                />
              </MapSideListPanel>
            </div>
          )}
          {roadLedgerOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={roadLedgerListWidth}
                minWidth={ROAD_LEDGER_LIST_MIN_WIDTH}
                maxWidth={ROAD_LEDGER_LIST_MAX_WIDTH}
                leftOffsetPx={roadLedgerListLeftPx}
                onWidthChange={setRoadLedgerListWidth}
              >
                <RoadLedgerListPanel onClose={handleHideRoadLedger} />
              </MapSideListPanel>
            </div>
          )}
          {roadLedgerOpen && mapContext?.roadLedgerIdentifyRow && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={roadLedgerDetailWidth}
                minWidth={ROAD_LEDGER_DETAIL_MIN_WIDTH}
                maxWidth={ROAD_LEDGER_DETAIL_MAX_WIDTH}
                leftOffsetPx={roadLedgerDetailLeftPx}
                onWidthChange={setRoadLedgerDetailWidth}
                contentClassName="overflow-y-auto overflow-x-hidden scrollbar-hide"
              >
                <RoadLedgerDetailPanel
                  row={mapContext.roadLedgerIdentifyRow}
                  onClose={() => mapContext?.setRoadLedgerIdentifyRow?.(null)}
                />
              </MapSideListPanel>
            </div>
          )}
          {roadNetworkOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={roadNetworkListWidth}
                minWidth={ROAD_NETWORK_LIST_MIN_WIDTH}
                maxWidth={ROAD_NETWORK_LIST_MAX_WIDTH}
                leftOffsetPx={roadNetworkListLeftPx}
                onWidthChange={setRoadNetworkListWidth}
              >
                <RoadNetworkListPanel onClose={handleHideRoadNetwork} />
              </MapSideListPanel>
            </div>
          )}
          {roadNetworkOpen && roadNetworkSelectedRow && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={roadNetworkDetailWidth}
                minWidth={ROAD_NETWORK_DETAIL_MIN_WIDTH}
                maxWidth={ROAD_NETWORK_DETAIL_MAX_WIDTH}
                leftOffsetPx={roadNetworkDetailLeftPx}
                onWidthChange={setRoadNetworkDetailWidth}
                contentClassName="overflow-hidden"
              >
                <RoadNetworkDetailPanel
                  row={roadNetworkSelectedRow}
                  onClose={() => setRoadNetworkSelectedId?.(null)}
                  overlayLeftPx={roadNetworkListLeftPx}
                  overlayWidthPx={
                    roadNetworkListWidth +
                    (roadNetworkDetailOpen ? roadNetworkDetailWidth : 0)
                  }
                />
              </MapSideListPanel>
            </div>
          )}
          {buildPublicLandOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={buildPublicLandPanelWidth}
                minWidth={BUILD_PUBLIC_LAND_PANEL_MIN_WIDTH}
                maxWidth={BUILD_PUBLIC_LAND_PANEL_MAX_WIDTH}
                leftOffsetPx={buildPublicLandPanelLeftPx}
                onWidthChange={setBuildPublicLandPanelWidth}
              >
                <BuildPublicLandListPanel
                  onClose={handleCloseBuildPublicLand}
                  selectedId={buildPublicLandSelectedId}
                  onSelectId={setBuildPublicLandSelectedId}
                  refreshKey={buildPublicLandListRefreshKey}
                  onAdd={() => setBuildPublicLandSelectedId(LAYER_ROW_NEW_ID)}
                />
              </MapSideListPanel>
            </div>
          )}
          {buildPublicLandOpen && buildPublicLandSelectedId && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={buildPublicLandDetailWidth}
                minWidth={BUILD_PUBLIC_LAND_DETAIL_MIN_WIDTH}
                maxWidth={BUILD_PUBLIC_LAND_DETAIL_MAX_WIDTH}
                leftOffsetPx={buildPublicLandDetailLeftPx}
                onWidthChange={setBuildPublicLandDetailWidth}
                contentClassName="overflow-y-auto overflow-x-hidden scrollbar-hide"
              >
                <BuildPublicLandDetailPanel
                  detailId={buildPublicLandSelectedId}
                  onClose={() => setBuildPublicLandSelectedId(null)}
                  onSaved={() => setBuildPublicLandListRefreshKey((k) => k + 1)}
                  onCreated={(newId) => {
                    setBuildPublicLandListRefreshKey((k) => k + 1)
                    setBuildPublicLandSelectedId(newId)
                  }}
                  onDeleted={() => {
                    setBuildPublicLandSelectedId(null)
                    setBuildPublicLandListRefreshKey((k) => k + 1)
                  }}
                />
              </MapSideListPanel>
            </div>
          )}
          {roadUseLedgerOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={roadUseLedgerPanelWidth}
                minWidth={ROAD_USE_LEDGER_PANEL_MIN_WIDTH}
                maxWidth={ROAD_USE_LEDGER_PANEL_MAX_WIDTH}
                leftOffsetPx={roadUseLedgerPanelLeftPx}
                onWidthChange={setRoadUseLedgerPanelWidth}
              >
                <RoadUseLedgerListPanel
                  onClose={handleCloseRoadUseLedger}
                  selectedDetailId={roadUseLedgerDetailId}
                  onSelectDetailId={setRoadUseLedgerDetailId}
                  refreshKey={roadUseLedgerListRefreshKey}
                  onAdd={() => setRoadUseLedgerDetailId(LAYER_ROW_NEW_ID)}
                />
              </MapSideListPanel>
            </div>
          )}
          {roadUseLedgerOpen && roadUseLedgerDetailId && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={roadUseLedgerDetailWidth}
                minWidth={ROAD_USE_LEDGER_DETAIL_MIN_WIDTH}
                maxWidth={ROAD_USE_LEDGER_DETAIL_MAX_WIDTH}
                leftOffsetPx={roadUseLedgerDetailLeftPx}
                onWidthChange={setRoadUseLedgerDetailWidth}
                contentClassName="overflow-y-auto overflow-x-hidden scrollbar-hide"
              >
                <RoadUseLedgerDetailPanel
                  detailId={roadUseLedgerDetailId}
                  onClose={() => setRoadUseLedgerDetailId(null)}
                  onSaved={() => setRoadUseLedgerListRefreshKey((k) => k + 1)}
                  onCreated={(newId) => {
                    setRoadUseLedgerListRefreshKey((k) => k + 1)
                    setRoadUseLedgerDetailId(newId)
                  }}
                  onDeleted={() => {
                    setRoadUseLedgerDetailId(null)
                    setRoadUseLedgerListRefreshKey((k) => k + 1)
                  }}
                />
              </MapSideListPanel>
            </div>
          )}
          {riverUseLedgerOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={riverUseLedgerPanelWidth}
                minWidth={RIVER_USE_LEDGER_PANEL_MIN_WIDTH}
                maxWidth={RIVER_USE_LEDGER_PANEL_MAX_WIDTH}
                leftOffsetPx={riverUseLedgerPanelLeftPx}
                onWidthChange={setRiverUseLedgerPanelWidth}
              >
                <RiverUseLedgerListPanel
                  onClose={handleCloseRiverUseLedger}
                  selectedDetailId={riverUseLedgerDetailId}
                  onSelectDetailId={setRiverUseLedgerDetailId}
                  refreshKey={riverUseLedgerListRefreshKey}
                  onAdd={() => setRiverUseLedgerDetailId(LAYER_ROW_NEW_ID)}
                />
              </MapSideListPanel>
            </div>
          )}
          {riverUseLedgerOpen && riverUseLedgerDetailId && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={riverUseLedgerDetailWidth}
                minWidth={RIVER_USE_LEDGER_DETAIL_MIN_WIDTH}
                maxWidth={RIVER_USE_LEDGER_DETAIL_MAX_WIDTH}
                leftOffsetPx={riverUseLedgerDetailLeftPx}
                onWidthChange={setRiverUseLedgerDetailWidth}
                contentClassName="overflow-y-auto overflow-x-hidden scrollbar-hide"
              >
                <RiverUseLedgerDetailPanel
                  detailId={riverUseLedgerDetailId}
                  onClose={() => setRiverUseLedgerDetailId(null)}
                  onSaved={() => setRiverUseLedgerListRefreshKey((k) => k + 1)}
                  onCreated={(newId) => {
                    setRiverUseLedgerListRefreshKey((k) => k + 1)
                    setRiverUseLedgerDetailId(newId)
                  }}
                  onDeleted={() => {
                    setRiverUseLedgerDetailId(null)
                    setRiverUseLedgerListRefreshKey((k) => k + 1)
                  }}
                />
              </MapSideListPanel>
            </div>
          )}
          {aerialManageOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={aerialManagePanelWidth}
                minWidth={AERIAL_MANAGE_PANEL_MIN_WIDTH}
                maxWidth={AERIAL_MANAGE_PANEL_MAX_WIDTH}
                leftOffsetPx={aerialManagePanelLeftPx}
                onWidthChange={setAerialManagePanelWidth}
                className="transition-[width] duration-200 ease-out"
                contentClassName="overflow-hidden"
              >
                <AerialManagePanel
                  kind={aerialManageKind}
                  onClose={handleCloseAerialManage}
                  onContentWidthChange={(w) => {
                    setAerialManagePanelWidth(
                      Math.min(
                        AERIAL_MANAGE_PANEL_MAX_WIDTH,
                        Math.max(AERIAL_MANAGE_PANEL_MIN_WIDTH, w)
                      )
                    )
                  }}
                />
              </MapSideListPanel>
            </div>
          )}
          {shootingListOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={shootingRequestPanelWidth}
                minWidth={SHOOTING_REQUEST_PANEL_MIN_WIDTH}
                maxWidth={SHOOTING_REQUEST_PANEL_MAX_WIDTH}
                leftOffsetPx={shootingRequestPanelLeftPx}
                onWidthChange={setShootingRequestPanelWidth}
                contentClassName="overflow-hidden"
              >
                <ShootingRequestPanel
                  onClose={handleCloseShootingRequest}
                  selectedDetailId={shootingRequestDetailId}
                  onSelectDetailId={setShootingRequestDetailId}
                  listMode={shootingRequestListMode}
                  onListModeChange={setShootingRequestListMode}
                  hideModeTabs
                />
              </MapSideListPanel>
            </div>
          )}
          {shootingPanelOpen &&
            shootingRequestDetailId &&
            shootingRequestDetailId !== SHOOTING_REQUEST_NEW_ID && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={shootingRequestDetailWidth}
                minWidth={SHOOTING_REQUEST_DETAIL_MIN_WIDTH}
                maxWidth={SHOOTING_REQUEST_DETAIL_MAX_WIDTH}
                leftOffsetPx={shootingRequestDetailLeftPx}
                onWidthChange={setShootingRequestDetailWidth}
                contentClassName="overflow-hidden"
              >
                <ShootingRequestDetailPanel
                  detailId={shootingRequestDetailId}
                  onClose={() => {
                    if (shootingRequestOpen) {
                      handleCloseShootingRequest()
                    } else {
                      setShootingRequestDetailId(null)
                    }
                  }}
                  onCreated={(newId) => setShootingRequestDetailId(newId)}
                  listMode={shootingRequestListMode}
                  onStartMediaRegister={
                    shootingRequestListMode === 'approval' ? openMediaRegisterFromRequest : undefined
                  }
                />
              </MapSideListPanel>
            </div>
          )}
          {riverConstructionLedgerOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={riverConstructionLedgerPanelWidth}
                minWidth={RIVER_CONSTRUCTION_LEDGER_PANEL_MIN_WIDTH}
                maxWidth={RIVER_CONSTRUCTION_LEDGER_PANEL_MAX_WIDTH}
                leftOffsetPx={riverConstructionLedgerPanelLeftPx}
                onWidthChange={setRiverConstructionLedgerPanelWidth}
              >
                <RiverConstructionLedgerListPanel onClose={handleCloseRiverConstructionLedger} />
              </MapSideListPanel>
            </div>
          )}
          {riverConstructionLedgerOpen && riverConstructionLedgerSelectedRow && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={riverConstructionLedgerDetailWidth}
                minWidth={RIVER_CONSTRUCTION_LEDGER_DETAIL_MIN_WIDTH}
                maxWidth={RIVER_CONSTRUCTION_LEDGER_DETAIL_MAX_WIDTH}
                leftOffsetPx={riverConstructionLedgerDetailLeftPx}
                onWidthChange={setRiverConstructionLedgerDetailWidth}
                contentClassName="overflow-hidden"
              >
                <RiverConstructionLedgerDetailPanel
                  row={riverConstructionLedgerSelectedRow}
                  onClose={() => {
                    setRiverConstructionLedgerRiverFocus?.(null)
                    setRiverConstructionLedgerGeomEditingId?.(null)
                    setRiverConstructionLedgerSelectedId?.(null)
                  }}
                />
              </MapSideListPanel>
            </div>
          )}
          {usageDataAsOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={usageDataAsPanelWidth}
                minWidth={USAGE_DATA_AS_PANEL_MIN_WIDTH}
                maxWidth={USAGE_DATA_AS_PANEL_MAX_WIDTH}
                leftOffsetPx={usageDataAsPanelLeftPx}
                onWidthChange={setUsageDataAsPanelWidth}
              >
                <UsageDataAsListPanel
                  onClose={handleCloseUsageDataAs}
                  selectedDetailId={usageDataAsDetailId}
                  onSelectDetailId={setUsageDataAsDetailId}
                  refreshKey={usageDataAsListRefreshKey}
                  onAdd={() => setUsageDataAsDetailId(LAYER_ROW_NEW_ID)}
                />
              </MapSideListPanel>
            </div>
          )}
          {usageDataAsOpen && usageDataAsDetailId && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={usageDataAsDetailWidth}
                minWidth={USAGE_DATA_AS_DETAIL_MIN_WIDTH}
                maxWidth={USAGE_DATA_AS_DETAIL_MAX_WIDTH}
                leftOffsetPx={usageDataAsDetailLeftPx}
                onWidthChange={setUsageDataAsDetailWidth}
                contentClassName="overflow-y-auto overflow-x-hidden scrollbar-hide"
              >
                <UsageDataAsDetailPanel
                  detailId={usageDataAsDetailId}
                  onClose={() => setUsageDataAsDetailId(null)}
                  onSaved={() => setUsageDataAsListRefreshKey((k) => k + 1)}
                  onCreated={(newKey) => {
                    setUsageDataAsListRefreshKey((k) => k + 1)
                    setUsageDataAsDetailId(newKey)
                  }}
                  onDeleted={() => {
                    setUsageDataAsDetailId(null)
                    setUsageDataAsListRefreshKey((k) => k + 1)
                  }}
                />
              </MapSideListPanel>
            </div>
          )}
          {occupationLedgerOpen && occupationLedgerSerEng && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={occupationLedgerPanelWidth}
                minWidth={OCCUPATION_LEDGER_PANEL_MIN_WIDTH}
                maxWidth={OCCUPATION_LEDGER_PANEL_MAX_WIDTH}
                leftOffsetPx={occupationLedgerPanelLeftPx}
                onWidthChange={setOccupationLedgerPanelWidth}
              >
                <OccupationLedgerListPanel
                  serEng={occupationLedgerSerEng}
                  onClose={handleCloseOccupationLedger}
                  selectedDetailId={occupationLedgerDetailId}
                  onSelectDetailId={setOccupationLedgerDetailId}
                  refreshKey={occupationLedgerListRefreshKey}
                  onAdd={() => setOccupationLedgerDetailId(LAYER_ROW_NEW_ID)}
                />
              </MapSideListPanel>
            </div>
          )}
          {occupationLedgerOpen && occupationLedgerSerEng && occupationLedgerDetailId && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={occupationLedgerDetailWidth}
                minWidth={OCCUPATION_LEDGER_DETAIL_MIN_WIDTH}
                maxWidth={OCCUPATION_LEDGER_DETAIL_MAX_WIDTH}
                leftOffsetPx={occupationLedgerDetailLeftPx}
                onWidthChange={setOccupationLedgerDetailWidth}
                contentClassName="overflow-y-auto overflow-x-hidden scrollbar-hide"
              >
                <OccupationLedgerDetailPanel
                  detailId={occupationLedgerDetailId}
                  serEng={occupationLedgerSerEng}
                  onClose={() => setOccupationLedgerDetailId(null)}
                  onSaved={() => setOccupationLedgerListRefreshKey((k) => k + 1)}
                  onCreated={(newKey) => {
                    setOccupationLedgerListRefreshKey((k) => k + 1)
                    setOccupationLedgerDetailId(newKey)
                  }}
                  onDeleted={() => {
                    setOccupationLedgerDetailId(null)
                    setOccupationLedgerListRefreshKey((k) => k + 1)
                  }}
                />
              </MapSideListPanel>
            </div>
          )}
          {roadRewardOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={roadRewardPanelWidth}
                minWidth={ROAD_REWARD_PANEL_MIN_WIDTH}
                maxWidth={ROAD_REWARD_PANEL_MAX_WIDTH}
                leftOffsetPx={roadRewardPanelLeftPx}
                onWidthChange={setRoadRewardPanelWidth}
              >
                <RoadRewardListPanel
                  cases={roadRewardCases}
                  selectedId={roadRewardSelectedId}
                  onCasesChange={setRoadRewardCases}
                  onSelectId={setRoadRewardSelectedId}
                  onClose={handleCloseRoadReward}
                />
              </MapSideListPanel>
            </div>
          )}
          {roadRewardOpen && roadRewardSelectedId && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={roadRewardDetailWidth}
                minWidth={ROAD_REWARD_DETAIL_MIN_WIDTH}
                maxWidth={ROAD_REWARD_DETAIL_MAX_WIDTH}
                leftOffsetPx={roadRewardDetailLeftPx}
                onWidthChange={setRoadRewardDetailWidth}
                contentClassName="overflow-y-auto overflow-x-hidden scrollbar-hide"
              >
                <RoadRewardDetailPanel
                  caseId={roadRewardSelectedId}
                  cases={roadRewardCases}
                  onCasesChange={setRoadRewardCases}
                  onClose={() => setRoadRewardSelectedId(null)}
                  onDeleted={() => setRoadRewardSelectedId(null)}
                  onCaseIdChange={setRoadRewardSelectedId}
                  overlayLeftPx={roadRewardPanelLeftPx}
                  overlayWidthPx={
                    roadRewardPanelWidth + (roadRewardDetailOpen ? roadRewardDetailWidth : 0)
                  }
                />
              </MapSideListPanel>
            </div>
          )}
          <ShootingRequestFormModal
            open={
              SHOOTING_REQUEST_UI_ENABLED &&
              (myInfoShootingModalId != null ||
                (shootingPanelOpen && shootingRequestDetailId === SHOOTING_REQUEST_NEW_ID))
            }
            detailId={
              myInfoShootingModalId ??
              (shootingRequestDetailId === SHOOTING_REQUEST_NEW_ID
                ? SHOOTING_REQUEST_NEW_ID
                : null)
            }
            onOpenChange={(o) => {
              if (o) return
              if (myInfoShootingModalId != null) {
                setMyInfoShootingModalId(null)
                return
              }
              if (shootingRequestOpen) {
                handleCloseShootingRequest()
              } else {
                setShootingRequestDetailId(null)
              }
            }}
            onCreated={(newId) => setShootingRequestDetailId(newId)}
          />
          {memoManagementOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={memoPanelWidth}
                minWidth={MEMO_PANEL_MIN_WIDTH}
                maxWidth={MEMO_PANEL_MAX_WIDTH}
                leftOffsetPx={memoPanelLeftPx}
                onWidthChange={setMemoPanelWidth}
              >
                <MemoListPanel
                  onClose={handleCloseMemoManagement}
                  selectedDetailId={memoDetailId}
                  onSelectDetailId={setMemoDetailId}
                  refreshKey={memoListRefreshKey}
                />
              </MapSideListPanel>
            </div>
          )}
          {memoManagementOpen && memoDetailId && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={memoDetailWidth}
                minWidth={MEMO_DETAIL_MIN_WIDTH}
                maxWidth={MEMO_DETAIL_MAX_WIDTH}
                leftOffsetPx={memoDetailLeftPx}
                onWidthChange={setMemoDetailWidth}
                contentClassName="overflow-y-auto overflow-x-hidden scrollbar-hide"
              >
                <MemoDetailPanel
                  detailId={memoDetailId}
                  onClose={() => setMemoDetailId(null)}
                  onSaved={() => setMemoListRefreshKey((k) => k + 1)}
                  onCreated={(newRowKey) => {
                    setMemoListRefreshKey((k) => k + 1)
                    setMemoDetailId(newRowKey)
                  }}
                  onDeleted={() => {
                    setMemoDetailId(null)
                    setMemoListRefreshKey((k) => k + 1)
                  }}
                />
              </MapSideListPanel>
            </div>
          )}
          {complaintManagementOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={complaintPanelWidth}
                minWidth={COMPLAINT_PANEL_MIN_WIDTH}
                maxWidth={COMPLAINT_PANEL_MAX_WIDTH}
                leftOffsetPx={complaintPanelLeftPx}
                onWidthChange={setComplaintPanelWidth}
              >
                <ComplaintListPanel refreshKey={complaintListRefreshKey} />
              </MapSideListPanel>
            </div>
          )}
          {map3dDataOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={map3dDataPanelWidth}
                minWidth={MAP_3D_DATA_PANEL_MIN_WIDTH}
                maxWidth={MAP_3D_DATA_PANEL_MAX_WIDTH}
                leftOffsetPx={map3dPanelLeftPx}
                onWidthChange={setMap3dDataPanelWidth}
              >
                <Map3DDataPanel onClose={handleCloseMap3dData} />
              </MapSideListPanel>
            </div>
          )}
          {safetyMapOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={safetyMapPanelWidth}
                minWidth={SAFETY_MAP_PANEL_MIN_WIDTH}
                maxWidth={SAFETY_MAP_PANEL_MAX_WIDTH}
                leftOffsetPx={safetyMapPanelLeftPx}
                onWidthChange={setSafetyMapPanelWidth}
              >
                <SafetyMapLayerPanel onClose={handleCloseSafetyMap} />
              </MapSideListPanel>
            </div>
          )}
          {safetyInfoOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={safetyInfoPanelWidth}
                minWidth={SAFETY_INFO_PANEL_MIN_WIDTH}
                maxWidth={SAFETY_INFO_PANEL_MAX_WIDTH}
                leftOffsetPx={safetyInfoPanelLeftPx}
                onWidthChange={setSafetyInfoPanelWidth}
              >
                <SafetyInfoLayerPanel onClose={handleCloseSafetyInfo} />
              </MapSideListPanel>
            </div>
          )}
          {safetyWaterOpen && (
            <SafetyWaterShell
              listLeftPx={safetyWaterPanelLeftPx}
              listWidth={safetyWaterPanelWidth}
              listMinWidth={SAFETY_WATER_PANEL_MIN_WIDTH}
              listMaxWidth={SAFETY_WATER_PANEL_MAX_WIDTH}
              onListWidthChange={setSafetyWaterPanelWidth}
              statsLeftPx={safetyWaterStatsLeftPx}
              statsWidth={safetyWaterStatsWidth}
              onStatsWidthChange={setSafetyWaterStatsWidth}
              statsMinWidth={SAFETY_WATER_STATS_MIN_WIDTH}
              statsMaxWidth={SAFETY_WATER_STATS_MAX_WIDTH}
              statsKinds={safetyWaterStatsKinds}
              onStatsKindsChange={setSafetyWaterStatsKinds}
              onClose={handleCloseSafetyWater}
            />
          )}
          {safetyFacOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={safetyFacPanelWidth}
                minWidth={SAFETY_FAC_PANEL_MIN_WIDTH}
                maxWidth={SAFETY_FAC_PANEL_MAX_WIDTH}
                leftOffsetPx={safetyFacPanelLeftPx}
                onWidthChange={setSafetyFacPanelWidth}
              >
                <SafetyFacPanel onClose={handleCloseSafetyFac} />
              </MapSideListPanel>
            </div>
          )}
          {safetyHospitalBedOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={safetyHospitalBedPanelWidth}
                minWidth={SAFETY_HOSPITAL_BED_PANEL_MIN_WIDTH}
                maxWidth={SAFETY_HOSPITAL_BED_PANEL_MAX_WIDTH}
                leftOffsetPx={safetyHospitalBedPanelLeftPx}
                onWidthChange={setSafetyHospitalBedPanelWidth}
              >
                <SafetyHospitalBadPanel onClose={handleCloseSafetyHospitalBed} />
              </MapSideListPanel>
            </div>
          )}
          {jsjWaterLevelOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={jsjReservoirPanelWidth}
                minWidth={JSJ_RESERVOIR_PANEL_MIN_WIDTH}
                maxWidth={JSJ_RESERVOIR_PANEL_MAX_WIDTH}
                leftOffsetPx={jsjReservoirPanelLeftPx}
                onWidthChange={setJsjReservoirPanelWidth}
              >
                <SafetyJsjReservoirPanel onClose={handleCloseJsjWaterLevel} />
              </MapSideListPanel>
            </div>
          )}
          {roadDocOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={roadDocPanelWidth}
                minWidth={ROAD_DOC_PANEL_MIN_WIDTH}
                maxWidth={ROAD_DOC_PANEL_MAX_WIDTH}
                leftOffsetPx={roadDocPanelLeftPx}
                onWidthChange={setRoadDocPanelWidth}
                contentClassName="overflow-y-auto overflow-x-hidden scrollbar-hide"
              >
                <RoadDocManualPanel onClose={handleCloseRoadDoc} />
              </MapSideListPanel>
            </div>
          )}
          {roadCctvOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={roadCctvPanelWidth}
                minWidth={ROAD_CCTV_PANEL_MIN_WIDTH}
                maxWidth={ROAD_CCTV_PANEL_MAX_WIDTH}
                leftOffsetPx={roadCctvPanelLeftPx}
                onWidthChange={setRoadCctvPanelWidth}
                contentClassName="overflow-hidden"
              >
                <RoadCctvPanel onClose={handleCloseRoadCctv} />
              </MapSideListPanel>
            </div>
          )}
          {/* 점용대장(프) 더미 패널 비활성 — UseLedgerProtoList/Detail + 연계 점사용료 */}
          {useFeeOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={useFeePanelWidth}
                minWidth={USE_FEE_PANEL_MIN_WIDTH}
                maxWidth={USE_FEE_PANEL_MAX_WIDTH}
                leftOffsetPx={useFeePanelLeftPx}
                onWidthChange={setUseFeePanelWidth}
              >
                <UseFeeListPanel
                  onClose={handleCloseUseFee}
                  selectedId={useFeeDetailId}
                  onSelectId={(id) => {
                    setUseFeeDetailId((prev) => (prev === id ? null : id))
                  }}
                />
              </MapSideListPanel>
            </div>
          )}
          {useFeeOpen && useFeeDetailId && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={useFeeDetailWidth}
                minWidth={USE_FEE_DETAIL_MIN_WIDTH}
                maxWidth={USE_FEE_DETAIL_MAX_WIDTH}
                leftOffsetPx={useFeeDetailLeftPx}
                onWidthChange={setUseFeeDetailWidth}
                contentClassName="overflow-hidden"
              >
                <UseFeeDetailPanel
                  detailId={useFeeDetailId}
                  onClose={() => setUseFeeDetailId(null)}
                />
              </MapSideListPanel>
            </div>
          )}
          {groundwaterPermitOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={groundwaterPermitPanelWidth}
                minWidth={GROUNDWATER_PERMIT_PANEL_MIN_WIDTH}
                maxWidth={GROUNDWATER_PERMIT_PANEL_MAX_WIDTH}
                leftOffsetPx={groundwaterPermitPanelLeftPx}
                onWidthChange={setGroundwaterPermitPanelWidth}
              >
                <GroundwaterPermitListPanel
                  onClose={handleCloseGroundwaterPermit}
                  selectedDetailId={groundwaterPermitDetailId}
                  onSelectDetailId={setGroundwaterPermitDetailId}
                />
              </MapSideListPanel>
            </div>
          )}
          {groundwaterPermitOpen && groundwaterPermitDetailId && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={groundwaterPermitDetailWidth}
                minWidth={GROUNDWATER_PERMIT_DETAIL_MIN_WIDTH}
                maxWidth={GROUNDWATER_PERMIT_DETAIL_MAX_WIDTH}
                leftOffsetPx={groundwaterPermitDetailLeftPx}
                onWidthChange={setGroundwaterPermitDetailWidth}
                contentClassName="overflow-hidden"
              >
                <GroundwaterPermitDetailPanel
                  detailId={groundwaterPermitDetailId}
                  onClose={() => setGroundwaterPermitDetailId(null)}
                />
              </MapSideListPanel>
            </div>
          )}
          <div className="flex-1 min-w-0 relative">
            <div className="pointer-events-auto">
              <MapSearchBar
                listPanelWidth={totalListPanelWidth}
                onInputBottomChange={setSearchBarInputBottomPx}
              />
            </div>
            <div className="absolute inset-0 pointer-events-none p-4">
              {riverBasicPlanOpen && <RiverBasicPlanMapDrawingFromMapHandler />}
              <RoadLedgerFacilityAttrModal
                overlayLeftPx={roadLedgerListLeftPx}
                overlayWidthPx={
                  roadLedgerListWidth +
                  (roadLedgerDetailOpen ? roadLedgerDetailWidth : 0)
                }
              />
              <StandardDetail />
              <ComplaintDetail
                onListRefresh={() => setComplaintListRefreshKey((k) => k + 1)}
              />
              <AddressInfoDetail />
            </div>
            <div className="pointer-events-auto">
              <UserAccountProtoPanel
                open={protoUserAccountOpen}
                onClose={() => setProtoUserAccountOpen(false)}
                onSelectShootingRequest={(id) => setMyInfoShootingModalId(id)}
                onOpenLedger={(ledgerId) => {
                  setOpened([USAGE_DATA_AS_OPENED_KEY])
                  setUsageDataAsDetailId(ledgerId)
                }}
                onOpenFee={(feeId) => {
                  setOpened([USE_FEE_OPENED_KEY])
                  setUseFeeDetailId(feeId)
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </SearchBarOffsetContext.Provider>
  )
}

export default function MapLayoutClient({
  children,
  indexLogoSrc,
}: {
  children: React.ReactNode
  indexLogoSrc: string
}) {
  return (
    <MapContextProvider>
      <ParcelAnalysisProvider>
        <Suspense fallback={<div className="relative w-full h-screen overflow-hidden bg-slate-100 pl-[65px]" />}>
          <MapLayoutContent indexLogoSrc={indexLogoSrc}>{children}</MapLayoutContent>
        </Suspense>
      </ParcelAnalysisProvider>
    </MapContextProvider>
  )
}
