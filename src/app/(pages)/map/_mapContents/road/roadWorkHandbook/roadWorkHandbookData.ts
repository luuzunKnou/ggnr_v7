/** 도로 업무편람 — 설계실무요령 한글 자료·행정절차 대상여부 */

import {
  HANDBOOK_MATERIALS as HANDBOOK_MATERIALS_RAW,
  handbookLawMaterialHasAttachments,
  type HandbookLawXmlKey,
} from "./roadWorkHandbookMaterials"

export { LAW_XML, type HandbookLawXmlKey } from "./roadWorkHandbookMaterials"

export type HandbookFile = {
  name: string
  src: string
  url?: string
}

export type HandbookMaterial = {
  id: string
  /** HWP 장 번호 (예: 1·2, 8·9) */
  chapter: string
  /** 인용 법규·자료명 */
  name: string
  /** HWP 자료 출처 */
  source: string
  /** 법령정보센터 XML API — 상세에서 첨부파일 조회 */
  lawXmlKey?: HandbookLawXmlKey
  /** 첨부 없을 때 법령 원문 페이지 */
  lawViewUrl?: string
  /** HWP 비고만 있고 연결 자료 없음 (도서 참조 등) */
  notesOnly?: boolean
  /** 목록 배지 문구 (기본: 내려받기·원문·준비중) */
  listAccessLabel?: string
  desc?: string
  files: HandbookFile[]
}

/** 설계실무요령 HWP 장별 소제목 (2026년 HWP «인용 법규 및 자료 출처» 기준) */
export const HANDBOOK_CHAPTER_LABELS: Record<string, string> = {
  "1·2": "1,2장. 적용범위, 실시설계용역",
  "3": "3장. 단가 및 수량산출 기준",
  "4": "4장. 품셈 개정 내용",
  "5": "5장. 공사 원가계산 요령",
  "6": "6장. 중기사용료",
  "7": "7장. 공통단가",
  "8·9": "8,9장. 교통안전시설",
  "10": "10장. 관급자재",
  "11": "11장. 표준시장단가 적용",
  "12": "12장. 기타참고사항",
}

export function handbookChapterLabel(chapter: string): string {
  return HANDBOOK_CHAPTER_LABELS[chapter] ?? `${chapter.replace(/·/g, ",")}장`
}

export type HandbookFileAccess = "download" | "link" | "none"

export type HandbookOrg = "별도" | "대가없음" | "과업포함"

export type HandbookDetailSelection =
  | { kind: "target"; no: number }
  | { kind: "ref"; materialId: string }

export type HandbookViewMode = "target" | "ref"

export function handbookMapSessionKey(
  mode: HandbookViewMode,
  sel: HandbookDetailSelection | null
): string | null {
  if (mode === "ref") {
    if (sel?.kind === "ref") return `m-${sel.materialId}`
    return null
  }
  return "target"
}

export function isSameHandbookDetail(
  a: HandbookDetailSelection | null,
  b: HandbookDetailSelection | null
): boolean {
  if (a == null || b == null) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === "target" && b.kind === "target") return a.no === b.no
  return a.kind === "ref" && b.kind === "ref" && a.materialId === b.materialId
}

export type HandbookExampleNumberField = {
  key: string
  label: string
  kind?: "number"
  unit: string
  placeholder: string
  hint: string
}

export type HandbookExampleSelectField = {
  key: string
  label: string
  kind: "select"
  options: { value: string; label: string }[]
}

export type HandbookExampleField = HandbookExampleNumberField | HandbookExampleSelectField

export type HandbookExampleKind =
  | "newWiden"
  | "zoneArea"
  | "newLen5"
  | "roadTypeLen"
  | "disaster"
  | "area30000"
  | "cost100"
  | "cost50"
  | "facilityOrCost"

export type HandbookProcedure = {
  no: number
  name: string
  law: string
  criteria: string
  criteriaItems: string[]
  when: string
  org: HandbookOrg
  note?: string
  examples?: HandbookExampleField[]
  exampleKind?: HandbookExampleKind
  formulaHint?: string
}

function readNum(vals: Record<string, string>, key: string): number | null {
  const raw = vals[key]?.trim()
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("ko-KR") : n.toLocaleString("ko-KR", { maximumFractionDigits: 2 })
}

const ZONE_LIMIT: Record<string, { name: string; limit: number }> = {
  보전관리: { name: "보전관리지역", limit: 5000 },
  생산관리: { name: "생산관리지역", limit: 7500 },
  계획관리: { name: "계획관리지역", limit: 10000 },
  농림: { name: "농림지역", limit: 7500 },
  자연환경보전: { name: "자연환경보전지역", limit: 5000 },
}

