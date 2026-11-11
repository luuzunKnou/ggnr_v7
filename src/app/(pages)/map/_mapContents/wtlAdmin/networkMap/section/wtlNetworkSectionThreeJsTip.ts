import {
  formatDefineFieldDisplayValue,
} from '@/lib/defineLayerCodeDisplay'
import {
  getDefineFieldDisplayLabel,
  getRowValueByField,
  isDefineFieldFlagTrue,
  selectDefineLayerListFields,
} from '@/app/(pages)/map/_mapComponents/standard/defineLayerRowUtils'
import {
  loadWtlDefineDisplayBundle,
  peekWtlDefineDisplayBundle,
} from '../wtlNetworkDefineDisplayCache'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type ThreeJsTipUserData = {
  tooltipLayer?: string
  tooltipLabel?: string
  tooltipProps?: Record<string, unknown> | null
  tooltipFieldsTable?: string | null
}

/** 호버 툴팁 HTML — 레이어·show_title 라벨·시설목록 상세와 동일 테이블 */
export async function buildThreeJsHoverTipHtml(
  ud: ThreeJsTipUserData
): Promise<string> {
  const layer = String(ud.tooltipLayer ?? '').trim() || '—'
  const fallbackLabel = String(ud.tooltipLabel ?? '').trim() || '—'
  const tableName = String(ud.tooltipFieldsTable ?? '').trim()
  const props =
    ud.tooltipProps && typeof ud.tooltipProps === 'object'
      ? ud.tooltipProps
      : null

  let label = fallbackLabel
  let detailHtml =
    '<div class="mt-2 overflow-hidden rounded border border-border px-2.5 py-2 text-[11px] text-muted-foreground">상세 없음</div>'

  if (tableName && props) {
    let bundle = peekWtlDefineDisplayBundle(tableName, null)
    if (!bundle) {
      bundle = await loadWtlDefineDisplayBundle(tableName, null)
    }

    const titleField = bundle.fields.find((f) =>
      isDefineFieldFlagTrue(f.define_field_show_title)
    )
    if (titleField) {
      const titleKey = String(titleField.define_field_name ?? '').trim()
      if (titleKey) {
        const raw = getRowValueByField(props, titleKey)
        const text = formatDefineFieldDisplayValue(
          raw,
          titleField.define_field_type,
          bundle.codesByField[titleKey.toLowerCase()],
          ''
        ).trim()
        if (text) label = text
      }
    }

    const listFields = selectDefineLayerListFields(bundle.fields).filter(
      (f) => !isDefineFieldFlagTrue(f.define_field_show_title)
    )
    if (listFields.length > 0) {
      const rows: string[] = []
      for (const f of listFields) {
        const key = String(f.define_field_name ?? '').trim()
        if (!key) continue
        const kor = getDefineFieldDisplayLabel(key, f.define_field_kor_name)
        const raw = getRowValueByField(props, key)
        const text = formatDefineFieldDisplayValue(
          raw,
          f.define_field_type,
          bundle.codesByField[key.toLowerCase()],
          '—'
        )
        rows.push(
          `<tr>` +
            `<th scope="row" class="standard-detail-attr-label standard-detail-attr-cell-border" title="${escapeHtml(kor)}">${escapeHtml(kor)}</th>` +
            `<td class="standard-detail-attr-value standard-detail-attr-cell-border text-foreground" title="${escapeHtml(text)}">${escapeHtml(text)}</td>` +
            `</tr>`
        )
      }
      if (rows.length) {
        detailHtml =
          `<table class="standard-detail-attr-table mt-2">` +
          `<tbody>${rows.join('')}</tbody></table>`
      }
    }
  }

  return (
    `<div class="text-[11px] leading-tight text-muted-foreground">${escapeHtml(layer)}</div>` +
    `<div class="mt-0.5 text-[11px] font-medium leading-snug text-primary">${escapeHtml(label)}</div>` +
    detailHtml
  )
}
