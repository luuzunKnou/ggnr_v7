/**
 * 엑셀(.xlsx/.xls) · CSV 통합 읽기.
 * CSV는 UTF-8(BOM 포함) / CP949(EUC-KR) 자동 판별 후 SheetJS workbook으로 변환.
 */
import iconv from 'iconv-lite';
import * as XLSX from 'xlsx';

export const SPREADSHEET_ACCEPT = '.xlsx,.xls,.csv';
export const SPREADSHEET_EXT_RE = /\.(xlsx|xls|csv)$/i;

export function isSpreadsheetFileName(name: string): boolean {
  return SPREADSHEET_EXT_RE.test(name.trim());
}

export function isCsvFileName(name: string): boolean {
  return /\.csv$/i.test(name.trim());
}

export function stripSpreadsheetExt(name: string): string {
  return name.replace(SPREADSHEET_EXT_RE, '');
}

function toBuffer(data: ArrayBuffer | Uint8Array | Buffer): Buffer {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  return Buffer.from(data);
}

function countHangul(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xac00 && c <= 0xd7a3) n += 1;
  }
  return n;
}

function countReplacement(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 0xfffd) n += 1;
  }
  return n;
}

/** UTF-8로 잘못 해석된 CP949에서 흔한 깨짐 패턴 */
function looksLikeMojibake(s: string): boolean {
  const sample = s.slice(0, 4000);
  if (sample.includes('\uFFFD')) return true;
  return /(?:Ã.|Â.|ì.|í.|ë.|ê.|å.|æ.|Ð.|Ñ.){2,}/.test(sample);
}

function isValidUtf8(buf: Buffer): boolean {
  try {
    const decoded = iconv.decode(buf, 'utf-8');
    // iconv-lite utf-8은 잘못된 바이트를 �로 바꿀 수 있음
    if (decoded.includes('\uFFFD')) return false;
    const roundTrip = iconv.encode(decoded, 'utf-8');
    return roundTrip.equals(buf);
  } catch {
    return false;
  }
}

function scoreDecodedText(s: string): number {
  return countHangul(s) * 3 - countReplacement(s) * 20 - (looksLikeMojibake(s) ? 80 : 0);
}

export type CsvEncoding = 'utf-8' | 'cp949' | 'utf-16le';

/**
 * CSV 바이트 → 유니코드 문자열. BOM·UTF-8·CP949 자동 선택.
 */
export function decodeCsvBuffer(data: ArrayBuffer | Uint8Array | Buffer): {
  text: string;
  encoding: CsvEncoding;
} {
  const buf = toBuffer(data);

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: iconv.decode(buf.subarray(3), 'utf-8'), encoding: 'utf-8' };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: iconv.decode(buf, 'utf16-le'), encoding: 'utf-16le' };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: iconv.decode(buf, 'utf16-be'), encoding: 'utf-16le' };
  }

  const utf8 = iconv.decode(buf, 'utf-8');
  const cp949 = iconv.decode(buf, 'cp949');
  const utf8Ok = isValidUtf8(buf);
  const sUtf8 = scoreDecodedText(utf8);
  const sCp949 = scoreDecodedText(cp949);

  if (utf8Ok && sUtf8 >= sCp949) {
    return { text: utf8, encoding: 'utf-8' };
  }
  if (sCp949 > sUtf8) {
    return { text: cp949, encoding: 'cp949' };
  }
  if (utf8Ok) {
    return { text: utf8, encoding: 'utf-8' };
  }
  return { text: cp949, encoding: 'cp949' };
}

export type ReadWorkbookResult = {
  workbook: XLSX.WorkBook;
  isCsv: boolean;
  csvEncoding?: CsvEncoding;
};

/**
 * 파일명 확장자 기준: .csv → 인코딩 디코드 후 string 파싱, .xlsx/.xls → binary 파싱.
 */
export function readWorkbookFromBuffer(
  data: ArrayBuffer | Uint8Array | Buffer,
  fileName?: string
): ReadWorkbookResult {
  const name = (fileName ?? '').trim();
  const asCsv = isCsvFileName(name);

  if (asCsv) {
    const { text, encoding } = decodeCsvBuffer(data);
    const workbook = XLSX.read(text, {
      type: 'string',
      raw: false,
      cellDates: true,
      FS: ',',
    });
    return { workbook, isCsv: true, csvEncoding: encoding };
  }

  const buf = toBuffer(data);
  const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
  return { workbook, isCsv: false };
}

export function csvEncodingLabel(enc: CsvEncoding | undefined): string | null {
  if (!enc) return null;
  if (enc === 'cp949') return 'CSV 인코딩: CP949(한글 Windows)';
  if (enc === 'utf-16le') return 'CSV 인코딩: UTF-16';
  return 'CSV 인코딩: UTF-8';
}
