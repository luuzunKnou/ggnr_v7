import { SiteIndexShell } from '@/app/(pages)/(index)/site-index-shell';
import { BoardScreen } from '@/app/(pages)/_components/board/BoardScreen';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function NoticeDetailPage({ params }: PageProps) {
  const { id } = await params;
  const postId = Number(id);

  return (
    <SiteIndexShell
      fillViewport
      mainClassName="container mx-auto px-4 py-4 pb-24 flex flex-1 flex-col min-h-0"
    >
      <BoardScreen kind="notice" postId={Number.isInteger(postId) && postId > 0 ? postId : undefined} />
    </SiteIndexShell>
  );
}
