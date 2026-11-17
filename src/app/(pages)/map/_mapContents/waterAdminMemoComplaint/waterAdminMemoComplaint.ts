export type WaterAdminMenuKind = 'memo' | 'complaint'

export type WaterAdminTable = {
  tableName: string
  label: string
}

export type WaterAdminMenu = {
  serEng: string
  label: string
  kind: WaterAdminMenuKind
  tables: WaterAdminTable[]
  /** 목록에 안 보여도 지도에는 켜 둘 레이어. 없으면 tables 를 켠다 */
  mapLayers?: string[]
}

export const WATER_ADMIN_MENUS: WaterAdminMenu[] = [
  {
    serEng: 'wtlComplaint',
    label: '상수민원',
    kind: 'complaint',
    tables: [{ tableName: 'uiseong_complaint_wtl', label: '상수민원' }],
  },
  {
    serEng: 'wtlMemo',
    label: '상수메모',
    kind: 'memo',
    tables: [{ tableName: 'memo_wtl', label: '상수메모' }],
  },
  {
    serEng: 'splyComplaint',
    label: '급수민원',
    kind: 'complaint',
    tables: [{ tableName: 'complaint_sply', label: '급수민원' }],
  },
  {
    serEng: 'splyMemo',
    label: '급수메모',
    kind: 'memo',
    tables: [{ tableName: 'memo_sply', label: '급수메모' }],
  },
  {
    serEng: 'swlComplaint',
    label: '하수민원',
    kind: 'complaint',
    tables: [{ tableName: 'complaint_swl', label: '하수민원' }],
  },
  {
    serEng: 'swlMemo',
    label: '하수메모',
    kind: 'memo',
    tables: [{ tableName: 'memo_swl', label: '하수메모' }],
  },
  {
    serEng: 'dreComplaint',
    label: '준설민원',
    kind: 'complaint',
    tables: [{ tableName: 'complaint_dre', label: '준설민원' }],
    mapLayers: ['complaint_dre', 'complaint_dre_detail'],
  },
  {
    serEng: 'dreMemo',
    label: '준설메모',
    kind: 'memo',
    tables: [{ tableName: 'memo_dre', label: '준설메모' }],
  },
]

const MENU_BY_ENG = new Map(WATER_ADMIN_MENUS.map((menu) => [menu.serEng, menu]))

export function findOpenedWaterAdminMenu(opened: string[]): WaterAdminMenu | null {
  for (const token of opened) {
    const menu = MENU_BY_ENG.get(token)
    if (menu) return menu
  }
  return null
}
