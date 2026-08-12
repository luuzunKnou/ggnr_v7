import { SiteIndexShell } from '@/app/(pages)/(index)/site-index-shell';
import { BoardScreen } from '@/app/(pages)/_components/board/BoardScreen';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function LibraryDetailPage({ params }: PageProps) {
  const { id } = await params;
  const postId = Number(id);

  return (
    <SiteIndexShell mainClassName="container mx-auto px-4 py-4 pb-24">
      <BoardScreen kind="library" postId={Number.isInteger(postId) && postId > 0 ? postId : undefined} />
    </SiteIndexShell>
  );
}
