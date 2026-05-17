"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, MapPinned, Search, X } from "lucide-react";
import { call } from "@/lib/api";

type StepStatus = "pass" | "conditional" | "fail";

type AnalysisStep = {
  key: string;
  title: string;
  status: StepStatus;
  items: string[];
  deadlineHint?: string;
  legalRefs: string[];
};

type AnalysisResponse = {
  summary: {
    judgement: "적합" | "조건부적합" | "불가";
    totalParcels: number;
    validParcels: number;
    invalidParcels: number;
    supplementCount: number;
    consultationCount: number;
  };
  validation: {
    invalidOccupancyParcels: string[];
    invalidPropertyParcels: string[];
  };
  steps: AnalysisStep[];
  fee: {
    baseFee: number;
    discountAmount: number;
    adjustedFee: number;
    installmentInterest: number;
    vat: number;
    finalFee: number;
  };
  error?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

type ApplicationType = "new" | "renew" | "change";
type OccupancyType = "general" | "pipeline" | "sign" | "construction" | "access" | "other";
type DiscountCategory =
  | "none"
  | "public"
  | "residential"
  | "smallBiz"
  | "publicProject"
  | "accessibility"
  | "donation"
  | "semiHousing"
  | "other";
type StepIndex = 1 | 2 | 3;
type OccupantType = "nationalLocal" | "private";

type FacilityMajorId =
  | "ground"
  | "underground"
  | "connection"
  | "rail"
  | "overUnder"
  | "ad"
  | "vendor"
  | "construction"
  | "underBridge"
  | "barrierFree"
  | "etc";

type FacilityFieldKey =
  | "count"
  | "area"
  | "diameter"
  | "length"
  | "depth"
  | "days"
  | "buildingFloors"
  | "buildingKind"
  | "parallelSpec"
  | "excavationLength"
  | "excavationWidth";

type FacilitySubType = {
  id: string;
  label: string;
  calcMethod: string;
  requiredFields: FacilityFieldKey[];
  unitRate: string;
  serviceOccupancyType: OccupancyType;
};

type FacilityMajor = {
  id: FacilityMajorId;
  label: string;
  legalBasis: string;
  subTypes: FacilitySubType[];
};

type ParcelCard = {
  address: string;
  landCategory: string;
  areaText: string;
  ownerType: string;
  landPriceText: string;
};

function formatWon(value: number): string {
  return `${Math.round(value).toLocaleString()}원`;
}

function statusLabel(status: StepStatus): string {
  if (status === "pass") return "통과";
  if (status === "conditional") return "보완";
  return "불가";
}

function statusClassName(status: StepStatus): string {
  if (status === "pass") return "bg-emerald-100 text-emerald-700";
  if (status === "conditional") return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

function parseParcelLines(raw: string): string[] {
  return raw
    .split(/[\n,]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function toServiceOccupancyType(value: OccupancyType): "general" | "excavation" | "connection" {
  if (value === "pipeline" || value === "construction") return "excavation";
  if (value === "access") return "connection";
  return "general";
}

function toServiceApplicationType(value: ApplicationType): "new" | "change" | "extend" {
  if (value === "renew") return "extend";
  return value;
}

function toServiceDiscountCategory(value: DiscountCategory): "none" | "public" | "residential" | "smallBiz" {
  if (value === "public" || value === "publicProject" || value === "accessibility" || value === "donation") return "public";
  if (value === "residential") return "residential";
  if (value === "smallBiz") return "smallBiz";
  return "none";
}

function buildMockParcelCard(address: string): ParcelCard {
  const seed = Math.max(1, address.length % 9);
  const area = (420 + seed * 17).toLocaleString();
  const price = (265000 + seed * 3600).toLocaleString();
  return {
    address,
    landCategory: address.includes("도로") ? "도로" : "대",
    areaText: `${area}㎡`,
    ownerType: address.includes("국") ? "국유" : "사유",
    landPriceText: `${price} 원/㎡`,
  };
}

function createAddressCandidates(keyword: string): string[] {
  const q = keyword.trim();
  if (!q) return [];
  return [
    `경북 경산시 하양읍 ${q} 123-4`,
    `경북 경산시 하양읍 ${q} 123-5`,
    `경북 경산시 하양읍 ${q} 87-2`,
    `경북 경산시 하양읍 ${q} 201-1`,
  ];
}

function statusPillClass(value: "green" | "red" | "gray"): string {
  if (value === "green") return "bg-emerald-100 text-emerald-700";
  if (value === "red") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-600";
}

const FACILITY_MAJORS: FacilityMajor[] = [
  {
    id: "ground",
    label: "지상 공작물",
    legalBasis: "시행령 제55조 1호",
    subTypes: [
      { id: "ground_pole", label: "전봇대·전선·가로등·변압탑", calcMethod: "개수 × 고정단가", requiredFields: ["count"], unitRate: "갑/을/병지 단가", serviceOccupancyType: "general" },
      { id: "ground_box", label: "지중배전함·무선기지국·교통량검지기", calcMethod: "개수 × 고정단가", requiredFields: ["count"], unitRate: "갑/을/병지 단가", serviceOccupancyType: "general" },
      { id: "ground_tower", label: "송전탑·공중전화", calcMethod: "공시지가 × 요율", requiredFields: ["area"], unitRate: "토지가격 × 0.05", serviceOccupancyType: "general" },
      { id: "ground_energy", label: "태양광·태양열·풍력발전시설", calcMethod: "공시지가 × 요율", requiredFields: ["area"], unitRate: "토지가격 × 0.05", serviceOccupancyType: "general" },
      { id: "ground_public", label: "우체통·소화전·모래함·제설함", calcMethod: "개수 × 고정단가", requiredFields: ["count"], unitRate: "갑/을/병지 단가", serviceOccupancyType: "general" },
    ],
  },
  {
    id: "underground",
    label: "지하 매설물",
    legalBasis: "시행령 제55조 2호",
    subTypes: [
      { id: "under_water", label: "수도관·하수도관·농업용수관", calcMethod: "길이 × 지름별 고정단가", requiredFields: ["diameter", "length", "depth"], unitRate: "갑/을/병지 지름별 단가", serviceOccupancyType: "pipeline" },
      { id: "under_gas", label: "가스관·송유관·송열관", calcMethod: "길이 × 지름별 고정단가", requiredFields: ["diameter", "length", "depth"], unitRate: "갑/을/병지 지름별 단가", serviceOccupancyType: "pipeline" },
      { id: "under_electric", label: "전기관·전기통신관", calcMethod: "길이 × 지름별 고정단가", requiredFields: ["diameter", "length", "depth", "parallelSpec"], unitRate: "병행관은 외접원 환산", serviceOccupancyType: "pipeline" },
      { id: "under_manhole", label: "작업구(맨홀)·전력구·통신구·공동구", calcMethod: "길이 × 지름별 고정단가", requiredFields: ["diameter", "length", "depth"], unitRate: "갑/을/병지 단가", serviceOccupancyType: "pipeline" },
      { id: "under_drainage", label: "배수시설·수질자동측정시설", calcMethod: "길이 × 지름별 고정단가", requiredFields: ["diameter", "length"], unitRate: "갑/을/병지 단가", serviceOccupancyType: "pipeline" },
      { id: "under_anchor", label: "지중정착장치(어스앵커)·암거", calcMethod: "길이 × 지름별 고정단가", requiredFields: ["diameter", "length", "depth"], unitRate: "별도 구간 적용", serviceOccupancyType: "pipeline" },
    ],
  },
  {
    id: "connection",
    label: "진입·연결 시설",
    legalBasis: "시행령 제55조 3호",
    subTypes: [
      { id: "conn_entry", label: "진입로·출입로", calcMethod: "공시지가 × 요율", requiredFields: ["area", "buildingKind"], unitRate: "토지가격 × 0.05", serviceOccupancyType: "access" },
      { id: "conn_fuel", label: "주유소·수소충전소", calcMethod: "공시지가 × 요율", requiredFields: ["area", "buildingKind"], unitRate: "건축물×0.04 / 진입로×0.05", serviceOccupancyType: "access" },
      { id: "conn_terminal", label: "주차장·화물터미널·여객터미널", calcMethod: "공시지가 × 요율", requiredFields: ["area", "buildingKind"], unitRate: "토지가격 × 0.04", serviceOccupancyType: "access" },
      { id: "conn_repair", label: "자동차수리소·승강대·화물적치장·휴게소", calcMethod: "공시지가 × 요율", requiredFields: ["area", "buildingKind"], unitRate: "토지가격 × 0.04", serviceOccupancyType: "access" },
    ],
  },
  { id: "rail", label: "철도·궤도", legalBasis: "시행령 제55조 4호", subTypes: [{ id: "rail_main", label: "철도·궤도", calcMethod: "공시지가 × 요율", requiredFields: ["area"], unitRate: "토지가격 × 0.02", serviceOccupancyType: "general" }] },
  {
    id: "overUnder",
    label: "지하·공중 구조물",
    legalBasis: "시행령 제55조 5호",
    subTypes: [
      { id: "overunder_b1", label: "지하상가·지하실 (1층 건축물)", calcMethod: "공시지가 × 요율", requiredFields: ["area", "buildingFloors"], unitRate: "토지가격 × 0.015", serviceOccupancyType: "general" },
      { id: "overunder_b2", label: "지하상가·지하실 (2층 건축물)", calcMethod: "공시지가 × 요율", requiredFields: ["area", "buildingFloors"], unitRate: "토지가격 × 0.017", serviceOccupancyType: "general" },
      { id: "overunder_b3", label: "지하상가·지하실 (3층 이상)", calcMethod: "공시지가 × 요율", requiredFields: ["area", "buildingFloors"], unitRate: "토지가격 × 0.019", serviceOccupancyType: "general" },
      { id: "overunder_passage", label: "공중·지하 통로", calcMethod: "공시지가 × 요율", requiredFields: ["area"], unitRate: "토지가격 × 0.0075", serviceOccupancyType: "general" },
      { id: "overunder_bridge", label: "육교·그 밖의 것", calcMethod: "공시지가 × 요율", requiredFields: ["area"], unitRate: "토지가격 × 0.02", serviceOccupancyType: "general" },
    ],
  },
  {
    id: "ad",
    label: "광고·표지 시설",
    legalBasis: "시행령 제55조 6호",
    subTypes: [
      { id: "ad_sign", label: "간판 (돌출간판 제외)", calcMethod: "고정단가", requiredFields: ["area"], unitRate: "122,000 / 81,350 / 20,700", serviceOccupancyType: "sign" },
      { id: "ad_protruding", label: "돌출간판", calcMethod: "고정단가", requiredFields: ["area"], unitRate: "58,400 / 38,950 / 9,900", serviceOccupancyType: "sign" },
      { id: "ad_private", label: "사설안내표지", calcMethod: "고정단가", requiredFields: ["count"], unitRate: "101,650 / 67,750 / 17,250", serviceOccupancyType: "sign" },
      { id: "ad_banner_temp", label: "현수막 (일시)", calcMethod: "고정단가", requiredFields: ["area", "days"], unitRate: "400 / 200 / 50 (원/㎡/일)", serviceOccupancyType: "sign" },
      { id: "ad_banner", label: "현수막 (그 밖의 것)", calcMethod: "고정단가", requiredFields: ["area"], unitRate: "연간 고정단가", serviceOccupancyType: "sign" },
      { id: "ad_arch_road", label: "아치 (도로 횡단형)", calcMethod: "고정단가", requiredFields: ["area"], unitRate: "244,000 / 162,700 / 41,400", serviceOccupancyType: "sign" },
      { id: "ad_arch_other", label: "아치 (그 밖의 것)", calcMethod: "고정단가", requiredFields: ["area"], unitRate: "122,000 / 81,350 / 20,700", serviceOccupancyType: "sign" },
      { id: "ad_board", label: "현수막 게시시설", calcMethod: "고정단가", requiredFields: ["area"], unitRate: "국가·지자체 설치·관리만", serviceOccupancyType: "sign" },
    ],
  },
  {
    id: "vendor",
    label: "노점·판매대",
    legalBasis: "시행령 제55조 7호",
    subTypes: [
      { id: "vendor_booth", label: "버스표판매대·구두수선대", calcMethod: "공시지가 × 요율", requiredFields: ["area"], unitRate: "토지가격 × 0.01", serviceOccupancyType: "general" },
      { id: "vendor_temp", label: "노점·자판기·ATM·상품진열대 (일시)", calcMethod: "고정단가", requiredFields: ["area", "days"], unitRate: "400 / 300 / 150 (원/㎡/일)", serviceOccupancyType: "general" },
      { id: "vendor_general", label: "노점·자판기·ATM·상품진열대 (그 밖의)", calcMethod: "공시지가 × 요율", requiredFields: ["area"], unitRate: "토지가격 × 0.05", serviceOccupancyType: "general" },
    ],
  },
  {
    id: "construction",
    label: "공사용 시설",
    legalBasis: "시행령 제55조 8호",
    subTypes: [
      { id: "const_temp", label: "공사용 판자벽·발판·대기소 등 (일시)", calcMethod: "고정단가", requiredFields: ["area", "days"], unitRate: "400 / 300 / 150 (원/㎡/일)", serviceOccupancyType: "construction" },
      { id: "const_general", label: "공사용 시설 (그 밖의)", calcMethod: "공시지가 × 요율", requiredFields: ["area", "excavationLength", "excavationWidth"], unitRate: "토지가격 × 0.05", serviceOccupancyType: "construction" },
    ],
  },
  { id: "underBridge", label: "고가도로 하부 시설", legalBasis: "시행령 제55조 9호", subTypes: [{ id: "underbridge_main", label: "사무소·점포·창고·주차장·광장·공원·체육시설", calcMethod: "공시지가 × 요율", requiredFields: ["area"], unitRate: "토지가격 × 0.02", serviceOccupancyType: "general" }] },
  { id: "barrierFree", label: "장애인 편의시설", legalBasis: "시행령 제55조 10호", subTypes: [{ id: "bf_main", label: "높이차이 제거시설·주출입구 접근로", calcMethod: "공시지가 × 요율 (전액 면제)", requiredFields: ["area"], unitRate: "감면 자동 적용", serviceOccupancyType: "general" }] },
  {
    id: "etc",
    label: "기타",
    legalBasis: "시행령 제55조 11·12호",
    subTypes: [
      { id: "etc_farming", label: "농업·식물재배", calcMethod: "공시지가 × 요율", requiredFields: ["area"], unitRate: "토지가격 × 0.01", serviceOccupancyType: "general" },
      { id: "etc_residential", label: "주택 통행로", calcMethod: "공시지가 × 요율 (전액 면제)", requiredFields: ["area"], unitRate: "감면 자동 적용", serviceOccupancyType: "access" },
      { id: "etc_general", label: "그 밖의 공작물·시설", calcMethod: "공시지가 × 요율", requiredFields: ["area"], unitRate: "토지가격 × 0.05", serviceOccupancyType: "other" },
      { id: "etc_temp_entry", label: "임시공사장 및 공사용 진입로", calcMethod: "공시지가 × 요율", requiredFields: ["area"], unitRate: "토지가격 × 0.02", serviceOccupancyType: "construction" },
    ],
  },
];

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addYearsToDateInput(dateInput: string, years: number): string {
  if (!dateInput) return "";
  const [year, month, day] = dateInput.split("-").map((x) => Number(x));
  if (!year || !month || !day) return "";
  const baseDate = new Date(year, month - 1, day);
  if (Number.isNaN(baseDate.getTime())) return "";
  baseDate.setFullYear(baseDate.getFullYear() + years);
  return toDateInputValue(baseDate);
}

export function RoadUseLedgerAnalysisModal({ open, onClose }: Props) {
  const today = useMemo(() => toDateInputValue(new Date()), []);
  const [step, setStep] = useState<StepIndex>(1);
  const [applicationType, setApplicationType] = useState<ApplicationType>("new");
  const [occupancyType, setOccupancyType] = useState<OccupancyType>("general");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(() => addYearsToDateInput(today, 5));
  const [occupantType, setOccupantType] = useState<OccupantType>("private");
  const [occupancyParcelInput, setOccupancyParcelInput] = useState("");
  const [propertyParcelInput, setPropertyParcelInput] = useState("");
  const [occupancySearchKeyword, setOccupancySearchKeyword] = useState("");
  const [propertySearchKeyword, setPropertySearchKeyword] = useState("");
  const [occupancySuggestions, setOccupancySuggestions] = useState<string[]>([]);
  const [propertySuggestions, setPropertySuggestions] = useState<string[]>([]);
  const [selectedOccupancyParcels, setSelectedOccupancyParcels] = useState<string[]>([]);
  const [selectedPropertyParcels, setSelectedPropertyParcels] = useState<string[]>([]);
  const [occupancyParcelCard, setOccupancyParcelCard] = useState<ParcelCard | null>(null);
  const [propertyParcelCard, setPropertyParcelCard] = useState<ParcelCard | null>(null);
  const [drawingCompleted, setDrawingCompleted] = useState(false);
  const [drawnAreaM2, setDrawnAreaM2] = useState<string>("");
  const [drawnLengthM, setDrawnLengthM] = useState<string>("");
  const [requestedAreaM2, setRequestedAreaM2] = useState("");
  const [landPricePerM2, setLandPricePerM2] = useState("");
  const [previousAnnualFee, setPreviousAnnualFee] = useState("");
  const [pipeDiameterM, setPipeDiameterM] = useState("");
  const [occupancyCount, setOccupancyCount] = useState("");
  const [occupancyLengthM, setOccupancyLengthM] = useState("");
  const [discountCategory, setDiscountCategory] = useState<DiscountCategory>("none");
  const [facilityMajorId, setFacilityMajorId] = useState<FacilityMajorId>("ground");
  const [facilitySubTypeId, setFacilitySubTypeId] = useState<string>("ground_pole");
  const [buriedDepthM, setBuriedDepthM] = useState("");
  const [occupancyDays, setOccupancyDays] = useState("");
  const [buildingFloors, setBuildingFloors] = useState("");
  const [buildingKind, setBuildingKind] = useState<"building" | "entry" | "other">("other");
  const [parallelPipeline, setParallelPipeline] = useState(false);
  const [parallelPipeCount, setParallelPipeCount] = useState("");
  const [parallelPipeSpacingMm, setParallelPipeSpacingMm] = useState("");
  const [parallelOuterWidthM, setParallelOuterWidthM] = useState("");
  const [parallelOuterHeightM, setParallelOuterHeightM] = useState("");
  const [landPriceInputMode, setLandPriceInputMode] = useState<"auto" | "manual">("auto");
  const [safetyPlan, setSafetyPlan] = useState(false);
  const [trafficPlan, setTrafficPlan] = useState(false);
  const [restorationPlan, setRestorationPlan] = useState(false);
  const [consultationPrepared, setConsultationPrepared] = useState(false);
  const [requestInstallments, setRequestInstallments] = useState(false);
  const [isDevelopmentRestrictionZone, setIsDevelopmentRestrictionZone] = useState(false);
  const [isUrbanArea, setIsUrbanArea] = useState(false);
  const [isChildProtectionZone, setIsChildProtectionZone] = useState(false);
  const [isRoadZoneIncluded, setIsRoadZoneIncluded] = useState(false);
  const [isOverlappedWithExistingPermit, setIsOverlappedWithExistingPermit] = useState(false);
  const [ownerConsentSecured, setOwnerConsentSecured] = useState(false);
  const [rightSecured, setRightSecured] = useState(false);
  const [designDrawingAttached, setDesignDrawingAttached] = useState(false);
  const [structureCalculationAttached, setStructureCalculationAttached] = useState(false);
  const [buriedUtilityConsulted, setBuriedUtilityConsulted] = useState(false);
  const [excavationLengthM, setExcavationLengthM] = useState("");
  const [excavationWidthM, setExcavationWidthM] = useState("");
  const [recentlyPavedRestriction, setRecentlyPavedRestriction] = useState(false);
  const [rightSideConnection, setRightSideConnection] = useState(false);
  const [distanceSatisfied, setDistanceSatisfied] = useState(false);
  const [laneStandardSatisfied, setLaneStandardSatisfied] = useState(false);
  const [drainagePlan, setDrainagePlan] = useState(false);
  const [medianPlan, setMedianPlan] = useState(false);
  const [startConstructionWithinOneYear, setStartConstructionWithinOneYear] = useState(true);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const autoAnalyzeKeyRef = useRef<string>("");

  const occupancyParcelLines = useMemo(() => parseParcelLines(occupancyParcelInput), [occupancyParcelInput]);
  const propertyParcelLines = useMemo(() => parseParcelLines(propertyParcelInput), [propertyParcelInput]);
  const canAnalyze = occupancyParcelLines.length > 0 && propertyParcelLines.length > 0 && !loading;
  const step1Completed =
    Boolean(applicationType) &&
    Boolean(facilitySubTypeId) &&
    selectedOccupancyParcels.length > 0 &&
    selectedPropertyParcels.length > 0;
  // 현재는 지도 플레이스홀더 단계라 드로잉 없이도 다음 단계로 진행 가능하게 둔다.
  const step2Completed = true;
  const selectedFacilityMajor = useMemo(
    () => FACILITY_MAJORS.find((major) => major.id === facilityMajorId) ?? FACILITY_MAJORS[0],
    [facilityMajorId]
  );
  const selectedFacilitySubType = useMemo(
    () => selectedFacilityMajor.subTypes.find((subType) => subType.id === facilitySubTypeId) ?? selectedFacilityMajor.subTypes[0],
    [selectedFacilityMajor, facilitySubTypeId]
  );
  const requiredFieldSet = useMemo(
    () => new Set(selectedFacilitySubType?.requiredFields ?? []),
    [selectedFacilitySubType]
  );
  const needsAreaField = requiredFieldSet.has("area");
  const needsCountField = requiredFieldSet.has("count");
  const needsDiameterField = requiredFieldSet.has("diameter");
  const needsLengthField = requiredFieldSet.has("length");
  const needsDepthField = requiredFieldSet.has("depth");
  const needsDaysField = requiredFieldSet.has("days");
  const needsBuildingFloorsField = requiredFieldSet.has("buildingFloors");
  const needsBuildingKindField = requiredFieldSet.has("buildingKind");
  const needsParallelSpecField = requiredFieldSet.has("parallelSpec");
  const needsExcavationLengthField = requiredFieldSet.has("excavationLength");
  const needsExcavationWidthField = requiredFieldSet.has("excavationWidth");

  useEffect(() => {
    const nextSubType = selectedFacilityMajor.subTypes[0];
    if (!nextSubType) return;
    if (!selectedFacilityMajor.subTypes.some((subType) => subType.id === facilitySubTypeId)) {
      setFacilitySubTypeId(nextSubType.id);
    }
  }, [selectedFacilityMajor, facilitySubTypeId]);

  useEffect(() => {
    if (!selectedFacilitySubType) return;
    setOccupancyType(selectedFacilitySubType.serviceOccupancyType);
  }, [selectedFacilitySubType]);

  useEffect(() => {
    setOccupancyParcelInput(selectedOccupancyParcels.join(", "));
  }, [selectedOccupancyParcels]);

  useEffect(() => {
    setPropertyParcelInput(selectedPropertyParcels.join(", "));
  }, [selectedPropertyParcels]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const handleReset = () => {
    setApplicationType("new");
    setOccupancyType("general");
    setStartDate(today);
    setEndDate(addYearsToDateInput(today, 5));
    setOccupantType("private");
    setOccupancyParcelInput("");
    setPropertyParcelInput("");
    setOccupancySearchKeyword("");
    setPropertySearchKeyword("");
    setOccupancySuggestions([]);
    setPropertySuggestions([]);
    setSelectedOccupancyParcels([]);
    setSelectedPropertyParcels([]);
    setOccupancyParcelCard(null);
    setPropertyParcelCard(null);
    setDrawingCompleted(false);
    setDrawnAreaM2("");
    setDrawnLengthM("");
    setRequestedAreaM2("");
    setLandPricePerM2("");
    setPreviousAnnualFee("");
    setPipeDiameterM("");
    setOccupancyCount("");
    setOccupancyLengthM("");
    setDiscountCategory("none");
    setFacilityMajorId("ground");
    setFacilitySubTypeId("ground_pole");
    setBuriedDepthM("");
    setOccupancyDays("");
    setBuildingFloors("");
    setBuildingKind("other");
    setParallelPipeline(false);
    setParallelPipeCount("");
    setParallelPipeSpacingMm("");
    setParallelOuterWidthM("");
    setParallelOuterHeightM("");
    setLandPriceInputMode("auto");
    setSafetyPlan(false);
    setTrafficPlan(false);
    setRestorationPlan(false);
    setConsultationPrepared(false);
    setRequestInstallments(false);
    setIsDevelopmentRestrictionZone(false);
    setIsUrbanArea(false);
    setIsChildProtectionZone(false);
    setIsRoadZoneIncluded(false);
    setIsOverlappedWithExistingPermit(false);
    setOwnerConsentSecured(false);
    setRightSecured(false);
    setDesignDrawingAttached(false);
    setStructureCalculationAttached(false);
    setBuriedUtilityConsulted(false);
    setExcavationLengthM("");
    setExcavationWidthM("");
    setRecentlyPavedRestriction(false);
    setRightSideConnection(false);
    setDistanceSatisfied(false);
    setLaneStandardSatisfied(false);
    setDrainagePlan(false);
    setMedianPlan(false);
    setStartConstructionWithinOneYear(true);
    setStep(1);
    autoAnalyzeKeyRef.current = "";
    setSubmitError(null);
    setResult(null);
  };

  const handleAnalyze = async () => {
    if (occupancyParcelLines.length === 0 || propertyParcelLines.length === 0) {
      setSubmitError("점용대상필지와 물건지 필지를 각각 1개 이상 입력해야 분석할 수 있습니다.");
      setResult(null);
      return;
    }
    setLoading(true);
    setSubmitError(null);
    try {
      const response = await call("", "POST", {
        service: "roadUseLedgerService",
        action: "analyzeRoadUseParcels",
        params: {
          applicationType,
          occupancyType: toServiceOccupancyType(occupancyType),
          occupantType,
          useStart: startDate,
          useEnd: endDate,
          occupancyParcels: occupancyParcelLines,
          propertyParcels: propertyParcelLines,
          requestedAreaM2: drawnAreaM2 || requestedAreaM2,
          landPricePerM2,
          previousAnnualFee,
          pipeDiameterM,
          occupancyCount,
          occupancyLengthM: drawnLengthM || occupancyLengthM,
          buriedDepthM,
          occupancyDays,
          buildingFloors,
          buildingKind,
          parallelPipeline,
          parallelPipeCount,
          parallelPipeSpacingMm,
          parallelOuterWidthM,
          parallelOuterHeightM,
          discountCategory: toServiceDiscountCategory(discountCategory),
          requestInstallments,
          safetyPlan,
          trafficPlan,
          restorationPlan,
          consultationPrepared,
          isDevelopmentRestrictionZone,
          isUrbanArea,
          isChildProtectionZone,
          isRoadZoneIncluded,
          isOverlappedWithExistingPermit,
          ownerConsentSecured,
          rightSecured,
          designDrawingAttached,
          structureCalculationAttached,
          buriedUtilityConsulted,
          excavationLengthM,
          excavationWidthM,
          recentlyPavedRestriction,
          rightSideConnection,
          distanceSatisfied,
          laneStandardSatisfied,
          drainagePlan,
          medianPlan,
          startConstructionWithinOneYear,
        },
      });
      const data = (response?.data ?? response) as AnalysisResponse;
      if (data?.error) {
        setResult(null);
        setSubmitError(String(data.error));
      } else {
        setResult(data);
      }
    } catch (error: unknown) {
      setResult(null);
      setSubmitError(error instanceof Error ? error.message : "분석 요청에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const runAddressSearch = (type: "occupancy" | "property") => {
    if (type === "occupancy") {
      setOccupancySuggestions(createAddressCandidates(occupancySearchKeyword));
      return;
    }
    setPropertySuggestions(createAddressCandidates(propertySearchKeyword));
  };

  const addSelectedAddress = (type: "occupancy" | "property", address: string) => {
    if (!address.trim()) return;
    if (type === "occupancy") {
      setSelectedOccupancyParcels((prev) => (prev.includes(address) ? prev : [...prev, address]));
      setOccupancyParcelCard(buildMockParcelCard(address));
      setOccupancySuggestions([]);
      setOccupancySearchKeyword(address);
      return;
    }
    setSelectedPropertyParcels((prev) => (prev.includes(address) ? prev : [...prev, address]));
    setPropertyParcelCard(buildMockParcelCard(address));
    setPropertySuggestions([]);
    setPropertySearchKeyword(address);
  };

  const removeSelectedAddress = (type: "occupancy" | "property", address: string) => {
    if (type === "occupancy") {
      setSelectedOccupancyParcels((prev) => prev.filter((x) => x !== address));
      setOccupancyParcelCard((prev) => (prev?.address === address ? null : prev));
      return;
    }
    setSelectedPropertyParcels((prev) => prev.filter((x) => x !== address));
    setPropertyParcelCard((prev) => (prev?.address === address ? null : prev));
  };

  const selectAddressFromMap = (type: "occupancy" | "property") => {
    const suffix = type === "occupancy" ? "점용대상" : "물건지";
    addSelectedAddress(type, `경북 경산시 하양읍 금락리 123-4 (${suffix} 지도선택)`);
  };

  useEffect(() => {
    if (!open || step !== 3) return;
    const key = JSON.stringify({
          applicationType: toServiceApplicationType(applicationType),
      occupancyType,
      startDate,
      endDate,
      occupancyParcelLines,
      propertyParcelLines,
      drawnAreaM2,
      drawnLengthM,
      requestedAreaM2,
      landPricePerM2,
      discountCategory,
    });
    if (autoAnalyzeKeyRef.current === key) return;
    autoAnalyzeKeyRef.current = key;
    void handleAnalyze();
  }, [
    open,
    step,
    applicationType,
    occupancyType,
    startDate,
    endDate,
    occupancyParcelLines,
    propertyParcelLines,
    drawnAreaM2,
    drawnLengthM,
    requestedAreaM2,
    landPricePerM2,
    discountCategory,
  ]);

  const landAnalysisItems = useMemo(() => {
    const items: Array<{ name: string; state: "green" | "red" | "gray"; text: string }> = [
      { name: "도로구역 포함", state: isRoadZoneIncluded ? "green" : "red", text: isRoadZoneIncluded ? "충족" : "미충족" },
      {
        name: "개발제한구역(GB)",
        state: isDevelopmentRestrictionZone ? "red" : "green",
        text: isDevelopmentRestrictionZone ? "해당" : "해당없음",
      },
      { name: "도시지역 해당", state: isUrbanArea ? "red" : "green", text: isUrbanArea ? "해당" : "해당없음" },
      {
        name: "어린이보호구역",
        state: isChildProtectionZone ? "red" : "green",
        text: isChildProtectionZone ? "협의필요" : "해당없음",
      },
      {
        name: "기존 허가 중복",
        state: isOverlappedWithExistingPermit ? "red" : "green",
        text: isOverlappedWithExistingPermit ? "중복" : "이상없음",
      },
      {
        name: "지하매설물 중첩",
        state: buriedUtilityConsulted ? "green" : "red",
        text: buriedUtilityConsulted ? "이상없음" : "협의필요",
      },
      {
        name: "도로중심선 이격거리 충족",
        state: distanceSatisfied ? "green" : "red",
        text: distanceSatisfied ? "충족" : "미충족",
      },
      {
        name: "변속/부가차로 기준 충족",
        state: laneStandardSatisfied ? "green" : "red",
        text: laneStandardSatisfied ? "충족" : "미충족",
      },
      { name: "우측연결 충족", state: rightSideConnection ? "green" : "red", text: rightSideConnection ? "충족" : "미충족" },
      { name: "배수계획 적정", state: drainagePlan ? "green" : "red", text: drainagePlan ? "적정" : "미흡" },
    ];
    return items;
  }, [
    isRoadZoneIncluded,
    isDevelopmentRestrictionZone,
    isUrbanArea,
    isChildProtectionZone,
    isOverlappedWithExistingPermit,
    buriedUtilityConsulted,
    distanceSatisfied,
    laneStandardSatisfied,
    rightSideConnection,
    drainagePlan,
  ]);

  const showBusinessPlan = occupancyType === "pipeline" || occupancyType === "construction";
  const showBuriedOpinion = !buriedUtilityConsulted || landAnalysisItems.find((x) => x.name === "지하매설물 중첩")?.state === "red";
  const showStructureCalc = occupancyType === "sign" || occupancyType === "other";
  const showOwnerConsent = !ownerConsentSecured;
  const showCityConsultation = isUrbanArea;
  const showChildConsultation = isChildProtectionZone;

  const effectiveArea = drawnAreaM2 || requestedAreaM2 || "--";
  const effectiveLength = drawnLengthM || occupancyLengthM || "--";
  const occupancyTypeLabel =
    occupancyType === "pipeline"
      ? "지하 매설물"
      : occupancyType === "access"
      ? "진입·연결"
      : occupancyType === "construction"
      ? "공사용 시설"
      : occupancyType === "sign"
      ? "광고·표지"
      : "일반";
  const discountTypeLabel: Record<DiscountCategory, string> = {
    none: "해당없음",
    public: "공익비영리",
    residential: "주택통행로",
    smallBiz: "소상공인",
    publicProject: "공익사업",
    accessibility: "장애인편의시설",
    donation: "기부채납",
    semiHousing: "준주택",
    other: "기타",
  };
  const discountRateLabel: Record<DiscountCategory, string> = {
    none: "0%",
    public: "100%",
    residential: "100%",
    smallBiz: "80%",
    publicProject: "100%",
    accessibility: "100%",
    donation: "100%",
    semiHousing: "기준확인",
    other: "기준확인",
  };
  const stepLabels: Record<StepIndex, string> = {
    1: "점용신청 정보 (1/3)",
    2: "점용위치 그리기 (2/3)",
    3: "분석결과 (3/3)",
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="도로점용 분석"
      onClick={onClose}
    >
      <div
        className="relative flex h-[700px] w-[1100px] min-w-[1100px] max-w-[95vw] max-h-[90vh] flex-col gap-y-2 overflow-visible rounded-[5px] border border-slate-200 bg-white p-4 shadow-2xl xl:-translate-x-[231px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
            도로점용 분석 - {stepLabels[step]}
          </h2>
          <button
            type="button"
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col py-2">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div>
              <section className="absolute left-[calc(100%+12px)] top-0 hidden h-[700px] w-[450px] overflow-auto rounded-[5px] border border-slate-200 bg-slate-50 p-3 shadow-2xl xl:block">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-800">점용·연결 허가 처리절차</h4>
                  <a
                    href="https://www.law.go.kr/LSW//lsLawLinkInfo.do?lsJoLnkSeq=900263061&lsId=001821&chrClsCd=010202&print=print"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                  >
                    도로법 링크
                  </a>
                </div>
                <div className="overflow-x-auto rounded border border-slate-300 bg-white">
                  <table className="w-full border-collapse text-xs">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="w-16 border border-slate-300 px-1.5 py-1 text-center">구분</th>
                        <th className="w-56 border border-slate-300 px-1.5 py-1 text-center">민원업무</th>
                        <th className="w-32 border border-slate-300 px-1.5 py-1 text-center">근거</th>
                        <th className="w-28 border border-slate-300 px-1.5 py-1 text-center">서식</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-700">
                      <tr>
                        <td className="border border-slate-300 px-1 py-2 text-center">사전확인</td>
                        <td className="border border-slate-300 px-2 py-1">
                          <div className="space-y-1">
                            <div className="border border-slate-300 bg-slate-50 px-2 py-1 text-center">점용허가</div>
                            <div className="border border-slate-300 bg-slate-50 px-2 py-1 text-center">연결허가</div>
                          </div>
                        </td>
                        <td className="border border-slate-300 px-2 py-1 align-top">
                          <p>민원 처리에 관한 법률 제30조</p>
                          <p className="mt-1">연결규칙 제4조의2</p>
                        </td>
                        <td className="border border-slate-300 px-2 py-1 align-top">
                          <p className="text-center">-</p>
                          <p className="mt-1">연결규칙 서식 1의2</p>
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-slate-300 px-1 py-2 text-center">점용(연결)허가</td>
                        <td className="border border-slate-300 px-2 py-1">
                          <div className="space-y-1">
                            <div className="border border-slate-300 bg-slate-50 px-2 py-1 text-center">허가신청 (점용허가 / 연결허가)</div>
                            <div className="text-center text-[10px] text-slate-500">↓</div>
                            <div className="border border-dashed border-slate-300 bg-white px-2 py-1 text-center">(필요시) 착수신고 / 공사기간연장</div>
                            <div className="text-center text-[10px] text-slate-500">↓</div>
                            <div className="border border-slate-300 bg-slate-50 px-2 py-1 text-center">점용공사 준공확인</div>
                          </div>
                        </td>
                        <td className="border border-slate-300 px-2 py-1 align-top">
                          <p>법 제61조 / 제52조</p>
                          <p className="mt-1">법 제62조</p>
                        </td>
                        <td className="border border-slate-300 px-2 py-1 align-top">
                          <p>시행규칙 서식 24 / 연결규칙 서식 1</p>
                          <p className="mt-1">시행규칙 서식 32</p>
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-slate-300 px-1 py-2 text-center">허가 후 관리</td>
                        <td className="border border-slate-300 px-2 py-1">
                          <div className="space-y-1">
                            <div className="border border-slate-300 bg-slate-50 px-2 py-1 text-center">계속도로점용료 부과</div>
                            <div className="border border-slate-300 bg-slate-50 px-2 py-1 text-center">허가기간 연장신청 (점용허가 / 연결허가)</div>
                            <div className="border border-slate-300 bg-slate-50 px-2 py-1 text-center">권리의무 승계신고</div>
                            <div className="border border-slate-300 bg-slate-50 px-2 py-1 text-center">허가 변경신청 (점용허가 / 연결허가)</div>
                            <div className="border border-slate-300 bg-slate-50 px-2 py-1 text-center">행정처분 등 기타</div>
                          </div>
                        </td>
                        <td className="border border-slate-300 px-2 py-1 align-top">
                          <p>법 제66조</p>
                          <p className="mt-1">법 제61조 / 연결규칙 제4조</p>
                          <p className="mt-1">법 제106조</p>
                          <p className="mt-1">법 제61조 / 법 제52조</p>
                        </td>
                        <td className="border border-slate-300 px-2 py-1 align-top">
                          <p>-</p>
                          <p className="mt-1">시행규칙 서식25 / 연결규칙 서식 2</p>
                          <p className="mt-1">시행규칙 서식 46</p>
                          <p className="mt-1">시행규칙 서식26 / 연결규칙 서식 3</p>
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-slate-300 px-1 py-2 text-center">허가 취소</td>
                        <td className="border border-slate-300 px-2 py-1">
                          <div className="space-y-1">
                            <div className="border border-dashed border-slate-300 bg-white px-2 py-1 text-center">(필요시) 취소신청 (점용허가 / 연결허가)</div>
                            <div className="text-center text-[10px] text-slate-500">↓</div>
                            <div className="border border-slate-300 bg-slate-50 px-2 py-1 text-center">원상회복 준공확인</div>
                            <div className="text-center text-[10px] text-slate-500">↓</div>
                            <div className="border border-slate-300 bg-slate-50 px-2 py-1 text-center">도로점용 취소통보</div>
                          </div>
                        </td>
                        <td className="border border-slate-300 px-2 py-1 align-top">
                          <p>법 제63조</p>
                          <p className="mt-1">법 제73조</p>
                        </td>
                        <td className="border border-slate-300 px-2 py-1 align-top">
                          <p>시행규칙 서식48</p>
                          <p className="mt-1">시행규칙 서식 32</p>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="min-w-0 space-y-4">
            {step === 1 && (
              <section className="space-y-4">
                <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
                  <p className="mb-3 text-sm font-semibold text-slate-800">공통 입력 (모든 시설 공통)</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        신청유형
                      </span>
                      <select value={applicationType} onChange={(e) => setApplicationType(e.target.value as ApplicationType)} className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800">
                        <option value="new">신규</option>
                        <option value="renew">갱신</option>
                        <option value="change">변경</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        점용 시작일
                      </span>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => {
                          const nextStartDate = e.target.value;
                          setStartDate(nextStartDate);
                          setEndDate(addYearsToDateInput(nextStartDate, 5));
                        }}
                        className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        점용 종료일
                      </span>
                      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800" />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        점용자 구분
                      </span>
                      <select value={occupantType} onChange={(e) => setOccupantType(e.target.value as OccupantType)} className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800">
                        <option value="private">민간/기타</option>
                        <option value="nationalLocal">국가·지자체</option>
                      </select>
                    </label>
                    {applicationType === "renew" && (
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          전년도 점용료
                        </span>
                        <input type="number" min="0" step="1" value={previousAnnualFee} onChange={(e) => setPreviousAnnualFee(e.target.value)} className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800" />
                      </label>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <span className="inline-flex items-center gap-1 text-xs text-slate-700">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            점용대상 필지 (지번 텍스트 / 지도선택)
                          </span>
                          <span className="text-[11px] text-slate-500">복수 입력 가능</span>
                        </div>
                        <div className="rounded border border-slate-200 bg-white p-2">
                          <div className="relative flex items-center gap-2">
                            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                              value={occupancySearchKeyword}
                              onChange={(e) => setOccupancySearchKeyword(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  runAddressSearch("occupancy");
                                }
                              }}
                              className="h-8 w-full rounded border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-sm text-slate-800"
                              placeholder="지번/도로명 입력"
                            />
                            <button type="button" onClick={() => runAddressSearch("occupancy")} className="shrink-0 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">
                              주소검색
                            </button>
                            <button type="button" onClick={() => selectAddressFromMap("occupancy")} className="shrink-0 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">
                              지도선택
                            </button>
                          </div>
                        </div>
                        {occupancySuggestions.length > 0 && (
                          <div className="mt-2 rounded border border-slate-200 bg-white">
                            {occupancySuggestions.map((item) => (
                              <button key={item} type="button" onClick={() => addSelectedAddress("occupancy", item)} className="block w-full border-b border-slate-100 px-2 py-1.5 text-left text-xs text-slate-700 last:border-b-0 hover:bg-slate-50">
                                {item}
                              </button>
                            ))}
                          </div>
                        )}
                        {selectedOccupancyParcels.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {selectedOccupancyParcels.map((addr) => (
                              <span key={addr} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                                {addr}
                                <button type="button" className="text-slate-500 hover:text-slate-700" onClick={() => removeSelectedAddress("occupancy", addr)}>
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        {occupancyParcelCard && (
                          <div className="mt-2 rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
                            <p className="font-medium text-slate-800">{occupancyParcelCard.address}</p>
                            <p className="mt-1">
                              지목: {occupancyParcelCard.landCategory} | 면적: {occupancyParcelCard.areaText} | 소유: {occupancyParcelCard.ownerType}
                            </p>
                            <p className="mt-0.5">공시지가: {occupancyParcelCard.landPriceText}</p>
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <span className="inline-flex items-center gap-1 text-xs text-slate-700">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            물건지 필지 (지번 텍스트 / 지도선택)
                          </span>
                          <span className="text-[11px] text-slate-500">시설 설치 토지</span>
                        </div>
                        <div className="rounded border border-slate-200 bg-white p-2">
                          <div className="relative flex items-center gap-2">
                            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                              value={propertySearchKeyword}
                              onChange={(e) => setPropertySearchKeyword(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  runAddressSearch("property");
                                }
                              }}
                              className="h-8 w-full rounded border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-sm text-slate-800"
                              placeholder="지번/도로명 입력"
                            />
                            <button type="button" onClick={() => runAddressSearch("property")} className="shrink-0 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">
                              주소검색
                            </button>
                            <button type="button" onClick={() => selectAddressFromMap("property")} className="shrink-0 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">
                              지도선택
                            </button>
                          </div>
                        </div>
                        {propertySuggestions.length > 0 && (
                          <div className="mt-2 rounded border border-slate-200 bg-white">
                            {propertySuggestions.map((item) => (
                              <button key={item} type="button" onClick={() => addSelectedAddress("property", item)} className="block w-full border-b border-slate-100 px-2 py-1.5 text-left text-xs text-slate-700 last:border-b-0 hover:bg-slate-50">
                                {item}
                              </button>
                            ))}
                          </div>
                        )}
                        {selectedPropertyParcels.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {selectedPropertyParcels.map((addr) => (
                              <span key={addr} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                                {addr}
                                <button type="button" className="text-slate-500 hover:text-slate-700" onClick={() => removeSelectedAddress("property", addr)}>
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        {propertyParcelCard && (
                          <div className="mt-2 rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
                            <p className="font-medium text-slate-800">{propertyParcelCard.address}</p>
                            <p className="mt-1">
                              지목: {propertyParcelCard.landCategory} | 면적: {propertyParcelCard.areaText} | 소유: {propertyParcelCard.ownerType}
                            </p>
                            <p className="mt-0.5">공시지가: {propertyParcelCard.landPriceText}</p>
                          </div>
                        )}
                      </div>
                  </div>

                  <div className="mt-3 rounded border border-slate-200 bg-white p-2">
                    <div className="mb-2 flex items-center gap-4 text-xs text-slate-700">
                      <span className="inline-flex items-center gap-1 font-medium text-slate-800">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        인접지가(원/㎡)
                      </span>
                      <label className="inline-flex items-center gap-1">
                        <input type="radio" name="landPriceInputMode" checked={landPriceInputMode === "auto"} onChange={() => setLandPriceInputMode("auto")} />
                        자동산정
                      </label>
                      <label className="inline-flex items-center gap-1">
                        <input type="radio" name="landPriceInputMode" checked={landPriceInputMode === "manual"} onChange={() => setLandPriceInputMode("manual")} />
                        수동입력
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={landPricePerM2}
                        onChange={(e) => setLandPricePerM2(e.target.value)}
                        placeholder={landPriceInputMode === "auto" ? "자동조회 실패 시 입력" : "수동 입력"}
                        className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800"
                      />
                    </div>
                    <p className="text-[11px] text-slate-500">드로잉 후 접촉필지 기반 가중평균 자동산정, 실패 시 수동입력</p>
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
                  <p className="mb-3 text-sm font-semibold text-slate-800">시설선택</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        대분류
                      </span>
                      <select value={facilityMajorId} onChange={(e) => setFacilityMajorId(e.target.value as FacilityMajorId)} className="h-8 w-full rounded border border-slate-200 px-2 text-sm text-slate-800">
                        {FACILITY_MAJORS.map((major) => (
                          <option key={major.id} value={major.id}>
                            {major.label} ({major.legalBasis})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        소분류
                      </span>
                      <select value={facilitySubTypeId} onChange={(e) => setFacilitySubTypeId(e.target.value)} className="h-8 w-full rounded border border-slate-200 px-2 text-sm text-slate-800">
                        {selectedFacilityMajor.subTypes.map((subType) => (
                          <option key={subType.id} value={subType.id}>
                            {subType.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="mt-3 overflow-x-auto rounded border border-slate-200 bg-white">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          <th className="px-2 py-1.5">산정방식</th>
                          <th className="px-2 py-1.5">단가 기준</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-slate-200">
                          <td className="px-2 py-1.5 text-slate-800">{selectedFacilitySubType?.calcMethod || "--"}</td>
                          <td className="px-2 py-1.5 text-slate-700">{selectedFacilitySubType?.unitRate || "--"}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {needsCountField && (
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          설치 개수
                        </span>
                        <input type="number" min="0" step="1" value={occupancyCount} onChange={(e) => setOccupancyCount(e.target.value)} className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800" />
                      </label>
                    )}
                    {needsAreaField && (
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          점용면적(㎡)
                        </span>
                        <input type="number" min="0" step="0.01" value={requestedAreaM2} onChange={(e) => setRequestedAreaM2(e.target.value)} className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800" />
                      </label>
                    )}
                    {needsDiameterField && (
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          관 지름(m)
                        </span>
                        <input type="number" min="0" step="0.01" value={pipeDiameterM} onChange={(e) => setPipeDiameterM(e.target.value)} className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800" />
                      </label>
                    )}
                    {needsLengthField && (
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          매설 길이(m)
                        </span>
                        <input type="number" min="0" step="0.01" value={occupancyLengthM} onChange={(e) => setOccupancyLengthM(e.target.value)} className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800" />
                      </label>
                    )}
                    {needsDepthField && (
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          매설 깊이(m)
                        </span>
                        <input type="number" min="0" step="0.01" value={buriedDepthM} onChange={(e) => setBuriedDepthM(e.target.value)} className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800" />
                      </label>
                    )}
                    {needsDaysField && (
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          점용일수
                        </span>
                        <input type="number" min="1" step="1" value={occupancyDays} onChange={(e) => setOccupancyDays(e.target.value)} className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800" />
                      </label>
                    )}
                    {needsBuildingFloorsField && (
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          건축물 층수
                        </span>
                        <input type="number" min="1" step="1" value={buildingFloors} onChange={(e) => setBuildingFloors(e.target.value)} className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800" />
                      </label>
                    )}
                    {needsBuildingKindField && (
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          건축물 구분
                        </span>
                        <select value={buildingKind} onChange={(e) => setBuildingKind(e.target.value as "building" | "entry" | "other")} className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800">
                          <option value="building">건축물</option>
                          <option value="entry">진입로</option>
                          <option value="other">기타</option>
                        </select>
                      </label>
                    )}
                    {needsExcavationLengthField && (
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          굴착길이(m)
                        </span>
                        <input type="number" min="0" step="0.01" value={excavationLengthM} onChange={(e) => setExcavationLengthM(e.target.value)} className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800" />
                      </label>
                    )}
                    {needsExcavationWidthField && (
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="inline-flex w-28 items-center gap-1 text-slate-700">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          굴착너비(m)
                        </span>
                        <input type="number" min="0" step="0.01" value={excavationWidthM} onChange={(e) => setExcavationWidthM(e.target.value)} className="h-8 w-52 rounded border border-slate-200 px-2 text-sm text-slate-800" />
                      </label>
                    )}
                  </div>
                  {needsParallelSpecField && (
                    <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                      <label className="inline-flex items-center gap-1">
                        <input type="checkbox" checked={parallelPipeline} onChange={(e) => setParallelPipeline(e.target.checked)} />
                        병행 관로(동일 목적 2개 이상)
                      </label>
                      {parallelPipeline && (
                        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                          <input type="number" min="2" step="1" value={parallelPipeCount} onChange={(e) => setParallelPipeCount(e.target.value)} placeholder="관로 개수" className="h-8 rounded border border-amber-300 bg-white px-2 text-sm text-slate-800" />
                          <input type="number" min="0" step="1" value={parallelPipeSpacingMm} onChange={(e) => setParallelPipeSpacingMm(e.target.value)} placeholder="관 간 이격거리(mm)" className="h-8 rounded border border-amber-300 bg-white px-2 text-sm text-slate-800" />
                          <input type="number" min="0" step="0.01" value={parallelOuterWidthM} onChange={(e) => setParallelOuterWidthM(e.target.value)} placeholder="외접 직사각형 가로(m)" className="h-8 rounded border border-amber-300 bg-white px-2 text-sm text-slate-800" />
                          <input type="number" min="0" step="0.01" value={parallelOuterHeightM} onChange={(e) => setParallelOuterHeightM(e.target.value)} placeholder="외접 직사각형 세로(m)" className="h-8 rounded border border-amber-300 bg-white px-2 text-sm text-slate-800" />
                        </div>
                      )}
                    </div>
                  )}
                  {needsDepthField && (
                    <p className="mt-2 text-xs text-slate-500">※ 매설 깊이 20m 이상 50% 감액, 40m 이상 80% 감액</p>
                  )}
                </div>


              </section>
            )}

            {step === 2 && (
            <section className="space-y-4 rounded border border-slate-200 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">STEP 2 — 위치 지정</h3>
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                지도에서 점용 위치를 직접 그려주세요.
                <br />
                드로잉이 완료되면 면적이 자동으로 계산됩니다.
              </div>
              <div className="flex h-[300px] items-center justify-center rounded border border-slate-200 bg-[var(--color-background-secondary)] text-slate-500">
                <div className="text-center">
                  <MapPinned className="mx-auto mb-2 h-8 w-8" />
                  <p className="text-sm">지도 드로잉 영역</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                <div>
                  점용면적: <span className="font-semibold">{drawnAreaM2 || "--"}</span> ㎡
                </div>
                <div>
                  점용길이: <span className="font-semibold">{drawnLengthM || "--"}</span> m
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    setDrawingCompleted(true);
                    if (!drawnAreaM2) setDrawnAreaM2(requestedAreaM2 || "23.5");
                    if (!drawnLengthM) setDrawnLengthM(occupancyLengthM || "18.2");
                  }}
                >
                  드로잉 완료(시뮬레이션)
                </button>
              </div>
            </section>
            )}

            {step === 3 && (
            <section className="space-y-4 rounded border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">STEP 3 — 분석 결과</h3>
                <button
                  type="button"
                  onClick={() => void handleAnalyze()}
                  disabled={!canAnalyze}
                  className="inline-flex items-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  분석 수행
                </button>
              </div>

              {submitError && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{submitError}</div>}
              <div className="space-y-4">
                  <section className="rounded border border-slate-200 p-3">
                    <h4 className="mb-2 text-sm font-semibold text-slate-800">입지 분석</h4>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {landAnalysisItems.map((item) => (
                        <div key={item.name} className="rounded border border-slate-200 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm text-slate-800">{item.name}</span>
                            <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${statusPillClass(item.state)}`}>{item.text}</span>
                          </div>
                          {item.name === "지하매설물 중첩" && item.state === "red" && (
                            <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
                              상수도관 (관경 200mm) — 관리자: 수도사업소 → 의견서 필요
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded border border-slate-200 p-3">
                    <h4 className="mb-2 text-sm font-semibold text-slate-800">점용료 산정</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left text-sm">
                        <tbody>
                          <tr className="border-b border-slate-200">
                            <th className="w-56 py-2 pr-2 font-medium text-slate-700">1. 산정 방식</th>
                            <td className="py-2 text-slate-800">{landPricePerM2 ? "공시지가 기준" : "--"}</td>
                          </tr>
                          <tr className="border-b border-slate-200">
                            <th className="py-2 pr-2 font-medium text-slate-700">2. 인접지가</th>
                            <td className="py-2 text-slate-800">
                              {landPricePerM2 ? `${Number(landPricePerM2).toLocaleString()} 원/㎡ (접촉필지 2개 가중평균)` : "--"}
                              <p className="mt-1 text-xs text-slate-500">금락리 123-4: 291,000원 × 51.5% / 금락리 123-5: 275,000원 × 48.5%</p>
                            </td>
                          </tr>
                          <tr className="border-b border-slate-200">
                            <th className="py-2 pr-2 font-medium text-slate-700">3. 점용유형·감면유형·감면률</th>
                            <td className="py-2 text-slate-800">
                              <p>점용유형: {occupancyTypeLabel}</p>
                              <p>감면유형: {discountTypeLabel[discountCategory]}</p>
                              <p>감면률: {discountRateLabel[discountCategory]}</p>
                            </td>
                          </tr>
                          <tr className="border-b border-slate-200">
                            <th className="py-2 pr-2 font-medium text-slate-700">4. 점용면적</th>
                            <td className="py-2 text-slate-800">{effectiveArea === "--" ? "--" : `${effectiveArea} ㎡`}</td>
                          </tr>
                          <tr className="border-b border-slate-200">
                            <th className="py-2 pr-2 font-medium text-slate-700">5. 적용 요율</th>
                            <td className="py-2 text-slate-800">{occupancyType === "access" ? "× 0.05 (진입로·출입로)" : "--"}</td>
                          </tr>
                          <tr className="border-b border-slate-200">
                            <th className="py-2 pr-2 font-medium text-slate-700">6. 점용기간</th>
                            <td className="py-2 text-slate-800">{startDate && endDate ? `${startDate} ~ ${endDate}` : "--"}</td>
                          </tr>
                          <tr className="border-b border-slate-200">
                            <th className="py-2 pr-2 font-medium text-slate-700">7. 연간 점용료</th>
                            <td className="py-2 text-slate-800">{result ? `${result.fee.baseFee.toLocaleString()} 원/년` : "--"}</td>
                          </tr>
                          <tr className="bg-slate-50">
                            <th className="py-2 pr-2 font-semibold text-slate-800">8. 최종 부과액</th>
                            <td className="py-2 font-semibold text-slate-900">{result ? `${result.fee.finalFee.toLocaleString()} 원/년` : "--"}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">전년도 점용료 입력 시 조정 계산 적용</p>
                  </section>

                  <section className="rounded border border-slate-200 p-3">
                    <h4 className="mb-2 text-sm font-semibold text-slate-800">필요 서류</h4>
                    <ul className="space-y-1 text-sm">
                      <li className="flex items-center justify-between border-b border-slate-100 py-1">
                        <span>도로점용허가 신청서</span>
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">필수</span>
                      </li>
                      <li className="flex items-center justify-between border-b border-slate-100 py-1">
                        <span>설계도면 (전자도면)</span>
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">필수</span>
                      </li>
                      <li className="flex items-center justify-between border-b border-slate-100 py-1">
                        <span>현장사진 (원거리·근거리)</span>
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">필수</span>
                      </li>
                      {showBusinessPlan && (
                        <li className="flex items-center justify-between border-b border-slate-100 py-1">
                          <span>사업계획서</span>
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">조건부</span>
                        </li>
                      )}
                      {showBuriedOpinion && (
                        <li className="flex items-center justify-between border-b border-slate-100 py-1">
                          <span className="inline-flex items-center gap-1">
                            주요지하매설물 의견서
                            <button type="button" className="rounded border border-slate-300 px-1 text-[10px]" title="도로법 시행령 제54조 — 도로굴착 시 주요지하매설물 의견서 첨부">
                              ?
                            </button>
                          </span>
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">조건부</span>
                        </li>
                      )}
                      {showStructureCalc && (
                        <li className="flex items-center justify-between border-b border-slate-100 py-1">
                          <span className="inline-flex items-center gap-1">
                            구조계산서
                            <button type="button" className="rounded border border-slate-300 px-1 text-[10px]" title="공작물 설치 시 구조안전 검토자료 필요">
                              ?
                            </button>
                          </span>
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">조건부</span>
                        </li>
                      )}
                      {showOwnerConsent && (
                        <li className="flex items-center justify-between border-b border-slate-100 py-1">
                          <span className="inline-flex items-center gap-1">
                            토지소유자 동의서
                            <button type="button" className="rounded border border-slate-300 px-1 text-[10px]" title="사유지 포함 시 동의서 첨부 필요">
                              ?
                            </button>
                          </span>
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">조건부</span>
                        </li>
                      )}
                      {showCityConsultation && (
                        <li className="flex items-center justify-between border-b border-slate-100 py-1">
                          <span className="inline-flex items-center gap-1">
                            시·군 협의서
                            <button type="button" className="rounded border border-slate-300 px-1 text-[10px]" title="도시지역 해당 시 계획 적합성 협의 필요">
                              ?
                            </button>
                          </span>
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">조건부</span>
                        </li>
                      )}
                      {showChildConsultation && (
                        <li className="flex items-center justify-between py-1">
                          <span className="inline-flex items-center gap-1">
                            어린이보호구역 협의서
                            <button type="button" className="rounded border border-slate-300 px-1 text-[10px]" title="어린이보호구역 내 시설은 관계기관 협의 필요">
                              ?
                            </button>
                          </span>
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">조건부</span>
                        </li>
                      )}
                    </ul>
                    <div className="mt-2 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                      처리기간 예상: 도로굴착 수반 점용 → 10일 (경찰서 협의 포함)
                    </div>
                  </section>
                </div>
            </section>
            )}
              </div>
            </div>
          </div>

          <section className="mt-0 flex items-center justify-between border-t border-slate-200 bg-white pb-2 pt-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReset}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
              >
                초기화
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep((prev) => (prev === 1 ? 1 : ((prev - 1) as StepIndex)))}
                disabled={step === 1}
                className="inline-flex items-center rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 disabled:opacity-40"
              >
                <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                이전
              </button>
              {step < 3 && (
                <button
                  type="button"
                  onClick={() => {
                    if (step === 1 && step1Completed) setStep(2);
                    if (step === 2 && step2Completed) setStep(3);
                  }}
                  disabled={(step === 1 && !step1Completed) || (step === 2 && !step2Completed)}
                  className="inline-flex items-center rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  다음
                  <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}

