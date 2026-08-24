/**
 * elevation(등고선) GeoServer CSS (GeoCSS)
 *
 * 분류: divi(CTD…) / scls(F00171…) 동일 등급 OR 매칭
 * 색: 등급별 연한 회색 (진→연: 계 > 주 > 미분류 > 간 > 조)
 * 선: 계=실선(얇게), 주=더 얇은 실선, 간=점선, 조=가는점선, 미분류=가는실선
 * 축척: >10만 숨김 → ≤5만 계 → ≤2.5만 주 → ≤1만 간·조·미분류
 * 라벨: divi + cont, 라인 중앙 (해당 등급이 보일 때)
 */

export const ELEVATION_LAYER_NAME = "elevation"

/** 축척분모: 이보다 크면 전체 숨김 (1:10만보다 멀리) */
export const ELEVATION_SD_HIDE = 100_000
/** 축척분모: 계곡선 (1:5만) */
export const ELEVATION_SD_GYE = 50_000
/** 축척분모: 주곡선 (1:2.5만) */
export const ELEVATION_SD_JU = 25_000
/** 축척분모: 간·조·미분류 (1:1만, 실곡선 단계) */
export const ELEVATION_SD_DETAIL = 10_000

/** @deprecated 이전 상수 — 계곡선 임계와 동일 */
export const ELEVATION_SD_FAR = ELEVATION_SD_GYE
/** @deprecated 이전 상수 — 상세 임계와 동일 */
export const ELEVATION_SD_MID = ELEVATION_SD_DETAIL

/** 등급별 stroke·라벨 색 (더 연한 회색) */
const STROKE_GYE = "#999999" // 계곡선
const STROKE_JU = "#B8B8B8" // 주곡선
const STROKE_MISC = "#C8C8C8" // 미분류
const STROKE_GAN = "#D0D0D0" // 간곡선
const STROKE_JO = "#DCDCDC" // 조곡선

/** 선 불투명도 (60%) */
const STROKE_OPACITY = 0.6

/** 선 굵기 (계→조로 갈수록 얇게) */
const WIDTH_GYE = 1.4
const WIDTH_JU = 0.8
const WIDTH_GAN = 0.6
const WIDTH_MISC = 0.5
const WIDTH_JO = 0.4

const FILTER_GYE = `[divi = 'CTD001' or scls = 'F0017114' or scls = 'F0017124']`
const FILTER_JU = `[divi = 'CTD002' or scls = 'F0017111' or scls = 'F0017121']`
const FILTER_GAN = `[divi = 'CTD003' or scls = 'F0017112' or scls = 'F0017122']`
const FILTER_JO = `[divi = 'CTD004' or scls = 'F0017113' or scls = 'F0017123']`
const FILTER_MISC = `[divi = 'CTD000' or scls = 'F0017110' or scls = 'F0017120']`

function labelBlock(strokeColor: string): string {
  return `
  label: [divi] ' ' [cont];
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

/** elevation 레이어에 올릴 GeoServer CSS 본문 */
export function buildElevationContourCss(): string {
  return `/* elevation contour — scale: hide>${ELEVATION_SD_HIDE}; gye<=${ELEVATION_SD_GYE}; ju<=${ELEVATION_SD_JU}; detail<=${ELEVATION_SD_DETAIL} */
/* 계곡선 — @sd <= ${ELEVATION_SD_GYE} (1:5만) */
[@sd <= ${ELEVATION_SD_GYE}] ${FILTER_GYE} {
  stroke: ${STROKE_GYE};
  stroke-width: ${WIDTH_GYE};
  stroke-opacity: ${STROKE_OPACITY};
}

/* 주곡선 — @sd <= ${ELEVATION_SD_JU} (1:2.5만) */
[@sd <= ${ELEVATION_SD_JU}] ${FILTER_JU} {
  stroke: ${STROKE_JU};
  stroke-width: ${WIDTH_JU};
  stroke-opacity: ${STROKE_OPACITY};
}

/* 미분류 — @sd <= ${ELEVATION_SD_DETAIL} (1:1만) */
[@sd <= ${ELEVATION_SD_DETAIL}] ${FILTER_MISC} {
  stroke: ${STROKE_MISC};
  stroke-width: ${WIDTH_MISC};
  stroke-opacity: ${STROKE_OPACITY};
}

/* 간곡선 — @sd <= ${ELEVATION_SD_DETAIL} (1:1만) */
[@sd <= ${ELEVATION_SD_DETAIL}] ${FILTER_GAN} {
  stroke: ${STROKE_GAN};
  stroke-width: ${WIDTH_GAN};
  stroke-dasharray: 6 4;
  stroke-opacity: ${STROKE_OPACITY};
}

/* 조곡선 — @sd <= ${ELEVATION_SD_DETAIL} (1:1만) */
[@sd <= ${ELEVATION_SD_DETAIL}] ${FILTER_JO} {
  stroke: ${STROKE_JO};
  stroke-width: ${WIDTH_JO};
  stroke-dasharray: 2 3;
  stroke-opacity: ${STROKE_OPACITY};
}

/* 라벨(계) */
[@sd <= ${ELEVATION_SD_GYE}] ${FILTER_GYE} {
${labelBlock(STROKE_GYE)}
}

/* 라벨(주) */
[@sd <= ${ELEVATION_SD_JU}] ${FILTER_JU} {
${labelBlock(STROKE_JU)}
}

/* 라벨(간·조) */
[@sd <= ${ELEVATION_SD_DETAIL}] ${FILTER_GAN} {
${labelBlock(STROKE_GAN)}
}

[@sd <= ${ELEVATION_SD_DETAIL}] ${FILTER_JO} {
${labelBlock(STROKE_JO)}
}
`
}
