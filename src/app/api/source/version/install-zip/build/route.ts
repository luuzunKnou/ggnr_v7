import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { pickClientIpFromRequest } from '@/lib/requestClientMeta';
import {
  buildInstallZip,
  recordInstallZipHistory,
  failInstallZipBuild,
} from '@/service/sourceInstallZipService';
import {
  createInstallZipProgressId,
  initInstallZipProgress,
} from '@/service/sourceInstallZipProgress';
import type { SourcePackageProfile } from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';

export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

function parseProfile(raw: unknown): SourcePackageProfile {
  return raw === 'open' ? 'open' : 'closed';
}

export async function POST(req: NextRequest) {
  let progressId = '';
  let profile: SourcePackageProfile = 'closed';
  let clientIp: string | undefined;
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    profile = parseProfile(body.profile);
    const bodyIp = typeof body.clientIp === 'string' ? body.clientIp.trim() : '';
    clientIp = pickClientIpFromRequest(req, bodyIp);
    progressId =
      typeof body.progressId === 'string' && body.progressId.trim()
        ? body.progressId.trim()
        : createInstallZipProgressId();
    initInstallZipProgress(progressId);

    const result = await buildInstallZip({ profile, progressId });
    await recordInstallZipHistory({
      ok: true,
      message: `${result.zipName} (${result.fileCount}건)`,
      ip: clientIp,
      profile,
    });
    return NextResponse.json({
      ok: true,
      progressId,
      zipName: result.zipName,
      zipSize: result.zipSize,
      fileCount: result.fileCount,
      downloadUrl: `/api/source/version/install-zip/download?progressId=${encodeURIComponent(progressId)}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'build failed';
    failInstallZipBuild(progressId || undefined, message);
    await recordInstallZipHistory({
      ok: false,
      message,
      ip: clientIp,
      profile,
    });
    return NextResponse.json({ error: message, progressId }, { status: 500 });
  }
}
