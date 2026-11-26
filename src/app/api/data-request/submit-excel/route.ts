import { NextRequest, NextResponse } from 'next/server';
import { submitExcelBinaryRequest } from '@/service/dataRequestService';

export const maxDuration = 600;

export async function POST(req: NextRequest) {
  try {
    const userIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      '';

    const contentType = req.headers.get('content-type') ?? '';
    let pledgeName = '';
    let tableKorName = '';
    let fileName = '';
    let tableName = '';
    let tableNames: string[] = [];
    let schema = '';
    let fileBuffer: Buffer | undefined;

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      pledgeName = String(form.get('pledgeName') ?? '');
      tableKorName = String(form.get('tableKorName') ?? '');
      fileName = String(form.get('fileName') ?? '');
      tableName = String(form.get('tableName') ?? '');
      tableNames = form
        .getAll('tableNames')
        .map((v) => String(v ?? '').trim())
        .filter(Boolean);
      schema = String(form.get('schema') ?? '');
      const file = form.get('file');
      if (file && typeof file === 'object' && 'arrayBuffer' in file) {
        const ab = await (file as File).arrayBuffer();
        fileBuffer = Buffer.from(ab);
        if (!fileName) fileName = String((file as File).name ?? '');
      }
    } else {
      const body = (await req.json().catch(() => ({}))) as {
        pledgeName?: string;
        tableKorName?: string;
        fileName?: string;
        fileBase64?: string;
        tableName?: string;
        tableNames?: string[];
        schema?: string;
      };
      pledgeName = String(body.pledgeName ?? '');
      tableKorName = String(body.tableKorName ?? '');
      fileName = String(body.fileName ?? '');
      tableName = String(body.tableName ?? '');
      tableNames = Array.isArray(body.tableNames)
        ? body.tableNames.map((n) => String(n ?? '').trim()).filter(Boolean)
        : [];
      schema = String(body.schema ?? '');
      const b64 = String(body.fileBase64 ?? '').trim();
      if (b64) {
        fileBuffer = Buffer.from(b64, 'base64');
      }
    }

    const result = await submitExcelBinaryRequest({
      pledgeName,
      tableKorName,
      fileName,
      tableName,
      tableNames,
      schema,
      fileBuffer,
      userIp,
    });
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.error === 'Unauthorized' ? 401 : 400 }
      );
    }
    return NextResponse.json({
      success: true,
      fileGroupKey: result.fileGroupKey,
      auth: result.auth,
      immediateDownload: result.immediateDownload,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[data-request/submit-excel]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
