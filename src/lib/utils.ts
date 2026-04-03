import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

//clsx와 tailwind-merge를 결합해 className을 병합하는 유틸리티로, Shadcn/ui 컴포넌트에서 필수
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 바이트를 읽기 쉬운 용량 문자열로 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  if (i === 0) return `${Math.round(v)} ${units[i]}`;
  return `${v >= 10 || i === 1 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}
