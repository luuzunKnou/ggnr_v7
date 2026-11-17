'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { canWriteSer } from '@/lib/accessClient';
import { useMyAccessSnapshot } from '@/hooks/useMyAccessSnapshot';

const SerWriteAccessContext = createContext<boolean>(true);

/**
 * 지도 기능 패널 묶음에 씌워 LayerRow 추가·수정·삭제가 읽기 권한에서 숨겨지게 함.
 */
export function SerWriteAccessProvider({
  serEng,
  children,
}: {
  serEng: string;
  children: ReactNode;
}) {
  const { snapshot, loading } = useMyAccessSnapshot();
  const canWrite = useMemo(() => {
    if (loading) return false;
    return canWriteSer(snapshot, serEng);
  }, [loading, snapshot, serEng]);

  return (
    <SerWriteAccessContext.Provider value={canWrite}>{children}</SerWriteAccessContext.Provider>
  );
}

/**
 * @param serEng 있으면 해당 서비스 기준. 없으면 Provider 값(기본 true).
 */
export function useSerWriteAccess(serEng?: string): boolean {
  const fromContext = useContext(SerWriteAccessContext);
  const { snapshot, loading } = useMyAccessSnapshot();
  return useMemo(() => {
    const eng = serEng?.trim();
    if (eng) {
      if (loading) return false;
      return canWriteSer(snapshot, eng);
    }
    return fromContext;
  }, [serEng, snapshot, loading, fromContext]);
}

/** 쓰기 권한일 때만 children 표시 */
export function SerWriteOnly({
  serEng,
  children,
}: {
  serEng?: string;
  children: ReactNode;
}) {
  const canWrite = useSerWriteAccess(serEng);
  if (!canWrite) return null;
  return <>{children}</>;
}
