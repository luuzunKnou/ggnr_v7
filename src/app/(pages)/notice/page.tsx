import { SiteIndexShell } from '@/app/(pages)/(index)/site-index-shell';
import { BoardScreen } from '@/app/(pages)/_components/board/BoardScreen';

export const dynamic = 'force-dynamic';

export default function NoticeListPage() {
  return (
    <SiteIndexShell
      fillViewport
      mainClassName="container mx-auto px-4 py-4 pb-24 flex flex-1 flex-col min-h-0"
    >
      <BoardScreen kind="notice" />
    </SiteIndexShell>
  );
}
