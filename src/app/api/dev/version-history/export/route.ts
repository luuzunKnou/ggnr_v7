import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  historyTypeLabel,
  listVersionHistory,
  type VersionHistoryFilter,
  type VersionHistoryRow,
  type VersionHistoryType,
} from '@/service/mngVersionHistoryService';

export const dynamic = 'force-dynamic';

function parseFilter(raw: string): VersionHistoryFilter {
  const v = raw.trim();
  if (v === 'source_upload' || v === 'source_upload_only') return 'source_upload_only';
  if (v === 'source_all') return 'source_all';
  if (v === 'install_zip' || v === 'apply_latest') return v as VersionHistoryType;
  if (v === 'all' || v === 'version_all') return 'version_all';
  return 'version_all';
}

function formatDt(value: VersionHistoryRow['mvhCreateDate']): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}.${m}.${day} ${h}:${min}:${s}`;
}

function resolveExportPrefix(raw: string | null, filter: VersionHistoryFilter): string {
  const p = (raw ?? '').trim();
  if (p === '소스코드관리' || p === '최신소스적용') return p;
  if (
    filter === 'source_upload_only' ||
    filter === 'source_all' ||
    filter === 'install_zip' ||
    filter === 'source_upload'
  ) {
    return '소스코드관리';
  }
  return '최신소스적용';
}

function exportFileName(prefix: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const hm = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${prefix}_${ymd}_${hm}.xlsx`;
}

/** GET: 현재 검색조건 기준 이력 xlsx */
export async function GET(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const sp = req.nextUrl.searchParams;
    const filter = parseFilter(sp.get('filter') ?? 'version_all');
    const dateYmd = sp.get('date')?.trim() ?? '';
    const q = sp.get('q')?.trim() ?? '';
    const prefix = resolveExportPrefix(sp.get('prefix'), filter);

    const result = await listVersionHistory({
      filter,
      dateYmd: dateYmd || undefined,
      q: q || undefined,
      forExport: true,
    });
    if (!result.success) {
      return NextResponse.json({ error: result.error ?? '조회 실패' }, { status: 500 });
    }

    const rows = result.data.map((r) => ({
      일시: formatDt(r.mvhCreateDate),
      기능구분: historyTypeLabel(r.mvhHistoryType),
      상태: r.mvhStatus === 'success' ? '성공' : '실패',
      'IP/호스트': r.mvhIp ?? r.mvhClientHost ?? '',
      선택: Array.isArray(r.mvhOption) && r.mvhOption.length > 0 ? r.mvhOption.join(', ') : '',
      버전: r.mvhVer?.trim() ?? '',
      메모: r.mvhMemo?.trim() ?? '',
      본문: (r.mvhMessage ?? '').trim(),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '이력');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = exportFileName(prefix);
    const asciiFallback =
      prefix === '소스코드관리' ? 'source-code.xlsx' : 'apply-latest.xlsx';

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'history export failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
