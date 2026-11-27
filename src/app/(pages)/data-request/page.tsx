import { Suspense } from 'react'
import { SiteIndexShell } from '@/app/(pages)/(index)/site-index-shell'
import { DataRequestClient } from './DataRequestClient'

export const dynamic = 'force-dynamic'

export default function DataRequestPage() {
  return (
    <SiteIndexShell
      fillViewport
      mainClassName="container mx-auto px-4 py-4 pb-24 flex flex-1 flex-col min-h-0"
    >
      <Suspense
        fallback={
          <div className="py-8 text-center text-sm text-muted-foreground">불러오는 중…</div>
        }
      >
        <DataRequestClient />
      </Suspense>
    </SiteIndexShell>
  )
}
