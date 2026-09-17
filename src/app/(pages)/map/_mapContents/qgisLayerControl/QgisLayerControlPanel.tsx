'use client';

import { useCallback, useEffect, useMemo, useRef, useState, Fragment, type MouseEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { call } from '@/lib/api';
import { isSuperUser } from '@/lib/auth/superUser';
import { cn } from '@/lib/utils';
import { LayerRowPanelButton } from '@/app/(pages)/map/_mapComponents/layerRowEdit';
import { Switch } from '@/app/shadcnComponents/ui/switch';
import { resolveClientMachineIp, prefetchClientMachineIp } from '@/lib/clientMachineIp';

type UserKeyRow = {
  usrId: string;
  usrName: string | null;
  ugName: string | null;
  utName: string | null;
  qgisKey: string | null;
  controlId: number | null;
};

type LayerPermRow = {
  layerName: string;
  layerTitle: string;
  layerGroup?: string;
  canRead: boolean;
  canWrite: boolean;
};

/** 드론영상(ortho_tu_*)만 WMS, 나머지는 WFS */
function layerServiceKind(row: LayerPermRow): 'WFS' | 'WMS' {
  const group = String(row.layerGroup ?? '').trim();
  if (group === '드론영상' || /^ortho_tu_/i.test(row.layerName)) return 'WMS';
  return 'WFS';
}

function isLoopbackHostname(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.startsWith('127.');
}

/** QGIS에 넘길 주소 — localhost면 LAN IP로 바꿔 다른 PC에서도 접속 가능하게 */
async function resolveQgisShareOrigin(): Promise<string> {
  if (typeof window === 'undefined') return '';
  const { protocol, hostname, port } = window.location;
  if (!isLoopbackHostname(hostname)) return window.location.origin;
  const ip = await resolveClientMachineIp();
  if (!ip) return window.location.origin;
  const portPart = port ? `:${port}` : '';
  return `${protocol}//${ip}${portPart}`;
}

async function qgisCall<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await call('', 'POST', {
    service: 'qgisLayerControlService',
    action,
    params,
  });
  if (!res?.success) {
    const msg =
      (res && typeof res === 'object' && 'error' in res && String((res as { error?: string }).error)) ||
      '요청 실패';
    throw new Error(msg);
  }
  return res.data as T;
}

