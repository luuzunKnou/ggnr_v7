/**
 * 소규모 공공시설 첨부 폴더 규칙 (서버·화면 공용, node 의존 없음)
 *
 *   file_data/small_public/{관리번호}/                 시설 공통(대장·요약·기타)
 *   file_data/small_public/{관리번호}/후보지_{YYYY}/    후보지 평가(평가일 연도)
 *   file_data/small_public/{관리번호}/안전점검_{YYYY}/  안전점검(점검일 연도)
 *
 * 후보지는 5년 주기 등으로 따로 하고 안전점검과 연도가 겹치므로 폴더를 구분한다.
 * 예전 {YYYY}/ 폴더는 안전점검으로 읽는다(이전 후 정리 스크립트로 이름을 바꾼다).
 */

export type SmallPublicAttachScope = 'inspection' | 'candidate' | 'common'

export const SMALL_PUBLIC_SCOPE_LABEL = {
  inspection: '안전점검',
  candidate: '후보지',
} as const

const DIR_RE = /^(안전점검|후보지)_(\d{4})$/
const LEGACY_YEAR_RE = /^\d{4}$/

/** 구분·연도 폴더 이름 — 예: 후보지_2020 */
export function smallPublicScopeDirName(scope: 'inspection' | 'candidate', year: string): string {
  return `${SMALL_PUBLIC_SCOPE_LABEL[scope]}_${year}`
}

/** 폴더 이름 해석 — 예전 {YYYY} 는 안전점검(legacy) */
export function parseSmallPublicScopeDir(
  name: string
): { scope: 'inspection' | 'candidate'; year: string; legacy: boolean } | null {
  const n = String(name ?? '').trim()
  const m = n.match(DIR_RE)
  if (m) return { scope: m[1] === '후보지' ? 'candidate' : 'inspection', year: m[2]!, legacy: false }
  if (LEGACY_YEAR_RE.test(n)) return { scope: 'inspection', year: n, legacy: true }
  return null
}

/** 요청 값 → 구분(없거나 모르면 안전점검) */
export function parseSmallPublicScope(raw: string | null | undefined): SmallPublicAttachScope {
  const t = String(raw ?? '').trim()
  if (t === 'candidate' || t === 'common') return t
  return 'inspection'
}
