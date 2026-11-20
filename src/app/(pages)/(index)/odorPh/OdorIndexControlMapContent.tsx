'use client'

import { withBasePathNav } from '@/lib/basePath'
import { odorAlertBtnPrimary } from '@/app/(pages)/map/_mapContents/odorAlert/odorAlertConfig'

const CONTROL_MAP_HREF = '/map?system=odorAdmin'

/** 관제 지도 — 버튼으로만 이동 (자동 리다이렉트 없음) */
export function OdorIndexControlMapContent() {
  return (
    <div className="flex min-h-[200px] flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-muted-foreground">관제 지도에서 센서·경계·경보를 확인합니다.</p>
      <button
        type="button"
        title="관제 지도 열기"
        className={`${odorAlertBtnPrimary} cursor-pointer`}
        onClick={() => window.location.assign(withBasePathNav(CONTROL_MAP_HREF))}
      >
        관제 지도 열기
      </button>
    </div>
  )
}
