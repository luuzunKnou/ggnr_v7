import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs/promises';
import { getSessionUsrId } from '@/lib/auth/guard';
import { userCanAccessServiceFileData } from '@/lib/serviceFileDataAccess';
import {
  decodeServiceFileDataPathB64,
  isAllowedServiceFileDataDownloadPath,
} from '@/lib/serviceFileData';
import { parseSerEngForServiceFileData } from '@/lib/serviceFileDataPolicy';
import { resolveGgnrDataDir, turbopackOpaquePath } from '@/lib/turbopackFsPath';

export const dynamic = 'force-dynamic';

const IMAGE_THUMB_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.tif',
  '.tiff',
  '.bmp',
]);

/** `thumb=1` → 160px, 또는 32~640 숫자. 목록용 저화질 JPEG */
function parseThumbWidth(raw: string | null): number | null {
  if (raw == null || raw === '') return null;
  if (raw === '1' || raw === 'true') return 160;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 32 || n > 640) return null;
  return Math.round(n);
}

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

/** pathB64 우선, 없으면 레거시 path (영문 파일명 호환) */
function resolveDownloadRelativePath(req: NextRequest): string | null {
  const pathB64 = req.nextUrl.searchParams.get('pathB64');
  if (pathB64 != null && pathB64.trim() !== '') {
    return decodeServiceFileDataPathB64(pathB64);
  }
  const pathParam = req.nextUrl.searchParams.get('path');
  if (!pathParam || typeof pathParam !== 'string') return null;
  return pathParam;
}

export async function GET(req: NextRequest) {
  const usrId = await getSessionUsrId();
  const serEng = parseSerEngForServiceFileData(req.nextUrl.searchParams.get('serEng'));
  if (serEng == null) {
    return NextResponse.json({ error: '유효하지 않은 serEng 입니다.' }, { status: 400 });
  }
  if (!(await userCanAccessServiceFileData(usrId, serEng, 'read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pathParam = resolveDownloadRelativePath(req);
  if (pathParam == null) {
    return NextResponse.json({ error: 'path 또는 pathB64 쿼리가 필요합니다.' }, { status: 400 });
  }

  const normalized = pathParam.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!isAllowedServiceFileDataDownloadPath(normalized)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const baseDir = resolveGgnrDataDir();
  const base = path.resolve(baseDir);
  const resolvedRaw = path.resolve(base, ...normalized.split('/').filter(Boolean));
  const rel = path.relative(base, resolvedRaw);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const resolved = turbopackOpaquePath(resolvedRaw);

  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: '파일만 다운로드할 수 있습니다.' }, { status: 400 });
    }
    const filename = path.basename(resolved);
    const thumbW = parseThumbWidth(req.nextUrl.searchParams.get('thumb'));
    const ext = path.extname(filename).toLowerCase();

    if (thumbW != null && IMAGE_THUMB_EXTS.has(ext)) {
      try {
        const sharp = (await import('sharp')).default;
        const thumbBuf = await sharp(resolved)
          .rotate()
          .resize({
            width: thumbW,
            height: thumbW,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 42, mozjpeg: true })
          .toBuffer();
        return new NextResponse(new Uint8Array(thumbBuf), {
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Disposition': `inline; filename="${encodeURIComponent(
              `${path.parse(filename).name}_thumb.jpg`
            )}"`,
            'Cache-Control': 'private, max-age=3600',
          },
        });
      } catch {
        // sharp 실패 시 원본으로 폴백
      }
    }

    const buf = await fs.readFile(resolved);
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
