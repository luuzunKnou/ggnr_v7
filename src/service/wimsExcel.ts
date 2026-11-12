import * as XLSX from 'xlsx-js-style';
import { WIMS_GOJIKIND, type WimsHistoryRow, type WimsListQuery } from '@/lib/wimsTypes';
import { selectHistory } from '@/service/wimsService';

const COLUMNS: { key: keyof WimsHistoryRow; label: string; right?: boolean; wide?: boolean }[] = [
  { key: 'ymCustNo', label: '수용가 검침일련번호', wide: true },
  { key: 'gojikind', label: '종류' },
  { key: 'meterYm', label: '검침년월' },
  { key: 'meterMonth', label: '검침월' },
  { key: 'meterDay', label: '검침일' },
  { key: 'nabgiDate', label: '납기마감일' },
  { key: 'customerNo', label: '수용가번호' },
  { key: 'meterNo', label: '계량기번호' },
  { key: 'admDong', label: '행정동' },
  { key: 'areaCd', label: '구역' },
  { key: 'lostnoAddr', label: '지번주소', wide: true },
  { key: 'roadAddr', label: '도로명주소', wide: true },
  { key: 'suname', label: '성명' },
  { key: 'induty', label: '업종' },
  { key: 'diam', label: '구경', right: true },
  { key: 'useQty', label: '사용량', right: true },
  { key: 'freeQty', label: '사용료', right: true },
  { key: 'delYn', label: '상태' },
];

function asNumber(value: string): number | string {
  const text = value.replace(/,/g, '').trim();
  if (!text) return '';
  const n = Number(text);
  return Number.isFinite(n) ? n : value;
}

function cellValue(row: WimsHistoryRow, key: keyof WimsHistoryRow, right?: boolean): string | number {
  const raw = row[key] ?? '';
  if (key === 'gojikind') return WIMS_GOJIKIND[raw] ?? raw;
  if (right) return asNumber(raw);
  return raw;
}

export async function buildWimsExcel(query: WimsListQuery, userName: string): Promise<Buffer> {
  const rows = await selectHistory(query, 'excel');
  const lastCol = COLUMNS.length - 1;
  const header = COLUMNS.map((col) => col.label);
  const body = rows.map((row) => COLUMNS.map((col) => cellValue(row, col.key, col.right)));
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const aoa: (string | number)[][] = [
    ['WIMS 검침이력', ...Array(lastCol).fill('')],
    [`담당자: ${userName || ''}`, ...Array(lastCol).fill('')],
    [stamp, ...Array(lastCol).fill('')],
    header,
    ...body,
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } },
  ];
  sheet['!cols'] = COLUMNS.map((col) => ({ wch: col.wide ? 28 : 14 }));
  sheet['!freeze'] = { xSplit: 0, ySplit: 4, topLeftCell: 'A5', activePane: 'bottomLeft', state: 'frozen' };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'WIMS 검침이력');
  const raw = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
}
