'use client';

import { createContext, useContext } from 'react';
import type { ConsoleMenuAccessContextValue } from '@/lib/consoleMenuAccess/types';
import { canConsoleMenuRead, canConsoleMenuWrite } from '@/lib/consoleMenuAccess/client';

const defaultValue: ConsoleMenuAccessContextValue = {
  area: null,
  menuId: null,
  policy: 'write',
  canRead: true,
  canWrite: true,
  loading: false,
};

export const ConsoleMenuAccessContext = createContext<ConsoleMenuAccessContextValue>(defaultValue);

export function useConsoleMenuAccessContext(): ConsoleMenuAccessContextValue {
  return useContext(ConsoleMenuAccessContext);
}

/** 현재 콘솔 메뉴 쓰기 권한 (패널에서 저장·삭제 버튼 숨김 용) */
export function useConsoleMenuWriteAccess(): boolean {
  return useConsoleMenuAccessContext().canWrite;
}

/** 현재 콘솔 메뉴 읽기 권한 */
export function useConsoleMenuReadAccess(): boolean {
  return useConsoleMenuAccessContext().canRead;
}

/** 쓰기 권한일 때만 children 표시 */
export function ConsoleWriteOnly({ children }: { children: React.ReactNode }) {
  const canWrite = useConsoleMenuWriteAccess();
  if (!canWrite) return null;
  return <>{children}</>;
}

export { canConsoleMenuRead, canConsoleMenuWrite };
