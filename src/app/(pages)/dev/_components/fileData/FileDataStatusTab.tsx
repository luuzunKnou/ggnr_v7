'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { call } from '@/lib/api';
import { RefreshCw, AlertTriangle } from 'lucide-react';

type Validation = {
  rootRelative: string;
  invalidTopLevel: Array<{ folderName: string; reason: string }>;
  invalidKeyFolders: Array<{ relativePath: string; tableName: string; keyFolder: string; reason: string }>;
  looseFilesUnderTable: Array<{ relativePath: string; fileName: string }>;
  tablesMissingKeyField: string[];
  tablesKeyQueryFailed: string[];
};

export function FileDataStatusTab() {
  const [data, setData] = useState<Validation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchValidation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'fileDataUploadService',
        action: 'validateFileDataTree',
        params: { relativePath: 'service_data/file_data' },
      });
      const d = res?.data ?? res;
      setData(d as Validation);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchValidation();
  }, [fetchValidation]);

  const hasIssues =
    (data?.invalidTopLevel.length ?? 0) > 0 ||
    (data?.invalidKeyFolders.length ?? 0) > 0 ||
    (data?.looseFilesUnderTable.length ?? 0) > 0 ||
    (data?.tablesMissingKeyField.length ?? 0) > 0 ||
    (data?.tablesKeyQueryFailed.length ?? 0) > 0;

  return (
    <div className="flex flex-col h-full min-h-0 p-2 gap-2">
      <div className="shrink-0 flex items-center gap-2">
        <span className="text-sm font-medium">file_data 검증</span>
        <span className="text-xs text-muted-foreground flex-1 truncate">{data?.rootRelative ?? 'service_data/file_data'}</span>
        <Button variant="outline" size="sm" onClick={() => void fetchValidation()} disabled={loading} className="gap-1">
          <RefreshCw className={loading ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} /> 새로고침
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground shrink-0">
        최상위 폴더는 defineLayer 테이블명과 일치해야 하며, 그 아래 폴더명은 해당 테이블의 키 필드(레이어 속성) 값과 일치해야 합니다.{' '}
        <code className="text-foreground">*.log</code> 파일은 업로드 로그용으로 검증에서 제외됩니다.
      </p>

      <div className="flex-1 min-h-0 overflow-auto border rounded">
        {loading && !data ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">검증 중…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-32 text-xs text-red-500 px-4">{error}</div>
        ) : !data ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">데이터 없음</div>
        ) : !hasIssues ? (
          <div className="flex flex-col items-center justify-center h-32 text-xs text-green-700 dark:text-green-400 gap-1 px-4 text-center">
            불일치 항목이 없습니다.
          </div>
        ) : (
          <div className="p-2 space-y-4 text-xs">
            {data.tablesMissingKeyField.length > 0 && (
              <section>
                <h3 className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1 mb-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> 키 필드 미설정 테이블
                </h3>
                <p className="text-muted-foreground mb-1">레이어 속성관리에서 define_field_is_key 를 지정하세요.</p>
                <ul className="list-disc pl-4 font-mono">{data.tablesMissingKeyField.map((t) => <li key={t}>{t}</li>)}</ul>
              </section>
            )}

            {data.tablesKeyQueryFailed.length > 0 && (
              <section>
                <h3 className="font-semibold text-orange-700 dark:text-orange-400 mb-1">키 값 DB 조회 실패</h3>
                <ul className="list-disc pl-4 font-mono">{data.tablesKeyQueryFailed.map((t) => <li key={t}>{t}</li>)}</ul>
              </section>
            )}

            {data.invalidTopLevel.length > 0 && (
              <section>
                <h3 className="font-semibold text-red-700 dark:text-red-400 mb-1">테이블명 불일치 (최상위 폴더)</h3>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-1 pr-2">폴더명</th>
                      <th className="py-1">사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.invalidTopLevel.map((r) => (
                      <tr key={r.folderName} className="border-t border-muted">
                        <td className="py-1 pr-2 font-mono whitespace-nowrap">{r.folderName}</td>
                        <td className="py-1">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {data.invalidKeyFolders.length > 0 && (
              <section>
                <h3 className="font-semibold text-red-700 dark:text-red-400 mb-1">키 값 불일치 (하위 폴더)</h3>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-1 pr-2">경로</th>
                      <th className="py-1 pr-2">테이블</th>
                      <th className="py-1 pr-2">키 폴더</th>
                      <th className="py-1">사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.invalidKeyFolders.map((r) => (
                      <tr key={r.relativePath} className="border-t border-muted">
                        <td className="py-1 pr-2 font-mono truncate max-w-[14rem]" title={r.relativePath}>
                          {r.relativePath}
                        </td>
                        <td className="py-1 pr-2 font-mono">{r.tableName}</td>
                        <td className="py-1 pr-2 font-mono">{r.keyFolder}</td>
                        <td className="py-1">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {data.looseFilesUnderTable.length > 0 && (
              <section>
                <h3 className="font-semibold text-amber-800 dark:text-amber-300 mb-1">테이블 폴더 바로 아래 파일 (위치 오류)</h3>
                <p className="text-muted-foreground mb-1">파일은 반드시 테이블/키/파일 구조여야 합니다.</p>
                <ul className="list-disc pl-4">
                  {data.looseFilesUnderTable.map((r) => (
                    <li key={`${r.relativePath}/${r.fileName}`} className="font-mono">
                      {r.relativePath}/{r.fileName}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
