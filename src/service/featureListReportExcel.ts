/**
 * 기능 목록 보고서 엑셀 (시스템별 기능목록 + 기능목록별 설명).
 * — 호출측에서 ENABLED_SYSTEMS 필터된 systems·serviceList 를 넘긴다.
 */
import * as XLSX from "xlsx-js-style"

export type FeatureListReportSystem = {
  sys_key: string
  sys_kor: string | null
  serviceList: string[]
}

export type FeatureListReportRemark = {
  func_type?: string | null
  func_content?: string | null
  func_desc?: string | null
}

export type FeatureListReportService = {
  ser_kor: string | null
  ser_eng: string | null
  ser_remark?: FeatureListReportRemark[] | null
}

type CellStyle = {
  font?: { bold?: boolean }
  alignment?: { vertical?: string; horizontal?: string; wrapText?: boolean }
}

type ExcelCell = { v: string; t: "s"; s: CellStyle }

type UiRow = { kind: string; ui: string; desc: string }

const headerStyle: CellStyle = {
  font: { bold: true },
  alignment: { vertical: "center", horizontal: "center", wrapText: true },
}
const cellStyle: CellStyle = { alignment: { vertical: "center", wrapText: true } }
const topStyle: CellStyle = { alignment: { vertical: "top", wrapText: true } }

function cell(v: string, style: CellStyle = cellStyle): ExcelCell {
  return { v: v ?? "", t: "s", s: style }
}

function kindLabel(funcType: string | null | undefined): string {
  const t = String(funcType ?? "")
    .trim()
    .toLowerCase()
  if (t === "main") return "주요"
  if (t === "extra") return "추가"
  return String(funcType ?? "").trim()
}

function serviceLabel(ser: FeatureListReportService): string {
  const kor = (ser.ser_kor ?? "").trim() || (ser.ser_eng ?? "")
  const eng = (ser.ser_eng ?? "").trim()
  return eng ? `${kor}(${eng})` : kor
}

function systemLabel(sys: FeatureListReportSystem): string {
  const kor = (sys.sys_kor ?? "").trim() || sys.sys_key
  const key = (sys.sys_key ?? "").trim()
  return key ? `${kor}(${key})` : kor
}

function remarkRows(ser: FeatureListReportService): UiRow[] {
  const raw = ser.ser_remark
  if (!Array.isArray(raw) || raw.length === 0) return [{ kind: "", ui: "", desc: "" }]
  const rows: UiRow[] = raw
    .map((r) => ({
      kind: kindLabel(r?.func_type),
      ui: String(r?.func_content ?? "").trim(),
      desc: String(r?.func_desc ?? "").trim(),
    }))
    .filter((r) => r.kind || r.ui || r.desc)
  if (!rows.length) return [{ kind: "", ui: "", desc: "" }]
  rows.sort((a, b) => {
    if (a.kind === "주요" && b.kind !== "주요") return -1
    if (b.kind === "주요" && a.kind !== "주요") return 1
    return a.ui.localeCompare(b.ui, "ko")
  })
  return rows
}

function padDateStamp(): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
}

function buildSystemSheet(
  systems: FeatureListReportSystem[],
  serByEng: Map<string, FeatureListReportService>,
  envLabel: string
): { aoa: ExcelCell[][]; cols: { wch: number }[] } {
  const aoa: ExcelCell[][] = [
    [
      cell("시스템명(시스템키)", headerStyle),
      cell("사용 env", headerStyle),
      cell("서비스명(서비스키)", headerStyle),
      cell("UI구분", headerStyle),
      cell("UI내용", headerStyle),
      cell("기능 설명", headerStyle),
    ],
  ]

  const sortedSystems = [...systems].sort((a, b) => {
    if (a.sys_key === "index") return -1
    if (b.sys_key === "index") return 1
    return systemLabel(a).localeCompare(systemLabel(b), "ko")
  })

  for (const sys of sortedSystems) {
    const sysText = systemLabel(sys)
    const engList = Array.isArray(sys.serviceList) ? sys.serviceList : []
    const services = engList
      .map((eng) => serByEng.get(String(eng).trim()))
      .filter((s): s is FeatureListReportService => !!s && !!(s.ser_eng ?? "").trim())

    if (!services.length) {
      aoa.push([
        cell(sysText, topStyle),
        cell(envLabel, topStyle),
        cell("", cellStyle),
        cell("", cellStyle),
        cell("", cellStyle),
        cell("", cellStyle),
      ])
      continue
    }

    for (const ser of services) {
      const label = serviceLabel(ser)
      for (const ur of remarkRows(ser)) {
        aoa.push([
          cell(sysText, topStyle),
          cell(envLabel, topStyle),
          cell(label, cellStyle),
          cell(ur.kind, cellStyle),
          cell(ur.ui, cellStyle),
          cell(ur.desc, cellStyle),
        ])
      }
    }
  }

  return {
    aoa,
    cols: [{ wch: 36 }, { wch: 36 }, { wch: 36 }, { wch: 8 }, { wch: 28 }, { wch: 72 }],
  }
}

