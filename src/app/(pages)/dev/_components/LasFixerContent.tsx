'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { call } from '@/lib/api';
import { FileUp, RefreshCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

type DirListResult = {
  directories: string[];
  files: { name: string; size: number; modified?: string }[];
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const LAS_FOLDER = '3dtiles_las';

export function LasFixerContent() {
  const [lasEntries, setLasEntries] = useState<Array<{ label: string; relativePath: string; fileName: string; size: number }>>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState<'4326' | '5181' | 'ecef' | null>(null);
  const [result, setResult] = useState<{ success: boolean; message?: string; outputRelativePath?: string; error?: string } | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    setResult(null);
    try {
      const res = await call('', 'POST', {
        service: 'fileManagerService',
        action: 'listDirectory',
        params: { relativePath: LAS_FOLDER },
      });
      const data = res?.data ?? res;
      const nextList = {
        directories: Array.isArray(data?.directories) ? data.directories : [],
        files: Array.isArray(data?.files) ? data.files : [],
      };
      const grouped = await Promise.all(
        nextList.directories.map(async (dirName: string) => {
          const child = await call('', 'POST', {
            service: 'fileManagerService',
            action: 'listDirectory',
            params: { relativePath: `${LAS_FOLDER}/${dirName}` },
          }).catch(() => ({ data: { files: [] } }));
          const files = ((child?.data ?? child) as DirListResult)?.files ?? [];
          return files
            .filter((f) => /\.las$/i.test(f.name))
            .map((f) => ({
              label: `${dirName}/${f.name}`,
              relativePath: `${LAS_FOLDER}/${dirName}/${f.name}`,
              fileName: f.name,
              size: f.size,
            }));
        })
      );
      setLasEntries(grouped.flat());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setListError(msg);
      setLasEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const handleFix = async (lasRelativePath: string, target: '4326' | '5181' | 'ecef') => {
    setFixing(target);
    setResult(null);
    const action = target === '4326' ? 'fixLasTo4326' : target === '5181' ? 'fixLasTo5181' : 'fixLasToEcef';
    try {
      const res = await call('', 'POST', {
        service: 'pipelineService',
        action,
        params: { lasRelativePath },
      });
      const data = res?.data ?? res;
      if (data?.success) {
        setResult({
          success: true,
          message: data.message,
          outputRelativePath: data.outputRelativePath,
        });
        fetchList();
      } else {
        setResult({
          success: false,
          error: data?.error ?? '변환 실패',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({ success: false, error: msg });
    } finally {
      setFixing(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        WKT 등 비표준 좌표계로 저장된 LAS를 EPSG:4326(WGS84), EPSG:5181(Korea 2000 / Unified), 또는 EPSG:4978(ECEF, 3D Tiles/Cesium용)으로 변환합니다. 같은 폴더에 <code className="bg-muted px-1 rounded">원본명_4326.las</code>, <code className="bg-muted px-1 rounded">원본명_5181.las</code>, <code className="bg-muted px-1 rounded">원본명_ecef.las</code> 로 저장됩니다.
      </p>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="rounded-none" onClick={fetchList} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
          목록 새로고침
        </Button>
      </div>

      {listError && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">{listError}</p>
      )}

      {result && (
        <div
          className={`text-sm px-3 py-2 rounded flex items-start gap-2 ${
            result.success ? 'bg-green-500/10 text-green-800 dark:text-green-200' : 'bg-destructive/10 text-destructive'
          }`}
        >
          {result.success ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
          <div>
            {result.success && result.message && <p>{result.message}</p>}
            {result.success && result.outputRelativePath && (
              <p className="font-mono text-xs mt-1">{result.outputRelativePath}</p>
            )}
            {!result.success && result.error && <p>{result.error}</p>}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">폴더 목록 로딩 중…</p>
      ) : lasEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{LAS_FOLDER}에 LAS 파일이 없습니다.</p>
      ) : (
        <div className="border rounded-md divide-y max-h-[60vh] overflow-auto">
          {lasEntries.map((f) => (
            <div
              key={f.relativePath}
              className="flex items-center justify-between gap-4 px-3 py-2 hover:bg-muted/50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileUp className="w-4 h-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{f.label}</span>
                <span className="text-xs text-muted-foreground shrink-0">{formatSize(f.size)}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="rounded-none"
                  disabled={fixing !== null}
                  onClick={() => handleFix(f.relativePath, '4326')}
                >
                  {fixing === '4326' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                  4326으로 변환
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-none"
                  disabled={fixing !== null}
                  onClick={() => handleFix(f.relativePath, '5181')}
                >
                  {fixing === '5181' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                  5181로 변환
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-none"
                  disabled={fixing !== null}
                  onClick={() => handleFix(f.relativePath, 'ecef')}
                >
                  {fixing === 'ecef' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                  ECEF로 변환
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
