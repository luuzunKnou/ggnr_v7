/** 첨부 파일명 판별 (서버·클라이언트 공용 — 'use client' 금지) */

export function isImageServiceFileName(name: string): boolean {
  return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name);
}

export function isPdfServiceFileName(name: string): boolean {
  return /\.pdf$/i.test(name);
}
