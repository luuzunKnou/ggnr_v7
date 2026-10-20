'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { WtlFacilityEquipPanel } from './WtlFacilityEquipPanel'
import { WtlFacilityPlantView } from './WtlFacilityPlantView'
import { WtlFacilitySimpleListView } from './WtlFacilitySimpleListView'
import {
  WTL_PLANTS_BY_KIND,
  WTL_SIMPLE_BY_TAB,
  WTL_WATER_PLANTS,
  type WtlPlantKind,
} from './wtlFacilitySample'

const LIST_DEFAULT = 480
const LIST_MIN = 400
const LIST_MAX = 720
const EQUIP_DEFAULT = 420
const EQUIP_MIN = 320
const EQUIP_MAX = 640

const PLANT_TABS = ['취수장', '정수장', '배수지', '가압장'] as const
const SIMPLE_TABS = ['감압변', '유량계', '소방시설', 'CCTV'] as const
const FACILITY_TABS = [...PLANT_TABS, ...SIMPLE_TABS] as const

type FacilityTab = (typeof FACILITY_TABS)[number]
type SimpleTab = (typeof SIMPLE_TABS)[number]

function isPlantTab(tab: FacilityTab): tab is WtlPlantKind {
  return (PLANT_TABS as readonly string[]).includes(tab)
}

function isSimpleTab(tab: FacilityTab): tab is SimpleTab {
  return (SIMPLE_TABS as readonly string[]).includes(tab)
}

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

export function WtlFacilityShell({ leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const [listWidth, setListWidth] = useState(LIST_DEFAULT)
  const [equipWidth, setEquipWidth] = useState(EQUIP_DEFAULT)
  const [tab, setTab] = useState<FacilityTab>('정수장')
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(WTL_WATER_PLANTS[0]?.id ?? null)
  const [selectedEquipId, setSelectedEquipId] = useState<string | null>(null)
  const [selectedSimpleId, setSelectedSimpleId] = useState<string | null>(null)

  const plants = isPlantTab(tab) ? WTL_PLANTS_BY_KIND[tab] : []
  const selectedPlant = plants.find((plant) => plant.id === selectedPlantId) ?? null
  const selectedEquip = selectedPlant?.equipment.find((item) => item.id === selectedEquipId) ?? null
  const detailOpen = selectedPlant != null && selectedEquip != null
  const total = listWidth + (detailOpen ? equipWidth : 0)

  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => {
    return () => onTotalWidthChange(0)
  }, [onTotalWidthChange])

  useEffect(() => {
    setSelectedEquipId(null)
    if (isPlantTab(tab)) {
      const list = WTL_PLANTS_BY_KIND[tab]
      setSelectedPlantId(list[0]?.id ?? null)
      setSelectedSimpleId(null)
      return
    }
    setSelectedPlantId(null)
    if (isSimpleTab(tab)) {
      setSelectedSimpleId(WTL_SIMPLE_BY_TAB[tab].items[0]?.id ?? null)
    }
  }, [tab])

  useEffect(() => {
    setSelectedEquipId(null)
  }, [selectedPlantId])

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={listWidth}
          minWidth={LIST_MIN}
          maxWidth={LIST_MAX}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setListWidth}
        >
          <div className="standard-panel-root">
            <div className="standard-panel-header">
              <span className="standard-panel-title">시설관리</span>
              <button type="button" className="standard-panel-close" onClick={onClose} aria-label="닫기">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="standard-filter-section shrink-0 border-b-0">
                <div className="flex border-b border-border">
                  {FACILITY_TABS.map((name) => {
                    const on = tab === name
                    return (
                      <button
                        key={name}
                        type="button"
                        className={cn(
                          'h-7 min-w-0 flex-1 truncate border-b-2 -mb-px px-0.5 text-center text-[11px]',
                          on
                            ? 'border-primary font-semibold text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        )}
                        onClick={() => setTab(name)}
                      >
                        {name}
                      </button>
                    )
                  })}
                </div>
              </div>
              {isPlantTab(tab) ? (
                <WtlFacilityPlantView
                  plants={plants}
                  selectedPlantId={selectedPlantId}
                  selectedEquipId={selectedEquipId}
                  onSelectPlant={(plant) => setSelectedPlantId(plant.id)}
                  onSelectEquip={(equip) => setSelectedEquipId(equip?.id ?? null)}
                />
              ) : isSimpleTab(tab) ? (
                <WtlFacilitySimpleListView
                  config={WTL_SIMPLE_BY_TAB[tab]}
                  selectedId={selectedSimpleId}
                  onSelect={(item) => setSelectedSimpleId(item.id)}
                />
              ) : null}
            </div>
          </div>
        </MapSideListPanel>
      </div>
      {detailOpen && selectedPlant && selectedEquip && (
        <div className="pointer-events-auto shrink-0">
          <MapSideListPanel
            width={equipWidth}
            minWidth={EQUIP_MIN}
            maxWidth={EQUIP_MAX}
            leftOffsetPx={leftOffsetPx + listWidth}
            onWidthChange={setEquipWidth}
            contentClassName="overflow-hidden"
          >
            <WtlFacilityEquipPanel
              plant={selectedPlant}
              equipment={selectedEquip}
              onClose={() => setSelectedEquipId(null)}
            />
          </MapSideListPanel>
        </div>
      )}
    </>
  )
}
