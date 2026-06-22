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
import { SafetyMapLayerPanel } from "./_mapContents/safty/safetyMap/SafetyMapLayerPanel"
import { SafetyInfoLayerPanel } from "./_mapContents/safty/safetyInfo/SafetyInfoLayerPanel"
import { SafetyWaterPanel } from "./_mapContents/safty/safetyWater/SafetyWaterPanel"
import { SafetyFacPanel } from "./_mapContents/safty/safetyFac/SafetyFacPanel"
import { SafetyHospitalBadPanel } from "./_mapContents/safty/safetyHospitalBad/SafetyHospitalBadPanel"
import { SafetyJsjReservoirPanel } from "./_mapContents/safty/saftyJsj/SafetyJsjReservoirPanel"
import { RoadDocManualPanel } from "./_mapContents/road/roadDoc/roadDocManualPanel"
import { RoadCctvPanel } from "./_mapContents/road/roadCCTV/RoadCctvPanel"
import { RoadInfraPanel } from "./_mapContents/road/roadInfra/RoadInfraPanel"
import { RoadDataFlowAnalysisOrchestrator } from "./_mapContents/road/roadDataFlow/RoadDataFlowAnalysisOrchestrator"
import { RoadUseLedgerListPanel } from "./_mapContents/road/roadUseLedger/RoadUseLedgerListPanel"
import { RoadUseLedgerDetailPanel } from "./_mapContents/road/roadUseLedger/RoadUseLedgerDetailPanel"
import { RiverUseLedgerListPanel } from "./_mapContents/river/riverUseLedger/RiverUseLedgerListPanel"
import { RiverUseLedgerDetailPanel } from "./_mapContents/river/riverUseLedger/RiverUseLedgerDetailPanel"
import { BuildPublicLandListPanel } from "./_mapContents/buildPublicLand/BuildPublicLandListPanel"
import { BuildPublicLandDetailPanel } from "./_mapContents/buildPublicLand/BuildPublicLandDetailPanel"
import { LAYER_ROW_NEW_ID } from "./_mapComponents/layerRowEdit"
import { ROAD_LEDGER_SUMMARY_LAYER_ID } from "./_mapContents/road/roadLedger/roadLedgerDocLayerMap"
import {
  clearServiceMenuLayerState,
  ensureRoadLedgerSummaryLayer,
} from "@/lib/mapServiceMenuLayers"
import { MapSidebar } from "./_mapComponents/map-sidebar"
import { MapSearchBar } from "./_mapComponents/map-search-bar"
import { MapContextProvider, useMapContext } from "./_mapComponents/MapContext"
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

const SAFETY_MAP_PANEL_DEFAULT_WIDTH = 360
const SAFETY_MAP_PANEL_MIN_WIDTH = 280
const SAFETY_MAP_PANEL_MAX_WIDTH = 600

const SAFETY_INFO_PANEL_DEFAULT_WIDTH = 720
const SAFETY_INFO_PANEL_MIN_WIDTH = 560
const SAFETY_INFO_PANEL_MAX_WIDTH = 1200

const SAFETY_WATER_PANEL_DEFAULT_WIDTH = 360
const SAFETY_WATER_PANEL_MIN_WIDTH = 280
const SAFETY_WATER_PANEL_MAX_WIDTH = 600

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
const MAP_3D_DATA_OPENED_KEY = "map3dData"
const RIVER_BASIC_PLAN_OPENED_KEY = "riverBasicPlan"
const ROAD_LEDGER_OPENED_KEY = "roadLedger"
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