const ROAD_LEN_LIMIT: Record<string, { name: string; limit: number }> = {
  국도: { name: "일반국도·고속국도", limit: 5 },
  지방도: { name: "특별시·광역시·지방도", limit: 3 },
  시도: { name: "시도·군도·구도", limit: 1 },
}

export type HandbookGuideTone = "met" | "unmet" | "info"

export type HandbookGuideLine = {
  text: string
  tone: HandbookGuideTone
}

export function parseHandbookLaw(law: string): { name: string; articles: string | null } {
  const raw = law.trim()
  const matched = raw.match(/^(.*?)\s+(제\d.*)$/)
  if (!matched) return { name: raw, articles: null }
  return { name: matched[1].trim(), articles: matched[2].trim() }
}

function guide(tone: HandbookGuideTone, text: string): HandbookGuideLine {
  return { tone, text }
}

export function withDerivedScaleVals(vals: Record<string, string>): Record<string, string> {
  const next = { ...vals }
  if (!next.len?.trim()) {
    const n = readNum(next, "new_km") ?? 0
    const w = readNum(next, "widen_km") ?? 0
    if (n + w > 0) next.len = String(n + w)
  }
  return next
}

export type HandbookMatchStatus = "met" | "unmet" | "wait" | "check"

export const HANDBOOK_MATCH_LABEL: Record<HandbookMatchStatus, string> = {
  met: "해당",
  unmet: "미만",
  wait: "입력필요",
  check: "판단",
}

export function matchHandbookProcedure(
  proc: HandbookProcedure,
  vals: Record<string, string>
): HandbookMatchStatus {
  if (!proc.exampleKind) return "check"
  const lines = explainHandbookExample(proc, vals)
  if (lines.length === 0) return "wait"
  if (lines.some((line) => line.tone === "met")) return "met"
  if (lines.some((line) => line.tone === "unmet")) return "unmet"
  return "wait"
}

export const HANDBOOK_SCALE_FIELDS: HandbookExampleField[] = [
  { key: "new_km", label: "신설구간", unit: "km", placeholder: "예: 4", hint: "4km 이상" },
  { key: "widen_km", label: "확장구간", unit: "km", placeholder: "예: 10", hint: "10km 이상" },
  { key: "area", label: "사업면적", unit: "㎡", placeholder: "예: 5000", hint: "㎡" },
  {
    key: "zone",
    label: "용도지역",
    kind: "select",
    options: [
      { value: "보전관리", label: "보전관리지역 · 5,000㎡ 이상" },
      { value: "생산관리", label: "생산관리지역 · 7,500㎡ 이상" },
      { value: "계획관리", label: "계획관리지역 · 10,000㎡ 이상" },
      { value: "농림", label: "농림지역 · 7,500㎡ 이상" },
      { value: "자연환경보전", label: "자연환경보전지역 · 5,000㎡ 이상" },
    ],
  },
  {
    key: "roadType",
    label: "도로 종류",
    kind: "select",
    options: [
      { value: "국도", label: "일반국도·고속국도 · 5km 이상" },
      { value: "지방도", label: "특별시·광역시·지방도 · 3km 이상" },
      { value: "시도", label: "시도·군도·구도 · 1km 이상" },
    ],
  },
  { key: "cost", label: "총공사비", unit: "억원", placeholder: "예: 100", hint: "억원" },
  {
    key: "facility",
    label: "1·2종 시설물",
    kind: "select",
    options: [
      { value: "없음", label: "미포함" },
      { value: "포함", label: "포함" },
    ],
  },
]

