/**
 * 한글 문서(.hwpx) 만들기 — 제목·소제목·문단·표만 쓰는 간단한 보고서용.
 * 한컴오피스 한글이 만든 빈 문서의 구조(머리 정보·구역 설정)를 그대로 따르고, 글자·문단·테두리 모양만 정해 둔다.
 * A4 세로, 본문 폭 42,520(HWPUNIT, 1pt = 100).
 */

import { strToU8, zipSync } from 'fflate'

export type HwpxCell = string | { text: string; align?: 'left' | 'center' | 'right'; bold?: boolean }

export type HwpxBlock =
  | { kind: 'title'; text: string }
  | { kind: 'meta'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'note'; text: string }
  | {
      kind: 'table'
      /** 칸 너비 비율(합은 상관없음) */
      widths: number[]
      head: string[]
      /** group 줄은 모든 칸을 합쳐 회색 바탕으로 */
      rows: (HwpxCell[] | { group: string })[]
      /** 칸별 정렬(기본 왼쪽) */
      align?: ('left' | 'center' | 'right')[]
    }

/** A4 폭 59,528 − 좌우 여백 4,252 × 2(각 15mm) */
const PAGE_TEXT_WIDTH = 51024

/* 글자 모양 */
const CHAR = { body: 0, bodyBold: 1, title: 2, heading: 3, cell: 4, cellBold: 5, note: 6 } as const
/* 문단 모양 */
const PARA = { body: 0, title: 1, heading: 2, cellLeft: 3, cellCenter: 4, cellRight: 5, meta: 6 } as const
/* 테두리·바탕 */
const FILL = { none: 1, noneBrush: 2, cell: 3, head: 4, group: 5 } as const

const NS =
  'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"'

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* ── 머리 정보(header.xml) ───────────────────────────── */

const LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER']
const TYPE_INFO =
  '<hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>'

function fontfaces(): string {
  const faces = LANGS.map(
    (lang) =>
      `<hh:fontface lang="${lang}" fontCnt="2"><hh:font id="0" face="함초롬돋움" type="TTF" isEmbedded="0">${TYPE_INFO}</hh:font><hh:font id="1" face="함초롬바탕" type="TTF" isEmbedded="0">${TYPE_INFO}</hh:font></hh:fontface>`
  ).join('')
  return `<hh:fontfaces itemCnt="${LANGS.length}">${faces}</hh:fontfaces>`
}

function border(type: 'NONE' | 'SOLID'): string {
  const w = type === 'SOLID' ? '0.12 mm' : '0.1 mm'
  return ['left', 'right', 'top', 'bottom'].map((side) => `<hh:${side}Border type="${type}" width="${w}" color="#000000"/>`).join('')
}

function borderFill(id: number, type: 'NONE' | 'SOLID', face: string | null): string {
  const brush = face === null ? '' : `<hc:fillBrush><hc:winBrush faceColor="${face}" hatchColor="#999999" alpha="0"/></hc:fillBrush>`
  return `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>${border(type)}<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>${brush}</hh:borderFill>`
}

function borderFills(): string {
  const list = [
    borderFill(FILL.none, 'NONE', null),
    borderFill(FILL.noneBrush, 'NONE', 'none'),
    borderFill(FILL.cell, 'SOLID', null),
    borderFill(FILL.head, 'SOLID', '#E6EBF2'),
    borderFill(FILL.group, 'SOLID', '#F3F5F8'),
  ]
  return `<hh:borderFills itemCnt="${list.length}">${list.join('')}</hh:borderFills>`
}

function langAttrs(v: number): string {
  return `hangul="${v}" latin="${v}" hanja="${v}" japanese="${v}" other="${v}" symbol="${v}" user="${v}"`
}

function charPr(id: number, heightPt: number, bold: boolean, color = '#000000'): string {
  return `<hh:charPr id="${id}" height="${Math.round(heightPt * 100)}" textColor="${color}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="${FILL.noneBrush}"><hh:fontRef ${langAttrs(0)}/><hh:ratio ${langAttrs(100)}/><hh:spacing ${langAttrs(0)}/><hh:relSz ${langAttrs(100)}/><hh:offset ${langAttrs(0)}/>${bold ? '<hh:bold/>' : ''}<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/></hh:charPr>`
}

function charProperties(): string {
  const list = [
    charPr(CHAR.body, 10, false),
    charPr(CHAR.bodyBold, 10, true),
    charPr(CHAR.title, 16, true),
    charPr(CHAR.heading, 12, true, '#1F3864'),
    charPr(CHAR.cell, 9, false),
    charPr(CHAR.cellBold, 9, true),
    charPr(CHAR.note, 9, false, '#555555'),
  ]
  return `<hh:charProperties itemCnt="${list.length}">${list.join('')}</hh:charProperties>`
}

