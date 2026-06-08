import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
const BASE_DIR = path.join(GGNR_DATA_DIR, GGNR_DATA_PATHS.dtilesTiff);

function getContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  return 'application/octet-stream';
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const { path: pathSegments } = await context.params;

  if (!pathSegments || pathSegments.length === 0) {
    return NextResponse.json({ error: 'Path required' }, { status: 400 });
  }

  const resolved = path.normalize(path.join(BASE_DIR, ...pathSegments));

  if (!resolved.startsWith(BASE_DIR)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    }

    const contentType = getContentType(resolved);
    const fileSize = stat.size;
    const rangeHeader = req.headers.get('range');

    if (rangeHeader?.startsWith('bytes=')) {
      const part = rangeHeader.slice(6).trim().split(',')[0];
      const [startStr, endStr] = part.split('-');
      const start = startStr ? parseInt(startStr, 10) : 0;
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
      const safeEnd = Math.min(end, fileSize - 1);
      const safeStart = Math.max(0, Math.min(start, safeEnd));
      const length = safeEnd - safeStart + 1;

      const handle = await fs.open(resolved, 'r');
      try {
        const buf = Buffer.alloc(length);
        await handle.read(buf, 0, length, safeStart);
        return new NextResponse(buf, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(length),
            'Content-Range': `bytes ${safeStart}-${safeEnd}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } finally {
        await handle.close();
      }
    }

    const buf = await fs.readFile(resolved);
    return new NextResponse(buf, {
      headers: {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
