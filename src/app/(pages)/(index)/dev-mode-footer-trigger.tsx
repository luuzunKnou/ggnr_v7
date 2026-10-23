"use client"

import { useRouter } from "next/navigation"
import { useRef, useCallback } from "react"

const DEV_CLICK_COUNT = 5

/** 인덱스 하단 푸터 — 통계 시트가 상단에 붙을 때 높이 측정용 */
export const INDEX_SITE_FOOTER_ID = "index-site-footer"

export function DevModeFooterTrigger({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const countRef = useRef(0)

  const handleClick = useCallback(() => {
    countRef.current += 1
    if (countRef.current >= DEV_CLICK_COUNT) {
      countRef.current = 0
      router.push("/dev")
    }
  }, [router])

  return (
    <footer
      id={INDEX_SITE_FOOTER_ID}
      onClick={handleClick}
      className="bg-slate-800 text-slate-300 py-6 mt-12 cursor-default"
    >
      {children}
    </footer>
  )
}
