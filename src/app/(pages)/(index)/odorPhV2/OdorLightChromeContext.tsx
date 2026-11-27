'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { OdorLightChromeId } from '@/app/(pages)/(index)/odorPhV2/odorLightChrome'

const OdorLightChromeContext = createContext<OdorLightChromeId>('b')

export function OdorLightChromeProvider({
  value,
  children,
}: {
  value: OdorLightChromeId
  children: ReactNode
}) {
  return (
    <OdorLightChromeContext.Provider value={value}>{children}</OdorLightChromeContext.Provider>
  )
}

/** 라이트 크롬 A/B — 다크이거나 Provider 없으면 'b'(수정후)로 취급하지 않고 호출측에서 테마와 함께 판단 */
export function useOdorLightChrome(): OdorLightChromeId {
  return useContext(OdorLightChromeContext)
}
