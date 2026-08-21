/**
 * 안전점검 상세 속성 — 그룹·기본 노출(더보기 밖) 정의
 * 서비스는 flat attributes를 반환하고, 패널에서 이 설정으로 묶고 접는다.
 */

export type FmsDetailAttrGroup = {
  id: string
  label: string
  /** true면 더보기 없이 기본 표시 */
  primary: boolean
  fields: readonly string[]
}

/** 시설물(BASTB_MASTER) 상세 */
export const FMS_FACILITY_DETAIL_GROUPS: readonly FmsDetailAttrGroup[] = [
  {
    id: 'basic',
    label: '기본정보',
    primary: true,
    fields: [
      'facil_no',
      'facil_nm',
      'mng_main_cd',
      'permit_org_cd',
      'facil_owner',
      'route_class',
      'route_detail',
      'addr_full',
    ],
  },
  {
    id: 'class',
    label: '시설분류',
    primary: true,
    fields: ['facil_class', 'facil_gbn', 'facil_kind', 'facil_desc_cd'],
  },
  {
    id: 'completion',
    label: '준공·담보',
    primary: true,
    fields: ['cpl_ymd', 'rsp_to_ymd'],
  },
  {
    id: 'design',
    label: '설계',
    primary: false,
    fields: [
      'design_ymd_from',
      'design_ymd_to',
      'designer_nm',
      'dsn_book_st_yn',
      'eq_dsn_app_yn',
    ],
  },
  {
    id: 'construction',
    label: '공사',
    primary: false,
    fields: [
      'const_ymd_from',
      'const_ymd_to',
      'constractor_cd',
      'constractor_nm',
      'const_amt',
      'const_order_cd',
      'const_order_nm',
      'const_nm',
      'const_spvsr_nm',
    ],
  },
  {
    id: 'supervision',
    label: '감리',
    primary: false,
    fields: ['spv_ymd_from', 'spv_ymd_to', 'supervisor_nm', 'gam_reason_cd'],
  },
  {
    id: 'etc',
    label: '기타',
    primary: false,
    fields: [
      'mng_no',
      'temp_ymd',
      'whl_pht_file_ct',
      'etc_pht_file_ct',
      'upper_no',
      'lnk_facil_no',
      'etc_remark',
    ],
  },
] as const

/** 점검진단실적(MANTB_DIGN_RESULT) 상세 */
export const FMS_INSPECTION_DETAIL_GROUPS: readonly FmsDetailAttrGroup[] = [
  {
    id: 'summary',
    label: '',
    primary: true,
    fields: [
      'dign_gbn',
      'regular_gbn',
      'start_ymd',
      'end_ymd',
      'state_grade',
      'rep_engineer_nm',
      'dign_content',
    ],
  },
  {
    id: 'extra',
    label: '부가정보',
    primary: false,
    fields: [
      'facil_no',
      'dign_seq',
      'dign_amt',
      'amend_content',
      'wrt_ymd',
      'wrt_person_nm',
    ],
  },
] as const

export type FmsDetailAttrItem = {
  field: string
  label: string
  value: string
}

export type FmsDetailAttrSection = {
  id: string
  label: string
  primary: boolean
  items: FmsDetailAttrItem[]
}

/**
 * flat attributes → 그룹 섹션.
 * 그룹에 없는 필드는 기타(primary=false)로 뒤에 붙인다.
 */
export function buildFmsDetailSections(
  items: FmsDetailAttrItem[],
  groups: readonly FmsDetailAttrGroup[]
): FmsDetailAttrSection[] {
  const byField = new Map(items.map((item) => [item.field.toLowerCase(), item]))
  const used = new Set<string>()
  const sections: FmsDetailAttrSection[] = []

  for (const group of groups) {
    const sectionItems: FmsDetailAttrItem[] = []
    for (const field of group.fields) {
      const key = field.toLowerCase()
      const item = byField.get(key)
      if (!item) continue
      sectionItems.push(item)
      used.add(key)
    }
    if (sectionItems.length === 0) continue
    sections.push({
      id: group.id,
      label: group.label,
      primary: group.primary,
      items: sectionItems,
    })
  }

  const rest = items.filter((item) => !used.has(item.field.toLowerCase()))
  if (rest.length > 0) {
    const etc = sections.find((s) => s.id === 'etc')
    if (etc) {
      etc.items.push(...rest)
    } else {
      sections.push({
        id: 'ungrouped',
        label: '기타',
        primary: false,
        items: rest,
      })
    }
  }

  return sections
}

export function countHiddenFmsDetailItems(sections: FmsDetailAttrSection[]): number {
  return sections.filter((s) => !s.primary).reduce((n, s) => n + s.items.length, 0)
}
