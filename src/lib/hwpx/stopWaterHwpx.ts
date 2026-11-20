/**
 * 단수 알림문 HWPX(한글) 생성 — v6 ggnr StopWaterController(downloadHwp) 양식 그대로 이식.
 * - 템플릿: templates/stopWaterBlank.hwpx (v6 resources/excel/blank.hwpx 복사본)
 * - Contents/header.xml 패치(용지·문단·글자 모양 추가), Contents/section0.xml 새로 작성,
 *   BinData/image1.png(단수구역도) 삽입, content.hpf 매니페스트에 이미지 등록
 * - zip: mimetype 무압축 첫 항목
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'

const TEMPLATE_PATH = path.join(process.cwd(), 'src', 'lib', 'hwpx', 'templates', 'stopWaterBlank.hwpx')

export type StopWaterHwpxInput = {
  /** 알림 제목 */
  title: string
  /** 단수 사유 */
  reason: string
  /** 'YYYY-MM-DD HH:mm' 또는 'YYYY-MM-DDTHH:mm' */
  startAt: string
  endAt: string
  /** 대상지역(리 이름 쉼표 연결) */
  areas: string
  /** 단수구역도 PNG */
  image?: Buffer | null
  /** 발신 기관(문서 끝) */
  from?: string
  /** 문서 하단 날짜(기본: 오늘) */
  today?: Date
}

// ───────────────────────── zip (읽기·쓰기) ─────────────────────────

type ZipEntry = { name: string; data: Buffer }

/** 중앙 디렉터리 기준 zip 읽기(store/deflate만) */
function readZip(buf: Buffer): ZipEntry[] {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('HWPX 템플릿 zip 형식이 올바르지 않습니다.')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out: ZipEntry[] = []
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 중앙 디렉터리 손상')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const start = localOff + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(start, start + compSize)
    const data = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw)
    out.push({ name, data })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** zip 쓰기 — mimetype은 무압축(store), 나머지 deflate */
function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const store = e.name === 'mimetype'
    const comp = store ? e.data : zlib.deflateRawSync(e.data)
    const crc = crc32(e.data)
    const method = store ? 0 : 8
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 이름
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, comp)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(comp.length, 20)
    central.writeUInt32LE(e.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + comp.length
  }
  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, end])
}

// ───────────────────────── header.xml (v6 makeHeaderXml) ─────────────────────────

const PARA_PR = (id: number, align: 'CENTER' | 'JUSTIFY', caseSpacing: number) =>
  `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">` +
  `<hh:align horizontal="${align}" vertical="BASELINE"/>` +
  '<hh:heading type="NONE" idRef="0" level="0"/>' +
  '<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>' +
  '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>' +
  '<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">' +
  '<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin>' +
  `<hh:lineSpacing type="PERCENT" value="${caseSpacing}" unit="HWPUNIT"/>` +
  '</hp:case><hp:default>' +
  '<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin>' +
  '<hh:lineSpacing type="PERCENT" value="100" unit="HWPUNIT"/>' +
  '</hp:default></hp:switch>' +
  '<hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>' +
  '</hh:paraPr>'

const CHAR_PR = (id: number, height: number) =>
  `<hh:charPr id="${id}" height="${height}" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">` +
  '<hh:fontRef hangul="1" latin="1" hanja="1" japanese="1" other="1" symbol="1" user="1"/>' +
  '<hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>' +
  '<hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>' +
  '<hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>' +
  '<hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>' +
  '<hh:bold hangul="1" latin="1" hanja="1" japanese="1" other="1" symbol="1" user="1"/>' +
  '<hh:underline type="NONE" shape="SOLID" color="#000000"/>' +
  '<hh:strikeout shape="NONE" color="#000000"/>' +
  '<hh:outline type="NONE"/>' +
  '<hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/>' +
  '</hh:charPr>'

