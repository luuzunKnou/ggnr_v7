import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { resolveDownloadZip } from '@/service/dataRequestService';

export async function GET(req: NextRequest) {
  try {
    const fileGroupKey = Number(req.nextUrl.searchParams.get('fileGroupKey'));
    const result = await resolveDownloadZip({ fileGroupKey });
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 400 }
      );
    }
    const buf = await fs.readFile(result.absPath);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[data-request/download]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
