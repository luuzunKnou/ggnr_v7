import type { ReactNode } from "react"

export default function SysManagerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background p-3 md:p-3">
      <div className="max-w-5xl mx-auto">{children}</div>
    </div>
  )
}