function makeHeaderXml(xml: string): string {
  const pageDef = '<hh:pageDef width="59527" height="84188" gutterType="LEFT_ONLY" landscape="0"/>'
  if (!xml.includes('<hh:pageDef')) {
    xml = xml.replace(
      '</hh:refList>',
      `</hh:refList><hh:secDefList><hh:secDef id="0" status="2">${pageDef}</hh:secDef></hh:secDefList>`
    )
  } else {
    xml = xml.replace(/<hh:pageDef [^>]*>/g, pageDef)
  }
  xml = xml.replace('<hh:borderFills itemCnt="2">', '<hh:borderFills itemCnt="3">')
  xml = xml.replace(
    '</hh:borderFills>',
    '<hh:borderFill id="3" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">' +
      '<hh:slash type="NONE" Crooked="0" isCounter="0"/>' +
      '<hh:backSlash type="NONE" Crooked="0" isCounter="0"/>' +
      '<hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>' +
      '<hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>' +
      '<hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>' +
      '<hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>' +
      '<hh:diagonal type="NONE" width="0.1 mm" color="#000000"/>' +
      '</hh:borderFill></hh:borderFills>'
  )
  // v6: 기존 문단 줄간격 160% → 100% (전체)
  xml = xml
    .split('<hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>')
    .join('<hh:lineSpacing type="PERCENT" value="100" unit="HWPUNIT"/>')
  xml = xml.replace('<hh:paraProperties itemCnt="21">', '<hh:paraProperties itemCnt="23">')
  xml = xml.replace(
    '</hh:paraProperties>',
    PARA_PR(21, 'CENTER', 100) + PARA_PR(22, 'JUSTIFY', 160) + '</hh:paraProperties>'
  )
  xml = xml.replace('<hh:charProperties itemCnt="8">', '<hh:charProperties itemCnt="12">')
  // 8: 13pt, 9: 16pt(제목·기관), 10: 9pt(안내문), 11: 10pt(항목) — 모두 굵게
  xml = xml.replace(
    '</hh:charProperties>',
    CHAR_PR(8, 1300) + CHAR_PR(9, 1600) + CHAR_PR(10, 900) + CHAR_PR(11, 1000) + '</hh:charProperties>'
  )
  xml = xml.replace(
    '<hh:binData itemCnt="0"/>',
    '<hh:binData itemCnt="1"><hh:binItem id="1" type="EMBEDDING" format="PNG" binDataIDRef="1"/></hh:binData>'
  )
  return xml
}

// ───────────────────────── section0.xml (v6 buildSectionXml) ─────────────────────────

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function hp(text: string, paraPr = '22', charPr = '0'): string {
  return (
    `<hp:p id="0" paraPrIDRef="${paraPr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${charPr}"><hp:t>${escapeXml(text)}</hp:t></hp:run>` +
    '<hp:linesegarray/></hp:p>'
  )
}

/** 'yyyy년 M월 d일 H:mm' — v6 의도 형식. (v6는 시각이 0:00으로 떨어지는 버그가 있어 시각을 그대로 살림) */
export function formatStopWaterDate(value: string): string {
  const v = String(value ?? '').trim()
  if (!v) return ''
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(v)
  if (!m) return v.length > 16 ? v.slice(0, 16) : v
  const [, y, mo, d, h, mi] = m
  const date = `${Number(y)}년 ${Number(mo)}월 ${Number(d)}일`
  return h != null ? `${date} ${Number(h)}:${mi}` : `${date} 0:00`
}

function formatToday(d: Date): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

const SEC_NS =
  'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" ' +
  'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" ' +
  'xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" ' +
  'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" ' +
  'xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" ' +
  'xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" ' +
  'xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" ' +
  'xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" ' +
  'xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
  'xmlns:opf="http://www.idpf.org/2007/opf/" ' +
  'xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" ' +
  'xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" ' +
  'xmlns:epub="http://www.idpf.org/2007/ops" ' +
  'xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"'

const PAGE_BORDER = (type: string) =>
  `<hp:pageBorderFill type="${type}" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER">` +
  '<hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>'

