import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

//clsx와 tailwind-merge를 결합해 className을 병합하는 유틸리티로, Shadcn/ui 컴포넌트에서 필수
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
