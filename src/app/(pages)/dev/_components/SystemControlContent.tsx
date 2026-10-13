'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Switch } from '@/app/shadcnComponents/ui/switch';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { USER_MANAGER_UI_STYLE, USER_MGMT_HISTORY_TABLE } from './userManagerUiVariants';

type Item = {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
};

async function controlCall<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await call('', 'POST', { service: 'systemControlService', action, params });
  if (!res?.success) throw new Error(res?.error ?? 'failed');
  return res.data as T;
}

/** 시스템 관리 «시스템 통합제어» — su 전용 항목별 on/off */
export function SystemControlContent() {
  const ui = USER_MANAGER_UI_STYLE;
  const table = USER_MGMT_HISTORY_TABLE;
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await controlCall<{ items: Item[] }>('listSystemControls');
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (item: Item, enabled: boolean) => {
    setBusyName(item.name);
    setError(null);
    setMsg(null);
    setItems((prev) => prev.map((r) => (r.name === item.name ? { ...r, enabled } : r)));
    try {
      await controlCall('updateSystemControl', { name: item.name, enabled });
      setMsg(`${item.label}: ${enabled ? '사용' : '미사용'}으로 저장했습니다.`);
    } catch (e: unknown) {
      setItems((prev) =>
        prev.map((r) => (r.name === item.name ? { ...r, enabled: item.enabled } : r))
      );
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setBusyName(null);
    }
  };

  return (
    <div className={ui.page}>
      <div className={ui.toolbar}>
        {error ? (
          <p className="min-w-0 max-w-[420px] shrink truncate text-sm text-red-600" title={error}>
            {error}
          </p>
        ) : msg ? (
          <p className="min-w-0 max-w-[420px] shrink truncate text-sm text-emerald-600" title={msg}>
            {msg}
          </p>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn('ml-auto shrink-0 gap-1 rounded-none', ui.secondaryButton)}
          onClick={() => void load()}
          disabled={loading}
          title="새로고침"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          새로고침
        </Button>
      </div>

      <div className={ui.tableWrap}>
        <div className={ui.tableScroll}>
          <table className={cn(ui.table, 'table-fixed')}>
            <thead className={cn('sticky top-0', table.tableHead)}>
              <tr>
                <th className={cn('w-48 text-left', table.tableCell)}>항목</th>
                <th className={cn('text-left', table.tableCell)}>설명</th>
                <th className={cn('w-24 text-center', table.tableCell)}>사용</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr className={table.tableRow}>
                  <td className={cn('text-muted-foreground', table.tableCell)} colSpan={3}>
                    불러오는 중…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr className={table.tableRow}>
                  <td className={cn('text-muted-foreground', table.tableCell)} colSpan={3}>
                    통합제어 항목이 없습니다.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.name} className={table.tableRow}>
                    <td className={cn('truncate', table.tableCell)} title={item.name}>
                      {item.label}
                    </td>
                    <td className={cn('truncate text-muted-foreground', table.tableCell)} title={item.description}>
                      {item.description}
                    </td>
                    <td className={cn('text-center', table.tableCell)}>
                      <div className="flex items-center justify-center">
                        <Switch
                          checked={item.enabled}
                          disabled={busyName === item.name}
                          onCheckedChange={(v) => void toggle(item, v)}
                          aria-label={`${item.label} 사용`}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
