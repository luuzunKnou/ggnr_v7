/**
 * elevation(등고선) GeoServer CSS (GeoCSS)
 *
 * 분류: divi(CTD…) / scls(F00171…) 동일 등급 OR 매칭
 *   - CTD001 / F0017114·F0017124 → 계곡선 (elevation_ctd001)
 *   - CTD002 / F0017111·F0017121 → 주곡선 (elevation_ctd002)
 *   - CTD003 / F0017112·F0017122 → 간곡선 (elevation_ctd003)
 *   - CTD004 / F0017113·F0017123 → 조곡선 (elevation_ctd004)
 *   - 그 외 → 등고선(기타) (elevation_etc)
 * 도면 관례: 계=굵은 실선·고도 라벨, 주=가는 실선, 간=긴 파선, 조=짧은 점선
 * 색: 갈색(세피아) 계열, 계만 조금 더 진하게
 * 축척: >10만 숨김 → ≤5만 계·주 동시 → ≤1만 간·조·기타
 */

export const ELEVATION_LAYER_NAME = "elevation"

export type ElevationSplitKind = "ctd001" | "ctd002" | "ctd003" | "ctd004" | "etc"

export const ELEVATION_SPLIT_LAYER_NAMES = [
  "elevation_ctd001",
  "elevation_ctd002",
  "elevation_ctd003",
  "elevation_ctd004",
  "elevation_etc",
] as const

/** 축척분모: 이보다 크면 전체 숨김 (1:10만보다 멀리) */
export const ELEVATION_SD_HIDE = 100_000
/** 축척분모: 계·주곡선 (1:5만) */
export const ELEVATION_SD_GYE = 50_000
/** 축척분모: 주곡선 — 계와 동일 구간에서 동시 표시 */
export const ELEVATION_SD_JU = ELEVATION_SD_GYE
/** 축척분모: 간·조·기타 (1:1만) */
export const ELEVATION_SD_DETAIL = 10_000

/** @deprecated 이전 상수 — 계곡선 임계와 동일 */
export const ELEVATION_SD_FAR = ELEVATION_SD_GYE
/** @deprecated 이전 상수 — 상세 임계와 동일 */
export const ELEVATION_SD_MID = ELEVATION_SD_DETAIL

/** 등급별 stroke·라벨 색 (갈색 세피아) */
const STROKE_GYE = "#8B5A2B" // 계곡선
const STROKE_JU = "#A67C52" // 주곡선
const STROKE_MISC = "#B8956C" // 기타
const STROKE_GAN = "#C4A882" // 간곡선
const STROKE_JO = "#D4C4A8" // 조곡선

/** 선 불투명도 */
const STROKE_OPACITY = 0.85

/** 선 굵기 — 계 ≈ 주 × 2.5 (도면 관례) */
const WIDTH_GYE = 1.8
const WIDTH_JU = 0.7
const WIDTH_GAN = 0.6
const WIDTH_MISC = 0.55
const WIDTH_JO = 0.45

const FILTER_GYE = `[divi = 'CTD001' or scls = 'F0017114' or scls = 'F0017124']`
const FILTER_JU = `[divi = 'CTD002' or scls = 'F0017111' or scls = 'F0017121']`
const FILTER_GAN = `[divi = 'CTD003' or scls = 'F0017112' or scls = 'F0017122']`
const FILTER_JO = `[divi = 'CTD004' or scls = 'F0017113' or scls = 'F0017123']`
const FILTER_MISC = `[divi = 'CTD000' or scls = 'F0017110' or scls = 'F0017120']`

/** 계곡선만 고도(cont) 라벨 — divi 코드는 표기하지 않음 */
function indexLabelBlock(strokeColor: string): string {
  return `
  label: [cont];
  label-follow-line: true;
  label-offset: 0;
  font-size: 11;
  font-fill: ${strokeColor};
  font-weight: bold;
  font-family: "Nanum Gothic", "Malgun Gothic", "SansSerif";
  halo-radius: 1.5;
  halo-color: #FFFFFF;
  -gt-label-repeat: 400;
  -gt-label-group: true;`
}

function strokeRule(
  maxSd: number,
  stroke: string,
  width: number,
  opts?: { dasharray?: string; filter?: string }
): string {
  const filter = opts?.filter ? ` ${opts.filter}` : ""
  const dash = opts?.dasharray ? `\n  stroke-dasharray: ${opts.dasharray};` : ""
  return `[@sd <= ${maxSd}]${filter} {
  stroke: ${stroke};
  stroke-width: ${width};
  stroke-opacity: ${STROKE_OPACITY};${dash}
}`
}

