import { SiteIndexShell } from '@/app/(pages)/(index)/site-index-shell';
import { BoardScreen } from '@/app/(pages)/_components/board/BoardScreen';

export const dynamic = 'force-dynamic';

export default function NoticeListPage() {
  return (
    <SiteIndexShell mainClassName="container mx-auto px-4 py-4 pb-24">
      <BoardScreen kind="notice" />
    </SiteIndexShell>
  );
}
