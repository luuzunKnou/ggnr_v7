'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/app/shadcnComponents/ui/button';
import { AccessRequestForm } from '@/app/(pages)/_components/AccessRequest';

function AccessRequestsContent() {
  const searchParams = useSearchParams();
  const qType = searchParams.get('type')?.trim();
  const qKey = searchParams.get('key')?.trim() ?? '';
  const initialTab = qType === 'sys' ? 'sys' : 'ser';

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">서비스 이용신청</h1>
        <Button variant="outline" asChild>
          <Link href="/">홈</Link>
        </Button>
      </div>
      <div className="rounded-lg border border-border p-4">
        <AccessRequestForm
          initialTab={initialTab}
          initialSerEng={initialTab === 'ser' ? qKey : ''}
          initialSysKey={initialTab === 'sys' ? qKey : ''}
        />
      </div>
    </div>
  );
}

export default function AccessRequestsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">불러오는 중…</div>
      }
    >
      <AccessRequestsContent />
    </Suspense>
  );
}