/** elevation(부모) 레이어 — 전체 등급 한 CSS (침수현황·고도 등 단일 토글용) */
export function buildElevationContourCss(): string {
  return `/* elevation contour — scale: hide>${ELEVATION_SD_HIDE}; gye+ju<=${ELEVATION_SD_GYE}; detail<=${ELEVATION_SD_DETAIL} */
/* 계곡선 — @sd <= ${ELEVATION_SD_GYE} (1:5만) — 굵은 실선 */
${strokeRule(ELEVATION_SD_GYE, STROKE_GYE, WIDTH_GYE, { filter: FILTER_GYE })}

/* 주곡선 — @sd <= ${ELEVATION_SD_JU} (계와 동일) — 가는 실선 */
${strokeRule(ELEVATION_SD_JU, STROKE_JU, WIDTH_JU, { filter: FILTER_JU })}

/* 미분류 — @sd <= ${ELEVATION_SD_DETAIL} (1:1만) */
${strokeRule(ELEVATION_SD_DETAIL, STROKE_MISC, WIDTH_MISC, { filter: FILTER_MISC })}

/* 간곡선 — @sd <= ${ELEVATION_SD_DETAIL} (1:1만) — 긴 파선 */
${strokeRule(ELEVATION_SD_DETAIL, STROKE_GAN, WIDTH_GAN, {
    filter: FILTER_GAN,
    dasharray: "6 4",
  })}

/* 조곡선 — @sd <= ${ELEVATION_SD_DETAIL} (1:1만) — 짧은 점선 */
${strokeRule(ELEVATION_SD_DETAIL, STROKE_JO, WIDTH_JO, {
    filter: FILTER_JO,
    dasharray: "2 3",
  })}

/* 라벨 — 계곡선 고도만 */
[@sd <= ${ELEVATION_SD_GYE}] ${FILTER_GYE} {
${indexLabelBlock(STROKE_GYE)}
}
`
}

export function elevationSplitKindFromLayerName(layerName: string): ElevationSplitKind | null {
  const name = String(layerName ?? "").trim().toLowerCase()
  if (name === "elevation_ctd001") return "ctd001"
  if (name === "elevation_ctd002") return "ctd002"
  if (name === "elevation_ctd003") return "ctd003"
  if (name === "elevation_ctd004") return "ctd004"
  if (name === "elevation_etc") return "etc"
  return null
}

/**
 * 분할 자식 스타일 — FeatureType CQL로 이미 필터되므로 속성 필터 없이 선·축척만.
 * 부모 스타일과 동일한 도면 관례(색·굵기·점선·라벨).
 */
export function buildElevationSplitCss(kind: ElevationSplitKind): string {
  switch (kind) {
    case "ctd001":
      return `/* elevation_ctd001 계곡선 — @sd <= ${ELEVATION_SD_GYE} */
${strokeRule(ELEVATION_SD_GYE, STROKE_GYE, WIDTH_GYE)}

[@sd <= ${ELEVATION_SD_GYE}] {
${indexLabelBlock(STROKE_GYE)}
}
`
    case "ctd002":
      return `/* elevation_ctd002 주곡선 — @sd <= ${ELEVATION_SD_JU} */
${strokeRule(ELEVATION_SD_JU, STROKE_JU, WIDTH_JU)}
`
    case "ctd003":
      return `/* elevation_ctd003 간곡선 — @sd <= ${ELEVATION_SD_DETAIL} */
${strokeRule(ELEVATION_SD_DETAIL, STROKE_GAN, WIDTH_GAN, { dasharray: "6 4" })}
`
    case "ctd004":
      return `/* elevation_ctd004 조곡선 — @sd <= ${ELEVATION_SD_DETAIL} */
${strokeRule(ELEVATION_SD_DETAIL, STROKE_JO, WIDTH_JO, { dasharray: "2 3" })}
`
    case "etc":
      return `/* elevation_etc 등고선(기타) — @sd <= ${ELEVATION_SD_DETAIL} */
${strokeRule(ELEVATION_SD_DETAIL, STROKE_MISC, WIDTH_MISC)}
`
  }
}

export function buildElevationSplitCssByLayerName(layerName: string): string | null {
  const kind = elevationSplitKindFromLayerName(layerName)
  return kind ? buildElevationSplitCss(kind) : null
}
