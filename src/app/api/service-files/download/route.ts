import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs/promises';
import { getSessionUsrId, userHasSerAccess } from '@/lib/auth/guard';
import { isAllowedServiceFileDataDownloadPath } from '@/lib/serviceFileData';
import { parseSerEngForServiceFileData } from '@/lib/serviceFileDataPolicy';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';

export const dynamic = 'force-dynamic';

function contentTypeForFile(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.txt': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.json': 'application/json',
    '.zip': 'application/zip',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
  };
  return map[ext] ?? 'application/octet-stream';
}

export async function GET(req: NextRequest) {
  const usrId = await getSessionUsrId();
  if (!usrId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serEng = parseSerEngForServiceFileData(req.nextUrl.searchParams.get('serEng'));
  if (serEng == null) {
    return NextResponse.json({ error: '유효하지 않은 serEng 입니다.' }, { status: 400 });
  }
  if (!(await userHasSerAccess(usrId, serEng, 'read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pathParam = req.nextUrl.searchParams.get('path');
  if (!pathParam || typeof pathParam !== 'string') {
    return NextResponse.json({ error: 'path 쿼리가 필요합니다.' }, { status: 400 });
  }

  const normalized = pathParam.replace(/\//g, path.sep).replace(/^[/\\]+/, '');
  if (!isAllowedServiceFileDataDownloadPath(normalized)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const resolved = path.resolve(GGNR_DATA_DIR, normalized);
  const base = path.resolve(GGNR_DATA_DIR);
  const rel = path.relative(base, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: '파일만 다운로드할 수 있습니다.' }, { status: 400 });
    }
    const buf = await fs.readFile(resolved);
    const filename = path.basename(resolved);
    return new NextResponse(buf, {
      headers: {
        'Content-Type': contentTypeForFile(filename),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
