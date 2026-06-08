'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { call } from '@/lib/api';

type Row = {
  uarKey: number;
  usrId: string;
  targetType: string;
  serEng: string | null;
  sysKey: string | null;
  requestedSerpType: number | null;
  requestReason?: string | null;
  state: string;
  createdAt: string;
};

async function permCall(action: string, params: Record<string, unknown> = {}) {
  const res = await call('', 'POST', { service: 'permissionService', action, params });
  if (!res?.success) throw new Error(res?.error ?? 'failed');
  return res.data;
}

export function AccessRequestQueue() {
  const [rows, setRows] = useState<Row[]>([]);
  const [rejectReason, setRejectReason] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const data = (await permCall('listPendingAccessRequests')) as Row[];
    setRows(data);
  }, []);

  useEffect(() => {
    load().catch((e) => setMsg(String(e.message)));
  }, [load]);

  async function approve(key: number) {
    try {
      await permCall('approveAccessRequest', { uarKey: key });
      await load();
      setMsg('승인됨');
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : '오류');
    }
  }

  async function reject(key: number) {
    try {
      await permCall('rejectAccessRequest', {
        uarKey: key,
        rejectReason: rejectReason[key] ?? null,
      });
      await load();
      setMsg('반려됨');
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : '오류');
    }
  }

  return (
    <div className="space-y-3 border rounded-lg p-3">
      <h3 className="font-medium">대기 중인 권한 신청</h3>
      {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
      <Button size="sm" variant="outline" onClick={() => load()}>
        새로고침
      </Button>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">신청자</th>
            <th className="p-2">유형</th>
            <th className="p-2">대상</th>
            <th className="p-2">신청사유</th>
            <th className="p-2">단계</th>
            <th className="p-2">일시</th>
            <th className="p-2">처리</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="p-4 text-muted-foreground">
                대기 건이 없습니다.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.uarKey} className="border-b border-border/50">
                <td className="p-2">{r.usrId}</td>
                <td className="p-2">{r.targetType}</td>
                <td className="p-2 font-mono text-xs">
                  {r.targetType === 'ser' ? r.serEng : `sys:${r.sysKey}`}
                </td>
                <td className="p-2 text-xs text-muted-foreground max-w-[200px] align-top">
                  {r.requestReason?.trim() ? (
                    <span className="line-clamp-3 whitespace-pre-wrap break-words">{r.requestReason}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="p-2">{r.requestedSerpType ?? '-'}</td>
                <td className="p-2 text-xs">{r.createdAt}</td>
                <td className="p-2 space-y-1">
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => approve(r.uarKey)}>
                      승인
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => reject(r.uarKey)}>
                      반려
                    </Button>
                  </div>
                  <Input
                    placeholder="반려 사유"
                    className="h-7 text-xs"
                    value={rejectReason[r.uarKey] ?? ''}
                    onChange={(e) =>
                      setRejectReason((prev) => ({ ...prev, [r.uarKey]: e.target.value }))
                    }
                  />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
