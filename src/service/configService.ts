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

/** 현재 프로젝트의 src/config/projects/<project>.runtime.env 를 읽어 키-값 맵 반환 (재시작 없이 실시간 반영) */
function getRuntimeEnvVars(): Record<string, string> {
  const root = getProjectRoot()
  const project = typeof process !== "undefined" ? process.env.GGNR_PROJECT : ""
  if (!project || typeof project !== "string") return {}
  const runtimeEnvPath = join(root, "src", "config", "projects", `${project.trim()}.runtime.env`)
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

/** runtime.env 의 SYSTEM_KOR_NAME (사이트/플랫폼 한글 타이틀). 없으면 기본값 반환 */
export function getSystemKorName(): string {
  const name = getRuntimeEnvVars().SYSTEM_KOR_NAME?.trim()
  return name || "공간정보 통합관리 플랫폼"
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
    let systems = Array.isArray(data.sys) ? data.sys : Array.isArray(data.systems) ? data.systems : []
    const enabledStr = (getRuntimeEnvVars().ENABLED_SYSTEMS ?? "").trim()
    if (enabledStr) {
      const allowedKeys = new Set(enabledStr.split(",").map((s) => s.trim()).filter(Boolean))
      if (allowedKeys.size > 0) {
        const filtered = systems.filter((s) => allowedKeys.has(s.sys_key?.trim() ?? ""))
        if (filtered.length > 0) systems = filtered
      }
    }
    return { systems, debug }
  } catch (e: any) {
    return { systems: [], error: e?.message ?? "systemList.config 읽기 실패", debug }
  }
}

/**
 * systemList.config 전체 저장
 */
export function saveSystemList(params: { systems: SystemConfigItem[] }): { saved: number } {
  const systems = params?.systems
  if (!Array.isArray(systems)) {
    throw new Error("systems 배열이 필요합니다.")
  }

  const normalized = systems.map((s) => ({
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
  }))

  const content = JSON.stringify({ sys: normalized }, null, 2)
  const systemListPath = resolveSystemListPath()
  writeFileSync(systemListPath, content, "utf-8")
  return { saved: normalized.length }
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
