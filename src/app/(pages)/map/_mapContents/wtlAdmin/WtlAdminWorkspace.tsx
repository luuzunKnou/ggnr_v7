'use client'

import { useEffect, useMemo, useState } from 'react'
import { MapSideListPanel } from '../../_mapComponents/MapSideListPanel'
import { WtlAdminDetailPanel, WtlAdminListPanel } from './WtlAdminScreen'
import { WTL_SCREENS, sectionBySerEng, type WtlNav } from './wtlAdminMenu'
import type { WtlAdminSerEng } from './wtlAdminBinding'

const LIST_DEFAULT = 640
const LIST_MIN = 480
const LIST_MAX = 900
const DETAIL_DEFAULT = 400
const DETAIL_MIN = 320
const DETAIL_MAX = 640

type Props = {
  serEng: WtlAdminSerEng
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

function rootMenus(nav: WtlNav[]): WtlNav[] {
  return nav
}

export function WtlAdminWorkspace({ serEng, leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const section = sectionBySerEng(serEng)
  const menus = rootMenus(section?.nav ?? [])
  const [listWidth, setListWidth] = useState(LIST_DEFAULT)
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT)
  const [menuId, setMenuId] = useState(menus[0]?.id ?? '')
  const [tab, setTab] = useState<string | null>(null)
  const [rowIndex, setRowIndex] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const next = sectionBySerEng(serEng)
    const first = next?.nav[0]
    setMenuId(first?.id ?? '')
    setTab(null)
    setRowIndex(null)
    setEditing(false)
    setNotice(null)
  }, [serEng])

  const menu = menus.find((item) => item.id === menuId) ?? menus[0]
  const screenId = menu?.screenId ?? 'net-view'
  const screen = WTL_SCREENS[screenId] ?? WTL_SCREENS['net-view']
  const activeTab = tab && screen.tabs?.some((item) => item.id === tab) ? tab : (screen.tabs?.[0]?.id ?? null)
  const detailOpen = rowIndex != null
  const total = listWidth + (detailOpen ? detailWidth : 0)

  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => {
    return () => onTotalWidthChange(0)
  }, [onTotalWidthChange])

  const row = useMemo(() => (rowIndex == null ? null : (screen.rows[rowIndex] ?? null)), [rowIndex, screen.rows])

  const pickMenu = (id: string) => {
    const picked = menus.find((item) => item.id === id)
    setMenuId(id)
    setTab(picked?.tab ?? null)
    setRowIndex(null)
    setEditing(false)
    setNotice(null)
  }

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
          <WtlAdminListPanel
            title={section?.label ?? '상수도 행정'}
            menus={menus}
            menuId={menu?.id ?? ''}
            onMenu={pickMenu}
            screen={screen}
            tab={activeTab}
            onTab={setTab}
            selectedIndex={rowIndex}
            onSelect={(index) => {
              setRowIndex(index)
              setEditing(false)
              setNotice(null)
            }}
            onAdd={() => {
              setRowIndex(0)
              setEditing(true)
              setNotice(null)
            }}
            onClose={onClose}
          />
        </MapSideListPanel>
      </div>
      {detailOpen && (
        <div className="pointer-events-auto shrink-0">
          <MapSideListPanel
            width={detailWidth}
            minWidth={DETAIL_MIN}
            maxWidth={DETAIL_MAX}
            leftOffsetPx={leftOffsetPx + listWidth}
            onWidthChange={setDetailWidth}
            contentClassName="overflow-hidden"
          >
            <WtlAdminDetailPanel
              title={menu?.label ?? ''}
              screen={screen}
              tab={activeTab}
              row={row}
              editing={editing}
              notice={notice}
              onEdit={() => setEditing(true)}
              onCancel={() => {
                setEditing(false)
                setNotice(null)
              }}
              onSave={() => {
                setEditing(false)
                setNotice('화면에만 반영했습니다. 서버에는 저장하지 않습니다.')
              }}
              onClose={() => {
                setRowIndex(null)
                setEditing(false)
                setNotice(null)
              }}
            />
          </MapSideListPanel>
        </div>
      )}
    </>
  )
}
