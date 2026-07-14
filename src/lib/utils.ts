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

/**
 * 텍스트를 클립보드에 복사한다.
 * navigator.clipboard는 Secure Context(HTTPS 또는 localhost)에서만 존재하므로,
 * IP 주소로 접속하는 등 비보안 컨텍스트에서는 document.execCommand('copy') 폴백을 사용한다.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy fallback
    }
  }

  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let succeeded = false;
  try {
    succeeded = document.execCommand('copy');
  } catch {
    succeeded = false;
  } finally {
    document.body.removeChild(textarea);
  }
  return succeeded;
}
