import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { after } from 'next/server';
import { NextRequest, NextResponse } from 'next/server';
import {
  cleanupLayerCadExportJob,
  getLayerCadExportCapabilities,
  getLayerCadExportJob,
  runLayerCadExportJob,
  startLayerCadExportJob,
  type LayerCadExportItem,
} from '@/service/layerCadExportService';
import { recordLayerDownloadLog } from '@/service/layerDownloadLog';

export const dynamic = 'force-dynamic';
/** 대용량 관로+라벨 변환용 (초) */
export const maxDuration = 600;

/**
 * GET /api/download/cad
 * - 인자 없음: 변환 가능 여부
 * - ?jobId= : 상태 JSON
 * - ?jobId=&download=1 : 파일 스트림
 */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId')?.trim() ?? '';
  if (!jobId) {
    return NextResponse.json({ success: true, ...getLayerCadExportCapabilities() });
  }

  const job = getLayerCadExportJob(jobId);
  if (!job) {
    return NextResponse.json({ error: '작업을 찾을 수 없습니다. 다시 다운로드하세요.' }, { status: 404 });
  }

  const wantDownload = req.nextUrl.searchParams.get('download') === '1';
  if (!wantDownload) {
    if (job.status === 'pending') return NextResponse.json({ status: 'pending' });
    if (job.status === 'error') return NextResponse.json({ status: 'error', error: job.error });
    return NextResponse.json({
      status: 'done',
      fileName: job.fileName,
      format: job.format,
      byteLength: job.byteLength,
      included: job.included,
      skipped: job.skipped,
    });
  }

  if (job.status !== 'done') {
    return NextResponse.json({ error: '파일이 아직 준비되지 않았습니다.' }, { status: 409 });
  }

  try {
    const st = await stat(job.filePath);
    for (const tableName of job.included) {
      try {
        await recordLayerDownloadLog({
          tableName,
          format: job.format === 'dwg' ? 'DWG' : 'DXF',
        });
      } catch (e) {
        console.warn('[download/cad] data_log', e instanceof Error ? e.message : e);
      }
    }

    const contentType = job.format === 'dwg' ? 'application/acad' : 'application/dxf';
    const nodeStream = createReadStream(job.filePath);
    nodeStream.on('close', () => {
      void cleanupLayerCadExportJob(jobId);
    });
    nodeStream.on('error', () => {
      void cleanupLayerCadExportJob(jobId);
    });

    console.log('[download/cad] stream', job.fileName, st.size, 'bytes');

    return new NextResponse(Readable.toWeb(nodeStream) as unknown as BodyInit, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(st.size),
        'Content-Disposition': `attachment; filename="${job.fileName}"`,
        'Cache-Control': 'no-store',
        'X-Cad-Included': job.included.join(','),
        'X-Cad-Skipped-Count': String(job.skipped.length),
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[download/cad] stream', msg);
    await cleanupLayerCadExportJob(jobId);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/download/cad — 변환 잡 시작 (즉시 jobId 반환)
 * body: { layers: [{ tableName, schema?, labelField? }], format?, bbox? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const formatRaw = String(body?.format ?? 'dxf').toLowerCase();
    const format = formatRaw === 'dwg' ? 'dwg' : 'dxf';
    const bbox = body?.bbox ?? null;
    const layersRaw = Array.isArray(body?.layers) ? body.layers : [];
    const layers: LayerCadExportItem[] = layersRaw
      .map(
        (row: {
          tableName?: string;
          table?: string;
          schema?: string;
          labelField?: string | null;
        }) => ({
          tableName: String(row?.tableName ?? row?.table ?? '').trim(),
          schema:
            String(row?.schema ?? '').toLowerCase() === 'public_layer'
              ? ('public_layer' as const)
              : ('layer' as const),
          labelField: String(row?.labelField ?? '').trim() || null,
        })
      )
      .filter((row: LayerCadExportItem) => Boolean(row.tableName));

    if (!layers.length) {
      return NextResponse.json({ error: '레이어를 한 개 이상 선택하세요.' }, { status: 400 });
    }

    const { jobId } = startLayerCadExportJob({ layers, bbox, format });
    console.log('[download/cad] job start', jobId, 'layers', layers.length, format);
    // Next가 응답 후 백그라운드 작업을 끊지 않도록 after()로 실행
    after(() => runLayerCadExportJob(jobId, { layers, bbox, format }));
    return NextResponse.json({ success: true, jobId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[download/cad] start', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
