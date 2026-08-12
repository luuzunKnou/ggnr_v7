// src/app/(pages)/map/page.tsx
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';
import { getDefaultMapCenterFromFooter } from '@/service/configService';
import MapViewModeWrapper from './_mapComponents/MapViewModeWrapper';

export default async function MapPage() {
  const projectName = (process.env.GGNR_PROJECT ?? 'build_yy').trim() || 'build_yy';
  const defaultCenter = await getDefaultMapCenterFromFooter();
  return (
    <Suspense fallback={<div className="flex h-full min-h-[50vh] items-center justify-center text-sm text-muted-foreground">지도 로딩 중...</div>}>
      <MapViewModeWrapper projectName={projectName} defaultCenter={defaultCenter} />
    </Suspense>
  );
}