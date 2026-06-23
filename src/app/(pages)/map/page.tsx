// src/app/(pages)/map/page.tsx
import { getDefaultMapCenterFromFooter } from '@/service/configService';
import MapViewModeWrapper from './_mapComponents/MapViewModeWrapper';

export default async function MapPage() {
  const projectName = (process.env.GGNR_PROJECT ?? 'build_yy').trim() || 'build_yy';
  const defaultCenter = await getDefaultMapCenterFromFooter();
  return <MapViewModeWrapper projectName={projectName} defaultCenter={defaultCenter} />;
}