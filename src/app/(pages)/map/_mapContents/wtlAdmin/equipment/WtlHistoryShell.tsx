'use client'

import { useEffect, useMemo, useState } from 'react'
import { call } from '@/lib/api'
import {
  WtlFacilityShell,
  type WtlFacilityShellCatalog,
} from '../facility/WtlFacilityShell'
import {
  equipmentTabLabel,
  listAllEquipmentUndergroundTableNames,
  listEquipmentGroupOptions,
} from './wtlEquipmentCatalog'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

/** 이력관리 — 설비관리와 동일 셸·카탈로그, 탭은 adminTabs.json wtlHistory */
export function WtlHistoryShell(props: Props) {
  const [tabs, setTabs] = useState<string[]>([])
  const [enabledTabs, setEnabledTabs] = useState<string[]>([])
  const [tabsLoading, setTabsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setTabsLoading(true)
    void call('', 'POST', {
      service: 'wtlFacilityService',
      action: 'listHistoryTabs',
      params: {},
    })
      .then((res) => {
        if (cancelled) return
        const data = res?.data ?? res
        const next = Array.isArray(data?.tabs)
          ? data.tabs.map((t: unknown) => String(t ?? '').trim()).filter(Boolean)
          : []
        const enabled = Array.isArray(data?.enabledTabs)
          ? data.enabledTabs.map((t: unknown) => String(t ?? '').trim()).filter(Boolean)
          : []
        setTabs((prev) => (prev.join('\0') === next.join('\0') ? prev : next))
        setEnabledTabs((prev) =>
          prev.join('\0') === enabled.join('\0') ? prev : enabled
        )
      })
      .catch(() => {
        if (!cancelled) {
          setTabs((prev) => (prev.length === 0 ? prev : []))
          setEnabledTabs((prev) => (prev.length === 0 ? prev : []))
        }
      })
      .finally(() => {
        if (!cancelled) setTabsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const enabledSet = useMemo(() => new Set(enabledTabs), [enabledTabs])

  const catalog = useMemo<WtlFacilityShellCatalog>(
    () => ({
      tabs,
      isTabEnabled: (name: string) =>
        !tabsLoading && enabledSet.has(String(name ?? '').trim()),
      listGroupOptions: listEquipmentGroupOptions,
      listUndergroundTableNames: () => listAllEquipmentUndergroundTableNames(tabs),
      tabLabel: equipmentTabLabel,
      emptyNoTab: '활성화된 이력 레이어가 없습니다.',
      emptyNoLayer: '선택한 이력에 등록된 레이어가 없습니다.',
      emptyNoQuery: '이력을 조회할 수 없습니다.',
    }),
    [enabledSet, tabs, tabsLoading]
  )

  return (
    <WtlFacilityShell
      {...props}
      title="이력관리"
      catalog={catalog}
      layerGroupsMode="equipment"
    />
  )
}
