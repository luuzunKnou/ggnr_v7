/**
 * 피해 예상 필지 지도 채움색
 */
export function riskFillRgba(riskLevelOrProximity: number | string): string {
  if (typeof riskLevelOrProximity === 'string') {
    // 기준 수위표 `THRESHOLD_ROWS` swatch 색상을 그대로 사용 (fill alpha 포함)
    switch (riskLevelOrProximity) {
      case '관심':
        return 'rgba(250, 204, 21, 0.55)';
      case '주의보':
        return 'rgba(251, 146, 60, 0.55)';
      case '경보':
        return 'rgba(248, 113, 113, 0.55)';
      case '심각':
        return 'rgba(220, 38, 38, 0.55)';
      case '계획홍수':
        return 'rgba(127, 29, 29, 0.55)';
      case '침수':
        return 'rgba(148, 163, 184, 0.55)'; // slate-400
      default:
        return 'rgba(148, 163, 184, 0.55)';
    }
  }

  // 호환: proximity가 그대로 넘어오면 기존 그라데이션 유지
  const proximity = Math.min(1, Math.max(0, riskLevelOrProximity));
  const t = proximity;
  const r = Math.round(186 + (30 - 186) * t);
  const g = Math.round(230 + (58 - 230) * t);
  const b = Math.round(253 + (138 - 253) * t);
  const a = 0.32 + 0.55 * t;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function riskStrokeRgba(riskLevelOrProximity: number | string): string {
  if (typeof riskLevelOrProximity === 'string') {
    switch (riskLevelOrProximity) {
      case '관심':
        return 'rgba(250, 204, 21, 0.9)';
      case '주의보':
        return 'rgba(251, 146, 60, 0.9)';
      case '경보':
        return 'rgba(248, 113, 113, 0.9)';
      case '심각':
        return 'rgba(220, 38, 38, 0.9)';
      case '계획홍수':
        return 'rgba(127, 29, 29, 0.9)';
      case '침수':
        return 'rgba(148, 163, 184, 0.9)';
      default:
        return 'rgba(148, 163, 184, 0.9)';
    }
  }

  // 호환: proximity가 그대로 넘어오면 기존 그라데이션 유지
  const proximity = Math.min(1, Math.max(0, riskLevelOrProximity));
  const t = proximity;
  const r = Math.round(125 + (30 - 125) * t);
  const g = Math.round(211 + (64 - 211) * t);
  const b = Math.round(252 + (175 - 252) * t);
  return `rgba(${r}, ${g}, ${b}, ${0.75 + 0.2 * t})`;
}
