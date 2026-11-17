'use client'

import { SwlNetworkMapShell } from './networkMap/SwlNetworkMapShell'
import type { SwlAdminEmptySerEng } from './swlAdminBinding'

type Props = {
  serEng: SwlAdminEmptySerEng
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

export function SwlAdminEmptyShell(props: Props) {
  if (props.serEng === 'swlNetworkMap') {
    return (
      <SwlNetworkMapShell
        leftOffsetPx={props.leftOffsetPx}
        onTotalWidthChange={props.onTotalWidthChange}
        onClose={props.onClose}
      />
    )
  }
  return null
}
