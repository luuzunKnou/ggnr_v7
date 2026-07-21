import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { resolveRequestClientMeta } from '@/lib/requestClientMeta';
import {
  buildInstallZip,
  recordInstallZipHistory,
  failInstallZipBuild,
} from '@/service/sourceInstallZipService';
import type { SourcePackageProfile } from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';

export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

/** 레거시 단일 GET — build 후 download URL 안내 */
export async function GET(req: NextRequest) {
  const clientMeta = resolveRequestClientMeta(req);
  const profile: SourcePackageProfile =
    req.nextUrl.searchParams.get('profile') === 'open' ? 'open' : 'closed';
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const result = await buildInstallZip({ profile });
    await recordInstallZipHistory({
      ok: true,
      message: result.zipName,
      ip: clientMeta.ip,
      profile,
    });
    const downloadUrl = `/api/source/version/install-zip/download?zipName=${encodeURIComponent(result.zipName)}`;
    return NextResponse.redirect(new URL(downloadUrl, req.nextUrl.origin));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'install zip build failed';
    failInstallZipBuild(undefined, message);
    await recordInstallZipHistory({
      ok: false,
      message,
      ip: clientMeta.ip,
      profile,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
