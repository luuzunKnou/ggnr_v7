/**
 * 상태평가등급 뱃지 색 — build_uj 실데이터(양호/보통/A~C등급/불량) + 코드표 D·E 대비
 * 매칭: trim 후 완전 일치
 */
export function getStateGradeBadgeClass(grade: string): string {
  const g = String(grade ?? '').trim()
  if (!g) return 'bg-muted text-muted-foreground'
  if (g === '양호' || g === 'A등급') {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
  }
  if (g === 'B등급') {
    return 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300'
  }
  if (g === '보통' || g === 'C등급') {
    return 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300'
  }
  if (g === '불량' || g === 'D등급') {
    return 'bg-orange-100 text-orange-900 dark:bg-orange-950/60 dark:text-orange-300'
  }
  if (g === 'E등급') {
    return 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
  }
  return 'bg-muted text-muted-foreground'
}
