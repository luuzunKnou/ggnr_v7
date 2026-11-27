'use client'

import { useEffect } from 'react'
import {
  applyOdorScadaPalette,
  clearOdorScadaPaletteAttr,
  readOdorScadaPalette,
} from '@/app/(pages)/(index)/odorPhV2/odorScadaPalette'

const PROJECT_ATTR = 'data-ggnr-project'

type Props = {
  projectName: string
}

/**
 * odor_ph 전용 — html에 프로젝트·SCADA 팔레트 속성을 맞춰
 * 좌측 사이드바·우측 맵 컨트롤이 B/C 톤을 쓰게 한다.
 */
export function OdorPhScadaChromeSync({ projectName }: Props) {
  useEffect(() => {
    const root = document.documentElement
    const isOdor = projectName.trim() === 'odor_ph'
    if (isOdor) root.setAttribute(PROJECT_ATTR, 'odor_ph')
    else if (root.getAttribute(PROJECT_ATTR) === 'odor_ph') root.removeAttribute(PROJECT_ATTR)

    const syncPalette = () => {
      if (!isOdor) {
        clearOdorScadaPaletteAttr()
        return
      }
      if (root.classList.contains('dark_v2')) applyOdorScadaPalette(readOdorScadaPalette())
      else clearOdorScadaPaletteAttr()
    }
    syncPalette()

    const obs = new MutationObserver(syncPalette)
    obs.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => {
      obs.disconnect()
      if (isOdor) {
        clearOdorScadaPaletteAttr()
        root.removeAttribute(PROJECT_ATTR)
      }
    }
  }, [projectName])

  return null
}
