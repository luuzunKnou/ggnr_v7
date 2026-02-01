/**
 * Config 파일 읽기/쓰기 (systemList.config 등)
 * - 서버 측에서만 실행되며, 프로젝트 src/config 경로를 사용합니다.
 */
import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const CONFIG_DIR = join(process.cwd(), "src/config")
const SYSTEM_LIST_PATH = join(CONFIG_DIR, "systemList.config")
const SERVICE_LIST_PATH = join(CONFIG_DIR, "serviceList.config")

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
 * systemList.config 전체 조회 (공통 시스템 목록)
 */
export function getSystemList(_params?: unknown): { systems: SystemConfigItem[] } {
  try {
    const raw = readFileSync(SYSTEM_LIST_PATH, "utf-8")
    const data = JSON.parse(raw) as { sys?: SystemConfigItem[]; systems?: SystemConfigItem[] }
    const systems = Array.isArray(data.sys) ? data.sys : Array.isArray(data.systems) ? data.systems : []
    return { systems }
  } catch (e: any) {
    throw new Error(e?.message ?? "systemList.config 읽기 실패")
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
  writeFileSync(SYSTEM_LIST_PATH, content, "utf-8")
  return { saved: normalized.length }
}

export type SerConfigItem = {
  ser_key: number | null
  ser_dep1: string | null
  ser_dep2: string | null
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
}

/**
 * serviceList.config 전체 조회 (공통 기능 목록)
 */
export function getServiceList(_params?: unknown): { ser: SerConfigItem[] } {
  try {
    const raw = readFileSync(SERVICE_LIST_PATH, "utf-8")
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
    ser_key: s.ser_key ?? null,
    ser_dep1: s.ser_dep1 ?? null,
    ser_dep2: s.ser_dep2 ?? null,
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
  }))
  const content = JSON.stringify({ ser: normalized }, null, 2)
  writeFileSync(SERVICE_LIST_PATH, content, "utf-8")
  return { saved: normalized.length }
}
