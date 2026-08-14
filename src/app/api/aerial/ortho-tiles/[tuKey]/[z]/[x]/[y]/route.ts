import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '@/database/db';
import { tifUnit } from '@/database/schema/tif_unit';
import { getSessionUsrId } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';

/**
 * GET /api/aerial/ortho-tiles/{tuKey}/{z}/{x}/{y}.jpg
 * — tif_unit.tiles_relative_path 아래 XYZ (자체항공 /api/2dtiles 와 분리)
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ tuKey: string; z: string; x: string; y: string }> }
) {
  const usrId = await getSessionUsrId();
  if (!usrId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { tuKey: tuKeyRaw, z, x, y: yRaw } = await context.params;
  const tuKey = Number(tuKeyRaw);
  if (!Number.isFinite(tuKey) || tuKey <= 0) {
    return NextResponse.json({ error: 'Invalid tuKey' }, { status: 400 });
  }
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const yFile = yRaw.endsWith('.jpg') || yRaw.endsWith('.jpeg') || yRaw.endsWith('.png')
    ? yRaw
    : `${yRaw}.jpg`;
  if (!/^\d+\.(jpg|jpeg|png)$/i.test(yFile)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const row = (
    await db
      .select({
        tilesRelativePath: tifUnit.tilesRelativePath,
        convertStatus: tifUnit.convertStatus,
        tuIsDel: tifUnit.tuIsDel,
      })
      .from(tifUnit)
      .where(and(eq(tifUnit.tuKey, tuKey), eq(tifUnit.tuIsDel, false)))
      .limit(1)
  )[0];

  /** 재변환 중에도 기존 타일은 계속 서빙 */
  if (
    !row?.tilesRelativePath ||
    (row.convertStatus !== 'done' && row.convertStatus !== 'converting')
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const tilesRel = row.tilesRelativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!tilesRel.startsWith('aerial/ortho/') || tilesRel.includes('..')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const base = path.resolve(GGNR_DATA_DIR);
  const resolved = path.resolve(base, ...tilesRel.split('/').filter(Boolean), z, x, yFile);
  const rel = path.relative(base, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  /** PNG↔JPG 상호 fallback (신규 PNG / 레거시 JPEG) */
  const tryPaths = [resolved];
  if (/\.png$/i.test(resolved)) {
    tryPaths.push(resolved.replace(/\.png$/i, '.jpg'));
  } else if (/\.jpe?g$/i.test(resolved)) {
    tryPaths.push(resolved.replace(/\.jpe?g$/i, '.png'));
  }

  for (const candidate of tryPaths) {
    const relCand = path.relative(base, candidate);
    if (!relCand || relCand.startsWith('..') || path.isAbsolute(relCand)) continue;
    try {
      const buf = await fs.readFile(candidate);
      const lower = candidate.toLowerCase();
      const contentType = lower.endsWith('.png') ? 'image/png' : 'image/jpeg';
      return new NextResponse(buf, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'private, max-age=300',
        },
      });
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') continue;
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
