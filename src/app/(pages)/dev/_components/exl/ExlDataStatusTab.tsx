'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { RefreshCw, Check, X, Search, Download, FileSpreadsheet } from 'lucide-react';

type ExcelDataStatusRow = {
  tableName: string;
  tableKorName: string;
  table: boolean;
  layer: boolean;
  style: boolean;
  define: boolean;
  lastSourcePath: string | null;
  lastCreateDate: string | null;
};

type Props = {
  relativePath: string;
  onPathChange: (p: string) => void;
};

function StepCell({ ok }: { ok: boolean }) {
  return ok ? <Check className="w-3.5 h-3.5 text-green-600 mx-auto" /> : <X className="w-3.5 h-3.5 text-red-400 mx-auto" />;
}

/** DB 구조 기준: define(source=excel) 테이블 + excel_upload_history 최신 이력. UI는 SHP 레이어 상태와 동일. */
export function ExlDataStatusTab({ relativePath, onPathChange }: Props) {
  const [rows, setRows] = useState<ExcelDataStatusRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [downloadingExcel, setDownloadingExcel] = useState<string | null>(null);
  const [downloadingShp, setDownloadingShp] = useState<string | null>(null);

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  };

  const handleExcelDownload = useCallback(async (pathRel: string | null, tableName: string) => {
    const path =
      pathRel?.trim() ||
      `excel_data/${tableName.replace(/[^a-zA-Z0-9_]/g, '_')}.xlsx`;
    const key = `excel:${path}`;
    setDownloadingExcel(key);
    console.log('[ExlDataStatusTab] Excel download start', path);
    try {
      const q = new URLSearchParams({ path });
      const res = await fetch(`/api/download/excel?${q.toString()}`);
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn('[ExlDataStatusTab] Excel download failed', res.status, errText);
        throw new Error(res.status === 403 ? '접근 불가' : res.status === 404 ? '파일 없음' : '다운로드 실패');
      }
      const blob = await res.blob();
      const name = path.split(/[/\\]/).pop() ?? 'download.xlsx';
      triggerBlobDownload(blob, name);
      console.log('[ExlDataStatusTab] Excel download ok', name, blob.size);
    } catch (e) {
      console.error('[ExlDataStatusTab] Excel download', e);
      alert(e instanceof Error ? e.message : 'Excel 다운로드 실패');
    } finally {
      setDownloadingExcel(null);
    }
  }, []);

  const handleShpDownload = useCallback(async (tableName: string) => {
    if (!tableName?.trim()) return;
    setDownloadingShp(tableName);
    console.log('[ExlDataStatusTab] SHP download start', tableName);
    try {
      const res = await fetch('/api/download/shp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.warn('[ExlDataStatusTab] SHP failed', data);
        throw new Error(typeof data?.error === 'string' ? data.error : 'SHP export failed');
      }
      const blob = await res.blob();
      triggerBlobDownload(blob, `${tableName}.zip`);
      console.log('[ExlDataStatusTab] SHP download ok', blob.size);
    } catch (e) {
      console.error('[ExlDataStatusTab] SHP download', e);
      alert(e instanceof Error ? e.message : 'SHP 다운로드 실패');
    } finally {
      setDownloadingShp(null);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'excelUploadService',
        action: 'getExcelDataStatusList',
        params: {},
      });
      const d = res?.data ?? res;
      if (d?.success) {
        setRows(Array.isArray(d.rows) ? d.rows : []);
      } else {
        setError(d?.error ?? '목록을 불러올 수 없습니다.');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (r.tableName ?? '').toLowerCase().includes(q) ||
      (r.tableKorName ?? '').toLowerCase().includes(q) ||
      (r.lastSourcePath ?? '').toLowerCase().includes(q)
    );
  });
  const totalCount = rows.length;
  const layerOk = rows.filter((r) => r.layer).length;
  const styleOk = rows.filter((r) => r.style).length;
  const defineOk = rows.filter((r) => r.define).length;

  return (
    <div className="flex flex-col h-full min-h-0 p-2 gap-2">
      <div className="shrink-0 flex items-center gap-2">
        <span className="text-sm font-medium whitespace-nowrap">데이터 상태</span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          총 {totalCount}개 (Layer {layerOk} / Style {styleOk} / Define {defineOk})
        </span>
        <div className="flex-1" />
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 pr-2 text-xs border rounded w-40 bg-background"
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={fetchStatus} className="gap-1">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> 새로고침
        </Button>
      </div>

      <section className="flex-1 min-h-0 overflow-auto border rounded">
        {loading ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">로딩 중…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-xs text-red-500">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            {rows.length === 0 ? 'Excel 유래 레이어가 없습니다.' : '검색 결과가 없습니다.'}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted z-10">
              <tr className="text-muted-foreground">
                <th className="py-1.5 px-2 text-left w-28">테이블명</th>
                <th className="py-1.5 px-2 text-left w-40">한글명</th>
                <th className="py-1.5 px-2 text-left">파일 경로</th>
                <th className="py-1.5 px-2 text-center w-24">최종 업로드</th>
                <th className="py-1.5 px-2 text-center w-14">Table</th>
                <th className="py-1.5 px-2 text-center w-14">Layer</th>
                <th className="py-1.5 px-2 text-center w-14">Style</th>
                <th className="py-1.5 px-2 text-center w-14">Define</th>
                <th className="py-1.5 px-2 text-center w-24">Excel</th>
                <th className="py-1.5 px-2 text-center w-24">SHP</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.tableName} className="border-t hover:bg-muted/40">
                  <td className="py-1 px-2 font-mono truncate max-w-[7rem]" title={r.tableName}>{r.tableName}</td>
                  <td className="py-1 px-2 truncate max-w-[14rem]" title={r.tableKorName}>{r.tableKorName || '—'}</td>
                  <td className="py-1 px-2 text-muted-foreground truncate max-w-[16rem]" title={r.lastSourcePath ?? ''}>
                    {r.lastSourcePath || '—'}
                  </td>
                  <td className="py-1 px-2 text-center whitespace-nowrap text-muted-foreground">
                    {r.lastCreateDate ? new Date(r.lastCreateDate).toLocaleString() : '—'}
                  </td>
                  <td className="py-1 px-2"><StepCell ok={r.table} /></td>
                  <td className="py-1 px-2"><StepCell ok={r.layer} /></td>
                  <td className="py-1 px-2"><StepCell ok={r.style} /></td>
                  <td className="py-1 px-2"><StepCell ok={r.define} /></td>
                  <td className="py-1 px-2 text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-1.5 gap-0.5"
                      disabled={!!downloadingExcel || !!downloadingShp}
                      onClick={() => handleExcelDownload(r.lastSourcePath, r.tableName)}
                      title={
                        r.lastSourcePath
                          ? '원본 Excel 다운로드'
                          : `이력 경로 없음 — excel_data/${r.tableName}.xlsx 시도`
                      }
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span className="text-xs">Excel</span>
                    </Button>
                  </td>
                  <td className="py-1 px-2 text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-1.5 gap-0.5"
                      disabled={!r.table || !!downloadingExcel || !!downloadingShp}
                      onClick={() => handleShpDownload(r.tableName)}
                      title="DB 테이블을 EPSG:5181 SHP(zip)로 다운로드"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span className="text-xs">SHP</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {filtered.length > 0 && filtered.length !== rows.length && (
        <div className="shrink-0 text-xs text-muted-foreground px-1">
          {filtered.length}건 표시 (전체 {rows.length}건)
        </div>
      )}
    </div>
  );
}
