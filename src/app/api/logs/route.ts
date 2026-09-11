import { NextRequest, NextResponse } from 'next/server';
import {
  assertGnmsLogBearer,
  saveGnmsLogFiles,
  type GnmsLogFileInput,
} from '@/service/gnmsLogReceiveService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function corsHeaders(req: NextRequest): HeadersInit {
  const origin = req.headers.get('origin')?.trim() || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function withCors(req: NextRequest, res: NextResponse): NextResponse {
  const h = corsHeaders(req);
  for (const [k, v] of Object.entries(h)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function OPTIONS(req: NextRequest) {
  return withCors(req, new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
  const auth = assertGnmsLogBearer(req.headers.get('authorization'));
  if (!auth.ok) {
    return withCors(req, NextResponse.json({ error: auth.error }, { status: auth.status }));
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return withCors(
      req,
      NextResponse.json({ error: '요청 본문을 읽을 수 없습니다.' }, { status: 400 })
    );
  }

  const project = String(form.get('project') ?? '').trim();
  const type = String(form.get('type') ?? '').trim();
  const date = String(form.get('date') ?? '').trim();

  const files: GnmsLogFileInput[] = [];
  const pushEntry = async (entry: FormDataEntryValue | null) => {
    if (!(entry instanceof File)) return;
    const buf = Buffer.from(await entry.arrayBuffer());
    files.push({ fileName: entry.name || 'upload.log', data: buf });
  };

  await pushEntry(form.get('file'));
  for (const entry of form.getAll('files')) {
    await pushEntry(entry);
  }
  // 일부 클라이언트가 files[] 로 보낼 때
  for (const entry of form.getAll('files[]')) {
    await pushEntry(entry);
  }

  try {
    const result = await saveGnmsLogFiles({ project, type, date, files });
    return withCors(req, NextResponse.json(result));
  } catch (e) {
    const status =
      e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number'
        ? (e as { status: number }).status
        : 500;
    const message = e instanceof Error ? e.message : String(e);
    if (status === 400) {
      return withCors(req, NextResponse.json({ error: message }, { status: 400 }));
    }
    console.error('[api/logs] save failed:', e);
    return withCors(
      req,
      NextResponse.json({ error: message || '저장에 실패했습니다.' }, { status: 500 })
    );
  }
}
