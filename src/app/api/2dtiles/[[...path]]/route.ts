import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
const BASE_DIR = path.normalize(path.join(GGNR_DATA_DIR, 'tiles_jpg'));

function isSafeOrthoSegment(s: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(s);
}

function isDigits(s: string): boolean {
  return /^\d+$/.test(s);
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const { path: pathSegments } = await context.params;

  if (!pathSegments?.length) {
    return NextResponse.json({ error: 'Path required' }, { status: 400 });
  }

  let resolved: string;

  const isOrthoTileFile = (yFile: string) => /^\d+\.(jpg|jpeg|png)$/i.test(yFile);

  if (pathSegments.length === 5) {
    const [groupName, tileSetId, zStr, xStr, yFile] = pathSegments;
    if (!isSafeOrthoSegment(groupName) || !isSafeOrthoSegment(tileSetId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!isDigits(zStr) || !isDigits(xStr) || !isOrthoTileFile(yFile)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    resolved = path.normalize(path.join(BASE_DIR, ...pathSegments));
  } else if (pathSegments.length === 4) {
    const [tileSetId, zStr, xStr, yFile] = pathSegments;
    if (!isSafeOrthoSegment(tileSetId) || !isDigits(zStr) || !isDigits(xStr) || !isOrthoTileFile(yFile)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    resolved = path.normalize(path.join(BASE_DIR, ...pathSegments));
  } else {
    return NextResponse.json(
      {
        error:
          'Path must be {group}/{outputSlug|legacyTileRoot}/{z}/{x}/{y}.(jpg|png) or legacy {tileRoot}/{z}/{x}/{y}.(jpg|png)',
      },
      { status: 400 }
    );
  }

  if (!resolved.startsWith(BASE_DIR)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    }

    const buf = await fs.readFile(resolved);
    const lower = resolved.toLowerCase();
    const contentType = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
        ? 'image/jpeg'
        : 'application/octet-stream';
    return new NextResponse(buf, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
