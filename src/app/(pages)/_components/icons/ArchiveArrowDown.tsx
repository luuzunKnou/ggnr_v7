'use client'

import { createLucideIcon } from 'lucide-react'

/** lucide 0.563에 패키지 export 없어 로컬 정의 (archive-arrow-down) */
export const ArchiveArrowDown = createLucideIcon('archive-arrow-down', [
  ['rect', { width: '20', height: '5', x: '2', y: '3', rx: '1', key: 'box' }],
  ['path', { d: 'M4 8v11a2 2 0 0 0 2 2h.343', key: 'left' }],
  ['path', { d: 'M20 8v11a2 2 0 0 1-2 2h-.343', key: 'right' }],
  ['path', { d: 'm9 18 3 3 3-3', key: 'chev' }],
  ['path', { d: 'M12 12v9', key: 'shaft' }],
])