export function explainHandbookExample(proc: HandbookProcedure, rawVals: Record<string, string>): HandbookGuideLine[] {
  const kind = proc.exampleKind
  if (!kind) return []
  const vals = withDerivedScaleVals(rawVals)

  if (kind === "newWiden") {
    const n = readNum(vals, "new_km")
    const w = readNum(vals, "widen_km")
    if (n == null && w == null) return []
    const newKm = n ?? 0
    const widenKm = w ?? 0
    const ratio = newKm / 4 + widenKm / 10
    const lines: HandbookGuideLine[] = []
    if (n != null) {
      lines.push(
        n >= 4
          ? guide("met", `신설 ${fmtNum(n)}km는 4km 이상 기준에 해당합니다. 도시지역 신설이면 폭 25m 이상인지도 함께 봅니다.`)
          : guide("unmet", `신설 ${fmtNum(n)}km는 단독 신설 기준(4km 이상)에는 미치지 않습니다.`)
      )
    }
    if (w != null) {
      lines.push(
        w >= 10
          ? guide("met", `확장 ${fmtNum(w)}km는 10km 이상 기준에 해당합니다. 왕복 2차로 이상 기존 도로 확장인지도 함께 봅니다.`)
          : guide("unmet", `확장 ${fmtNum(w)}km는 단독 확장 기준(10km 이상)에는 미치지 않습니다.`)
      )
    }
    if (n != null && w != null) {
      lines.push(
        ratio >= 1
          ? guide("met", `신설·확장 합산식은 ${ratio.toFixed(2)}로 1 이상이므로, 병행 규모로도 대상입니다.`)
          : guide("unmet", `신설·확장 합산식은 ${ratio.toFixed(2)}로 1 미만입니다. 신설 4km 또는 확장 10km에 각각 못 미치면 대상이 아닙니다.`)
      )
    } else if ((n != null && n > 0 && n < 4) || (w != null && w > 0 && w < 10)) {
      lines.push(guide("info", "신설과 확장을 함께 넣으면 (신설합/4km)+(확장합/10km) ≥ 1 인지도 볼 수 있습니다."))
    }
    if (proc.no === 1) {
      lines.push(guide("info", "재협의(도시·군관리계획 증가분 6만㎡·1만㎡)는 이 입력으로 판단하지 않습니다."))
    }
    return lines
  }

  if (kind === "zoneArea") {
    const zone = vals.zone?.trim() || ""
    const area = readNum(vals, "area")
    const meta = ZONE_LIMIT[zone]
    if (!zone && area == null) return []
    if (!meta) {
      return area == null ? [] : [guide("info", "용도지역을 고르면 해당 지역 면적 기준과 비교합니다.")]
    }
    if (area == null) {
      return [guide("info", `${meta.name} 기준은 ${fmtNum(meta.limit)}㎡ 이상입니다. 사업면적을 넣으면 비교합니다.`)]
    }
    return [
      guide("info", `${meta.name} 기준은 ${fmtNum(meta.limit)}㎡ 이상입니다.`),
      area >= meta.limit
        ? guide("met", `입력한 ${fmtNum(area)}㎡는 이 기준에 해당하므로 소규모환경영향평가 대상 규모입니다.`)
        : guide("unmet", `입력한 ${fmtNum(area)}㎡는 기준에 미치지 않습니다.`),
    ]
  }

  if (kind === "newLen5") {
    const n = readNum(vals, "new_km")
    if (n == null) return []
    return n >= 5
      ? [
          guide("met", `신설 총길이 ${fmtNum(n)}km는 5km 이상 기준에 해당합니다.`),
          guide("info", "도시계획시설 도로로서 인터체인지·교차부·다른 간선도로 접속부가 있는지도 함께 봅니다."),
        ]
      : [
          guide("unmet", `신설 총길이 ${fmtNum(n)}km는 5km 이상 기준에 미치지 않습니다.`),
          guide("info", "접속부 요건과 별개로, 길이 규모만 보면 대상이 아닙니다."),
        ]
  }

  if (kind === "roadTypeLen") {
    const road = vals.roadType?.trim() || ""
    const len = readNum(vals, "len")
    const meta = ROAD_LEN_LIMIT[road]
    if (!road && len == null) return []
    if (!meta) {
      return len == null ? [] : [guide("info", "도로 종류를 고르면 해당 도로의 길이 기준(5·3·1km)과 비교합니다.")]
    }
    if (len == null) {
      return [guide("info", `${meta.name} 기준은 총 길이 ${fmtNum(meta.limit)}km 이상입니다. 총연장을 넣으면 비교합니다.`)]
    }
    return [
      guide("info", `${meta.name} 기준은 총 길이 ${fmtNum(meta.limit)}km 이상입니다.`),
      len >= meta.limit
        ? guide("met", `입력한 ${fmtNum(len)}km는 이 기준에 해당합니다.`)
        : guide("unmet", `입력한 ${fmtNum(len)}km는 기준에 미치지 않습니다.`),
    ]
  }

  if (kind === "disaster") {
    const area = readNum(vals, "area")
    const len = readNum(vals, "len")
    if (area == null && len == null) return []
    const lines: HandbookGuideLine[] = []
    let evalHit = false
    let reviewHit = false
    if (area != null) {
      if (area >= 50000) {
        evalHit = true
        lines.push(guide("met", `부지면적 ${fmtNum(area)}㎡는 5만㎡ 이상으로 재해영향평가 대상입니다.`))
      } else if (area >= 5000) {
        reviewHit = true
        lines.push(guide("met", `부지면적 ${fmtNum(area)}㎡는 5천㎡ 이상 5만㎡ 미만으로 재해영향성검토 대상입니다.`))
      } else {
        lines.push(guide("unmet", `부지면적 ${fmtNum(area)}㎡는 재해영향성검토 하한(5천㎡)에 미치지 않습니다.`))
      }
    }
    if (len != null) {
      if (len >= 10) {
        evalHit = true
        lines.push(guide("met", `길이 ${fmtNum(len)}km는 10km 이상으로 재해영향평가 대상입니다.`))
      } else if (len >= 2) {
        reviewHit = true
        lines.push(guide("met", `길이 ${fmtNum(len)}km는 2km 이상 10km 미만으로 재해영향성검토 대상입니다.`))
      } else {
        lines.push(guide("unmet", `길이 ${fmtNum(len)}km는 검토 하한(2km)에 미치지 않습니다.`))
      }
    }
    if (evalHit) {
      lines.push(guide("met", "면적·길이 중 하나라도 평가 규모이면 재해영향평가로 봅니다."))
    } else if (reviewHit) {
      lines.push(guide("info", "평가 규모는 아니고, 재해영향성검토 대상입니다. 도시·군계획시설 결정은 5천㎡ 또는 2km 이상이면 해당합니다."))
    } else {
      lines.push(guide("unmet", "입력한 면적·길이만 보면 검토·평가 대상 규모에 해당하지 않습니다."))
    }
    return lines
  }

  if (kind === "area30000") {
    const area = readNum(vals, "area")
    if (area == null) return []
    return area >= 30000
      ? [
          guide("met", `사업면적 ${fmtNum(area)}㎡는 3만㎡ 이상 기준에 해당합니다.`),
          guide("info", "같은 목적으로 분할·연접 개발하면 전체 면적을 합산하고, 매장문화재 유존지역은 제외합니다."),
        ]
      : [
          guide("unmet", `사업면적 ${fmtNum(area)}㎡는 3만㎡ 이상 기준에 미치지 않습니다.`),
          guide("info", "분할·연접 개발이면 합산 면적으로 다시 봅니다."),
        ]
  }

  if (kind === "cost100") {
    const cost = readNum(vals, "cost")
    if (cost == null) return []
    const met = cost >= 100
    const head = met
      ? guide("met", `총공사비 ${fmtNum(cost)}억원은 100억원 이상 기준에 해당합니다.`)
      : guide("unmet", `총공사비 ${fmtNum(cost)}억원은 100억원 이상 기준에 미치지 않습니다.`)
    if (proc.no === 8) {
      return [
        head,
        met
          ? guide("met", "기본설계·실시설계의 설계VE 대상 규모입니다.")
          : guide("unmet", "공사비만 보면 설계VE 대상이 아닙니다."),
        guide("info", "시공 중 10% 이상 조정, 실시설계 완료 후 3년 경과 발주, 발주청이 필요하다고 인정하는 경우는 공사비와 별도로 해당될 수 있습니다."),
      ]
    }
    return [
      head,
      met ? guide("met", "설계심의 대상 규모입니다.") : guide("unmet", "공사비만 보면 설계심의 대상이 아닙니다."),
      guide("info", "기술자문위원회 자문을 받은 공사와 국토교통부령으로 정하는 공사(설계용역 건설사업관리 등)는 제외됩니다."),
    ]
  }

  if (kind === "cost50") {
    const cost = readNum(vals, "cost")
    if (cost == null) return []
    return cost >= 50
      ? [
          guide("met", `총공사금액 ${fmtNum(cost)}억원은 50억원 이상 기준에 해당합니다.`),
          guide("info", "설계단계에서 설계안전보건대장을 작성하고, 계획·시공 단계 대장과 이어집니다."),
        ]
      : [
          guide("unmet", `총공사금액 ${fmtNum(cost)}억원은 50억원 이상 기준에 미치지 않습니다.`),
          guide("info", "이 금액 기준만 보면 설계안전보건대장 작성 대상이 아닙니다."),
        ]
  }

  const facility = vals.facility?.trim() || ""
  const cost = readNum(vals, "cost")
  if (!facility && cost == null) return []
  const lines: HandbookGuideLine[] = []
  if (facility === "포함") {
    lines.push(guide("met", "1·2종 시설물이 포함되면 공사비와 관계없이 기본·실시설계용역의 건설사업관리 대상입니다."))
  } else if (facility === "없음") {
    lines.push(guide("info", "1·2종 시설물이 없으면 총공사비 300억원 이상인지를 봅니다."))
  } else {
    lines.push(guide("info", "1·2종 시설물 여부를 고르면 공사비와 함께 판단할 수 있습니다."))
  }
  if (cost != null) {
    if (cost >= 300) {
      lines.push(guide("met", `총공사비 ${fmtNum(cost)}억원은 300억원 이상 기준에 해당합니다.`))
    } else {
      lines.push(guide("unmet", `총공사비 ${fmtNum(cost)}억원은 300억원 이상 기준에 미치지 않습니다.`))
    }
  }
  if (facility === "포함" || (cost != null && cost >= 300)) {
    lines.push(guide("met", "위 규모만 보면 건설사업관리(설계감리) 대상입니다. 신공법·특수공법은 발주청 판단입니다."))
  } else if (facility === "없음" && cost != null && cost < 300) {
    lines.push(guide("unmet", "1·2종 미포함이고 300억원 미만이면, 이 두 기준으로는 대상이 아닙니다. 신공법·특수공법은 발주청 판단입니다."))
  }
  return lines
}

