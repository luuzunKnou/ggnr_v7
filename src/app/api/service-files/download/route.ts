import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
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
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
  };
  return map[ext] ?? 'application/octet-stream';
}

const STREAM_VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm']);

/** 대용량 영상: 전체를 메모리에 올리지 않고 Range(206)로 잘라 보낸다 (재생·탐색용) */
function streamVideoResponse(
  req: NextRequest,
  resolved: string,
  filename: string,
  size: number
): NextResponse {
  const commonHeaders: Record<string, string> = {
    'Content-Type': contentTypeForFile(filename),
    'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=300',
  };
  const range = req.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
    let start = NaN;
    let end = NaN;
    if (m && m[1] !== '') {
      start = Number(m[1]);
      end = m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
    } else if (m && m[2] !== '') {
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { ...commonHeaders, 'Content-Range': `bytes */${size}` },
      });
    }
    const stream = Readable.toWeb(createReadStream(resolved, { start, end })) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: {
        ...commonHeaders,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
      },
    });
  }
  const stream = Readable.toWeb(createReadStream(resolved)) as ReadableStream;
  return new NextResponse(stream, {
    headers: { ...commonHeaders, 'Content-Length': String(size) },
  });
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

    if (STREAM_VIDEO_EXTS.has(ext)) {
      return streamVideoResponse(req, resolved, filename, stat.size);
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
