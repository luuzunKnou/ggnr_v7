/**
 * 거터 기능 버튼 아이콘 색 (hex).
 * Tailwind 클래스 문자열이 번들에서 빠져 색이 사라지는 것을 피하기 위해 hex 사용.
 * 색 변경은 이 파일만 수정하면 된다.
 */
export const MAP_SPLIT_GUTTER_ICON_COLOR = {
  lock: {
    // 분할선 이동 가능(활성)만 눈에 띄게, 잠금(비활성)은 기존 회색
    active: '#1b9cff',
    inactive: '#94a3b8', // slate-400
  },
  /** 접기/펼치기 */
  expandToggle: {
    active: '#e2e8f0', // slate-200
    inactive: '#cbd5e1', // slate-300
  },
  mapSync: {
    active: '#34d399', // emerald-400
    inactive: '#94a3b8',
  },
  basemapSync: {
    active: '#fcd34d', // amber-300
    inactive: '#94a3b8',
  },
  exit: {
    active: '#f87171', // red-400
    inactive: '#94a3b8',
  },
} as const;