export const HANDBOOK_MATERIALS: HandbookMaterial[] = HANDBOOK_MATERIALS_RAW

export function handbookFileAccess(file: HandbookFile): HandbookFileAccess {
  if (file.url?.startsWith("/")) return "download"
  if (file.url?.includes("flDownload.do")) return "download"
  if (file.url) return "link"
  return "none"
}

export function handbookFileOrg(file: HandbookFile): string {
  const hay = `${file.src} ${file.name} ${file.url ?? ""}`
  if (hay.includes("국가법령정보센터") || hay.includes("법제처")) return "법제처"
  if (hay.includes("건설기술정보시스템")) return "건설기술정보시스템"
  if (hay.includes("한국표준품셈정보원") || hay.includes("표준품셈")) return "한국표준품셈정보원"
  if (hay.includes("나라장터") || hay.includes("g2b.go.kr")) return "조달청"
  if (hay.includes("조달청")) return "조달청"
  if (hay.includes("한국도로교통공단") || hay.includes("도로교통공단")) return "한국도로교통공단"
  if (hay.includes("대한건설협회")) return "대한건설협회"
  if (hay.includes("한국엔지니어링협회") || hay.includes("엔지니어링종합정보시스템")) return "한국엔지니어링협회"
  if (hay.includes("한국공간정보산업협회")) return "한국공간정보산업협회"
  if (hay.includes("한국건설엔지니어링협회")) return "한국건설엔지니어링협회"
  if (hay.includes("국가유산청")) return "국가유산청"
  if (hay.includes("중소벤처기업부")) return "중소벤처기업부"
  if (hay.includes("행정안전부")) return "행정안전부"
  if (hay.includes("환경부")) return "환경부"
  if (hay.includes("국토교통부")) return "국토교통부"
  if (hay.includes("경상북도")) return "경상북도"
  if (file.url?.startsWith("/")) return "내부자료"
  return "기타"
}