function buildSectionXml(input: StopWaterHwpxInput): string {
  const sb: string[] = []
  sb.push('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>')
  sb.push(`<hs:sec ${SEC_NS}>`)
  sb.push(
    '<hp:p id="3121190098" paraPrIDRef="20" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">' +
      '<hp:run charPrIDRef="7">' +
      '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="1" textVerticalWidthHead="0" masterPageCnt="0">' +
      '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>' +
      '<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>' +
      '<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>' +
      '<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>' +
      '<hp:pagePr landscape="WIDELY" width="59527" height="84188" gutterType="LEFT_ONLY">' +
      '<hp:margin header="0" footer="0" gutter="0" left="5669" right="5669" top="5669" bottom="4252"/>' +
      '</hp:pagePr>' +
      '<hp:footNotePr>' +
      '<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>' +
      '<hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/>' +
      '<hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/>' +
      '<hp:numbering type="CONTINUOUS" newNum="1"/>' +
      '<hp:placement place="EACH_COLUMN" beneathText="0"/>' +
      '</hp:footNotePr>' +
      '<hp:endNotePr>' +
      '<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>' +
      '<hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/>' +
      '<hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/>' +
      '<hp:numbering type="CONTINUOUS" newNum="1"/>' +
      '<hp:placement place="END_OF_DOCUMENT" beneathText="0"/>' +
      '</hp:endNotePr>' +
      PAGE_BORDER('BOTH') +
      PAGE_BORDER('EVEN') +
      PAGE_BORDER('ODD') +
      '</hp:secPr>' +
      '<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>' +
      '</hp:run>' +
      '<hp:run charPrIDRef="7"><hp:t/></hp:run>' +
      '<hp:linesegarray/>' +
      '</hp:p>'
  )

  const blank = (n: number) => {
    for (let i = 0; i < n; i += 1) sb.push(hp(''))
  }
  const tab = '   '

  sb.push(hp(input.title, '21', '9'))
  blank(2)
  sb.push(hp('아래와 같이 일시적으로 단수가 예정되어 있습니다. 많은 협조와 양해를 부탁드립니다.', '21', '10'))
  blank(3)
  sb.push(hp('- 아    래 -', '21', '11'))
  blank(2)
  sb.push(hp('1. 사    유', '22', '11'))
  sb.push(hp(tab + input.reason))
  sb.push(hp('2. 단수일시', '22', '11'))
  sb.push(
    hp(`${tab}${formatStopWaterDate(input.startAt)} ~ ${formatStopWaterDate(input.endAt)} (예정)`)
  )
  sb.push(hp('3. 대상지역 및 단수구역도', '22', '11'))
  sb.push(hp(input.areas ? tab + input.areas : ''))

  // 그림 (v6 동일 크기 161.12 x 81.56 mm)
  const hwpUnitPerMm = 7200 / 25.4
  const picWidth = Math.round(161.12 * hwpUnitPerMm)
  const picHeight = Math.round(81.56 * hwpUnitPerMm)
  const picScaleX = picWidth / 129600
  const picScaleY = picHeight / 65640
  const picCenterX = Math.trunc(picWidth / 2)
  const picCenterY = Math.trunc(picHeight / 2)
  const picBaseline = Math.round((20749 * picHeight) / 24411)
  sb.push(
    '<hp:p id="0" paraPrIDRef="21" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">' +
      '<hp:run charPrIDRef="0">' +
      '<hp:pic id="2143612663" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" groupLevel="0" instid="1069870840" reverse="0">' +
      '<hp:offset x="0" y="0"/>' +
      '<hp:orgSz width="129600" height="65640"/>' +
      `<hp:curSz width="${picWidth}" height="${picHeight}"/>` +
      '<hp:flip horizontal="0" vertical="0"/>' +
      `<hp:rotationInfo angle="0" centerX="${picCenterX}" centerY="${picCenterY}" rotateimage="1"/>` +
      '<hp:renderingInfo>' +
      '<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>' +
      `<hc:scaMatrix e1="${picScaleX}" e2="0" e3="0" e4="0" e5="${picScaleY}" e6="0"/>` +
      '<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>' +
      '</hp:renderingInfo>' +
      '<hc:img binaryItemIDRef="image1" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>' +
      '<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="129600" y="0"/><hc:pt2 x="129600" y="65640"/><hc:pt3 x="0" y="65640"/></hp:imgRect>' +
      '<hp:imgClip left="0" right="129600" top="0" bottom="65640"/>' +
      '<hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:imgDim dimwidth="129600" dimheight="65640"/>' +
      '<hp:effects/>' +
      `<hp:sz width="${picWidth}" widthRelTo="ABSOLUTE" height="${picHeight}" heightRelTo="ABSOLUTE" protect="0"/>` +
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="CENTER" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:shapeComment>그림입니다. 원본 그림의 이름: map-image (3).png 원본 그림의 크기: 가로 1728pixel, 세로 875pixel</hp:shapeComment>' +
      '</hp:pic>' +
      '<hp:t/>' +
      '</hp:run>' +
      '<hp:linesegarray>' +
      `<hp:lineseg textpos="0" vertpos="22400" vertsize="${picHeight}" textheight="${picHeight}" baseline="${picBaseline}" spacing="600" horzpos="0" horzsize="${picWidth}" flags="393216"/>` +
      '</hp:linesegarray>' +
      '</hp:p>'
  )

  blank(2)
  for (const n of [
    '※ 단수 시간 전, 사용할 물을 미리 충분히 받아 두시기 바랍니다.',
    '※ 통수 직후 수압 변화로 인해 일시적으로 이물질(녹물 등)이 발생할 수 있습니다.\n   반드시 맑은물을 확인하신 후 사용해 주세요.',
    '※ 수압 급변에 따른 고장 방지를 위해 단수 중에는 수도꼭지를 잠가 주시기 바랍니다.',
  ]) {
    sb.push(hp(n))
  }
  blank(5)
  sb.push(hp(formatToday(input.today ?? new Date()), '21', '11'))
  blank(2)
  sb.push(hp(input.from ?? '의성군 상하수도사업소', '21', '9'))
  sb.push('</hs:sec>')
  return sb.join('')
}

