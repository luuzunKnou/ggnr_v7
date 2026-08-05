/**
 * Config 파일 읽기/쓰기 (systemList.config 등)
 * - 서버 측에서만 실행되며, 프로젝트 src/config 경로를 사용합니다.
 * - runtime.env, serviceList.config, systemList.config 는 호출 시마다 파일을 읽어 재시작 없이 반영됩니다.
 */
import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"

/** package.json 이 있는 디렉터리를 프로젝트 루트로 사용 (Next 등에서 cwd 가 달라도 동작) */
function getProjectRoot(): string {
  let dir = typeof process !== "undefined" ? process.cwd() : ""
  for (let i = 0; i < 6; i++) {
    if (!dir) break
    if (existsSync(join(dir, "package.json"))) return dir
    dir = join(dir, "..")
  }
  return typeof process !== "undefined" ? process.cwd() : ""
}

/** src/config 내 config 파일 경로 후보들 중 존재하는 첫 경로 반환 (API/페이지 컨텍스트 차이 대응) */
function resolveConfigPath(filename: "systemList.config" | "serviceList.config"): string {
  const cwd = typeof process !== "undefined" ? process.cwd() : ""
  const fromPackage = getProjectRoot()
  const roots = [cwd, fromPackage].filter(Boolean)
  const seen = new Set<string>()
  for (const root of roots) {
    const n = root?.replace(/\\/g, "/")
    if (!n || seen.has(n)) continue
    seen.add(n)
    const p = join(root, "src", "config", filename)
    if (existsSync(p)) return p
  }
  return join(fromPackage || cwd, "src", "config", filename)
}

function resolveSystemListPath(): string {
  return resolveConfigPath("systemList.config")
}

function resolveRuntimeEnvPath(): { project: string; path: string } {
  const root = getProjectRoot()
  const project = (typeof process !== "undefined" ? process.env.GGNR_PROJECT : "")?.trim() ?? ""
  const path = join(root, "src", "config", "projects", `${project}.runtime.env`)
  return { project, path }
}

