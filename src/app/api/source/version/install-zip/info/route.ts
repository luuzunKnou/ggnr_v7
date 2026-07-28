import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { getInstallZipInfo } from '@/service/sourceInstallZipService';
import type { SourcePackageProfile } from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';

export const dynamic = 'force-dynamic';

function parseProfile(raw: string | null): SourcePackageProfile {
  return raw === 'open' ? 'open' : 'closed';
}

export async function GET(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const profile = parseProfile(req.nextUrl.searchParams.get('profile'));
    const info = await getInstallZipInfo(profile);
    return NextResponse.json(info);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'info failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
