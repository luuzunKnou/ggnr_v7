"use client"

import { useRouter } from "next/navigation"
import { useRef, useCallback } from "react"

const DEV_CLICK_COUNT = 5

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
    <footer onClick={handleClick} className="bg-slate-800 text-slate-300 py-6 mt-12 cursor-default">
      {children}
    </footer>
  )
}
