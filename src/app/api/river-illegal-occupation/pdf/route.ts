import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId, userHasSerAccess } from '@/lib/auth/guard';
import { pdfContentDispositionHeader } from '@/lib/chromeHtmlToPdf';
import { RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG } from '@/app/(pages)/map/_mapContents/river/riverIllegalOccupation/riverIllegalOccupationConfig';
import { buildRiverIllegalOccupationPdf } from '@/service/riverIllegalOccupationPdfService';

export const runtime = 'nodejs';
/** 전체 PDF: 캐시 병합 위주. 미스 많으면 Chrome 재생성으로 수분 가능 */
export const maxDuration = 1800;

export async function POST(req: NextRequest) {
  const usrId = await getSessionUsrId();
  if (!usrId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await userHasSerAccess(usrId, RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG, 'read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { ids?: unknown };
  try {
    body = (await req.json()) as { ids?: unknown };
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.map((v) => String(v ?? '').trim()).filter(Boolean)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids 가 필요합니다.' }, { status: 400 });
  }
  if (ids.length > 800) {
    return NextResponse.json({ error: '한 번에 800건까지 저장할 수 있습니다.' }, { status: 400 });
  }

  try {
    const { body: fileBody, fileName, contentType } = await buildRiverIllegalOccupationPdf({ ids });
    return new NextResponse(new Uint8Array(fileBody), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': pdfContentDispositionHeader(fileName),
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[river-illegal-occupation/pdf]', msg);
    return NextResponse.json({ error: msg || 'PDF 생성에 실패했습니다.' }, { status: 500 });
  }
}
