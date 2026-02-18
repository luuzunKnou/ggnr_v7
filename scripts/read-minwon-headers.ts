/**
 * Reads Excel files under [공간누리 AI 참고자료] and prints sheet names + first row (headers).
 * Run: npx tsx scripts/read-minwon-headers.ts
 */
import * as XLSX from "xlsx";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const BASE = "C:\\Users\\user\\Downloads\\[공간누리 AI 참고자료]";
const FILES = [
  "의성하수_1.민원접수대장.xlsx",
  "의성상수_★2025년 긴급민원접수대장(251231).xlsx",
  "안동 상수 누수민원대장.xlsx",
  "안동 상수_누수 20250918 누수민원대장.xlsx",
  "안동 이재민_★의견제출내역 250803==민원.xlsx",
  "안동 상수  수용가 내부누수 민원대장(2025 임시).xls",
  "안동 상수 급수공사 신청대장(2025 임시).xls",
  "안동 상수 누수 민원대장(2025 임시).xls",
  "안동 상수 단수 민원대장(2025 임시).xls",
];

function getRow(sheet: XLSX.WorkSheet, rowIndex: number): string[] {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const row: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c })];
    const val = cell?.w ?? cell?.v ?? "";
    row.push(String(val).trim());
  }
  return row;
}

function getFirstRows(sheet: XLSX.WorkSheet, maxRows: number): string[][] {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const out: string[][] = [];
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + maxRows - 1); r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      const val = cell?.w ?? cell?.v ?? "";
      row.push(String(val).trim());
    }
    out.push(row);
  }
  return out;
}

function findHeaderRow(rows: string[][]): string[] {
  const headerKeywords = ["접수", "민원", "일자", "연락처", "내용", "조치", "업체", "비고", "No", "번호", "comp_", "req_", "create_"];
  for (const row of rows) {
    const nonEmpty = row.filter((c) => c.length > 0);
    if (nonEmpty.length < 3) continue;
    const text = row.join(" ");
    if (headerKeywords.some((k) => text.includes(k))) return row;
  }
  return rows[0] ?? [];
}

function main() {
  const result: Record<string, { sheets: Record<string, { firstRows: string[][]; headerRow: string[] }> }> = {};
  for (const file of FILES) {
    const path = join(BASE, file);
    if (!existsSync(path)) {
      console.warn("Skip (not found):", path);
      continue;
    }
    const buf = readFileSync(path);
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    result[file] = { sheets: {} };
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      const firstRows = getFirstRows(sheet, 6);
      const headerRow = findHeaderRow(firstRows);
      result[file].sheets[name] = { firstRows, headerRow };
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

main();