/** 현재 프로젝트의 src/config/projects/<project>.runtime.env 를 읽어 키-값 맵 반환 (재시작 없이 실시간 반영) */
function getRuntimeEnvVars(): Record<string, string> {
  const { project, path: runtimeEnvPath } = resolveRuntimeEnvPath()
  if (!project) return {}
  if (!existsSync(runtimeEnvPath)) return {}
  try {
    const content = readFileSync(runtimeEnvPath, "utf-8")
    const out: Record<string, string> = {}
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (key) out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 개발자 콘솔용: 현재 GGNR_PROJECT 의 runtime.env 를 행 배열로 반환 (파일 순서 유지, #·빈 줄 제외).
 */
export function getRuntimeEnvRows(_params?: unknown): {
  project: string
  path: string
  rows: { key: string; value: string }[]
} {
  const { project, path: runtimeEnvPath } = resolveRuntimeEnvPath()
  if (!project) {
    throw new Error("GGNR_PROJECT가 설정되어 있지 않습니다. (npm run dev -- <project> …)")
  }
  if (!existsSync(runtimeEnvPath)) {
    return { project, path: runtimeEnvPath, rows: [] }
  }
  const content = readFileSync(runtimeEnvPath, "utf-8")
  const rows: { key: string; value: string }[] = []
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (key) rows.push({ key, value })
  }
  return { project, path: runtimeEnvPath, rows }
}

/**
 * runtime.env 전체를 KEY=VALUE 행으로 덮어씁니다. 키가 비어 있는 행은 생략됩니다.
 */
export function saveRuntimeEnvRows(params: { rows: { key: string; value: string }[] }): { saved: number } {
  const rows = params?.rows
  if (!Array.isArray(rows)) {
    throw new Error("rows 배열이 필요합니다.")
  }
  const { project, path: runtimeEnvPath } = resolveRuntimeEnvPath()
  if (!project) {
    throw new Error("GGNR_PROJECT가 설정되어 있지 않습니다.")
  }
  const lines: string[] = []
  for (const r of rows) {
    const key = String(r.key ?? "").trim()
    if (!key) continue
    if (key.includes("=") || /\s/.test(key)) {
      throw new Error(`유효하지 않은 변수명: "${key}" (공백·= 사용 불가)`)
    }
    const value = String(r.value ?? "")
    lines.push(`${key}=${value}`)
  }
  const body = lines.length ? `${lines.join("\n")}\n` : ""
  writeFileSync(runtimeEnvPath, body, "utf-8")
  return { saved: lines.length }
}

/** runtime.env 의 SYSTEM_KOR_NAME (사이트/플랫폼 한글 타이틀). 없으면 기본값 반환 */
export function getSystemKorName(): string {
  const name = getRuntimeEnvVars().SYSTEM_KOR_NAME?.trim()
  return name || "공간정보 통합관리 플랫폼"
}

const DEFAULT_FOOTER_ADDR =
  "안동시 토지정보과 | 054-840-6371 | 36691 경상북도 안동시 퇴계로 115 (명륜동)"
const DEFAULT_FOOTER_RSS = "Copyright (c) 2024. ALL RIGHTS RESERVED"

function extractAddressFromFooterAddr(footerAddr: string): string {
  const parts = String(footerAddr ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
  const raw = parts[parts.length - 1] ?? ""
  return raw.replace(/^\d{5}\s+/, "").trim()
}

const SIDO_ABBREV_TO_FULL: Record<string, string> = {
  경북: "경상북도",
  경남: "경상남도",
  경상북: "경상북도",
  경상남: "경상남도",
  전북: "전북특별자치도",
  전남: "전라남도",
  전라북: "전북특별자치도",
  전라남: "전라남도",
  충북: "충청북도",
  충남: "충청남도",
  충청북: "충청북도",
  충청남: "충청남도",
  강원: "강원특별자치도",
  경기: "경기도",
  제주: "제주특별자치도",
}

const RE_SIDO_FULL = /^([가-힣]+)(특별자치도|특별자치시|특별시|광역시|도)(\s+|$)/u
const RE_SIGUNGU_TOKEN = /([가-힣]+)(시|군|구)(\s+|$)/u
const RE_SIGUNGU_HEAD = /^([가-힣]+)(시|군|구)(\s+|$)/u

function normalizeSidoToken(token: string): string {
  const t = token.trim()
  if (!t) return ""
  if (SIDO_ABBREV_TO_FULL[t]) return SIDO_ABBREV_TO_FULL[t]
  if (/도$|특별|광역/.test(t)) return t
  if ((t.endsWith("북") || t.endsWith("남")) && t.length >= 2 && !t.endsWith("도")) {
    return `${t}도`
  }
  return t
}

/** 주소 문자열 앞에서 시도·시군구명 추출 (푸터 주소·지오코딩 입력용) */
function parseSidoSigunguFromAddress(address: string): { sido: string; sigungu: string } {
  const rest0 = String(address ?? "").trim()
  if (!rest0) return { sido: "", sigungu: "" }

  let rest = rest0
  let sido = ""

  const fullSido = rest.match(RE_SIDO_FULL)
  if (fullSido) {
    sido = fullSido[1] + fullSido[2]
    rest = rest.slice(fullSido[0].length).trim()
  } else {
    const sgMatch = rest.match(RE_SIGUNGU_TOKEN)
    if (sgMatch?.index != null && sgMatch.index > 0) {
      const prefix = rest.slice(0, sgMatch.index).trim()
      const sidoToken = prefix.split(/\s+/).pop() ?? prefix
      sido = normalizeSidoToken(sidoToken)
      rest = rest.slice(sgMatch.index).trim()
    }
  }

  let sigungu = ""
  const sg = rest.match(RE_SIGUNGU_HEAD)
  if (sg) sigungu = sg[1] + sg[2]

  return { sido, sigungu }
}

async function geocodeAddressVworld(
  address: string,
  apiKey: string,
  type: "ROAD" | "PARCEL"
): Promise<{ lon: number; lat: number } | null> {
  if (!address || !apiKey) return null
  const u = new URL("https://api.vworld.kr/req/address")
  u.searchParams.set("service", "address")
  u.searchParams.set("request", "getCoord")
  u.searchParams.set("version", "2.0")
  u.searchParams.set("crs", "epsg:4326")
  u.searchParams.set("type", type)
  u.searchParams.set("address", address)
  u.searchParams.set("format", "json")
  u.searchParams.set("key", apiKey)
  try {
    const res = await fetch(u.toString(), { method: "GET", cache: "no-store" })
    if (!res.ok) return null
    const data = (await res.json()) as {
      response?: {
        status?: string
        result?: { point?: { x?: string | number; y?: string | number } }
      }
    }
    const status = String(data?.response?.status ?? "").toUpperCase()
    const lon = Number(data?.response?.result?.point?.x)
    const lat = Number(data?.response?.result?.point?.y)
    if (status !== "OK" || !Number.isFinite(lon) || !Number.isFinite(lat)) return null
    return { lon, lat }
  } catch {
    return null
  }
}

/** 인덱스 푸터: runtime.env 의 FOOTER_ADDR, FOOTER_RSS */
export function getIndexFooterConfig(_params?: unknown): {
  footerAddr: string
  footerRss: string
} {
  const vars = getRuntimeEnvVars()
  return {
    footerAddr: vars.FOOTER_ADDR?.trim() || DEFAULT_FOOTER_ADDR,
    footerRss: vars.FOOTER_RSS?.trim() || DEFAULT_FOOTER_RSS,
  }
}

/**
 * runtime.env 의 FOOTER_ADDR 마지막 주소 조각을 파싱해 기본 지도 중심 좌표를 구합니다.
 * 예: "영주시 | 054-639-6000 | 36040 경상북도 영주시 시청로 1" → "경상북도 영주시 시청로 1"
 */
export async function getDefaultMapCenterFromFooter(): Promise<{ lon: number; lat: number } | null> {
  const vars = getRuntimeEnvVars()
  const footerAddr = vars.FOOTER_ADDR?.trim() || DEFAULT_FOOTER_ADDR
  const address = extractAddressFromFooterAddr(footerAddr)
  const apiKey = vars.VWORLD_API_KEY?.trim() ?? ""
  if (!address || !apiKey) return null
  const road = await geocodeAddressVworld(address, apiKey, "ROAD")
  if (road) return road
  return geocodeAddressVworld(address, apiKey, "PARCEL")
}

/**
 * 필지분석 행정경계 고정 시도·시군구.
 * runtime.env FOOTER_ADDR 마지막 주소 조각에서 파싱 (예: build_yy → 경상북도, 영양군).
 */
export function getParcelAnalysisRegionFromFooter(_params?: unknown): {
  sido: string
  sigungu: string
} {
  const vars = getRuntimeEnvVars()
  const footerAddr = vars.FOOTER_ADDR?.trim() || DEFAULT_FOOTER_ADDR
  const address = extractAddressFromFooterAddr(footerAddr)
  return parseSidoSigunguFromAddress(address)
}

/** 지도용 클라이언트 설정 (주소 검색 등).
 * runtime.env 의 지도/외부연계 키를 반환.
 */
/** npm run dev -- <project> 로 기동한 프로젝트 키 (사이드바 메뉴 분기 등) */
export function getBootProject(_params?: unknown): { project: string } {
  return { project: (process.env.GGNR_PROJECT ?? "build_yy").trim() || "build_yy" }
}

export function getMapConfig(_params?: unknown): {
  VWORLD_API_KEY: string
  /** 브이월드 키 발급 시 등록한 서비스 URL. 2D데이터 API에서만 필요(없으면 파라미터 생략) */
  VWORLD_DOMAIN: string
  OPENAI_API_KEY: string
  SAFEMAP_API_KEY: string
  SAFETYDATA_API_KEY: string
  DATA_PORTAL_KEY: string
  dataPotalKey: string
} {
  const vars = getRuntimeEnvVars()
  const dataPortalKey =
    vars.DATA_PORTAL_KEY?.trim() ??
    vars.dataPotalKey?.trim() ??
    vars.DATA_POTAL_KEY?.trim() ??
    vars.PUBLIC_DATA_KEY?.trim() ??
    vars.DATA_GO_KR_KEY?.trim() ??
    ""
  return {
    VWORLD_API_KEY: vars.VWORLD_API_KEY?.trim() ?? '',
    VWORLD_DOMAIN: vars.VWORLD_DOMAIN?.trim() ?? '',
    OPENAI_API_KEY: vars.OPENAI_API_KEY?.trim() ?? '',
    SAFEMAP_API_KEY: vars.SAFEMAP_API_KEY?.trim() ?? '',
    SAFETYDATA_API_KEY: vars.SAFETYDATA_API_KEY?.trim() ?? '',
    DATA_PORTAL_KEY: dataPortalKey,
    dataPotalKey: dataPortalKey,
  }
}

/** 필지 연계(행망 KRAS·KOREPS·브이월드 fallback) 설정 */
export function getLandLinkageConfig(_params?: unknown): {
  useKras: boolean
  krasKey: string
  krasIp: string
  krasPort: string
  krasPath: string
  korepsKey: string
  korepsIp: string
  korepsPort: string
  korepsPath: string
  sggCode: string
  vworldKey: string
  dataPortalKey: string
  useSeum: boolean
} {
  const vars = getRuntimeEnvVars()
  const map = getMapConfig()
  /** 행망 호출: GGNR_ENV가 dev가 아닐 때만(demo·prod) */
  const ggnrEnv = (typeof process !== "undefined" ? process.env.GGNR_ENV : "")?.trim().toLowerCase() ?? ""
  return {
    useKras: ggnrEnv !== "dev",
    krasKey: vars.KRAS_KEY?.trim() ?? vars.KRAS_API_KEY?.trim() ?? "",
    krasIp: vars.KRAS_IP?.trim() ?? "",
    krasPort: vars.KRAS_PORT?.trim() ?? "",
    krasPath: vars.KRAS_PATH?.trim() ?? "",
    korepsKey: vars.KOREPS_KEY?.trim() ?? vars.KOREPS_API_KEY?.trim() ?? "",
    korepsIp: vars.KOREPS_IP?.trim() ?? vars.KRAS_IP?.trim() ?? "",
    korepsPort: vars.KOREPS_PORT?.trim() ?? vars.KRAS_PORT?.trim() ?? "",
    korepsPath: vars.KOREPS_PATH?.trim() ?? "",
    sggCode: vars.SGG_CODE?.trim() ?? "",
    vworldKey: map.VWORLD_API_KEY,
    dataPortalKey: map.DATA_PORTAL_KEY,
    /** 세움터 DB 우선. 실패·타임아웃 시 포털 */
    useSeum: true,
  }
}

const SAFETYDATA_DSSP_IF_00117 = "https://www.safetydata.go.kr/V2/api/DSSP-IF-00117"

/** 침수흔적도 DSSP-IF-00117 기본 serviceKey (`SAFETYDATA_API_KEY`가 있으면 그 값을 우선) */
const SAFETYDATA_DSSP_FALLBACK_SERVICE_KEY = "QOS949Q69S3P539V"

/**
 * 행정안전부_침수흔적도 오픈API (DSSP-IF-00117) 테스트 호출.
 * CORS·키 노출 회피를 위해 서버에서만 요청합니다.
 */
export async function fetchSafetydataDssp00117Test(params?: {
  pageNo?: number
  numOfRows?: number
  returnType?: "json" | "xml"
}): Promise<{
  httpStatus: number
  requestUrlMasked: string
  bodyPreview: string
}> {
  const vars = getRuntimeEnvVars()
  const serviceKey =
    vars.SAFETYDATA_API_KEY?.trim() || SAFETYDATA_DSSP_FALLBACK_SERVICE_KEY
  const pageNo = params?.pageNo ?? 1
  const numOfRows = Math.min(30, Math.max(1, params?.numOfRows ?? 5))
  const returnType = params?.returnType ?? "json"
  const u = new URL(SAFETYDATA_DSSP_IF_00117)
  u.searchParams.set("serviceKey", serviceKey)
  u.searchParams.set("pageNo", String(pageNo))
  u.searchParams.set("numOfRows", String(numOfRows))
  u.searchParams.set("returnType", returnType)
  const res = await fetch(u.toString(), { method: "GET", cache: "no-store" })
  const text = await res.text()
  const max = 6000
  const bodyPreview =
    text.length > max ? `${text.slice(0, max)}\n…(truncated, ${text.length} chars total)` : text
  const requestUrlMasked = `${SAFETYDATA_DSSP_IF_00117}?serviceKey=***&pageNo=${pageNo}&numOfRows=${numOfRows}&returnType=${returnType}`
  return { httpStatus: res.status, requestUrlMasked, bodyPreview }
}

const SAFETYDATA_DSSP_IF_00247 = "https://www.safetydata.go.kr/V2/api/DSSP-IF-00247"

/**
 * 행정안전부_긴급재난문자 오픈API (DSSP-IF-00247) 테스트 호출.
 */
export async function fetchSafetydataDssp00247Test(params?: {
  pageNo?: number
  numOfRows?: number
  returnType?: "json" | "xml"
  /** 조회시작일자 YYYYMMDD */
  crtDt?: string
  /** 지역명(시도명, 시군구명) */
  rgnNm?: string
}): Promise<{
  httpStatus: number
  requestUrlMasked: string
  bodyPreview: string
}> {
  const vars = getRuntimeEnvVars()
  const serviceKey =
    vars.SAFETYDATA_API_KEY?.trim() || SAFETYDATA_DSSP_FALLBACK_SERVICE_KEY
  const pageNo = params?.pageNo ?? 1
  const numOfRows = Math.min(30, Math.max(1, params?.numOfRows ?? 10))
  const returnType = params?.returnType ?? "json"
  const u = new URL(SAFETYDATA_DSSP_IF_00247)
  u.searchParams.set("serviceKey", serviceKey)
  u.searchParams.set("pageNo", String(pageNo))
  u.searchParams.set("numOfRows", String(numOfRows))
  u.searchParams.set("returnType", returnType)
  const crtDt = params?.crtDt?.trim()
  const rgnNm = params?.rgnNm?.trim()
  if (crtDt) u.searchParams.set("crtDt", crtDt)
  if (rgnNm) u.searchParams.set("rgnNm", rgnNm)
  const res = await fetch(u.toString(), { method: "GET", cache: "no-store" })
  const text = await res.text()
  const max = 6000
  const bodyPreview =
    text.length > max ? `${text.slice(0, max)}\n…(truncated, ${text.length} chars total)` : text
  const q = new URLSearchParams({
    serviceKey: "***",
    pageNo: String(pageNo),
    numOfRows: String(numOfRows),
    returnType,
  })
  if (crtDt) q.set("crtDt", crtDt)
  if (rgnNm) q.set("rgnNm", rgnNm)
  const requestUrlMasked = `${SAFETYDATA_DSSP_IF_00247}?${q.toString()}`
  return { httpStatus: res.status, requestUrlMasked, bodyPreview }
}

const SAFETYDATA_DSSP_IF_10941 = "https://www.safetydata.go.kr/V2/api/DSSP-IF-10941"

/** 통합대피소 DSSP-IF-10941 (`SAFETYDATA_SHELTER_API_KEY`가 있으면 우선) */
const SAFETYDATA_DSSP_IF10941_FALLBACK_SERVICE_KEY = "4LA6W582X92XQUO8"

/**
 * 통합대피소 오픈API (DSSP-IF-10941) 테스트 호출.
 */
export async function fetchSafetydataDssp10941Test(params?: {
  pageNo?: number
  numOfRows?: number
  returnType?: "json" | "xml"
  startLot?: string
  endLot?: string
  startLat?: string
  endLat?: string
  shlt_se_cd?: string
}): Promise<{
  httpStatus: number
  requestUrlMasked: string
  bodyPreview: string
}> {
  const vars = getRuntimeEnvVars()
  const serviceKey =
    vars.SAFETYDATA_SHELTER_API_KEY?.trim() ||
    SAFETYDATA_DSSP_IF10941_FALLBACK_SERVICE_KEY
  const pageNo = params?.pageNo ?? 1
  const numOfRows = Math.min(30, Math.max(1, params?.numOfRows ?? 10))
  const returnType = params?.returnType ?? "json"
  const u = new URL(SAFETYDATA_DSSP_IF_10941)
  u.searchParams.set("serviceKey", serviceKey)
  u.searchParams.set("pageNo", String(pageNo))
  u.searchParams.set("numOfRows", String(numOfRows))
  u.searchParams.set("returnType", returnType)
  const startLot = params?.startLot?.trim()
  const endLot = params?.endLot?.trim()
  const startLat = params?.startLat?.trim()
  const endLat = params?.endLat?.trim()
  const shlt_se_cd = params?.shlt_se_cd?.trim()
  if (startLot) u.searchParams.set("startLot", startLot)
  if (endLot) u.searchParams.set("endLot", endLot)
  if (startLat) u.searchParams.set("startLat", startLat)
  if (endLat) u.searchParams.set("endLat", endLat)
  if (shlt_se_cd) u.searchParams.set("shlt_se_cd", shlt_se_cd)
  const res = await fetch(u.toString(), { method: "GET", cache: "no-store" })
  const text = await res.text()
  const max = 6000
  const bodyPreview =
    text.length > max ? `${text.slice(0, max)}\n…(truncated, ${text.length} chars total)` : text
  const q = new URLSearchParams({
    serviceKey: "***",
    pageNo: String(pageNo),
    numOfRows: String(numOfRows),
    returnType,
  })
  if (startLot) q.set("startLot", startLot)
  if (endLot) q.set("endLot", endLot)
  if (startLat) q.set("startLat", startLat)
  if (endLat) q.set("endLat", endLat)
  if (shlt_se_cd) q.set("shlt_se_cd", shlt_se_cd)
  const requestUrlMasked = `${SAFETYDATA_DSSP_IF_10941}?${q.toString()}`
  return { httpStatus: res.status, requestUrlMasked, bodyPreview }
}

/**
 * public/image/indexImage 에서 프로젝트명_01~04 (jpg 또는 png) 경로 4개 반환.
 * ParcelSlider 배경용. 서버에서만 호출.
 */
export function getIndexSliderImages(projectName: string): string[] {
  const root = getProjectRoot()
  const dir = join(root, "public", "image", "indexImage")
  const out: string[] = []
  for (let i = 1; i <= 4; i++) {
    const base = `${projectName}_${String(i).padStart(2, "0")}`
    const jpgPath = join(dir, `${base}.jpg`)
    const pngPath = join(dir, `${base}.png`)
    if (existsSync(jpgPath)) out.push(`/image/indexImage/${base}.jpg`)
    else if (existsSync(pngPath)) out.push(`/image/indexImage/${base}.png`)
    else out.push("")
  }
  return out
}

/**
 * 인덱스·지도 헤더/사이드 로고 URL.
 * 1) {project}_index_logo.svg → 2) {project}_index_logo.png → 3) default_index_logo.svg (공간누리)
 */
export function getIndexLogoSrc(projectName?: string): string {
  const name = (projectName ?? process.env.GGNR_PROJECT ?? "build_yy").trim()
  const root = getProjectRoot()
  const dir = join(root, "public", "image", "indexImage")
  const base = `${name}_index_logo`
  if (existsSync(join(dir, `${base}.svg`))) return `/image/indexImage/${base}.svg`
  if (existsSync(join(dir, `${base}.png`))) return `/image/indexImage/${base}.png`
  return `/image/indexImage/default_index_logo.svg`
}

export type SystemConfigItem = {
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
  /** 비공개 시스템(권한·신청 UI). 미설정이면 공개로 간주 */
  sys_is_private?: boolean | null
}

/** 파일에서 systemList.config 파싱만 수행 (ENABLED_SYSTEMS 미적용) */
function readSystemListFromDisk(): {
  systems: SystemConfigItem[]
  error?: string
  debug: string
} {
  const cwd = typeof process !== "undefined" ? process.cwd() : ""
  const projectRoot = getProjectRoot()
  const systemListPath = resolveSystemListPath()
  const debug = `cwd=${cwd} | projectRoot=${projectRoot} | path=${systemListPath} | exists=${existsSync(systemListPath)}`
  if (!existsSync(systemListPath)) {
    return { systems: [], error: `systemList.config 없음: ${systemListPath}`, debug }
  }
  try {
    const raw = readFileSync(systemListPath, "utf-8")
    const data = JSON.parse(raw) as { sys?: SystemConfigItem[]; systems?: SystemConfigItem[] }
    const systems = Array.isArray(data.sys) ? data.sys : Array.isArray(data.systems) ? data.systems : []
    return { systems, debug }
  } catch (e: any) {
    return { systems: [], error: e?.message ?? "systemList.config 읽기 실패", debug }
  }
}

/**
 * systemList.config 의 sys 배열 전부 (ENABLED_SYSTEMS 무시).
 * 권한·비공개 판별, dev 시스템 목록 관리 등에 사용. 지도/인덱스 노출용은 getSystemList.
 */
export function getSystemListAll(_params?: unknown): { systems: SystemConfigItem[] } {
  const base = readSystemListFromDisk()
  if (base.error) throw new Error(base.error)
  return { systems: base.systems }
}

/**
 * systemList.config 전체 조회 (공통 시스템 목록).
 * runtime.env 의 ENABLED_SYSTEMS 가 있으면 해당 값(쉼표 구분)을 sys_key 로만 매칭해 노출.
 * 예: ENABLED_SYSTEMS=wtl,river → sys_key 가 wtl, river 인 시스템만 반환.
 * 없으면 전체 노출. 필터 결과가 0건이면 전체 목록 반환(설정 오류 방지).
 */
export function getSystemList(_params?: unknown): { systems: SystemConfigItem[] } {
  const out = getSystemListDebug()
  if (out.error) throw new Error(out.error)
  return { systems: out.systems }
}

/** 디버그용: 경로·cwd·에러 포함. 화면에서 원인 확인용 */
export function getSystemListDebug(): {
  systems: SystemConfigItem[]
  error?: string
  debug?: string
} {
  const base = readSystemListFromDisk()
  if (base.error) return { systems: [], error: base.error, debug: base.debug }
  let systems = base.systems
  const runtime = getRuntimeEnvVars()
  const enabledStr = (runtime.ENABLED_SYSTEMS ?? "").trim()
  if (enabledStr) {
    const allowedKeys = new Set(enabledStr.split(",").map((s) => s.trim()).filter(Boolean))
    if (allowedKeys.size > 0) {
      const filtered = systems.filter((s) => allowedKeys.has(s.sys_key?.trim() ?? ""))
      if (filtered.length > 0) systems = filtered
    }
  }
  /** runtime.env DISABLED_SERVICES — 프로젝트별로 사이드바 메뉴(ser_eng) 숨김 */
  const disabledStr = (runtime.DISABLED_SERVICES ?? "").trim()
  if (disabledStr) {
    const disabled = new Set(disabledStr.split(",").map((s) => s.trim()).filter(Boolean))
    if (disabled.size > 0) {
      systems = systems.map((s) => ({
        ...s,
        serviceList: (s.serviceList ?? []).filter((eng) => !disabled.has(String(eng).trim())),
      }))
    }
  }
  return { systems, debug: base.debug }
}

/**
 * systemList.config 전체 저장
 */
export function saveSystemList(params: { systems: SystemConfigItem[] }): { saved: number } {
  const systems = params?.systems
  if (!Array.isArray(systems)) {
    throw new Error("systems 배열이 필요합니다.")
  }

  const normalized = systems.map((s) => {
    const row: SystemConfigItem = {
      sys_key: String(s.sys_key ?? "").trim(),
      sys_kor: String(s.sys_kor ?? "").trim(),
      sys_eng: s.sys_eng != null ? String(s.sys_eng).trim() : "",
      sys_detail: s.sys_detail != null ? String(s.sys_detail).trim() : "",
      sys_img: String(s.sys_img ?? "").trim(),
      sys_idx: Number(s.sys_idx) || 0,
      sys_col: String(s.sys_col ?? "").trim(),
      sys_link: String(s.sys_link ?? "").trim(),
      serviceList: Array.isArray(s.serviceList) ? s.serviceList : [],
      layerList: Array.isArray(s.layerList) ? s.layerList : [],
    }
    if (s.sys_is_private === true) row.sys_is_private = true
    else if (s.sys_is_private === false) row.sys_is_private = false
    return row
  })

  const content = JSON.stringify({ sys: normalized }, null, 2)
  const systemListPath = resolveSystemListPath()
  writeFileSync(systemListPath, content, "utf-8")
  return { saved: normalized.length }
}

export type SerConfigLayerRule = {
  layer_name: string | null
  identify: string | null
  url_property?: string | null
}

export type SerConfigItem = {
  ser_menu: string | null
  ser_cat: string | null
  ser_kor: string | null
  ser_eng: string | null
  ser_type: string | null
  ser_work_type: string | null
  ser_is_private: boolean | null
  ser_has_contents: boolean | null
  ser_has_file: boolean | null
  ser_data_table: string | null
  ser_data_query: string | null
  ser_idx: number | null
  ser_url: string | null
  ser_is_del: boolean | null
  ser_svg: string | null
  /** 지도 식별 시 패널 열림 + 레이어별 동작 (예: open_scan) */
  ser_layers?: SerConfigLayerRule[] | null
}

/**
 * serviceList.config 전체 조회 (공통 기능 목록).
 * 호출 시마다 경로를 계산하고 파일을 읽어 재시작 없이 반영됩니다.
 */
export function getServiceList(_params?: unknown): { ser: SerConfigItem[] } {
  const serviceListPath = resolveConfigPath("serviceList.config")
  try {
    const raw = readFileSync(serviceListPath, "utf-8")
    const data = JSON.parse(raw) as { ser?: SerConfigItem[] }
    const ser = Array.isArray(data.ser) ? data.ser : []
    return { ser }
  } catch (e: any) {
    throw new Error(e?.message ?? "serviceList.config 읽기 실패")
  }
}

/**
 * serviceList.config 전체 저장
 */
export function saveServiceList(params: { ser: SerConfigItem[] }): { saved: number } {
  const ser = params?.ser
  if (!Array.isArray(ser)) {
    throw new Error("ser 배열이 필요합니다.")
  }
  const normalized = ser.map((s) => ({
    ser_menu: s.ser_menu ?? null,
    ser_cat: s.ser_cat ?? null,
    ser_kor: s.ser_kor ?? null,
    ser_eng: s.ser_eng ?? null,
    ser_type: s.ser_type ?? null,
    ser_work_type: s.ser_work_type ?? null,
    ser_is_private: s.ser_is_private ?? null,
    ser_has_contents: s.ser_has_contents ?? null,
    ser_has_file: s.ser_has_file ?? null,
    ser_data_table: s.ser_data_table ?? null,
    ser_data_query: s.ser_data_query ?? null,
    ser_idx: s.ser_idx ?? null,
    ser_url: s.ser_url ?? null,
    ser_is_del: s.ser_is_del ?? null,
    ser_svg: s.ser_svg ?? null,
  }))
  const content = JSON.stringify({ ser: normalized }, null, 2)
  const serviceListPath = resolveConfigPath("serviceList.config")
  writeFileSync(serviceListPath, content, "utf-8")
  return { saved: normalized.length }
}

/** runtime.env ENABLED_SYSTEMS 원문 (필지분석 시설 카탈로그 필터) */
export function getEnabledSystemsRaw(_params?: unknown): string {
  return (getRuntimeEnvVars().ENABLED_SYSTEMS ?? "").trim()
}

/** 필지분석 MapCapture WMS 설정 */
export function getParcelAnalysisMapConfig(_params?: unknown): {
  geoserverUrl: string
  workspace: string
} {
  const geoserverUrl = (process.env.GEOSERVER_URL ?? "http://localhost:8080/geoserver").replace(/\/$/, "")
  // 메인 지도(serviceLayerFactory)와 동일하게 ggnr 워크스페이스 고정
  const workspace = "ggnr"
  return { geoserverUrl, workspace }
}
