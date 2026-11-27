'use client'

import { createLucideIcon } from 'lucide-react'

/** lucide 0.563에 패키지 export 없어 로컬 정의 (package-arrow-bend-up-left) */
export const PackageArrowBendUpLeft = createLucideIcon('package-arrow-bend-up-left', [
  ['path', { d: 'M12 15.343V12l8.71-5', key: 'top' }],
  ['path', { d: 'm17 22-3-3 3-3', key: 'chev' }],
  [
    'path',
    {
      d: 'M21 15V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4',
      key: 'box',
    },
  ],
  ['path', { d: 'M22 22v-1a2 2 0 00-2-2h-6', key: 'arm' }],
  ['path', { d: 'M3.29 7 12 12', key: 'seamL' }],
  ['path', { d: 'm7.5 4.27 9 5.15', key: 'seamR' }],
])
