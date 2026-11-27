'use client';

/**
 * KRAS 개인정보 원문 열람 — 사용자별 허용·회수 (부서 필터·다중 선택)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Switch } from '@/app/shadcnComponents/ui/switch';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { USER_MANAGER_UI_STYLE, USER_MGMT_HISTORY_TABLE } from './userManagerUiVariants';

type PermRow = {
  usrId: string;
  usrName: string | null;
  ugName: string | null;
  allowed: boolean;
  kppAt: string | null;
  kppBy: string | null;
};

const uiStyle = USER_MANAGER_UI_STYLE;
const historyTable = USER_MGMT_HISTORY_TABLE;
const PAGE_SIZE = 19;

function cell(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  return s || '—';
}

function isSuId(usrId: string): boolean {
  return usrId.trim().toLowerCase() === 'su';
}

export function KrasPiiPermissionPanel() {
  const [ugName, setUgName] = useState('');
  const [departments, setDepartments] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PermRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const selectableIds = useMemo(
    () => rows.map((r) => r.usrId).filter((id) => !isSuId(id)),
    [rows]
  );
  const selectedCount = selected.size;
  const allPageSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const load = useCallback(async (pageNum: number, dept?: string) => {
    const nextDept = dept ?? ugName;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setHint(null);
    setSelected(new Set());
    try {
      const res = await call('', 'POST', {
        service: 'krasPiiPermissionService',
        action: 'listKrasPiiPermissions',
        params: {
          ugName: nextDept.trim() || undefined,
          page: pageNum,
          pageSize: PAGE_SIZE,
        },
      });
      if (!res?.success) throw new Error(res?.error ?? '목록 조회 실패');
      const raw = (res.data ?? {}) as Record<string, unknown>;
      const nested =
        raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : null;
      const data = (
        Array.isArray(raw.rows) ? raw : nested && Array.isArray(nested.rows) ? nested : raw
      ) as {
        rows?: PermRow[];
        departments?: string[];
        total?: number;
        totalPages?: number;
        page?: number;
        message?: string;
      };
      setRows(Array.isArray(data.rows) ? data.rows : []);
      if (Array.isArray(data.departments)) setDepartments(data.departments.filter(Boolean));
      setTotal(Number(data.total ?? 0));
      setTotalPages(Math.max(1, Number(data.totalPages ?? 1)));
      setPage(Number(data.page ?? pageNum));
      if (data.message) setHint(String(data.message));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '목록 조회 실패');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [ugName]);

  useEffect(() => {
    void load(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 최초 1회

  const toggleOne = (usrId: string, checked: boolean) => {
    if (isSuId(usrId)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(usrId);
      else next.delete(usrId);
      return next;
    });
  };

  const togglePage = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of selectableIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const selectAllFiltered = async () => {
    if (loading || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'krasPiiPermissionService',
        action: 'listKrasPiiSelectableIds',
        params: { ugName: ugName.trim() || undefined },
      });
      if (!res?.success) throw new Error(res?.error ?? '전체 선택 실패');
      const raw = (res.data ?? {}) as Record<string, unknown>;
      const nested =
        raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : null;
      const data = (Array.isArray(raw.usrIds) ? raw : nested && Array.isArray(nested.usrIds) ? nested : raw) as {
        usrIds?: string[];
      };
      const ids = (Array.isArray(data.usrIds) ? data.usrIds : [])
        .map((id) => String(id ?? '').trim())
        .filter((id) => id && !isSuId(id));
      setSelected(new Set(ids));
      if (!ids.length) setHint('선택할 사용자가 없습니다.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '전체 선택 실패');
    } finally {
      setSaving(false);
    }
  };

  const clearSelection = () => {
    setSelected(new Set());
  };

  const applyBulk = async (allowed: boolean) => {
    const usrIds = [...selected];
    if (!usrIds.length || saving) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await call('', 'POST', {
        service: 'krasPiiPermissionService',
        action: 'setKrasPiiAllowedBulk',
        params: { usrIds, allowed },
      });
      if (!res?.success) throw new Error(res?.error ?? '일괄 적용 실패');
      const idSet = new Set(usrIds);
      setRows((prev) => prev.map((r) => (idSet.has(r.usrId) ? { ...r, allowed } : r)));
      setSelected(new Set());
      setSuccessMsg(
        allowed
          ? `선택한 ${usrIds.length}명을 원문 허용으로 변경했습니다.`
          : `선택한 ${usrIds.length}명을 마스킹으로 변경했습니다.`
      );
    } catch (e: unknown) {
      setSuccessMsg(null);
      setError(e instanceof Error ? e.message : '일괄 적용 실패');
    } finally {
      setSaving(false);
    }
  };

  const setAllowed = async (usrId: string, allowed: boolean) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await call('', 'POST', {
        service: 'krasPiiPermissionService',
        action: 'setKrasPiiAllowed',
        params: { usrId, allowed },
      });
      if (!res?.success) throw new Error(res?.error ?? '저장 실패');
      setRows((prev) => prev.map((r) => (r.usrId === usrId ? { ...r, allowed } : r)));
      setSelected((prev) => {
        if (!prev.has(usrId)) return prev;
        const next = new Set(prev);
        next.delete(usrId);
        return next;
      });
      setSuccessMsg(allowed ? '원문 허용으로 변경되었습니다.' : '마스킹으로 변경되었습니다.');
    } catch (e: unknown) {
      setSuccessMsg(null);
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn(uiStyle.page, 'gap-2')}>
      <div className={cn(uiStyle.toolbar, 'flex-wrap')}>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">부서</span>
          <select
            className="h-8 min-w-[12rem] rounded-none border border-input bg-background px-2 text-xs text-foreground"
            value={ugName}
            disabled={loading || saving}
            title="부서 필터"
            onChange={(e) => {
              const next = e.target.value;
              setUgName(next);
              void load(1, next);
            }}
          >
            <option value="">전체</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn('h-8 rounded-none px-2 text-[11px]', uiStyle.secondaryButton)}
            disabled={loading || saving || total <= 0}
            title={ugName.trim() ? `「${ugName.trim()}」 부서 전체` : '필터 전체(모든 부서)'}
            onClick={() => void selectAllFiltered()}
          >
            전체 선택
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn('h-8 rounded-none px-2 text-[11px]', uiStyle.secondaryButton)}
            disabled={loading || saving || selectedCount === 0}
            onClick={clearSelection}
          >
            선택 해제
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn('h-8 rounded-none px-2 text-[11px]', uiStyle.secondaryButton)}
            disabled={loading || saving || selectedCount === 0}
            onClick={() => void applyBulk(true)}
          >
            선택 원문 허용{selectedCount ? ` (${selectedCount})` : ''}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn('h-8 rounded-none px-2 text-[11px]', uiStyle.secondaryButton)}
            disabled={loading || saving || selectedCount === 0}
            onClick={() => void applyBulk(false)}
          >
            선택 마스킹{selectedCount ? ` (${selectedCount})` : ''}
          </Button>
          {successMsg ? (
            <span className="text-xs text-green-600 dark:text-green-400">{successMsg}</span>
          ) : null}
          {hint ? (
            <span className="max-w-[24rem] truncate text-xs text-muted-foreground" title={hint}>
              {hint}
            </span>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="whitespace-nowrap text-xs text-muted-foreground">총 {total}명</span>
          {error ? (
            <span className="max-w-[18rem] truncate text-xs text-destructive" title={error}>
              {error}
            </span>
          ) : null}
        </div>
      </div>

      <div className={cn(uiStyle.tableWrap, 'flex-none')}>
        <div className="overflow-x-auto">
          <table className={cn(uiStyle.table, 'min-w-full table-fixed')}>
            <thead
              className={cn(
                historyTable.tableHead,
                'h-[27px] [&_th]:h-[27px] [&_th]:max-h-[27px]'
              )}
            >
              <tr>
                <th className={cn('w-10 text-center', historyTable.tableCell)}>
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-foreground"
                    checked={allPageSelected}
                    disabled={loading || saving || selectableIds.length === 0}
                    onChange={(e) => togglePage(e.target.checked)}
                    title="이 페이지 전체"
                    aria-label="이 페이지 전체"
                  />
                </th>
                <th className={cn('w-36 text-left', historyTable.tableCell)}>사용자 ID</th>
                <th className={cn('w-28 text-left', historyTable.tableCell)}>이름</th>
                <th className={cn('w-36 text-left', historyTable.tableCell)}>부서</th>
                <th className={cn('w-36 text-left', historyTable.tableCell)}>열람 권한</th>
              </tr>
            </thead>
            <tbody>
              {!rows.length ? (
                <tr className={historyTable.tableRow}>
                  <td className={cn('text-muted-foreground', historyTable.tableCell)} colSpan={5}>
                    {loading ? '불러오는 중…' : '사용자가 없습니다.'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const su = isSuId(r.usrId);
                  const checked = selected.has(r.usrId);
                  return (
                    <tr key={r.usrId} className={historyTable.tableRow}>
                      <td className={cn('text-center', historyTable.tableCell)}>
                        {su ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-foreground"
                            checked={checked}
                            disabled={loading || saving}
                            onChange={(e) => toggleOne(r.usrId, e.target.checked)}
                            aria-label={`${r.usrId} 선택`}
                          />
                        )}
                      </td>
                      <td
                        className={cn('truncate font-mono text-xs', historyTable.tableCell)}
                        title={r.usrId}
                      >
                        {r.usrId}
                      </td>
                      <td className={cn('truncate', historyTable.tableCell)} title={r.usrName ?? undefined}>
                        {cell(r.usrName)}
                      </td>
                      <td className={cn('truncate', historyTable.tableCell)} title={r.ugName ?? undefined}>
                        {cell(r.ugName)}
                      </td>
                      <td className={cn('whitespace-nowrap', historyTable.tableCell)}>
                        {su ? (
                          <span className="text-xs text-muted-foreground">변경 불가</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={r.allowed}
                              disabled={saving || loading}
                              onCheckedChange={(next) => void setAllowed(r.usrId, next)}
                              aria-label={`${r.usrId} 열람 권한`}
                              title={r.allowed ? '원문 허용' : '마스킹'}
                              className={r.allowed ? 'bg-sky-400' : 'bg-rose-300'}
                            />
                            <span
                              className={cn(
                                'text-xs font-medium',
                                r.allowed ? 'text-sky-800' : 'text-rose-800'
                              )}
                            >
                              {r.allowed ? '원문 허용' : '마스킹'}
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-auto flex shrink-0 items-center justify-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn('rounded-none', uiStyle.secondaryButton)}
          disabled={loading || saving || page <= 1}
          onClick={() => void load(page - 1)}
        >
          이전
        </Button>
        <span className="text-xs text-muted-foreground">
          {page} / {totalPages}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn('rounded-none', uiStyle.secondaryButton)}
          disabled={loading || saving || page >= totalPages}
          onClick={() => void load(page + 1)}
        >
          다음
        </Button>
      </div>
    </div>
  );
}
