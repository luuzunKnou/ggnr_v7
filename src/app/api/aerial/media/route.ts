import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';

function contentTypeForFile(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
  };
  return map[ext] ?? 'application/octet-stream';
}

function contentDisposition(filename: string, inline: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_') || 'file';
  const utf8 = encodeURIComponent(filename);
  const kind = inline ? 'inline' : 'attachment';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * GET /api/aerial/media?path=aerial/drone/...&download=1
 * — GGNR_DATA_DIR 아래 aerial/ 경로만 허용. 로그인 필요.
 */
export async function GET(req: NextRequest) {
  const usrId = await getSessionUsrId();
  if (!usrId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const pathParam = req.nextUrl.searchParams.get('path')?.trim() ?? '';
  const asDownload = req.nextUrl.searchParams.get('download') === '1';
  if (!pathParam) {
    return NextResponse.json({ error: 'path 파라미터가 필요합니다.' }, { status: 400 });
  }

  const normalized = pathParam.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized.startsWith('aerial/') || normalized.includes('..')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const base = path.resolve(GGNR_DATA_DIR);
  const resolved = path.resolve(base, ...normalized.split('/').filter(Boolean));
  const rel = path.relative(base, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return NextResponse.json({ error: '파일이 아닙니다.' }, { status: 400 });
    }
    const fileName = path.basename(resolved);
    const size = stat.size;
    const contentType = contentTypeForFile(fileName);
    const disposition = contentDisposition(fileName, !asDownload);
    const commonHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Disposition': disposition,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=300',
    };

    /** 동영상 시크·미리보기: Range 없으면 통째로 받아 체감 로딩이 길어짐 */
    const range = req.headers.get('range');
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
      if (!m) {
        return new NextResponse(null, {
          status: 416,
          headers: { ...commonHeaders, 'Content-Range': `bytes */${size}` },
        });
      }
      let start = m[1] !== '' ? Number(m[1]) : 0;
      let end = m[2] !== '' ? Number(m[2]) : size - 1;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end < start ||
        start >= size
      ) {
        return new NextResponse(null, {
          status: 416,
          headers: { ...commonHeaders, 'Content-Range': `bytes */${size}` },
        });
      }
      end = Math.min(end, size - 1);
      const chunkSize = end - start + 1;
      const stream = createReadStream(resolved, { start, end });
      const webStream = Readable.toWeb(stream) as ReadableStream;
      return new NextResponse(webStream, {
        status: 206,
        headers: {
          ...commonHeaders,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${size}`,
        },
      });
    }

    const stream = createReadStream(resolved);
    const webStream = Readable.toWeb(stream) as ReadableStream;
    return new NextResponse(webStream, {
      headers: {
        ...commonHeaders,
        'Content-Length': String(size),
      },
    });
  } catch {
    return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });
  }
}
