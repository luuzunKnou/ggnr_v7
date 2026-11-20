import * as XLSX from 'xlsx'
import type { WtlOutageMeterRowDto } from '@/service/wtlOutageService'

/** yyyyMMdd_HHmm (로컬) */
function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`
}

/** 열 순서·제목 — wtl_meta_ps 정의(한글명) 기준 */
const COLUMNS: { key: keyof WtlOutageMeterRowDto; title: string; width: number }[] = [
  { key: 'ftrIdn', title: '관리번호', width: 12 },
  { key: 'homNum', title: '수용가번호', width: 14 },
  { key: 'homNam', title: '수용가성명', width: 12 },
  { key: 'homAdr', title: '수용가주소', width: 40 },
  { key: 'hjdName', title: '행정읍/면/동', width: 12 },
  { key: 'homCnt', title: '가구수', width: 8 },
  { key: 'sbiName', title: '업종', width: 10 },
  { key: 'metNum', title: '계량기기물번호', width: 16 },
  { key: 'metDip', title: '계량기구경', width: 10 },
  { key: 'mofName', title: '계량기형식', width: 12 },
  { key: 'istYmd', title: '설치일자', width: 11 },
  { key: 'pipIdn', title: '급수관관리번호', width: 14 },
  { key: 'remark', title: '비고', width: 20 },
]

/**
 * 단수구역 계량기 목록을 xlsx로 저장.
 * @param label 파일명에 넣을 구역 이름(제수변 번호 등). 파일명에 못 쓰는 문자는 _ 로 바꾼다
 */
export function exportWtlOutageMeterExcel(rows: WtlOutageMeterRowDto[], label?: string): string | null {
  if (rows.length === 0) return null
  const data = rows.map((row, index) => {
    const out: Record<string, string | number> = { 순번: index + 1 }
    for (const col of COLUMNS) out[col.title] = row[col.key] ?? ''
    return out
  })
  const ws = XLSX.utils.json_to_sheet(data, { header: ['순번', ...COLUMNS.map((c) => c.title)] })
  ws['!cols'] = [{ wch: 6 }, ...COLUMNS.map((c) => ({ wch: c.width }))]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '단수계량기')
  const safe = String(label ?? '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 40)
  const fileName = `${stamp()}_단수계량기목록${safe ? `_${safe}` : ''}.xlsx`
  XLSX.writeFile(wb, fileName)
  return fileName
}