export function matchHandbookMaterial(mat: HandbookMaterial, keyword: string): boolean {
  const q = keyword.trim().toLowerCase()
  if (!q) return true
  const hay = [
    mat.chapter,
    mat.name,
    mat.source,
    mat.desc ?? "",
    ...mat.files.flatMap((f) => [f.name, f.src, handbookFileOrg(f)]),
  ]
    .join(" ")
    .toLowerCase()
  return q.split(/\s+/).every((token) => hay.includes(token))
}

export function handbookMaterialOrg(mat: HandbookMaterial): string {
  if (mat.lawXmlKey) return "법제처"
  const first = mat.files[0]
  return first ? handbookFileOrg(first) : "기타"
}

export function handbookMaterialAccess(mat: HandbookMaterial): HandbookFileAccess {
  if (mat.notesOnly) return "none"
  if (mat.lawXmlKey) {
    return handbookLawMaterialHasAttachments(mat.id) ? "download" : "link"
  }
  const kinds = mat.files.map(handbookFileAccess)
  if (kinds.includes("download")) return "download"
  if (kinds.includes("link")) return "link"
  return "none"
}

export function handbookMaterialFileHint(mat: HandbookMaterial, keyword: string): string | undefined {
  const q = keyword.trim().toLowerCase()
  if (!q) return undefined
  const nameHit =
    mat.name.toLowerCase().includes(q) ||
    mat.source.toLowerCase().includes(q) ||
    (mat.desc ?? "").toLowerCase().includes(q)
  if (nameHit) return undefined
  const hit = mat.files.find(
    (f) => f.name.toLowerCase().includes(q) || f.src.toLowerCase().includes(q)
  )
  return hit?.name
}