/** content.hpf 매니페스트에 image1 등록(v6 ensureImageInContentHpf) */
function ensureImageInContentHpf(xml: string): string {
  if (/<opf:item[^>]*\bid="image1"/.test(xml)) return xml
  const item = '<opf:item id="image1" href="BinData/image1.png" media-type="image/png" isEmbeded="1"/>'
  if (xml.includes('</opf:manifest>')) return xml.replace('</opf:manifest>', `${item}</opf:manifest>`)
  return xml
}

/** 단수 알림문 HWPX 바이트 */
export async function buildStopWaterHwpx(input: StopWaterHwpxInput): Promise<Buffer> {
  const template = await fs.readFile(TEMPLATE_PATH)
  const entries = readZip(template)
  const get = (name: string) => entries.find((e) => e.name === name)
  const put = (name: string, data: Buffer) => {
    const hit = get(name)
    if (hit) hit.data = data
    else entries.push({ name, data })
  }

  const header = get('Contents/header.xml')
  if (!header) throw new Error('HWPX 템플릿에 header.xml이 없습니다.')
  put('Contents/header.xml', Buffer.from(makeHeaderXml(header.data.toString('utf8')), 'utf8'))
  put('Contents/section0.xml', Buffer.from(buildSectionXml(input), 'utf8'))

  if (input.image && input.image.length > 0) {
    put('BinData/image1.png', input.image)
    const hpf = get('Contents/content.hpf')
    if (hpf) put('Contents/content.hpf', Buffer.from(ensureImageInContentHpf(hpf.data.toString('utf8')), 'utf8'))
  }

  // mimetype 항상 첫 번째
  const mimetype = get('mimetype')
  const rest = entries.filter((e) => e.name !== 'mimetype')
  return writeZip(mimetype ? [mimetype, ...rest] : rest)
}

/** v6 파일명: yyyyMMdd_단수알림.hwpx */
export function stopWaterHwpxFileName(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_단수알림.hwpx`
}
