/**
 * 실시간 통합 현황 — 심각도 색 규칙
 * 정상·보조 = 낮은 채도 / 주의·경보·대응 = 강한 색만 사용
 * (Tailwind purge 이슈 피하려고 hex·인라인 스타일 기준)
 */

import type { CSSProperties } from 'react'
import type { OdorGrade } from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'

export type OdorLiveSeverity = 'ok' | 'warn' | 'bad'

/** 강조용 — 주의·경보는 채도 유지, 정상은 무채에 가깝게 */
export const ODOR_LIVE_SEVERITY_HEX: Record<OdorLiveSeverity, string> = {
  ok: '#94a3b8',
  warn: '#eab308',
  bad: '#ef4444',
}

/** 가동 필요(주의↑·미가동) — 경보(빨강)·주의(노랑)와 구분 */
export const ODOR_LIVE_ACTION_HEX = '#f97316'

/** 1·2등급은 회색 계열, 3~5만 신호색 */
export const ODOR_LIVE_GRADE_HEX: Record<OdorGrade, string> = {
  1: '#64748b',
  2: '#94a3b8',
  3: '#eab308',
  4: '#f87171',
  5: '#ef4444',
}

export function odorLiveSeverityFromGrade(grade: OdorGrade): OdorLiveSeverity {
  if (grade <= 2) return 'ok'
  if (grade === 3) return 'warn'
  return 'bad'
}

/** 실시간 통합 현황용 구간 라벨 (정상 / 주의 / 경보) */
export function odorLiveSeverityLabel(grade: OdorGrade): '정상' | '주의' | '경보' {
  const s = odorLiveSeverityFromGrade(grade)
  if (s === 'ok') return '정상'
  if (s === 'warn') return '주의'
  return '경보'
}

/** 화면에서 색으로 강조할지 — 정상은 false */
export function odorLiveSeverityIsAccent(severity: OdorLiveSeverity): boolean {
  return severity === 'warn' || severity === 'bad'
}

export function odorLiveSeverityColorStyle(severity: OdorLiveSeverity): CSSProperties {
  if (!odorLiveSeverityIsAccent(severity)) {
    return { color: 'var(--muted-foreground)' }
  }
  return { color: ODOR_LIVE_SEVERITY_HEX[severity] }
}

export function odorLiveSeverityTagStyle(severity: OdorLiveSeverity): CSSProperties {
  if (!odorLiveSeverityIsAccent(severity)) {
    return {
      color: 'var(--muted-foreground)',
      backgroundColor: 'color-mix(in srgb, var(--muted-foreground) 12%, transparent)',
    }
  }
  const hex = ODOR_LIVE_SEVERITY_HEX[severity]
  return {
    color: hex,
    backgroundColor: `color-mix(in srgb, ${hex} 18%, transparent)`,
  }
}

export function odorLiveSeverityBorderStyle(severity: OdorLiveSeverity): CSSProperties {
  if (!odorLiveSeverityIsAccent(severity)) {
    return { borderLeftColor: 'var(--border)' }
  }
  return { borderLeftColor: ODOR_LIVE_SEVERITY_HEX[severity] }
}

export function odorLiveSeverityRowBgStyle(severity: OdorLiveSeverity): CSSProperties | undefined {
  if (severity !== 'bad') return undefined
  return { backgroundColor: `color-mix(in srgb, ${ODOR_LIVE_SEVERITY_HEX.bad} 12%, transparent)` }
}