function buildServiceSheet(
  systems: FeatureListReportSystem[],
  serByEng: Map<string, FeatureListReportService>,
  envLabel: string
): { aoa: ExcelCell[][]; cols: { wch: number }[] } {
  type Entry = {
    label: string
    sysKeys: Set<string>
    ui: Map<string, UiRow>
  }
  const byEng = new Map<string, Entry>()
  const sysMeta = new Map(systems.map((s) => [s.sys_key, systemLabel(s)]))

  for (const sys of systems) {
    const engList = Array.isArray(sys.serviceList) ? sys.serviceList : []
    for (const engRaw of engList) {
      const eng = String(engRaw).trim()
      if (!eng) continue
      const ser = serByEng.get(eng)
      if (!ser) continue
      if (!byEng.has(eng)) {
        byEng.set(eng, { label: serviceLabel(ser), sysKeys: new Set(), ui: new Map() })
      }
      const entry = byEng.get(eng)!
      entry.sysKeys.add(sys.sys_key)
      for (const ur of remarkRows(ser)) {
        if (!ur.kind && !ur.ui) continue
        const uk = `${ur.kind}\t${ur.ui}`
        if (!entry.ui.has(uk)) entry.ui.set(uk, { ...ur })
        else if (ur.desc && !entry.ui.get(uk)!.desc) entry.ui.get(uk)!.desc = ur.desc
      }
    }
  }

  const services = [...byEng.entries()].sort((a, b) => {
    const korA = a[1].label.replace(/\([^)]*\)\s*$/, "").trim()
    const korB = b[1].label.replace(/\([^)]*\)\s*$/, "").trim()
    const c = korA.localeCompare(korB, "ko")
    if (c !== 0) return c
    return a[0].localeCompare(b[0])
  })

  const aoa: ExcelCell[][] = [
    [
      cell("서비스명(서비스키)", headerStyle),
      cell("사용 시스템", headerStyle),
      cell("사용 env", headerStyle),
      cell("UI구분", headerStyle),
      cell("UI내용", headerStyle),
      cell("기능 설명", headerStyle),
    ],
  ]

  for (const [, entry] of services) {
    const keys = [...entry.sysKeys].sort((a, b) => {
      if (a === "index") return -1
      if (b === "index") return 1
      return (sysMeta.get(a) || a).localeCompare(sysMeta.get(b) || b, "ko")
    })
    const sysText = keys.map((k) => sysMeta.get(k) || k).join("\n")
    const uiRows = [...entry.ui.values()]
    uiRows.sort((a, b) => {
      if (a.kind === "주요" && b.kind !== "주요") return -1
      if (b.kind === "주요" && a.kind !== "주요") return 1
      return a.ui.localeCompare(b.ui, "ko")
    })
    if (!uiRows.length) uiRows.push({ kind: "", ui: "", desc: "" })

    for (const ur of uiRows) {
      aoa.push([
        cell(entry.label, cellStyle),
        cell(sysText, topStyle),
        cell(envLabel, topStyle),
        cell(ur.kind, cellStyle),
        cell(ur.ui, cellStyle),
        cell(ur.desc, cellStyle),
      ])
    }
  }

  return {
    aoa,
    cols: [{ wch: 36 }, { wch: 36 }, { wch: 36 }, { wch: 8 }, { wch: 28 }, { wch: 72 }],
  }
}

function sheetFromAoa(aoa: ExcelCell[][], cols: { wch: number }[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws["!cols"] = cols
  ws["!rows"] = aoa.map(() => ({ hpt: 18 }))
  return ws
}

export function buildFeatureListReportBuffer(params: {
  systems: FeatureListReportSystem[]
  services: FeatureListReportService[]
  envLabel: string
  projectId: string
}): { buffer: Buffer; fileName: string } {
  const serByEng = new Map<string, FeatureListReportService>()
  for (const s of params.services) {
    const eng = (s.ser_eng ?? "").trim()
    if (eng) serByEng.set(eng, s)
  }

  const sysSheet = buildSystemSheet(params.systems, serByEng, params.envLabel)
  const serSheet = buildServiceSheet(params.systems, serByEng, params.envLabel)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheetFromAoa(sysSheet.aoa, sysSheet.cols), "시스템별 기능목록")
  XLSX.utils.book_append_sheet(wb, sheetFromAoa(serSheet.aoa, serSheet.cols), "기능목록별 설명")

  const raw = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
  const project = params.projectId.trim() || "project"
  const fileName = `${padDateStamp()}_${project}_기능목록_보고서.xlsx`
  return { buffer, fileName }
}
