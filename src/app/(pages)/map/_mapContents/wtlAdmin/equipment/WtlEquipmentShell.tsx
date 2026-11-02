'use client'

import { WtlFacilityShell } from '../facility/WtlFacilityShell'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

/** 설비관리 — 시설관리와 동일 UX(DB·탭·상세·연관탭), 제목만 다름 */
export function WtlEquipmentShell(props: Props) {
  return <WtlFacilityShell {...props} title="설비관리" />
}
