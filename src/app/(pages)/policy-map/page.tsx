import { SiteIndexShell } from '@/app/(pages)/(index)/site-index-shell';
import { PolicyMapScreen } from './PolicyMapScreen';

export const dynamic = 'force-dynamic';

export default function PolicyMapPage() {
  return (
    <SiteIndexShell
      fillViewport
      mainClassName="container mx-auto flex min-h-0 flex-1 flex-col px-4 py-4 pb-24"
    >
      <PolicyMapScreen />
    </SiteIndexShell>
  );
}