function paraPr(id: number, align: 'JUSTIFY' | 'LEFT' | 'CENTER' | 'RIGHT', lineSpacing: number, prev: number, next: number, keepWithNext = false): string {
  const margin = `<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="${prev}" unit="HWPUNIT"/><hc:next value="${next}" unit="HWPUNIT"/></hh:margin><hh:lineSpacing type="PERCENT" value="${lineSpacing}" unit="HWPUNIT"/>`
  return `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:align horizontal="${align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/><hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="${keepWithNext ? 1 : 0}" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/><hh:autoSpacing eAsianEng="0" eAsianNum="0"/><hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${margin}</hp:case><hp:default>${margin}</hp:default></hp:switch><hh:border borderFillIDRef="${FILL.noneBrush}" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>`
}

function paraProperties(): string {
  const list = [
    paraPr(PARA.body, 'JUSTIFY', 160, 0, 0),
    paraPr(PARA.title, 'CENTER', 160, 0, 400),
    paraPr(PARA.heading, 'LEFT', 160, 1200, 400, true),
    paraPr(PARA.cellLeft, 'LEFT', 130, 0, 0),
    paraPr(PARA.cellCenter, 'CENTER', 130, 0, 0),
    paraPr(PARA.cellRight, 'RIGHT', 130, 0, 0),
    paraPr(PARA.meta, 'CENTER', 160, 0, 600),
  ]
  return `<hh:paraProperties itemCnt="${list.length}">${list.join('')}</hh:paraProperties>`
}

function headerXml(): string {
  return `${XML_HEAD}<hh:head ${NS} version="1.5" secCnt="1"><hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList>${fontfaces()}${borderFills()}${charProperties()}<hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties>${paraProperties()}<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="${PARA.body}" charPrIDRef="${CHAR.body}" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles></hh:refList><hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument><hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption><hh:trackchageConfig flags="56"/></hh:head>`
}

/* ── 본문(section0.xml) ──────────────────────────────── */

/** 구역 설정 — 한글 빈 문서(A4 세로, 여백 위 20·아래 15·좌우 30mm)와 같다 */
const SEC_PR =
  '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0"><hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/><hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/><hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/><hp:pagePr landscape="WIDELY" width="59528" height="84186" gutterType="LEFT_ONLY"><hp:margin header="4252" footer="4252" gutter="0" left="4252" right="4252" top="5668" bottom="4252"/></hp:pagePr><hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr><hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr><hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill><hp:pageBorderFill type="EVEN" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill><hp:pageBorderFill type="ODD" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill></hp:secPr><hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>'

class SectionWriter {
  private seq = 0
  private out: string[] = []

  private id(): number {
    this.seq += 1
    return this.seq
  }

  private run(text: string, charId: number): string {
    return `<hp:run charPrIDRef="${charId}"><hp:t>${esc(text)}</hp:t></hp:run>`
  }

  para(text: string, paraId: number, charId: number, lead = ''): void {
    this.out.push(`<hp:p id="${this.id()}" paraPrIDRef="${paraId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${lead}${this.run(text, charId)}</hp:p>`)
  }

  /** 첫 문단 — 구역 설정을 함께 담는다 */
  first(text: string, paraId: number, charId: number): void {
    this.para(text, paraId, charId, `<hp:run charPrIDRef="${charId}">${SEC_PR}</hp:run>`)
  }

  private cellXml(
    text: string,
    col: number,
    row: number,
    colSpan: number,
    width: number,
    fill: number,
    paraId: number,
    charId: number,
    header: boolean
  ): string {
    const lines = String(text ?? '').split('\n')
    const paras = lines
      .map((l) => `<hp:p id="${this.id()}" paraPrIDRef="${paraId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${this.run(l, charId)}</hp:p>`)
      .join('')
    return `<hp:tc name="" header="${header ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${fill}"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${paras}</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="${colSpan}" rowSpan="1"/><hp:cellSz width="${width}" height="1200"/><hp:cellMargin left="425" right="425" top="200" bottom="200"/></hp:tc>`
  }

  table(block: Extract<HwpxBlock, { kind: 'table' }>): void {
    const sum = block.widths.reduce((n, w) => n + w, 0)
    const widths = block.widths.map((w) => Math.floor((PAGE_TEXT_WIDTH * w) / sum))
    widths[widths.length - 1]! += PAGE_TEXT_WIDTH - widths.reduce((n, w) => n + w, 0)
    const cols = widths.length
    const paraOf = (a: 'left' | 'center' | 'right' | undefined) =>
      a === 'center' ? PARA.cellCenter : a === 'right' ? PARA.cellRight : PARA.cellLeft
    const trs: string[] = []
    trs.push(
      `<hp:tr>${block.head.map((h, c) => this.cellXml(h, c, 0, 1, widths[c]!, FILL.head, PARA.cellCenter, CHAR.cellBold, true)).join('')}</hp:tr>`
    )
    block.rows.forEach((row, i) => {
      const r = i + 1
      if (!Array.isArray(row)) {
        trs.push(`<hp:tr>${this.cellXml(row.group, 0, r, cols, PAGE_TEXT_WIDTH, FILL.group, PARA.cellLeft, CHAR.cellBold, false)}</hp:tr>`)
        return
      }
      trs.push(
        `<hp:tr>${row
          .map((cell, c) => {
            const o = typeof cell === 'string' ? { text: cell } : cell
            return this.cellXml(o.text, c, r, 1, widths[c]!, FILL.cell, paraOf(o.align ?? block.align?.[c]), o.bold ? CHAR.cellBold : CHAR.cell, false)
          })
          .join('')}</hp:tr>`
      )
    })
    const rowCnt = block.rows.length + 1
    const tbl = `<hp:tbl id="${this.id()}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${rowCnt}" colCnt="${cols}" cellSpacing="0" borderFillIDRef="${FILL.cell}" noAdjust="0"><hp:sz width="${PAGE_TEXT_WIDTH}" widthRelTo="ABSOLUTE" height="${rowCnt * 1200}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="425" right="425" top="200" bottom="200"/>${trs.join('')}</hp:tbl>`
    this.out.push(
      `<hp:p id="${this.id()}" paraPrIDRef="${PARA.cellLeft}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${CHAR.body}">${tbl}<hp:t/></hp:run></hp:p>`
    )
  }

