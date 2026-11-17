import * as XLSX from 'xlsx'
import {
  fetchLandInfoConfig,
  fetchParcelTabData,
  fetchPersonInfoMaskEnabled,
  type ParcelTabData,
} from '../../_mapComponents/landInfo/api'
import { formatPersonField } from '../../_mapComponents/landInfo/landPersonInfoMask'
import type { ResurveyDistrict, ResurveyParcel } from './cadastralResurveyMock'

/** 필지정보 동시 조회 수 — 행망·브이월드 부하 한도 */
const FETCH_CONCURRENCY = 8

type Row = Record<string, unknown>
type FetchStatus = '조회' | '자료없음' | '조회실패'
type ParcelResult = { parcel: ResurveyParcel; data: ParcelTabData | null; status: FetchStatus }

export type ResurveyExcelProgress = { done: number; total: number }

function field(row: Row | undefined, keys: string[]): string {
  if (!row) return ''
  for (const k of keys) {
    const v = row[k]
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

function jibunOf(p: ResurveyParcel): string {
  return `${p.ri} ${p.jibun}`
}

async function fetchAll(
  parcels: ResurveyParcel[],
  vworldKey: string,
  signal: AbortSignal,
  onProgress: (p: ResurveyExcelProgress) => void
): Promise<ParcelResult[]> {
  const out: ParcelResult[] = new Array(parcels.length)
  let next = 0
  let done = 0
  const run = async () => {
    while (!signal.aborted) {
      const i = next++
      if (i >= parcels.length) return
      const parcel = parcels[i]
      let result: ParcelResult
      if (!/^\d{19}$/.test(parcel.id)) {
        result = { parcel, data: null, status: '자료없음' }
      } else {
        try {
          const data = await fetchParcelTabData({ pnu: parcel.id, vworldKey })
          const empty =
            !data.characteristics.length && !data.possessions.length && !data.landUses.length
          result = { parcel, data, status: empty ? '자료없음' : '조회' }
        } catch {
          result = { parcel, data: null, status: '조회실패' }
        }
      }
      out[i] = result
      done += 1
      onProgress({ done, total: parcels.length })
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, parcels.length) }, () => run())
  )
  return out
}

/**
 * 필지목록 + 필지별 토지기본정보·소유내역·이용계획을 시트로 나눠 내려받는다.
 * 소유자 성명은 개인정보 마스킹 설정을 따른다(행망 결과는 서버에서 이미 마스킹).
 * 취소되면 파일을 만들지 않고 false 반환.
 */
export async function exportResurveyParcelExcel(args: {
  district: ResurveyDistrict
  parcels: ResurveyParcel[]
  signal: AbortSignal
  onProgress: (p: ResurveyExcelProgress) => void
}): Promise<boolean> {
  const { district, parcels, signal, onProgress } = args
  const [cfg, maskEnabled] = await Promise.all([
    fetchLandInfoConfig(),
    fetchPersonInfoMaskEnabled(),
  ])
  onProgress({ done: 0, total: parcels.length })
  const results = await fetchAll(parcels, cfg.vworldKey ?? '', signal, onProgress)
  if (signal.aborted) return false

  const listRows: Row[] = []
  const basicRows: Row[] = []
  const ownerRows: Row[] = []
  const useRows: Row[] = []

  for (const { parcel: p, data, status } of results) {
    const jibun = jibunOf(p)
    listRows.push({
      번호: p.seq,
      지번: jibun,
      고유번호: p.id,
      지목: p.jimok,
      '면적(㎡)': p.area,
      소유구분: p.ownerType,
      확정여부: p.confirmed ? '확정' : '미확정',
      필지정보: status,
    })
    if (!data) continue

    const ch = data.characteristics[0]
    const price = data.prices[0]
    if (ch || price) {
      basicRows.push({
        번호: p.seq,
        지번: jibun,
        지목: field(ch, ['lndcgrCodeNm', 'jimok']),
        '면적(㎡)': field(ch, ['lndpclAr', 'area']),
        용도지역: field(ch, ['prposArea1Nm', 'prposAreaDstrcCodeNm']),
        이동사유: field(ch, ['lndMoveResnNm', 'landMoveReason']),
        이동일자: field(ch, ['lndMoveDe', 'landMoveDate']),
        '공시지가(원/㎡)': field(price, ['pblntfPclnd']),
      })
    }

    const maskOwner = maskEnabled && data.source !== 'kras'
    for (const own of data.possessions) {
      const ownerNm = field(own, ['ownerNm', 'ownerName'])
      ownerRows.push({
        번호: p.seq,
        지번: jibun,
        소유구분: field(own, ['posesnSeCodeNm']),
        소유자명: ownerNm ? formatPersonField(ownerNm, maskOwner) : '',
        주소: field(own, ['ownerAddr', 'address']),
        공유인수: field(own, ['cnrsPsnCo', 'shareCnt']),
        변동원인: field(own, ['ownshipChgCauseCodeNm']),
        변동일자: field(own, ['ownshipChgDe']),
      })
    }

    for (const use of data.landUses) {
      useRows.push({
        번호: p.seq,
        지번: jibun,
        용도지역지구: field(use, ['prposAreaDstrcCodeNm']),
        저촉여부: field(use, ['cnflcAtNm']),
        비고: field(use, ['registDt']),
      })
    }
  }

  const wb = XLSX.utils.book_new()
  const sheets: [string, Row[], string[]][] = [
    ['필지목록', listRows, ['번호', '지번', '고유번호', '지목', '면적(㎡)', '소유구분', '확정여부', '필지정보']],
    ['토지기본정보', basicRows, ['번호', '지번', '지목', '면적(㎡)', '용도지역', '이동사유', '이동일자', '공시지가(원/㎡)']],
    ['소유내역', ownerRows, ['번호', '지번', '소유구분', '소유자명', '주소', '공유인수', '변동원인', '변동일자']],
    ['이용계획', useRows, ['번호', '지번', '용도지역지구', '저촉여부', '비고']],
  ]
  for (const [name, rows, header] of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header }), name)
  }
  XLSX.writeFile(wb, `${district.name}_필지목록.xlsx`)
  return true
}