export function QgisLayerControlPanel({ onClose }: { onClose?: () => void }) {
  const { data: session } = useSession();
  const sessionId = session?.user?.id ?? null;
  const [users, setUsers] = useState<UserKeyRow[]>([]);
  const [selectedUsrId, setSelectedUsrId] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerPermRow[]>([]);
  const [userFilter, setUserFilter] = useState('');
  const [layerFilter, setLayerFilter] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingLayers, setLoadingLayers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  /** 접힌 레이어 카테고리 — 기본은 모두 접힘 */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  /** localhost 대신 LAN IP — 다른 PC QGIS 접속용 */
  const [shareOrigin, setShareOrigin] = useState('');

  const flashStatus = (label: string) => {
    if (statusTimerRef.current != null) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    setStatusHint(label);
    statusTimerRef.current = window.setTimeout(() => {
      setStatusHint(null);
      statusTimerRef.current = null;
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (statusTimerRef.current != null) window.clearTimeout(statusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    prefetchClientMachineIp();
    void resolveQgisShareOrigin().then(setShareOrigin);
  }, []);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    setError(null);
    try {
      const data = await qgisCall<UserKeyRow[]>('listAdminUsersWithKeys', {});
      setUsers(Array.isArray(data) ? data : []);
      setForbidden(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '사용자 목록 조회 실패';
      if (/관리자|403|Forbidden/i.test(msg)) setForbidden(true);
      else setError(msg);
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const loadLayers = useCallback(async (usrId: string, opts?: { collapseAll?: boolean }) => {
    setLoadingLayers(true);
    setError(null);
    try {
      const data = await qgisCall<{ layers: LayerPermRow[] }>('getUserLayerPermissions', {
        usrId,
      });
      const nextLayers = Array.isArray(data.layers) ? data.layers : [];
      setLayers(nextLayers);
      if (opts?.collapseAll !== false) {
        setCollapsedGroups(
          new Set(nextLayers.map((r) => String(r.layerGroup ?? '').trim() || '기타'))
        );
      }
    } catch (e) {
      setLayers([]);
      setError(e instanceof Error ? e.message : '레이어 권한 조회 실패');
    } finally {
      setLoadingLayers(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedUsrId) {
      setLayers([]);
      setCollapsedGroups(new Set());
      return;
    }
    void loadLayers(selectedUsrId, { collapseAll: true });
  }, [selectedUsrId, loadLayers]);

  const toggleGroupCollapsed = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const filteredUsers = useMemo(() => {
    const q = userFilter.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.usrId.toLowerCase().includes(q) ||
        String(u.usrName ?? '')
          .toLowerCase()
          .includes(q) ||
        String(u.ugName ?? '')
          .toLowerCase()
          .includes(q) ||
        String(u.qgisKey ?? '')
          .toLowerCase()
          .includes(q)
    );
  }, [users, userFilter]);

  const groups = useMemo(() => {
    const map = new Map<string, UserKeyRow[]>();
    for (const u of filteredUsers) {
      const g = String(u.ugName ?? '').trim() || '기타';
      const list = map.get(g) ?? [];
      list.push(u);
      map.set(g, list);
    }
    return [...map.entries()];
  }, [filteredUsers]);

  const filteredLayers = useMemo(() => {
    const q = layerFilter.trim().toLowerCase();
    if (!q) return layers;
    return layers.filter(
      (r) =>
        r.layerName.toLowerCase().includes(q) ||
        r.layerTitle.toLowerCase().includes(q) ||
        String(r.layerGroup ?? '')
          .toLowerCase()
          .includes(q)
    );
  }, [layers, layerFilter]);

  const layerGroups = useMemo(() => {
    const map = new Map<string, LayerPermRow[]>();
    for (const row of filteredLayers) {
      const g = String(row.layerGroup ?? '').trim() || '기타';
      const list = map.get(g) ?? [];
      list.push(row);
      map.set(g, list);
    }
    return [...map.entries()];
  }, [filteredLayers]);

  const selectedUser = useMemo(
    () => users.find((u) => u.usrId === selectedUsrId) ?? null,
    [users, selectedUsrId]
  );

  const connOrigin = shareOrigin || (typeof window !== 'undefined' ? window.location.origin : '');

  const wfsUrl = useMemo(() => {
    if (!selectedUser?.qgisKey || !connOrigin) return null;
    return `${connOrigin}/wfs.do?key=${encodeURIComponent(selectedUser.qgisKey)}`;
  }, [selectedUser, connOrigin]);

  const wmsUrl = useMemo(() => {
    if (!selectedUser?.qgisKey || !connOrigin) return null;
    return `${connOrigin}/wms.do?key=${encodeURIComponent(selectedUser.qgisKey)}`;
  }, [selectedUser, connOrigin]);

  const readOnCount = useMemo(() => layers.filter((r) => r.canRead).length, [layers]);
  const writeOnCount = useMemo(() => layers.filter((r) => r.canWrite).length, [layers]);

  const patchLayer = (layerName: string, next: Partial<LayerPermRow>) => {
    setLayers((prev) =>
      prev.map((row) => (row.layerName === layerName ? { ...row, ...next } : row))
    );
  };

  /** 카테고리(그룹) 단위로 읽기·수정 일괄 적용 */
  const patchGroup = (
    groupRows: LayerPermRow[],
    next: { canRead?: boolean; canWrite?: boolean }
  ) => {
    const names = new Set(groupRows.map((r) => r.layerName));
    setLayers((prev) =>
      prev.map((row) => {
        if (!names.has(row.layerName)) return row;
        let canRead = next.canRead !== undefined ? next.canRead : row.canRead;
        let canWrite = next.canWrite !== undefined ? next.canWrite : row.canWrite;
        if (next.canRead === false) canWrite = false;
        if (next.canWrite === true) canRead = true;
        return { ...row, canRead, canWrite };
      })
    );
  };

  const handleCopyKey = async (key: string, e?: MouseEvent) => {
    e?.stopPropagation();
    const k = String(key ?? '').trim();
    if (!k) return;
    try {
      await navigator.clipboard.writeText(k);
      flashStatus('키 복사됨');
    } catch {
      window.alert('복사에 실패했습니다.');
    }
  };

  const handleCopyWfsUrl = async () => {
    if (!wfsUrl) {
      window.alert('먼저 키를 발급하세요.');
      return;
    }
    try {
      await navigator.clipboard.writeText(wfsUrl);
      flashStatus('WFS 주소 복사됨');
    } catch {
      window.alert('복사에 실패했습니다.');
    }
  };

  const handleCopyWmsUrl = async () => {
    if (!wmsUrl) {
      window.alert('먼저 키를 발급하세요.');
      return;
    }
    try {
      await navigator.clipboard.writeText(wmsUrl);
      flashStatus('WMS 주소 복사됨');
    } catch {
      window.alert('복사에 실패했습니다.');
    }
  };

  const handleRegenerate = async (usrId: string) => {
    if (!confirm(`${usrId} 접속 키를 발급/재발급할까요?`)) return;
    try {
      await qgisCall('regenerateUserQgisKey', { usrId });
      await loadUsers();
      if (selectedUsrId === usrId) await loadLayers(usrId, { collapseAll: false });
      flashStatus('키 발급 완료');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '키 발급 실패');
    }
  };

  const handleDeleteKey = async (usrId: string) => {
    if (!confirm(`${usrId} 접속 키를 삭제할까요?`)) return;
    try {
      await qgisCall('deleteUserQgisKey', { usrId });
      await loadUsers();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '키 삭제 실패');
    }
  };

  const handleSave = async () => {
    if (!selectedUsrId) return;
    setSaving(true);
    try {
      await qgisCall('saveUserLayerPermissions', {
        usrId: selectedUsrId,
        layers: layers.map((r) => ({
          layerName: r.layerName,
          canRead: r.canRead,
          canWrite: r.canWrite,
        })),
      });
      await loadLayers(selectedUsrId, { collapseAll: false });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  if (forbidden) {
    return (
      <div className="standard-panel-root">
        <div className="standard-panel-header">
          <span className="standard-panel-title">레이어권한</span>
          {onClose ? (
            <button type="button" onClick={onClose} className="standard-panel-close" aria-label="닫기">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          관리자만 사용할 수 있습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="standard-panel-root relative">
      {statusHint ? (
        <div className="pointer-events-none absolute inset-0 z-[200] flex items-center justify-center px-3">
          <div
            className="pointer-events-none inline-block px-4 py-2 text-sm text-white shadow-md"
            style={{ backgroundColor: 'rgba(81, 145, 228, 0.88)', borderRadius: 3 }}
            role="status"
          >
            {statusHint}
          </div>
        </div>
      ) : null}
      <div className="standard-panel-header !px-4">
        <div className="flex min-w-0 items-center gap-2">
          <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <span className="standard-panel-title">레이어권한</span>
            <p className="mt-0.5 text-[11px] leading-none text-muted-foreground">
              사용자 {users.length}명
            </p>
          </div>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} className="standard-panel-close" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* 좌: 사용자 리스트 */}
        <section className="flex w-[480px] shrink-0 flex-col border-r border-border bg-background">
          <div className="shrink-0 space-y-3 px-2 py-2">
            <div className="space-y-2.5 rounded-md border border-border bg-background px-2.5 py-2.5">
              <div className="space-y-1">
                <p className="text-[12px] font-semibold text-foreground">QGIS 접속 주소</p>
                <p className="truncate text-[11px] leading-relaxed text-muted-foreground">
                  QGIS에서 레이어를 연결할 때 사용합니다. 키가 없으면 왼쪽 목록에서 먼저 발급하세요.
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-foreground">WFS</span>
                  <button
                    type="button"
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    disabled={!wfsUrl}
                    title="WFS 주소 복사"
                    onClick={() => void handleCopyWfsUrl()}
                  >
                    <Copy className="h-3 w-3" />
                    복사
                  </button>
                </div>
                <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2">
                  <p className="break-all font-mono text-[11px] leading-relaxed text-foreground/90">
                    {wfsUrl ?? `${connOrigin || ''}/wfs.do?key=(키 발급 필요)`}
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-foreground">WMS</span>
                  <button
                    type="button"
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    disabled={!wmsUrl}
                    title="WMS 주소 복사"
                    onClick={() => void handleCopyWmsUrl()}
                  >
                    <Copy className="h-3 w-3" />
                    복사
                  </button>
                </div>
                <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2">
                  <p className="break-all font-mono text-[11px] leading-relaxed text-foreground/90">
                    {wmsUrl ?? `${connOrigin || ''}/wms.do?key=(키 발급 필요)`}
                  </p>
                </div>
              </div>
            </div>

            <div className="standard-search-wrap">
              <Search className="standard-search-icon" />
              <input
                type="search"
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                placeholder="아이디·이름·키 검색"
                className="h-8 w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground outline-none ring-0 placeholder:text-muted-foreground focus:border-border focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
              />
            </div>
          </div>

          <div className="standard-list-body border-t border-border">
            <div className="standard-list-scroll">
              {loadingUsers ? (
                <p className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</p>
              ) : filteredUsers.length === 0 ? (
                <p className="py-10 text-center text-xs text-muted-foreground">사용자가 없습니다.</p>
              ) : (
                <table className="standard-list-table">
                  <colgroup>
                    <col className="w-[18%]" />
                    <col className="w-[14%]" />
                    <col />
                    <col className="w-12" />
                    <col className="w-12" />
                  </colgroup>
                  <thead className="standard-table-thead">
                    <tr>
                      <th className="standard-table-th standard-table-th-left">아이디</th>
                      <th className="standard-table-th standard-table-th-left">이름</th>
                      <th className="standard-table-th standard-table-th-left">KEY</th>
                      <th className="standard-table-th standard-table-th-center">재발급</th>
                      <th className="standard-table-th standard-table-th-center">키삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(([group, rows]) => (
                      <Fragment key={group}>
                        <tr className="bg-muted/60">
                          <td
                            colSpan={5}
                            className="border-b border-border/80 px-1.5 py-1.5 text-[11px] font-semibold text-foreground/80"
                          >
                            {group}
                            <span className="ml-1 font-normal text-muted-foreground">
                              ({rows.length})
                            </span>
                          </td>
                        </tr>
                        {rows.map((u) => {
                          const selected = selectedUsrId === u.usrId;
                          return (
                            <tr
                              key={u.usrId}
                              className={cn(
                                'cursor-pointer border-b border-border/60 transition-colors',
                                selected
                                  ? 'bg-primary/[0.08] hover:bg-primary/[0.12]'
                                  : 'bg-background hover:bg-muted/40'
                              )}
                              onClick={() => setSelectedUsrId(u.usrId)}
                            >
                              <td
                                className="standard-table-td-text px-1.5 font-medium text-foreground"
                                title={u.usrId}
                              >
                                {u.usrId}
                              </td>
                              <td
                                className="standard-table-td-text px-1.5 text-muted-foreground"
                                title={u.usrName ?? ''}
                              >
                                {u.usrName || '—'}
                              </td>
                              <td className="px-1.5 py-1.5 align-middle">
                                {u.qgisKey ? (
                                  <button
                                    type="button"
                                    className="inline-flex max-w-full items-center gap-1 truncate font-mono text-[10px] text-primary hover:underline"
                                    title={`${u.qgisKey} — 클릭하여 복사`}
                                    onClick={(e) => void handleCopyKey(u.qgisKey!, e)}
                                  >
                                    <Copy className="h-3 w-3 shrink-0 text-primary" />
                                    <span className="truncate">{u.qgisKey}</span>
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                    <KeyRound className="h-3 w-3 shrink-0 text-muted-foreground/45" />
                                    미발급
                                  </span>
                                )}
                              </td>
                              <td className="px-0.5 py-1.5 text-center align-middle">
                                <button
                                  type="button"
                                  className="inline-flex rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                  title="키 발급/재발급"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleRegenerate(u.usrId);
                                  }}
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                </button>
                              </td>
                              <td className="px-0.5 py-1.5 text-center align-middle">
                                <button
                                  type="button"
                                  className="inline-flex rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                                  title="키 삭제"
                                  disabled={!u.qgisKey}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleDeleteKey(u.usrId);
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="standard-list-footer">{filteredUsers.length}명</div>
          </div>
        </section>

        {/* 우: 레이어 권한 테이블 */}
        <section className="flex min-w-0 flex-1 flex-col bg-background">
          <div className="standard-filter-section !px-2">
            <div className="min-w-0">
              {selectedUser ? (
                <p className="truncate text-xs">
                  <span className="font-semibold text-foreground">{selectedUser.usrId}</span>
                  {selectedUser.usrName ? (
                    <span className="text-muted-foreground"> · {selectedUser.usrName}</span>
                  ) : null}
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    읽기 {readOnCount} · 수정 {writeOnCount}
                  </span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">왼쪽에서 사용자를 선택하세요</p>
              )}
            </div>

            <div className="standard-search-wrap">
              <Search className="standard-search-icon" />
              <input
                type="search"
                value={layerFilter}
                onChange={(e) => setLayerFilter(e.target.value)}
                placeholder="레이어 검색"
                disabled={!selectedUsrId}
                className="h-8 w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground outline-none ring-0 placeholder:text-muted-foreground focus:border-border focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>

          <div className="standard-list-body">
            <div className="standard-list-scroll">
              {!selectedUsrId ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                  <KeyRound className="h-8 w-8 text-muted-foreground/25" />
                  <p className="text-xs text-muted-foreground">
                    사용자를 선택하면 레이어 권한을 설정합니다.
                  </p>
                </div>
              ) : loadingLayers ? (
                <p className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</p>
              ) : (
                <table className="standard-list-table">
                  <colgroup>
                    <col />
                    <col style={{ width: 380 }} />
                    <col style={{ width: 380 }} />
                    <col style={{ width: 60 }} />
                    <col style={{ width: 60 }} />
                  </colgroup>
                  <thead className="standard-table-thead">
                    <tr>
                      <th className="standard-table-th standard-table-th-left !text-[12px]">
                        한글명
                      </th>
                      <th className="standard-table-th standard-table-th-left !text-[12px]">
                        영문명
                      </th>
                      <th className="standard-table-th standard-table-th-left !text-[12px]">
                        WFS/WMS
                      </th>
                      <th className="standard-table-th standard-table-th-center !text-[12px]">
                        읽기
                      </th>
                      <th className="standard-table-th standard-table-th-center !text-[12px]">
                        수정
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLayers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="standard-table-empty !px-1.5">
                          표시할 레이어가 없습니다.
                        </td>
                      </tr>
                    ) : (
                      layerGroups.map(([group, rows]) => {
                        const groupReadAll = rows.length > 0 && rows.every((r) => r.canRead);
                        const groupWriteAll = rows.length > 0 && rows.every((r) => r.canWrite);
                        const groupReadSome = rows.some((r) => r.canRead);
                        const searching = Boolean(layerFilter.trim());
                        const expanded = searching || !collapsedGroups.has(group);
                        return (
                          <Fragment key={group}>
                            <tr className="bg-muted/60">
                              <td
                                colSpan={3}
                                className="border-b border-border/80 px-1.5 py-1.5 text-[12px] font-semibold text-foreground"
                              >
                                <button
                                  type="button"
                                  className="inline-flex max-w-full items-center gap-1 rounded px-0.5 text-left text-[12px] hover:bg-muted"
                                  onClick={() => toggleGroupCollapsed(group)}
                                  title={expanded ? '접기' : '펼치기'}
                                  aria-expanded={expanded}
                                >
                                  {expanded ? (
                                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  )}
                                  <span className="truncate">{group}</span>
                                  <span className="shrink-0 font-normal text-muted-foreground">
                                    ({rows.length})
                                  </span>
                                  <span className="ml-1 shrink-0 font-normal text-[10px] text-muted-foreground">
                                    그룹 일괄
                                  </span>
                                </button>
                              </td>
                              <td className="border-b border-border/80 px-1.5 py-1.5 text-center align-middle">
                                <div
                                  className="flex justify-center"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Switch
                                    checked={groupReadAll}
                                    className={cn(
                                      'focus-visible:ring-0',
                                      groupReadSome && !groupReadAll ? 'opacity-70' : undefined
                                    )}
                                    onCheckedChange={(v) => patchGroup(rows, { canRead: v })}
                                    aria-label={`${group} 읽기 일괄`}
                                    title={
                                      groupReadAll
                                        ? '그룹 읽기 모두 끄기'
                                        : '그룹 읽기 모두 켜기'
                                    }
                                  />
                                </div>
                              </td>
                              <td className="border-b border-border/80 px-1.5 py-1.5 text-center align-middle">
                                <div
                                  className="flex justify-center"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Switch
                                    checked={groupWriteAll}
                                    className={cn(
                                      'focus-visible:ring-0',
                                      rows.some((r) => r.canWrite) && !groupWriteAll
                                        ? 'opacity-70'
                                        : undefined
                                    )}
                                    onCheckedChange={(v) => patchGroup(rows, { canWrite: v })}
                                    aria-label={`${group} 수정 일괄`}
                                    title={
                                      groupWriteAll
                                        ? '그룹 수정 모두 끄기'
                                        : '그룹 수정 모두 켜기(읽기도 함께)'
                                    }
                                  />
                                </div>
                              </td>
                            </tr>
                            {expanded
                              ? rows.map((row) => {
                                  const serviceKind = layerServiceKind(row);
                                  return (
                                    <tr
                                      key={row.layerName}
                                      className="border-b border-border/60 bg-muted/15 hover:bg-muted/35"
                                    >
                                      <td
                                        className="standard-table-td-text px-1.5 pl-6 text-foreground"
                                        title={row.layerTitle}
                                      >
                                        <span className="truncate">{row.layerTitle}</span>
                                      </td>
                                      <td
                                        className="standard-table-td-compact px-1.5 font-mono text-[12px] text-muted-foreground"
                                        title={row.layerName}
                                      >
                                        {row.layerName}
                                      </td>
                                      <td className="px-1.5 py-2.5 align-middle">
                                        <span
                                          className={cn(
                                            'inline-flex min-w-[2.75rem] justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
                                            serviceKind === 'WMS'
                                              ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                                              : 'bg-sky-500/15 text-sky-800 dark:text-sky-300'
                                          )}
                                        >
                                          {serviceKind}
                                        </span>
                                      </td>
                                      <td className="px-1.5 py-2.5 text-center align-middle">
                                        <div className="flex justify-center">
                                          <Switch
                                            checked={row.canRead}
                                            className="focus-visible:ring-0"
                                            onCheckedChange={(v) =>
                                              patchLayer(row.layerName, {
                                                canRead: v,
                                                canWrite: v ? row.canWrite : false,
                                              })
                                            }
                                            aria-label={`${row.layerName} 읽기`}
                                          />
                                        </div>
                                      </td>
                                      <td className="px-1.5 py-2.5 text-center align-middle">
                                        <div className="flex justify-center">
                                          <Switch
                                            checked={row.canWrite}
                                            disabled={!row.canRead}
                                            className="focus-visible:ring-0"
                                            onCheckedChange={(v) =>
                                              patchLayer(row.layerName, {
                                                canWrite: v,
                                                canRead: v ? true : row.canRead,
                                              })
                                            }
                                            aria-label={`${row.layerName} 수정`}
                                          />
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })
                              : null}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border bg-background px-2 py-2.5">
              <LayerRowPanelButton
                type="button"
                disabled={!selectedUsrId || loadingLayers}
                loading={saving}
                onClick={() => void handleSave()}
              >
                {saving ? '저장 중…' : '저장'}
              </LayerRowPanelButton>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
