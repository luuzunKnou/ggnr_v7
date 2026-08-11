import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs/promises';
import { getSessionUsrId, userHasSerAccess } from '@/lib/auth/guard';
import { exportLayerTableToCsv } from '@/service/excelUploadService';
import { recordLayerDownloadLog } from '@/service/layerDownloadLog';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';

export async function GET(req: NextRequest) {
  const usrId = await getSessionUsrId();
  if (!usrId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await userHasSerAccess(usrId, 'dataQuery', 'read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const pathParam = req.nextUrl.searchParams.get('path');
  if (!pathParam || typeof pathParam !== 'string') {
    return NextResponse.json({ error: 'path 쿼리가 필요합니다.' }, { status: 400 });
  }
  const normalized = pathParam.replace(/\//g, path.sep).replace(/^[/\\]+/, '');
  const resolved = path.resolve(GGNR_DATA_DIR, normalized);
  const base = path.resolve(GGNR_DATA_DIR);
  const rel = path.relative(base, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    console.warn('[download/excel] path outside data dir:', normalized);
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: '파일만 다운로드할 수 있습니다.' }, { status: 400 });
    }
    const buf = await fs.readFile(resolved);
    const filename = path.basename(resolved);
    console.log('[download/excel]', rel, buf.length, 'bytes');
    const lower = filename.toLowerCase();
    const contentType = lower.endsWith('.csv')
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return new NextResponse(buf, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST: DB 테이블 → CSV 내보내기 (교차 다운로드) */
export async function POST(req: NextRequest) {
  const usrId = await getSessionUsrId();
  if (!usrId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await userHasSerAccess(usrId, 'dataQuery', 'read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const tableName = String(body?.tableName ?? body?.table ?? '').trim();
    if (!tableName) {
      return NextResponse.json({ error: 'tableName이 필요합니다.' }, { status: 400 });
    }
    const schemaRaw = String(body?.schema ?? '').toLowerCase();
    const schema = schemaRaw === 'public_layer' ? ('public_layer' as const) : ('layer' as const);
    const result = await exportLayerTableToCsv({ tableName, schema });
    if (!result.success || !result.buffer) {
      console.error('[download/excel] csv export', tableName, result.error);
      return NextResponse.json(
        { error: result.error ?? 'CSV 내보내기 실패' },
        { status: 500 }
      );
    }
    const fileName = result.fileName ?? `${tableName}.csv`;
    console.log('[download/excel] csv export', schema, tableName, result.buffer.length, 'bytes');
    try {
      await recordLayerDownloadLog({ tableName, format: 'CSV' });
    } catch (e) {
      console.warn('[download/excel] data_log', e instanceof Error ? e.message : e);
    }
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[download/excel] csv export exception', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
