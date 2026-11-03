'use client'

import { useMemo } from 'react'
import {
  WtlFacilityShell,
  type WtlFacilityShellCatalog,
} from '../facility/WtlFacilityShell'
import {
  EQUIPMENT_TABS,
  isEquipmentTabEnabled,
  listAllEquipmentUndergroundTableNames,
  listEquipmentGroupOptions,
} from './wtlEquipmentCatalog'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

const EQUIPMENT_CATALOG: WtlFacilityShellCatalog = {
  tabs: EQUIPMENT_TABS,
  isTabEnabled: isEquipmentTabEnabled,
  listGroupOptions: listEquipmentGroupOptions,
  listUndergroundTableNames: listAllEquipmentUndergroundTableNames,
  emptyNoTab: '활성화된 설비 레이어가 없습니다.',
  emptyNoLayer: '선택한 설비에 등록된 레이어가 없습니다.',
  emptyNoQuery: '설비를 조회할 수 없습니다.',
}

/** 설비관리 — 기존 설비 종류 탭 + DB 목록·상세 (시설 셸 재사용) */
export function WtlEquipmentShell(props: Props) {
  const catalog = useMemo(() => EQUIPMENT_CATALOG, [])
  return <WtlFacilityShell {...props} title="설비관리" catalog={catalog} />
}