  xml(): string {
    return `${XML_HEAD}<hs:sec ${NS}>${this.out.join('')}</hs:sec>`
  }
}

function sectionXml(blocks: HwpxBlock[]): string {
  const w = new SectionWriter()
  let first = true
  const para = (text: string, p: number, c: number) => {
    if (first) w.first(text, p, c)
    else w.para(text, p, c)
    first = false
  }
  for (const b of blocks) {
    if (b.kind === 'title') para(b.text, PARA.title, CHAR.title)
    else if (b.kind === 'meta') para(b.text, PARA.meta, CHAR.note)
    else if (b.kind === 'heading') para(b.text, PARA.heading, CHAR.heading)
    else if (b.kind === 'para') para(b.text, PARA.body, CHAR.body)
    else if (b.kind === 'note') para(b.text, PARA.body, CHAR.note)
    else {
      if (first) para('', PARA.body, CHAR.body)
      w.table(b)
    }
  }
  if (first) para('', PARA.body, CHAR.body)
  return w.xml()
}

/* ── 묶기 ───────────────────────────────────────────── */

function contentHpf(title: string): string {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  return `${XML_HEAD}<opf:package ${NS} version="" unique-identifier="" id=""><opf:metadata><opf:title>${esc(title)}</opf:title><opf:language>ko</opf:language><opf:meta name="creator" content="text">소규모 공공시설관리 시스템</opf:meta><opf:meta name="CreatedDate" content="text">${now}</opf:meta><opf:meta name="ModifiedDate" content="text">${now}</opf:meta></opf:metadata><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`
}

const VERSION_XML = `${XML_HEAD}<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1" xmlVersion="1.5" application="Hancom Office Hangul" appVersion="12, 0, 0, 535 WIN32LEWindows_10"/>`
const CONTAINER_XML = `${XML_HEAD}<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/><ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/><ocf:rootfile full-path="META-INF/container.rdf" media-type="application/rdf+xml"/></ocf:rootfiles></ocf:container>`
const CONTAINER_RDF = `${XML_HEAD}<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/header.xml"/></rdf:Description><rdf:Description rdf:about="Contents/header.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#HeaderFile"/></rdf:Description><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/section0.xml"/></rdf:Description><rdf:Description rdf:about="Contents/section0.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#SectionFile"/></rdf:Description><rdf:Description rdf:about=""><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#Document"/></rdf:Description></rdf:RDF>`
const MANIFEST_XML = `${XML_HEAD}<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>`
const SETTINGS_XML = `${XML_HEAD}<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>`

/** 한글 문서 바이트 — mimetype 은 맨 앞·압축 없이 */
export function buildHwpx(title: string, blocks: HwpxBlock[]): Uint8Array {
  const previewText = blocks
    .filter((b): b is Extract<HwpxBlock, { text: string }> => 'text' in b)
    .map((b) => b.text)
    .join('\r\n')
    .slice(0, 1000)
  return zipSync({
    mimetype: [strToU8('application/hwp+zip'), { level: 0 }],
    'version.xml': strToU8(VERSION_XML),
    'Contents/header.xml': strToU8(headerXml()),
    'Contents/section0.xml': strToU8(sectionXml(blocks)),
    'Contents/content.hpf': strToU8(contentHpf(title)),
    'Preview/PrvText.txt': strToU8(previewText),
    'settings.xml': strToU8(SETTINGS_XML),
    'META-INF/container.rdf': strToU8(CONTAINER_RDF),
    'META-INF/container.xml': strToU8(CONTAINER_XML),
    'META-INF/manifest.xml': strToU8(MANIFEST_XML),
  })
}

export function downloadHwpx(fileName: string, title: string, blocks: HwpxBlock[]): void {
  const bytes = buildHwpx(title, blocks)
  const blob = new Blob([bytes as BlobPart], { type: 'application/hwp+zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.hwpx') ? fileName : `${fileName}.hwpx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