const NEW_WIDEN_EXAMPLES: HandbookExampleField[] = [
  { key: "new_km", label: "신설구간", unit: "km", placeholder: "예: 4", hint: "4km 이상" },
  { key: "widen_km", label: "확장구간", unit: "km", placeholder: "예: 10", hint: "10km 이상" },
]

export const HANDBOOK_PROCEDURES: HandbookProcedure[] = [
  {
    no: 1,
    name: "전략환경영향평가",
    law: "환경영향평가법 시행령 제7조 제2항·제22조 제2항 (별표2) 제2호 마목, 제28조 제2항 제2호",
    criteria: "신설 4km 이상 또는 확장 10km 이상(왕복 2차로 이상 기존도로), 합산 1 이상",
    criteriaItems: [
      "도로(고속국도 제외) 건설공사 계획으로서 환경영향평가 대상 규모 이상인 경우",
      "신설 4km 이상(도시지역은 폭 25m 이상인 도로)",
      "왕복 2차로 이상 기존 도로 확장 10km 이상",
      "신설·확장을 함께 하면 (신설 합/4km)+(확장 합/10km) ≥ 1",
      "재협의: 도시·군관리계획 증가분이 도시지역(녹지 제외) 6만㎡, 그 외 1만㎡ 이상",
    ],
    when: "도로 노선 선정시",
    org: "별도",
    examples: NEW_WIDEN_EXAMPLES,
    exampleKind: "newWiden",
    formulaHint: "(신설합/4km)+(확장합/10km) ≥ 1",
  },
  {
    no: 2,
    name: "소규모환경영향평가",
    law: "환경영향평가법 시행령 제59조·제61조 제2항 (별표4) 제1호",
    criteria: "보전관리 5,000㎡ / 생산관리 7,500㎡ / 계획관리 10,000㎡ / 농림 7,500㎡ / 자연환경보전 5,000㎡",
    criteriaItems: [
      "관리지역은 보전관리 5,000㎡, 생산관리 7,500㎡, 계획관리 10,000㎡ 이상",
      "농림지역 7,500㎡ 이상",
      "자연환경보전지역 5,000㎡ 이상",
    ],
    when: "사업 승인전",
    org: "별도",
    examples: [
      {
        key: "zone",
        label: "용도지역",
        kind: "select",
        options: [
          { value: "보전관리", label: "보전관리지역 · 5,000㎡ 이상" },
          { value: "생산관리", label: "생산관리지역 · 7,500㎡ 이상" },
          { value: "계획관리", label: "계획관리지역 · 10,000㎡ 이상" },
          { value: "농림", label: "농림지역 · 7,500㎡ 이상" },
          { value: "자연환경보전", label: "자연환경보전지역 · 5,000㎡ 이상" },
        ],
      },
      { key: "area", label: "사업면적", unit: "㎡", placeholder: "예: 5000", hint: "선택한 지역 기준 이상" },
    ],
    exampleKind: "zoneArea",
  },
  {
    no: 3,
    name: "환경영향평가",
    law: "환경영향평가법 시행령 제31조 제2항·제47조 제2항 (별표3) 제5호",
    criteria: "신설 4km 이상 또는 확장 10km 이상(왕복 2차로 이상 기존도로), 합산 1 이상",
    criteriaItems: [
      "전략환경영향평가와 같은 규모 산식",
      "신설 4km 이상 또는 왕복 2차로 이상 기존도로 확장 10km 이상",
      "병행 시 합산 1 이상",
    ],
    when: "실시계획인가전",
    org: "별도",
    examples: NEW_WIDEN_EXAMPLES,
    exampleKind: "newWiden",
    formulaHint: "(신설합/4km)+(확장합/10km) ≥ 1",
  },
  {
    no: 4,
    name: "교통영향평가",
    law: "도시교통정비 촉진법 시행령 제13조의2 제3항 (별표1) 제1호 가목 3)",
    criteria: "신설 5km 이상(인터체인지·교차부·간선도로 접속부)",
    criteriaItems: [
      "도시계획시설사업 도로로서 총길이 5km 이상인 신설노선",
      "인터체인지, 교차 부분 및 다른 간선도로와의 접속부가 있는 경우",
    ],
    when: "실시계획인가전",
    org: "별도",
    examples: [{ key: "new_km", label: "신설구간", unit: "km", placeholder: "예: 5", hint: "5km 이상" }],
    exampleKind: "newLen5",
  },
  {
    no: 5,
    name: "교통안전진단",
    law: "교통안전법 제34조, 시행령 제22조 (별표2)",
    criteria: "일반국도·고속국도 5km / 특별시·광역시·지방도 3km / 시도·군도·구도 1km",
    criteriaItems: [
      "도시계획시설사업 또는 도로법 도로 건설",
      "일반국도·고속국도 총 길이 5km 이상",
      "특별시·광역시·지방도(국가지원지방도 포함) 3km 이상",
      "시도·군도·구도 1km 이상",
    ],
    when: "실시계획인가전",
    org: "별도",
    examples: [
      {
        key: "roadType",
        label: "도로 종류",
        kind: "select",
        options: [
          { value: "국도", label: "일반국도·고속국도 · 5km 이상" },
          { value: "지방도", label: "특별시·광역시·지방도 · 3km 이상" },
          { value: "시도", label: "시도·군도·구도 · 1km 이상" },
        ],
      },
      { key: "len", label: "총연장", unit: "km", placeholder: "예: 5", hint: "선택한 도로 기준 이상" },
    ],
    exampleKind: "roadTypeLen",
  },
  {
    no: 6,
    name: "재해영향성검토/평가",
    law: "자연재해대책법 시행령 제6조 제1항 (별표1) 비고 제2호 다목",
    criteria: "평가: 5만㎡ 또는 10km 이상 · 검토: 5천㎡~5만㎡ 또는 2~10km",
    criteriaItems: [
      "재해영향평가: 면적 5만㎡ 이상 또는 길이 10km 이상",
      "재해영향성검토: 면적 5천㎡ 이상 5만㎡ 미만 또는 길이 2km 이상 10km 미만",
      "도시·군계획시설 결정은 부지면적 5천㎡ 또는 길이 2km 이상인 경우(도로는 길이 개념)",
    ],
    when: "도시관리계획결정(변경)시",
    org: "별도",
    examples: [
      { key: "area", label: "부지면적", unit: "㎡", placeholder: "예: 50000", hint: "평가 5만㎡ · 검토 5천㎡" },
      { key: "len", label: "길이", unit: "km", placeholder: "예: 10", hint: "평가 10km · 검토 2km" },
    ],
    exampleKind: "disaster",
  },
  {
    no: 7,
    name: "문화재지표조사",
    law: "매장문화재 보호 및 조사에 관한 법률 시행령 제4조",
    criteria: "토지 건설공사 사업면적 3만㎡ 이상",
    criteriaItems: [
      "토지에서 시행하는 건설공사로서 사업면적 3만㎡ 이상",
      "같은 목적으로 분할·연접 개발하면 전체 면적을 합산한다",
      "매장문화재 유존지역 등은 면적에서 제외",
    ],
    when: "—",
    org: "별도",
    examples: [{ key: "area", label: "사업면적", unit: "㎡", placeholder: "예: 30000", hint: "3만㎡ 이상" }],
    exampleKind: "area30000",
  },
  {
    no: 8,
    name: "설계VE",
    law: "건설기술 진흥법 시행령 제75조",
    criteria: "총공사비 100억원 이상 기본설계 및 실시설계",
    criteriaItems: [
      "총공사비 100억원 이상인 건설공사의 기본설계·실시설계",
      "시공 중 10% 이상 조정, 실시설계 완료 후 3년 경과 발주, 발주청이 필요하다고 인정하는 경우 등도 해당",
    ],
    when: "—",
    org: "별도",
    examples: [{ key: "cost", label: "총공사비", unit: "억원", placeholder: "예: 100", hint: "100억원 이상" }],
    exampleKind: "cost100",
  },
  {
    no: 9,
    name: "설계자문",
    law: "건설기술 진흥법 시행령 제19조",
    criteria: "계획·조사·설계 단계에서 1회 이상 기술자문위원회 자문",
    criteriaItems: [
      "계획·조사·설계 용역 수행단계에서 1회 이상 자문",
      "규모가 작거나 자문할 중요한 사항이 없으면 미시행",
      "시·군 조례에 따라 기술자문위원회 시행 여부를 참고한다",
    ],
    when: "용역 수행단계",
    org: "대가없음",
    note: "시·군 조례사항에 따라 기술자문위원회 시행 여부 참고",
  },
  {
    no: 10,
    name: "설계심의",
    law: "건설기술 진흥법 시행령 제17조, 시행규칙 제3조",
    criteria: "총공사비 100억원 이상(기술자문 받은 건 등 제외)",
    criteriaItems: [
      "지방자치단체 등이 시행하는 총공사비 100억원 이상 건설공사",
      "기술자문위원회 자문을 받은 공사와 국토교통부령으로 정하는 공사(설계용역 건설사업관리를 한 공사 등)는 제외",
    ],
    when: "—",
    org: "대가없음",
    note: "기술자문 수행 시 제외 — 판단 필요",
    examples: [{ key: "cost", label: "총공사비", unit: "억원", placeholder: "예: 100", hint: "100억원 이상" }],
    exampleKind: "cost100",
  },
  {
    no: 11,
    name: "설계안전성평가",
    law: "건설기술 진흥법 시행령 제75조의2, 제98조",
    criteria: "1·2종 시설물 건설공사(교량 계획에 따라 판단)",
    criteriaItems: [
      "안전관리계획 수립 대상의 실시설계",
      "1종·2종 시설물 건설공사, 지하 10m 이상 굴착, 폭발물 사용 공사 등",
      "교량 계획에 따라 수행 여부를 정한다",
    ],
    when: "설계 진행 중",
    org: "별도",
    note: "교량 계획에 따른 대상 결정 — 판단 필요",
  },
  {
    no: 12,
    name: "주민설명회",
    law: "건설기술 진흥법 시행령 제71조 제3항·제4항",
    criteria: "기본설계 시 주민의견 청취, 14일 이상 공람",
    criteriaItems: [
      "기본설계 때 주민 등 이해당사자 의견을 듣는다",
      "일간신문·홈페이지 등으로 공고하고 기본설계안을 14일 이상 공람한다",
      "기본설계를 생략하는 경우에는 실시설계 또는 타당성 조사 때 의견을 듣는다",
    ],
    when: "기본설계시",
    org: "과업포함",
  },
  {
    no: 13,
    name: "설계안전보건대장",
    law: "산업안전보건법 제67조, 시행령 제55조",
    criteria: "총공사금액 50억원 이상",
    criteriaItems: [
      "총공사금액 50억원 이상인 공사의 설계단계에서 설계안전보건대장을 작성한다",
      "계획단계 기본안전보건대장, 시공단계 공사안전보건대장과 이어진다",
    ],
    when: "설계단계",
    org: "과업포함",
    examples: [{ key: "cost", label: "총공사금액", unit: "억원", placeholder: "예: 50", hint: "50억원 이상" }],
    exampleKind: "cost50",
  },
  {
    no: 14,
    name: "도시관리계획 결정(변경)",
    law: "국토의 계획 및 이용에 관한 법률 제26조·제30조, 시행령 제25조",
    criteria: "시종점·중심선이 범위 안이면 심의 없이 경미한 변경 가능",
    criteriaItems: [
      "도로: 시점·종점이 바뀌지 않고 중심선이 종전 도로 범위를 벗어나지 않으면 지방도시계획위원회 심의 없이 변경할 수 있다",
      "그 외는 심의",
      "설계 진행에 따라 경미한 변경인지 심의인지를 정한다",
    ],
    when: "설계 진행 중",
    org: "대가없음",
    note: "설계 진행에 따른 판단 필요. 경미한 변경이면 실시계획인가와 병행 가능(약 3~4개월).",
  },
  {
    no: 15,
    name: "경관심의",
    law: "시·군 기본경관계획",
    criteria: "해당 시·군 기본경관계획을 참고하여 판단",
    criteriaItems: ["시·군 기본경관계획을 참고하여 대상 여부를 정한다"],
    when: "—",
    org: "대가없음",
  },
  {
    no: 16,
    name: "건설사업관리(설계감리)",
    law: "건설기술 진흥법 시행령 제57조",
    criteria: "1·2종 시설물 포함 또는 총공사비 300억원 이상",
    criteriaItems: [
      "1종·2종 시설물 건설공사(또는 포함)의 기본·실시설계용역",
      "신공법·특수공법으로 발주청이 필요하다고 인정하는 경우",
      "총공사비 300억원 이상인 기본·실시설계용역",
    ],
    when: "—",
    org: "별도",
    examples: [
      {
        key: "facility",
        label: "1·2종 시설물",
        kind: "select",
        options: [
          { value: "없음", label: "미포함" },
          { value: "포함", label: "포함" },
        ],
      },
      { key: "cost", label: "총공사비", unit: "억원", placeholder: "예: 300", hint: "300억원 이상" },
    ],
    exampleKind: "facilityOrCost",
  },
]
