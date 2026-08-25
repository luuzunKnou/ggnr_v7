'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ShootingRequestForm } from './ShootingRequestForm';
import { addShootingRequest } from './shootingRequestMockStore';

type Props = {
  /** 접수 후 이동할 지도 URL (기본 /map) */
  afterSubmitMapHref?: string;
};

/**
 * 지도·사이드바 없이 신청서만 단독으로 보여주는 화면.
 * URL: /drone
 */
export function ShootingRequestStandaloneClient({
  afterSubmitMapHref = '/map',
}: Props) {
  const router = useRouter();
  const [doneId, setDoneId] = useState<string | null>(null);

  const goMap = () => {
    router.push(afterSubmitMapHref);
  };

  if (doneId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-background px-5 py-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-foreground">신청이 접수되었습니다</p>
          <p className="mt-2 text-[12px] text-muted-foreground">
            내 촬영요청목록에서 진행 상태를 확인할 수 있습니다.
          </p>
          <button
            type="button"
            onClick={goMap}
            className="mt-4 rounded border border-sky-600 bg-sky-600 px-3 py-1.5 text-[12px] text-white hover:bg-sky-700"
          >
            지도로 이동
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-3 py-6">
      <div className="flex h-[min(62vh,500px)] w-full max-w-[46rem] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg">
        <ShootingRequestForm
          closeLabel="닫기"
          onClose={goMap}
          onSubmit={async (draft) => {
            const row = await addShootingRequest(draft);
            setDoneId(row.id);
          }}
        />
      </div>
    </div>
  );
}
