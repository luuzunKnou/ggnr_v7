import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getForServe, policyMapSiteAbsDir } from '@/service/policyMapService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
};

type Ctx = { params: Promise<{ id: string; path?: string[] }> };

/** 정책지도 정적 파일 열람 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id, path: parts } = await ctx.params;
    const pmKey = Number(id);
    const meta = await getForServe(pmKey);
    if (!meta) {
      return new NextResponse('없거나 권한이 없습니다.', { status: 404 });
    }

    const siteRoot = path.resolve(policyMapSiteAbsDir(pmKey));
    const relParts = (parts ?? []).map((p) => decodeURIComponent(p)).filter(Boolean);
    const rel = relParts.length ? relParts.join('/') : meta.pmEntry.replace(/^\/+/, '');
    if (!rel || rel.includes('..')) {
      return new NextResponse('잘못된 경로입니다.', { status: 400 });
    }

    const abs = path.resolve(siteRoot, ...rel.split('/'));
    if (abs !== siteRoot && !abs.startsWith(siteRoot + path.sep)) {
      return new NextResponse('잘못된 경로입니다.', { status: 400 });
    }

    let st;
    try {
      st = await fs.stat(abs);
    } catch {
      return new NextResponse('파일을 찾을 수 없습니다.', { status: 404 });
    }

    if (st.isDirectory()) {
      const indexAbs = path.join(abs, 'index.html');
      try {
        await fs.access(indexAbs);
        const body = await fs.readFile(indexAbs);
        return new NextResponse(body, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      } catch {
        return new NextResponse('index.html이 없습니다.', { status: 404 });
      }
    }

    const body = await fs.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    return new NextResponse(body, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    const status =
      e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number'
        ? (e as { status: number }).status
        : 500;
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(msg, { status });
  }
}
