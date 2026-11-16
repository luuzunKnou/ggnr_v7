export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isSuperUser } from '@/lib/auth/superUser';
import { getIndexFooterConfig, getSystemKorName } from '@/service/configService';

/** 기존 Index에서 슈퍼계정이 odor_index 대시보드를 미리보기 */
export default async function OdorIndexPreviewPage() {
  const session = await auth();
  if (!isSuperUser(session?.user?.id)) {
    redirect('/');
  }

  const [{ OdorIndexConsole }, { listSensors }] = await Promise.all([
    import('@/app/(pages)/(index)/odorPh/OdorIndexConsole'),
    import('@/service/odorSensorService'),
  ]);

  let sensors: Awaited<ReturnType<typeof listSensors>> = [];
  try {
    sensors = await listSensors();
  } catch {
    sensors = [];
  }

  const { footerAddr, footerRss } = getIndexFooterConfig();

  return (
    <OdorIndexConsole
      title={getSystemKorName()}
      sensors={sensors}
      footerAddr={footerAddr}
      footerRss={footerRss}
      queriedAt={new Date().toISOString()}
    />
  );
}
