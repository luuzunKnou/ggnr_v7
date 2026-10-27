/**
 * 지적기록물 — UI 확인용 임시 자료 (안동시 일원, 실제 공부와 무관).
 * 목록은 필지, 상세는 그 필지에 묶인 문서(스캔 1장씩).
 */
import { fromLonLat } from 'ol/proj'
import {
  CADASTRAL_DOC_TYPES,
  getCadastralDocType,
  getCadastralLedgerType,
  type CadastralDocType,
  type CadastralLedgerType,
} from './cadastralRecordConfig'

export type CadastralRecordDoc = {
  id: string
  docType: CadastralDocType
  docTypeLabel: string
  ledgerType: CadastralLedgerType
  ledgerTypeLabel: string
  volumeNo: string
  pageNo: string
  fileName: string
  previewUrl: string
}

export type CadastralRecordParcel = {
  id: string
  emd: string
  ri: string
  jibun: string
  /** EPSG:3857 */
  center3857: [number, number]
  docs: CadastralRecordDoc[]
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) => {
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    if (ch === '&') return '&amp;'
    if (ch === '"') return '&quot;'
    return '&apos;'
  })
}

function createDemoPreviewUrl(title: string, subtitle: string, accent: string): string {
  const t = escapeXml(title)
  const s = escapeXml(subtitle)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1280" viewBox="0 0 960 1280">
  <rect width="960" height="1280" fill="#f8fafc"/>
  <rect x="28" y="28" width="904" height="1224" rx="6" fill="#fff" stroke="${accent}" stroke-width="2"/>
  <rect x="28" y="28" width="904" height="64" fill="${accent}"/>
  <text x="480" y="70" text-anchor="middle" font-family="Malgun Gothic,sans-serif" font-size="26" fill="#fff">${t}</text>
  <text x="480" y="120" text-anchor="middle" font-family="Malgun Gothic,sans-serif" font-size="16" fill="#334155">${s}</text>
  <rect x="72" y="150" width="816" height="36" fill="#f1f5f9" stroke="#cbd5e1"/>
  <rect x="72" y="186" width="816" height="36" fill="#fff" stroke="#cbd5e1"/>
  <rect x="72" y="222" width="816" height="36" fill="#f8fafc" stroke="#cbd5e1"/>
  <rect x="72" y="258" width="816" height="36" fill="#fff" stroke="#cbd5e1"/>
  <rect x="72" y="294" width="816" height="36" fill="#f8fafc" stroke="#cbd5e1"/>
  <rect x="72" y="330" width="816" height="36" fill="#fff" stroke="#cbd5e1"/>
  <path d="M120 430h260l50 140-120 160-190-90z" fill="${accent}33" stroke="${accent}" stroke-width="2"/>
  <path d="M380 560h250l-30 170H360z" fill="${accent}22" stroke="${accent}" stroke-width="2"/>
  <path d="M620 470h220l-40 260H590z" fill="${accent}1a" stroke="${accent}" stroke-width="2"/>
  <path d="M160 900h200l30 120H180z" fill="${accent}22" stroke="${accent}" stroke-width="2"/>
  <path d="M390 860h280l-20 180H370z" fill="${accent}1a" stroke="${accent}" stroke-width="2"/>
  <text x="480" y="1210" text-anchor="middle" font-family="Malgun Gothic,sans-serif" font-size="14" fill="#64748b">임시 미리보기 · 실제 기록물 아님</text>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

type SeedDoc = {
  id: string
  docType: CadastralDocType
  ledgerType: CadastralLedgerType
  volumeNo: string
  pageNo: string
  fileName: string
}

type SeedParcel = {
  id: string
  emd: string
  ri: string
  jibun: string
  docs: SeedDoc[]
}

const SEED: SeedParcel[] = [
  {
    id: 'p-myeongnyun-115',
    emd: '명륜동',
    ri: '',
    jibun: '115',
    docs: [
      {
        id: 'd-1a',
        docType: 'ledger',
        ledgerType: 'land',
        volumeNo: '8',
        pageNo: '24',
        fileName: 'AD_토지대장_권08_p024.jpg',
      },
      {
        id: 'd-1b',
        docType: 'map',
        ledgerType: 'land',
        volumeNo: '3',
        pageNo: '11',
        fileName: 'AD_지적도_권03_p011.jpg',
      },
      {
        id: 'd-1c',
        docType: 'shared',
        ledgerType: 'land',
        volumeNo: '4',
        pageNo: '9',
        fileName: 'AD_공유지연명부_권04_p009.jpg',
      },
    ],
  },
  {
    id: 'p-goran-1',
    emd: '길안면',
    ri: '고란리',
    jibun: '1',
    docs: [
      {
        id: 'd-2a',
        docType: 'ledger',
        ledgerType: 'land',
        volumeNo: '12',
        pageNo: '6',
        fileName: 'AD_토지대장_권12_p006.jpg',
      },
      {
        id: 'd-2b',
        docType: 'map',
        ledgerType: 'land',
        volumeNo: '3',
        pageNo: '1',
        fileName: 'AD_지적도_권03_p001.jpg',
      },
    ],
  },
  {
    id: 'p-imha-san23',
    emd: '임하면',
    ri: '임하리',
    jibun: '산 23',
    docs: [
      {
        id: 'd-3a',
        docType: 'ledger',
        ledgerType: 'forest',
        volumeNo: '5',
        pageNo: '18',
        fileName: 'AD_임야대장_권05_p018.jpg',
      },
      {
        id: 'd-3b',
        docType: 'map',
        ledgerType: 'forest',
        volumeNo: '2',
        pageNo: '4',
        fileName: 'AD_임야도_권02_p004.jpg',
      },
    ],
  },
  {
    id: 'p-taeri-san12',
    emd: '와룡면',
    ri: '태리',
    jibun: '산 12',
    docs: [
      {
        id: 'd-4a',
        docType: 'map',
        ledgerType: 'forest',
        volumeNo: '2',
        pageNo: '7',
        fileName: 'AD_임야도_권02_p007.jpg',
      },
    ],
  },
  {
    id: 'p-angyo-456',
    emd: '풍산읍',
    ri: '안교리',
    jibun: '456',
    docs: [
      {
        id: 'd-5a',
        docType: 'ledger',
        ledgerType: 'land',
        volumeNo: '9',
        pageNo: '31',
        fileName: 'AD_토지대장_권09_p031.jpg',
      },
      {
        id: 'd-5b',
        docType: 'coord',
        ledgerType: 'land',
        volumeNo: '1',
        pageNo: '12',
        fileName: 'AD_좌표등록부_권01_p012.jpg',
      },
    ],
  },
  {
    id: 'p-gyori-78-1',
    emd: '서후면',
    ri: '교리',
    jibun: '78-1',
    docs: [
      {
        id: 'd-6a',
        docType: 'ledger',
        ledgerType: 'land',
        volumeNo: '10',
        pageNo: '2',
        fileName: 'AD_토지대장_권10_p002.jpg',
      },
      {
        id: 'd-6b',
        docType: 'map',
        ledgerType: 'land',
        volumeNo: '6',
        pageNo: '19',
        fileName: 'AD_지적도_권06_p019.jpg',
      },
      {
        id: 'd-6c',
        docType: 'survey',
        ledgerType: 'land',
        volumeNo: '14',
        pageNo: '3',
        fileName: 'AD_분할측량_권14_p003.jpg',
      },
    ],
  },
  {
    id: 'p-sinseok-12',
    emd: '남선면',
    ri: '신석리',
    jibun: '12',
    docs: [
      {
        id: 'd-7a',
        docType: 'ledger',
        ledgerType: 'forest',
        volumeNo: '3',
        pageNo: '8',
        fileName: 'AD_임야대장_권03_p008.jpg',
      },
      {
        id: 'd-7b',
        docType: 'survey',
        ledgerType: 'forest',
        volumeNo: '9',
        pageNo: '21',
        fileName: 'AD_등록전환_권09_p021.jpg',
      },
    ],
  },
  {
    id: 'p-okdong-201',
    emd: '옥동',
    ri: '',
    jibun: '201',
    docs: [
      {
        id: 'd-8a',
        docType: 'closed',
        ledgerType: 'land',
        volumeNo: '6',
        pageNo: '41',
        fileName: 'AD_폐쇄대장_권06_p041.jpg',
      },
      {
        id: 'd-8b',
        docType: 'ledger',
        ledgerType: 'land',
        volumeNo: '7',
        pageNo: '1',
        fileName: 'AD_토지대장_권07_p001.jpg',
      },
    ],
  },
  {
    id: 'p-taehwa-33',
    emd: '태화동',
    ri: '',
    jibun: '33',
    docs: [
      {
        id: 'd-9a',
        docType: 'shared',
        ledgerType: 'land',
        volumeNo: '4',
        pageNo: '15',
        fileName: 'AD_공유지연명부_권04_p015.jpg',
      },
    ],
  },
  {
    id: 'p-yongsang-890',
    emd: '용상동',
    ri: '',
    jibun: '890',
    docs: [
      {
        id: 'd-10a',
        docType: 'ledger',
        ledgerType: 'land',
        volumeNo: '11',
        pageNo: '2',
        fileName: 'AD_토지대장_권11_p002.jpg',
      },
      {
        id: 'd-10b',
        docType: 'map',
        ledgerType: 'land',
        volumeNo: '8',
        pageNo: '22',
        fileName: 'AD_지적도_권08_p022.jpg',
      },
    ],
  },
  {
    id: 'p-mangho-5',
    emd: '일직면',
    ri: '망호리',
    jibun: '5',
    docs: [
      {
        id: 'd-11a',
        docType: 'survey',
        ledgerType: 'land',
        volumeNo: '7',
        pageNo: '15',
        fileName: 'AD_면적측정부_권07_p015.jpg',
      },
      {
        id: 'd-11b',
        docType: 'coord',
        ledgerType: 'land',
        volumeNo: '1',
        pageNo: '8',
        fileName: 'AD_좌표등록부_권01_p008.jpg',
      },
    ],
  },
  {
    id: 'p-geumgok-44-2',
    emd: '길안면',
    ri: '금곡리',
    jibun: '44-2',
    docs: [
      {
        id: 'd-12a',
        docType: 'ledger',
        ledgerType: 'land',
        volumeNo: '12',
        pageNo: '40',
        fileName: 'AD_토지대장_권12_p040.jpg',
      },
      {
        id: 'd-12b',
        docType: 'survey',
        ledgerType: 'land',
        volumeNo: '14',
        pageNo: '8',
        fileName: 'AD_분할측량_권14_p008.jpg',
      },
    ],
  },
]

/** 안동시 일원 임시 좌표 (WGS84) */
const PARCEL_LONLAT: Record<string, [number, number]> = {
  'p-myeongnyun-115': [128.7294, 36.5685],
  'p-goran-1': [128.978, 36.386],
  'p-imha-san23': [128.89, 36.525],
  'p-taeri-san12': [128.795, 36.625],
  'p-angyo-456': [128.585, 36.575],
  'p-gyori-78-1': [128.648, 36.588],
  'p-sinseok-12': [128.785, 36.505],
  'p-okdong-201': [128.705, 36.56],
  'p-taehwa-33': [128.732, 36.564],
  'p-yongsang-890': [128.755, 36.548],
  'p-mangho-5': [128.668, 36.478],
  'p-geumgok-44-2': [128.94, 36.41],
}

const DOC_ORDER = new Map(CADASTRAL_DOC_TYPES.map((t, i) => [t.code, i]))

function hydrateDoc(doc: SeedDoc, loc: string, jibun: string): CadastralRecordDoc {
  const type = getCadastralDocType(doc.docType)
  const ledger = getCadastralLedgerType(doc.ledgerType)
  return {
    ...doc,
    docTypeLabel: type.label,
    ledgerTypeLabel: ledger.label,
    previewUrl: createDemoPreviewUrl(
      `${type.label} · ${ledger.label}`,
      `${loc} ${jibun} · ${doc.volumeNo}권 ${doc.pageNo}쪽`,
      type.color
    ),
  }
}

export function getCadastralParcels(): CadastralRecordParcel[] {
  return SEED.map((row) => {
    const loc = formatRecordLocation(row)
    const docs = row.docs
      .map((d) => hydrateDoc(d, loc, row.jibun))
      .sort((a, b) => (DOC_ORDER.get(a.docType) ?? 99) - (DOC_ORDER.get(b.docType) ?? 99))
    const lonlat = PARCEL_LONLAT[row.id] ?? [128.7229, 36.5664]
    return {
      ...row,
      docs,
      center3857: fromLonLat(lonlat) as [number, number],
    }
  })
}

export function getCadastralParcelById(id: string): CadastralRecordParcel | undefined {
  return getCadastralParcels().find((p) => p.id === id)
}

export function formatRecordLocation(row: { emd: string; ri: string }): string {
  return [row.emd, row.ri].filter(Boolean).join(' ')
}

export function formatRecordAddress(row: { emd: string; ri: string; jibun: string }): string {
  return [formatRecordLocation(row), row.jibun].filter(Boolean).join(' ')
}

/** 목록에 쓰는 문서 이름 — 토지대장, 지적도, 면적측정부 등 */
export function formatCadastralDocTitle(doc: {
  docType: CadastralDocType
  ledgerType: CadastralLedgerType
  docTypeLabel: string
}): string {
  switch (doc.docType) {
    case 'ledger':
      return doc.ledgerType === 'forest' ? '임야대장' : '토지대장'
    case 'map':
      return doc.ledgerType === 'forest' ? '임야도' : '지적도'
    case 'survey':
      return '면적측정부'
    default:
      return doc.docTypeLabel
  }
}

/** 목록 문서 칸 — «면적측정부 외 1» */
export function formatParcelDocSummary(
  docs: { docType: CadastralDocType; ledgerType: CadastralLedgerType; docTypeLabel: string }[]
): string {
  const first = docs[0]
  if (!first) return '—'
  const name = formatCadastralDocTitle(first)
  const extra = docs.length - 1
  if (extra <= 0) return name
  return `${name} 외 ${extra}`
}
