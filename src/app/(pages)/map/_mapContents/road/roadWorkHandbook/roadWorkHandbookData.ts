/** 도로 업무편람 — 설계실무요령 한글 자료·행정절차 대상여부 */

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
  /** 법령정보센터 XML API 주소 — 상세에서 첨부파일 조회 */
  xmlUrl?: string
  /** 첨부 없을 때 법령 원문 페이지 */
  lawViewUrl?: string
  /** HWP 비고만 있고 연결 자료 없음 (도서 참조 등) */
  notesOnly?: boolean
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

export type HandbookFormula = {
  kind: string
  new_km?: number
  widen_km?: number
  cost?: number
  area?: number
  zones?: Record<string, number>
  roads?: Record<string, number>
  eval_area?: number
  review_area?: number
  eval_km?: number
  review_km?: number
}

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
  formula?: HandbookFormula | null
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

function formulaNum(proc: HandbookProcedure, key: keyof HandbookFormula, fallback: number): number {
  const raw = proc.formula?.[key]
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function zoneMetaOf(proc: HandbookProcedure, zone: string): { name: string; limit: number } | undefined {
  const base = ZONE_LIMIT[zone]
  const fromFormula = proc.formula?.zones?.[zone]
  if (typeof fromFormula === "number" && Number.isFinite(fromFormula)) {
    return { name: base?.name ?? zone, limit: fromFormula }
  }
  return base
}

function roadMetaOf(proc: HandbookProcedure, road: string): { name: string; limit: number } | undefined {
  const base = ROAD_LEN_LIMIT[road]
  const fromFormula = proc.formula?.roads?.[road]
  if (typeof fromFormula === "number" && Number.isFinite(fromFormula)) {
    return { name: base?.name ?? road, limit: fromFormula }
  }
  return base
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
    const newLimit = formulaNum(proc, "new_km", 4)
    const widenLimit = formulaNum(proc, "widen_km", 10)
    const n = readNum(vals, "new_km")
    const w = readNum(vals, "widen_km")
    if (n == null && w == null) return []
    const newKm = n ?? 0
    const widenKm = w ?? 0
    const ratio = newKm / newLimit + widenKm / widenLimit
    const lines: HandbookGuideLine[] = []
    if (n != null) {
      lines.push(
        n >= newLimit
          ? guide("met", `신설 ${fmtNum(n)}km는 ${fmtNum(newLimit)}km 이상 기준에 해당합니다. 도시지역 신설이면 폭 25m 이상인지도 함께 봅니다.`)
          : guide("unmet", `신설 ${fmtNum(n)}km는 단독 신설 기준(${fmtNum(newLimit)}km 이상)에는 미치지 않습니다.`)
      )
    }
    if (w != null) {
      lines.push(
        w >= widenLimit
          ? guide("met", `확장 ${fmtNum(w)}km는 ${fmtNum(widenLimit)}km 이상 기준에 해당합니다. 왕복 2차로 이상 기존 도로 확장인지도 함께 봅니다.`)
          : guide("unmet", `확장 ${fmtNum(w)}km는 단독 확장 기준(${fmtNum(widenLimit)}km 이상)에는 미치지 않습니다.`)
      )
    }
    if (n != null && w != null) {
      lines.push(
        ratio >= 1
          ? guide("met", `신설·확장 합산식은 ${ratio.toFixed(2)}로 1 이상이므로, 병행 규모로도 대상입니다.`)
          : guide("unmet", `신설·확장 합산식은 ${ratio.toFixed(2)}로 1 미만입니다. 신설 ${fmtNum(newLimit)}km 또는 확장 ${fmtNum(widenLimit)}km에 각각 못 미치면 대상이 아닙니다.`)
      )
    } else if ((n != null && n > 0 && n < newLimit) || (w != null && w > 0 && w < widenLimit)) {
      lines.push(
        guide("info", `신설과 확장을 함께 넣으면 (신설합/${fmtNum(newLimit)}km)+(확장합/${fmtNum(widenLimit)}km) ≥ 1 인지도 볼 수 있습니다.`)
      )
    }
    if (proc.no === 1) {
      lines.push(guide("info", "재협의(도시·군관리계획 증가분 6만㎡·1만㎡)는 이 입력으로 판단하지 않습니다."))
    }
    return lines
  }

  if (kind === "zoneArea") {
    const zone = vals.zone?.trim() || ""
    const area = readNum(vals, "area")
    const meta = zoneMetaOf(proc, zone)
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
    const limit = formulaNum(proc, "new_km", 5)
    const n = readNum(vals, "new_km")
    if (n == null) return []
    return n >= limit
      ? [
          guide("met", `신설 총길이 ${fmtNum(n)}km는 ${fmtNum(limit)}km 이상 기준에 해당합니다.`),
          guide("info", "도시계획시설 도로로서 인터체인지·교차부·다른 간선도로 접속부가 있는지도 함께 봅니다."),
        ]
      : [
          guide("unmet", `신설 총길이 ${fmtNum(n)}km는 ${fmtNum(limit)}km 이상 기준에 미치지 않습니다.`),
          guide("info", "접속부 요건과 별개로, 길이 규모만 보면 대상이 아닙니다."),
        ]
  }

  if (kind === "roadTypeLen") {
    const road = vals.roadType?.trim() || ""
    const len = readNum(vals, "len")
    const meta = roadMetaOf(proc, road)
    if (!road && len == null) return []
    if (!meta) {
      return len == null ? [] : [guide("info", "도로 종류를 고르면 해당 도로의 길이 기준과 비교합니다.")]
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
    const evalArea = formulaNum(proc, "eval_area", 50000)
    const reviewArea = formulaNum(proc, "review_area", 5000)
    const evalKm = formulaNum(proc, "eval_km", 10)
    const reviewKm = formulaNum(proc, "review_km", 2)
    const lines: HandbookGuideLine[] = []
    let evalHit = false
    let reviewHit = false
    if (area != null) {
      if (area >= evalArea) {
        evalHit = true
        lines.push(guide("met", `부지면적 ${fmtNum(area)}㎡는 ${fmtNum(evalArea)}㎡ 이상으로 재해영향평가 대상입니다.`))
      } else if (area >= reviewArea) {
        reviewHit = true
        lines.push(guide("met", `부지면적 ${fmtNum(area)}㎡는 ${fmtNum(reviewArea)}㎡ 이상 ${fmtNum(evalArea)}㎡ 미만으로 재해영향성검토 대상입니다.`))
      } else {
        lines.push(guide("unmet", `부지면적 ${fmtNum(area)}㎡는 재해영향성검토 하한(${fmtNum(reviewArea)}㎡)에 미치지 않습니다.`))
      }
    }
    if (len != null) {
      if (len >= evalKm) {
        evalHit = true
        lines.push(guide("met", `길이 ${fmtNum(len)}km는 ${fmtNum(evalKm)}km 이상으로 재해영향평가 대상입니다.`))
      } else if (len >= reviewKm) {
        reviewHit = true
        lines.push(guide("met", `길이 ${fmtNum(len)}km는 ${fmtNum(reviewKm)}km 이상 ${fmtNum(evalKm)}km 미만으로 재해영향성검토 대상입니다.`))
      } else {
        lines.push(guide("unmet", `길이 ${fmtNum(len)}km는 검토 하한(${fmtNum(reviewKm)}km)에 미치지 않습니다.`))
      }
    }
    if (evalHit) {
      lines.push(guide("met", "면적·길이 중 하나라도 평가 규모이면 재해영향평가로 봅니다."))
    } else if (reviewHit) {
      lines.push(guide("info", `평가 규모는 아니고, 재해영향성검토 대상입니다. 도시·군계획시설 결정은 ${fmtNum(reviewArea)}㎡ 또는 ${fmtNum(reviewKm)}km 이상이면 해당합니다.`))
    } else {
      lines.push(guide("unmet", "입력한 면적·길이만 보면 검토·평가 대상 규모에 해당하지 않습니다."))
    }
    return lines
  }

  if (kind === "area30000") {
    const limit = formulaNum(proc, "area", 30000)
    const area = readNum(vals, "area")
    if (area == null) return []
    return area >= limit
      ? [
          guide("met", `사업면적 ${fmtNum(area)}㎡는 ${fmtNum(limit)}㎡ 이상 기준에 해당합니다.`),
          guide("info", "같은 목적으로 분할·연접 개발하면 전체 면적을 합산하고, 매장문화재 유존지역은 제외합니다."),
        ]
      : [
          guide("unmet", `사업면적 ${fmtNum(area)}㎡는 ${fmtNum(limit)}㎡ 이상 기준에 미치지 않습니다.`),
          guide("info", "분할·연접 개발이면 합산 면적으로 다시 봅니다."),
        ]
  }

  if (kind === "cost100") {
    const limit = formulaNum(proc, "cost", 100)
    const cost = readNum(vals, "cost")
    if (cost == null) return []
    const met = cost >= limit
    const head = met
      ? guide("met", `총공사비 ${fmtNum(cost)}억원은 ${fmtNum(limit)}억원 이상 기준에 해당합니다.`)
      : guide("unmet", `총공사비 ${fmtNum(cost)}억원은 ${fmtNum(limit)}억원 이상 기준에 미치지 않습니다.`)
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
    const limit = formulaNum(proc, "cost", 50)
    const cost = readNum(vals, "cost")
    if (cost == null) return []
    return cost >= limit
      ? [
          guide("met", `총공사금액 ${fmtNum(cost)}억원은 ${fmtNum(limit)}억원 이상 기준에 해당합니다.`),
          guide("info", "설계단계에서 설계안전보건대장을 작성하고, 계획·시공 단계 대장과 이어집니다."),
        ]
      : [
          guide("unmet", `총공사금액 ${fmtNum(cost)}억원은 ${fmtNum(limit)}억원 이상 기준에 미치지 않습니다.`),
          guide("info", "이 금액 기준만 보면 설계안전보건대장 작성 대상이 아닙니다."),
        ]
  }

  const facility = vals.facility?.trim() || ""
  const cost = readNum(vals, "cost")
  if (!facility && cost == null) return []
  const costLimit = formulaNum(proc, "cost", 300)
  const lines: HandbookGuideLine[] = []
  if (facility === "포함") {
    lines.push(guide("met", "1·2종 시설물이 포함되면 공사비와 관계없이 기본·실시설계용역의 건설사업관리 대상입니다."))
  } else if (facility === "없음") {
    lines.push(guide("info", `1·2종 시설물이 없으면 총공사비 ${fmtNum(costLimit)}억원 이상인지를 봅니다.`))
  } else {
    lines.push(guide("info", "1·2종 시설물 여부를 고르면 공사비와 함께 판단할 수 있습니다."))
  }
  if (cost != null) {
    if (cost >= costLimit) {
      lines.push(guide("met", `총공사비 ${fmtNum(cost)}억원은 ${fmtNum(costLimit)}억원 이상 기준에 해당합니다.`))
    } else {
      lines.push(guide("unmet", `총공사비 ${fmtNum(cost)}억원은 ${fmtNum(costLimit)}억원 이상 기준에 미치지 않습니다.`))
    }
  }
  if (facility === "포함" || (cost != null && cost >= costLimit)) {
    lines.push(guide("met", "위 규모만 보면 건설사업관리(설계감리) 대상입니다. 신공법·특수공법은 발주청 판단입니다."))
  } else if (facility === "없음" && cost != null && cost < costLimit) {
    lines.push(guide("unmet", `1·2종 미포함이고 ${fmtNum(costLimit)}억원 미만이면, 이 두 기준으로는 대상이 아닙니다. 신공법·특수공법은 발주청 판단입니다.`))
  }
  return lines
}

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
  if (mat.xmlUrl || mat.lawViewUrl) return "법제처"
  const first = mat.files[0]
  return first ? handbookFileOrg(first) : "기타"
}

export function handbookMaterialAccess(mat: HandbookMaterial): HandbookFileAccess {
  if (mat.notesOnly) return "none"
  if (mat.xmlUrl) {
    return mat.xmlUrl.includes("target=admrul") ? "download" : "link"
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

