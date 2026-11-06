import fs from 'node:fs'
import path from 'node:path'
import { normalizeGeoServerSymbolUrl } from '@/lib/geoserverSymbolPath'
import {
  formatSldXml,
  patchSldEnvDefaults,
  type GeometryType,
  type StyleProps,
} from '@/lib/geoserverStyleUtils'

export type SldEnvTemplateKind = 'point' | 'line' | 'polygon' | 'symbol'

const TEMPLATES_DIR = path.join(process.cwd(), 'src', 'lib', 'geoserverStyles', 'templates')

/** POINT + symbolUrl → symbol, 그 외 geometryType */
export function resolveSldEnvTemplateKind(
  geometryType: GeometryType,
  styleProps: StyleProps
): SldEnvTemplateKind {
  if (geometryType === 'POINT' && String(styleProps.symbolUrl ?? '').trim()) return 'symbol'
  if (geometryType === 'POINT') return 'point'
  if (geometryType === 'LINE') return 'line'
  return 'polygon'
}

function readTemplate(kind: SldEnvTemplateKind): string {
  const file = path.join(TEMPLATES_DIR, `${kind}.sld.tpl`)
  return fs.readFileSync(file, 'utf8')
}

/**
 * 타입별 env SLD 템플릿에 스타일명·심볼·화면 기본값을 채워 본문을 만든다.
 * 플레이스홀더: __STYLE_NAME__, __SYMBOL_HREF__, __SYMBOL_FORMAT__
 */
export function buildSldFromEnvTemplate(params: {
  styleName: string
  geometryType: GeometryType
  styleProps: StyleProps
}): string {
  const styleName = String(params.styleName ?? '').trim()
  if (!styleName) throw new Error('스타일 이름이 필요합니다.')

  const styleProps: StyleProps = { ...params.styleProps }
  // 점 크기: 화면 size만 오면 markSize(env _size)로 맞춤
  if (
    params.geometryType === 'POINT' &&
    styleProps.markSize == null &&
    styleProps.size != null &&
    Number.isFinite(styleProps.size)
  ) {
    styleProps.markSize = styleProps.size
  }

  const kind = resolveSldEnvTemplateKind(params.geometryType, styleProps)
  let body = readTemplate(kind)

  const symbolRaw = String(styleProps.symbolUrl ?? '').trim()
  const symbolHref = symbolRaw
    ? normalizeGeoServerSymbolUrl(symbolRaw)
    : `/www/symbol/water/${styleName}.svg`
  const symbolFormat = /\.png$/i.test(symbolHref) ? 'image/png' : 'image/svg+xml'

  body = body
    .split('__STYLE_NAME__')
    .join(styleName)
    .split('__SYMBOL_HREF__')
    .join(symbolHref)
    .split('__SYMBOL_FORMAT__')
    .join(symbolFormat)

  const patched = patchSldEnvDefaults(body, styleName, styleProps)
  return formatSldXml(patched ?? body)
}

/** 복잡한 CSS 라벨식(주제도 alias 등)이면 템플릿 SLD 대신 기존 CSS 경로를 쓴다 */
export function shouldUseSldEnvTemplate(styleProps: StyleProps): boolean {
  const label = String(styleProps.labelField ?? '').trim()
  if (!label) return true
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) return false
  return true
}