const RIVER_USE_LEDGER_PANEL_DEFAULT_WIDTH = 660
const RIVER_USE_LEDGER_PANEL_MIN_WIDTH = 480
const RIVER_USE_LEDGER_PANEL_MAX_WIDTH = 960
const RIVER_USE_LEDGER_DETAIL_DEFAULT_WIDTH = 400
const RIVER_USE_LEDGER_DETAIL_MIN_WIDTH = 320
const RIVER_USE_LEDGER_DETAIL_MAX_WIDTH = 640

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
  const setRiverBasicPlanPanelOpen = mapContext?.setRiverBasicPlanPanelOpen
  const setRiverBasicPlanSelectedRiver = mapContext?.setRiverBasicPlanSelectedRiver
  const setRoadLedgerPanelOpen = mapContext?.setRoadLedgerPanelOpen
  const setRoadLedgerIdentifyRow = mapContext?.setRoadLedgerIdentifyRow
  const setRoadLedgerFacilityModal = mapContext?.setRoadLedgerFacilityModal
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
  const map3dDataOpen = openedWindows.includes(MAP_3D_DATA_OPENED_KEY)
  const riverBasicPlanOpen = openedWindows.includes(RIVER_BASIC_PLAN_OPENED_KEY)
  const roadLedgerOpen = openedWindows.includes(ROAD_LEDGER_OPENED_KEY)
  const roadLedgerDetailOpen =
    roadLedgerOpen && Boolean(mapContext?.roadLedgerIdentifyRow)
  const safetyMapOpen = openedWindows.includes(SAFETY_MAP_OPENED_KEY)
  const safetyInfoOpen = openedWindows.includes(SAFETY_INFO_OPENED_KEY)
  const safetyWaterOpen = openedWindows.includes(SAFETY_WATER_OPENED_KEY)
  const safetyFacOpen = openedWindows.includes(SAFETY_FAC_OPENED_KEY)
  const safetyHospitalBedOpen = openedWindows.includes(SAFETY_HOSPITAL_BED_OPENED_KEY)
  const jsjWaterLevelOpen = openedWindows.includes(JSJ_WATER_LEVEL_OPENED_KEY)
  const roadDocOpen = openedWindows.includes(ROAD_DOC_OPENED_KEY)
  const roadCctvOpen = openedWindows.includes(ROAD_CCTV_OPENED_KEY)
  const roadInfraOpen = openedWindows.includes(ROAD_INFRA_OPENED_KEY)
  const buildPublicLandOpen = openedWindows.includes(BUILD_PUBLIC_LAND_OPENED_KEY)
  const roadUseLedgerOpen = openedWindows.includes(ROAD_USE_LEDGER_OPENED_KEY)
  const riverUseLedgerOpen = openedWindows.includes(RIVER_USE_LEDGER_OPENED_KEY)
  const [buildPublicLandSelectedId, setBuildPublicLandSelectedId] = useState<string | null>(null)
  const [buildPublicLandListRefreshKey, setBuildPublicLandListRefreshKey] = useState(0)
  const buildPublicLandDetailOpen = buildPublicLandOpen && Boolean(buildPublicLandSelectedId)
  const [roadUseLedgerDetailId, setRoadUseLedgerDetailId] = useState<string | null>(null)
  const [roadUseLedgerListRefreshKey, setRoadUseLedgerListRefreshKey] = useState(0)
  const roadUseLedgerDetailOpen = roadUseLedgerOpen && Boolean(roadUseLedgerDetailId)
  const [riverUseLedgerDetailId, setRiverUseLedgerDetailId] = useState<string | null>(null)
  const [riverUseLedgerListRefreshKey, setRiverUseLedgerListRefreshKey] = useState(0)
  const riverUseLedgerDetailOpen = riverUseLedgerOpen && Boolean(riverUseLedgerDetailId)
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
  const [safetyMapPanelWidth, setSafetyMapPanelWidth] = useState(SAFETY_MAP_PANEL_DEFAULT_WIDTH)
  const [safetyInfoPanelWidth, setSafetyInfoPanelWidth] = useState(SAFETY_INFO_PANEL_DEFAULT_WIDTH)
  const [safetyWaterPanelWidth, setSafetyWaterPanelWidth] = useState(SAFETY_WATER_PANEL_DEFAULT_WIDTH)
  const [safetyFacPanelWidth, setSafetyFacPanelWidth] = useState(SAFETY_FAC_PANEL_DEFAULT_WIDTH)
  const [safetyHospitalBedPanelWidth, setSafetyHospitalBedPanelWidth] = useState(
    SAFETY_HOSPITAL_BED_PANEL_DEFAULT_WIDTH
  )
  const [jsjReservoirPanelWidth, setJsjReservoirPanelWidth] = useState(JSJ_RESERVOIR_PANEL_DEFAULT_WIDTH)
  const [roadDocPanelWidth, setRoadDocPanelWidth] = useState(ROAD_DOC_PANEL_DEFAULT_WIDTH)
  const [roadCctvPanelWidth, setRoadCctvPanelWidth] = useState(ROAD_CCTV_PANEL_DEFAULT_WIDTH)
  const [roadInfraPanelWidth, setRoadInfraPanelWidth] = useState(ROAD_INFRA_PANEL_DEFAULT_WIDTH)
  const [buildPublicLandPanelWidth, setBuildPublicLandPanelWidth] = useState(BUILD_PUBLIC_LAND_PANEL_DEFAULT_WIDTH)
  const [buildPublicLandDetailWidth, setBuildPublicLandDetailWidth] = useState(BUILD_PUBLIC_LAND_DETAIL_DEFAULT_WIDTH)
  const [roadUseLedgerPanelWidth, setRoadUseLedgerPanelWidth] = useState(ROAD_USE_LEDGER_PANEL_DEFAULT_WIDTH)
  const [roadUseLedgerDetailWidth, setRoadUseLedgerDetailWidth] = useState(ROAD_USE_LEDGER_DETAIL_DEFAULT_WIDTH)
  const [riverUseLedgerPanelWidth, setRiverUseLedgerPanelWidth] = useState(RIVER_USE_LEDGER_PANEL_DEFAULT_WIDTH)
  const [riverUseLedgerDetailWidth, setRiverUseLedgerDetailWidth] = useState(RIVER_USE_LEDGER_DETAIL_DEFAULT_WIDTH)
  const [layerDataPanelWidth, setLayerDataPanelWidth] = useState(LAYER_DATA_PANEL_DEFAULT_WIDTH)
  const [searchBarInputBottomPx, setSearchBarInputBottomPx] = useState(16 + 30)

  /** 열린 MapSideListPanel 너비 합 → 검색창/레이어바 left 기준 (패널 추가 시 여기만 합산) */
  const totalListPanelWidth =
    (roadInfraOpen ? roadInfraPanelWidth : 0) +
    (layerListVisible ? standardListPanelWidth : 0) +
    (layerDataPanelOpen ? layerDataPanelWidth : 0) +
    (riverBasicPlanOpen ? riverBasicPlanListWidth : 0) +
    (riverBasicPlanOpen && selectedRiverName ? riverBasicPlanDetailWidth : 0) +
    (roadLedgerOpen ? roadLedgerListWidth : 0) +
    (roadLedgerDetailOpen ? roadLedgerDetailWidth : 0) +
    (buildPublicLandOpen ? buildPublicLandPanelWidth : 0) +
    (buildPublicLandDetailOpen ? buildPublicLandDetailWidth : 0) +
    (roadUseLedgerOpen ? roadUseLedgerPanelWidth : 0) +
    (roadUseLedgerDetailOpen ? roadUseLedgerDetailWidth : 0) +
    (riverUseLedgerOpen ? riverUseLedgerPanelWidth : 0) +
    (riverUseLedgerDetailOpen ? riverUseLedgerDetailWidth : 0) +
    (complaintManagementOpen ? complaintPanelWidth : 0) +
    (map3dDataOpen ? map3dDataPanelWidth : 0) +
    (safetyMapOpen ? safetyMapPanelWidth : 0) +
    (safetyInfoOpen ? safetyInfoPanelWidth : 0) +
    (safetyWaterOpen ? safetyWaterPanelWidth : 0) +
    (safetyFacOpen ? safetyFacPanelWidth : 0) +
    (safetyHospitalBedOpen ? safetyHospitalBedPanelWidth : 0) +
    (jsjWaterLevelOpen ? jsjReservoirPanelWidth : 0) +
    (roadDocOpen ? roadDocPanelWidth : 0) +
    (roadCctvOpen ? roadCctvPanelWidth : 0)
  const searchBarOffset = {
    leftPx: SIDEBAR_WIDTH + totalListPanelWidth + SEARCH_BAR_MARGIN,
    topPx: 16,
    inputBottomPx: searchBarInputBottomPx,
  }

  /** 패널별 왼쪽 경계(px). 드래그 시 해당 패널 너비 = clientX - leftOffset */
  const roadInfraPanelLeftPx = SIDEBAR_WIDTH
  const standardListLeftPx = SIDEBAR_WIDTH + (roadInfraOpen ? roadInfraPanelWidth : 0)
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
  const buildPublicLandPanelLeftPx = afterRoadLedgerPanelsLeftPx
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
  const complaintPanelLeftPx =
    riverUseLedgerDetailLeftPx + (riverUseLedgerDetailOpen ? riverUseLedgerDetailWidth : 0)
  const map3dPanelLeftPx = complaintPanelLeftPx + (complaintManagementOpen ? complaintPanelWidth : 0)
  const safetyMapPanelLeftPx = map3dPanelLeftPx + (map3dDataOpen ? map3dDataPanelWidth : 0)
  const safetyInfoPanelLeftPx = safetyMapPanelLeftPx + (safetyMapOpen ? safetyMapPanelWidth : 0)
  const safetyWaterPanelLeftPx = safetyInfoPanelLeftPx + (safetyInfoOpen ? safetyInfoPanelWidth : 0)
  const safetyFacPanelLeftPx = safetyWaterPanelLeftPx + (safetyWaterOpen ? safetyWaterPanelWidth : 0)
  const safetyHospitalBedPanelLeftPx =
    safetyFacPanelLeftPx + (safetyFacOpen ? safetyFacPanelWidth : 0)
  const jsjReservoirPanelLeftPx =
    safetyHospitalBedPanelLeftPx + (safetyHospitalBedOpen ? safetyHospitalBedPanelWidth : 0)
  const roadDocPanelLeftPx = jsjReservoirPanelLeftPx + (jsjWaterLevelOpen ? jsjReservoirPanelWidth : 0)
  const roadCctvPanelLeftPx = roadDocPanelLeftPx + (roadDocOpen ? roadDocPanelWidth : 0)

  const mapPaddingLeft = SIDEBAR_WIDTH + totalListPanelWidth
  /** 패딩은 useLayoutEffect — 자식 useEffect(도로대장 fit 등)보다 먼저 적용되어야 함 */
  useLayoutEffect(() => {
    const apply = () => {
      const map = mapInstanceRef?.current
      if (!map) return
      map.getView().padding = [0, 0, 0, mapPaddingLeft]
      setMapPaddingLeft?.(mapPaddingLeft)
    }
    if (applyMapViewPaddingRef) {
      applyMapViewPaddingRef.current = apply
    }
    apply()
    return () => {
      if (applyMapViewPaddingRef) applyMapViewPaddingRef.current = null
    }
  }, [applyMapViewPaddingRef, mapPaddingLeft, mapInstanceRef, setMapPaddingLeft])

  useEffect(() => {
    setRiverBasicPlanPanelOpen?.(riverBasicPlanOpen)
    setRiverBasicPlanSelectedRiver?.(selectedRiverName)
  }, [setRiverBasicPlanPanelOpen, setRiverBasicPlanSelectedRiver, riverBasicPlanOpen, selectedRiverName])

  useEffect(() => {
    setRoadLedgerPanelOpen?.(roadLedgerOpen)
  }, [setRoadLedgerPanelOpen, roadLedgerOpen])

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

  const handleCloseBuildPublicLand = () => {
    setBuildPublicLandSelectedId(null)
    const next = openedWindows.filter((w) => w !== BUILD_PUBLIC_LAND_OPENED_KEY)
    setOpened(next)
  }

  useEffect(() => {
    if (!roadUseLedgerOpen) setRoadUseLedgerDetailId(null)
  }, [roadUseLedgerOpen])

  useEffect(() => {
    if (!riverUseLedgerOpen) setRiverUseLedgerDetailId(null)
  }, [riverUseLedgerOpen])

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
    const next = openedWindows.filter((w) => w !== SAFETY_WATER_OPENED_KEY)
    setOpened(next)
  }

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
        <RoadDataFlowAnalysisOrchestrator />

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
          {complaintManagementOpen && (
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={complaintPanelWidth}
                minWidth={COMPLAINT_PANEL_MIN_WIDTH}
                maxWidth={COMPLAINT_PANEL_MAX_WIDTH}
                leftOffsetPx={complaintPanelLeftPx}
                onWidthChange={setComplaintPanelWidth}
              >
                <ComplaintListPanel />
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
            <div className="pointer-events-auto shrink-0">
              <MapSideListPanel
                width={safetyWaterPanelWidth}
                minWidth={SAFETY_WATER_PANEL_MIN_WIDTH}
                maxWidth={SAFETY_WATER_PANEL_MAX_WIDTH}
                leftOffsetPx={safetyWaterPanelLeftPx}
                onWidthChange={setSafetyWaterPanelWidth}
              >
                <SafetyWaterPanel onClose={handleCloseSafetyWater} />
              </MapSideListPanel>
            </div>
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
              <ComplaintDetail />
              <AddressInfoDetail />
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
      <Suspense fallback={<div className="relative w-full h-screen overflow-hidden bg-slate-100 pl-[65px]" />}>
        <MapLayoutContent indexLogoSrc={indexLogoSrc}>{children}</MapLayoutContent>
      </Suspense>
    </MapContextProvider>
  )
}
