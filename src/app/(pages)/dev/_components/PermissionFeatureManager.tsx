'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/shadcnComponents/ui/dialog';
import { cn } from '@/lib/utils';
import { Check, FileText, IdCard, Layers, PanelRight, Plus, Search, Server, Shield, X } from 'lucide-react';
import { permCall } from './perm/permApi';
import { PermRoleMappingPanel } from './perm/PermRoleMappingPanel';

type Perm = { permKey: number; permName: string | null; permEtc: string | null };
type PermDetailUserRow = { usrId: string; utName: string; usrName: string | null };

const PERM_TABS = [
  { id: 'ser' as const, label: '기능별 권한관리', icon: Layers },
  { id: 'sys' as const, label: '시스템별 접속권한 관리', icon: Server },
];

/** 레이어 속성관리(`LayerAttrManager`) 왼쪽 목록과 동일 폭 */
const PERM_LIST_WIDTH = 280;

export function PermissionFeatureManager() {
  const [tab, setTab] = useState<'ser' | 'sys'>('ser');
  const [perms, setPerms] = useState<Perm[]>([]);
  const [selPerm, setSelPerm] = useState<number | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  /** 상세 다이얼로그가 편집 중인 권한 키 (목록 선택과 별도로 유지) */
  const [detailModalPermKey, setDetailModalPermKey] = useState<number | null>(null);
  const [addName, setAddName] = useState('');
  const [addEtc, setAddEtc] = useState('');
  const [detailName, setDetailName] = useState('');
  const [detailEtc, setDetailEtc] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [permDetailUsers, setPermDetailUsers] = useState<PermDetailUserRow[]>([]);
  const [permDetailUsersLoading, setPermDetailUsersLoading] = useState(false);
  const [permDetailUserRemoving, setPermDetailUserRemoving] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [permListSearch, setPermListSearch] = useState('');

  const filteredPerms = useMemo(() => {
    const q = permListSearch.trim().toLowerCase();
    if (!q) return perms;
    return perms.filter((p) => {
      const name = (p.permName ?? '').toLowerCase();
      const etc = (p.permEtc ?? '').toLowerCase();
      const key = String(p.permKey);
      return name.includes(q) || etc.includes(q) || key.includes(q);
    });
  }, [perms, permListSearch]);

  const loadPerms = useCallback(async () => {
    const rows = (await permCall('listPerms')) as Perm[];
    setPerms(rows);
    setSelPerm((prev) => {
      if (prev == null) return null;
      return rows.some((r) => r.permKey === prev) ? prev : null;
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    loadPerms()
      .catch((e) => setMsg(String(e.message)))
      .finally(() => setLoading(false));
  }, [loadPerms]);

  useEffect(() => {
    if (!detailModalOpen || detailModalPermKey == null) {
      setPermDetailUsers([]);
      setPermDetailUserRemoving(null);
      return;
    }
    let cancelled = false;
    setPermDetailUsersLoading(true);
    permCall('listUsersForPerm', { permKey: detailModalPermKey })
      .then((rows) => {
        if (!cancelled) setPermDetailUsers(Array.isArray(rows) ? (rows as PermDetailUserRow[]) : []);
      })
      .catch(() => {
        if (!cancelled) setPermDetailUsers([]);
      })
      .finally(() => {
        if (!cancelled) setPermDetailUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailModalOpen, detailModalPermKey]);

  async function submitAddPerm() {
    setModalError(null);
    setAddSaving(true);
    try {
      const row = (await permCall('createPerm', {
        permName: addName.trim() || '권한',
        permEtc: addEtc.trim() ? addEtc.trim() : null,
      })) as Perm;
      setAddName('');
      setAddEtc('');
      setAddModalOpen(false);
      await loadPerms();
      setSelPerm(row.permKey);
      setMsg('권한이 추가되었습니다.');
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : '오류');
    } finally {
      setAddSaving(false);
    }
  }

  async function removePerm(key: number) {
    if (!confirm('이 권한과 연결된 매핑이 삭제될 수 있습니다. 계속할까요?')) return;
    setModalError(null);
    setDeleteSaving(true);
    try {
      await permCall('deletePerm', { permKey: key });
      setSelPerm((prev) => (prev === key ? null : prev));
      setDetailModalOpen(false);
      setDetailModalPermKey(null);
      await loadPerms();
      setMsg('삭제되었습니다.');
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : '오류';
      setModalError(m);
      setMsg(m);
    } finally {
      setDeleteSaving(false);
    }
  }

  function openPermDetail(p: Perm) {
    setAddModalOpen(false);
    setSelPerm(p.permKey);
    setDetailModalPermKey(p.permKey);
    setDetailName(p.permName ?? '');
    setDetailEtc(p.permEtc ?? '');
    setModalError(null);
    setDetailModalOpen(true);
  }

  async function submitDetailSave() {
    if (detailModalPermKey == null) return;
    setModalError(null);
    setDetailSaving(true);
    try {
      await permCall('updatePerm', {
        permKey: detailModalPermKey,
        permName: detailName.trim() || '권한',
        permEtc: detailEtc.trim() ? detailEtc.trim() : null,
      });
      await loadPerms();
      setMsg('저장되었습니다.');
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : '오류');
    } finally {
      setDetailSaving(false);
    }
  }

  async function removePermFromUser(usrId: string) {
    if (detailModalPermKey == null) return;
    if (!window.confirm('이 사용자에서 해당 권한을 제거할까요?')) return;
    setModalError(null);
    setPermDetailUserRemoving(usrId);
    try {
      await permCall('removeUserFromPerm', { permKey: detailModalPermKey, usr_id: usrId });
      setPermDetailUsers((prev) => prev.filter((u) => u.usrId !== usrId));
      setMsg('사용자에서 권한을 제거했습니다.');
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : '오류');
    } finally {
      setPermDetailUserRemoving(null);
    }
  }

  const detailPerm = selPerm != null ? perms.find((p) => p.permKey === selPerm) ?? null : null;
  const detailModalPerm =
    detailModalPermKey != null ? perms.find((p) => p.permKey === detailModalPermKey) ?? null : null;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="shrink-0 flex border-b bg-muted/30">
        {PERM_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                tab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
              onClick={() => setTab(t.id)}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>
      {msg ? (
        <p className="shrink-0 px-3 py-2 text-sm text-muted-foreground border-b border-border/60 bg-muted/20">
          {msg}
        </p>
      ) : null}

      <div
        className="flex gap-4 min-h-0 flex-1 overflow-hidden max-h-[calc(100vh-15.5rem)] pt-2"
        style={{ minHeight: '44vh' }}
      >
        {/* 왼쪽: 권한 목록 — LayerAttrManager 레이어 목록과 동일 톤 */}
        <div
          className="shrink-0 flex flex-col border rounded-none bg-muted/20 overflow-hidden max-h-[calc(100vh-15.5rem)]"
          style={{ width: PERM_LIST_WIDTH }}
        >
          <div className="shrink-0 p-2 border-b bg-muted/50 space-y-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full rounded-md gap-1.5 justify-center"
              onClick={() => {
                setDetailModalOpen(false);
                setDetailModalPermKey(null);
                setModalError(null);
                setAddName('');
                setAddEtc('');
                setAddModalOpen(true);
              }}
            >
              <Plus className="h-4 w-4 opacity-70" />
              권한 추가
            </Button>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="권한 검색 (이름·비고·키)"
                value={permListSearch}
                onChange={(e) => setPermListSearch(e.target.value)}
                className="h-9 pl-8 rounded-md text-sm bg-background"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            {loading ? (
              <p className="p-3 text-sm text-muted-foreground">목록 로딩 중…</p>
            ) : perms.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">등록된 권한이 없습니다.</p>
            ) : filteredPerms.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">검색 결과가 없습니다.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {filteredPerms.map((p) => {
                  const title = p.permName ?? String(p.permKey);
                  const isSelected = selPerm === p.permKey;
                  return (
                    <li
                      key={p.permKey}
                      className={cn(
                        'flex min-h-[30px] max-h-[30px] items-stretch transition-colors',
                        isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
                      )}
                    >
                      <button
                        type="button"
                        title={title}
                        onClick={() => {
                          setAddModalOpen(false);
                          setDetailModalOpen(false);
                          setDetailModalPermKey(null);
                          setSelPerm(p.permKey);
                          setModalError(null);
                        }}
                        className={cn(
                          'flex-1 min-w-0 text-left pl-2.5 pr-1 py-2 text-sm border-l-2 transition-colors',
                          isSelected
                            ? 'border-l-primary text-foreground font-medium'
                            : 'border-l-transparent text-muted-foreground'
                        )}
                      >
                        <span className="truncate block min-w-0">{title}</span>
                      </button>
                      <button
                        type="button"
                        title="상세보기"
                        aria-label={`${title} 상세보기`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openPermDetail(p);
                        }}
                        className={cn(
                          'flex w-9 shrink-0 items-center justify-center border-l border-border/50 text-muted-foreground transition-colors',
                          'hover:bg-muted/70 hover:text-foreground',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                          isSelected && 'text-foreground'
                        )}
                      >
                        <PanelRight className="h-4 w-4 opacity-80" strokeWidth={1.75} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* 오른쪽: 선택 권한 매핑 — LayerAttrManager 본문과 동일 톤 */}
        <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0 overflow-hidden">
          <PermRoleMappingPanel
            permKey={selPerm}
            permName={detailPerm?.permName}
            tab={tab}
            onTabChange={setTab}
            showTabBar={false}
            className="flex-1 min-h-0"
            onError={(message) => setMsg(message)}
          />
        </div>
      </div>

      <Dialog
        open={detailModalOpen}
        onOpenChange={(open) => {
          setDetailModalOpen(open);
          if (!open) {
            setModalError(null);
            setDetailModalPermKey(null);
          }
        }}
      >
        <DialogContent
          className="sm:max-w-[760px] p-0 gap-0 max-h-[90vh] overflow-hidden flex flex-col"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>권한 상세</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 shrink-0 bg-slate-50/40">
            <span className="text-xs font-medium text-slate-600">권한 상세</span>
            <button
              type="button"
              onClick={() => setDetailModalOpen(false)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="닫기"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {detailModalPerm != null && detailModalPermKey != null ? (
            <div className="flex flex-col min-h-0 overflow-auto p-3 space-y-3">
              <div className="rounded-xl border border-border bg-card px-3 pt-3 pb-[15px]">
                <div className="flex flex-col gap-3.5">
                  <div className="grid grid-cols-1 gap-y-3.5 sm:grid-cols-2 sm:gap-x-4">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
                        <IdCard className="h-3.5 w-3.5" />
                      </span>
                      <span className="w-20 shrink-0 text-[12px] text-muted-foreground/90">권한키</span>
                      <Input
                        value={String(detailModalPermKey)}
                        onChange={() => {}}
                        disabled
                        style={{ fontSize: '12px' }}
                        className="h-8 flex-1 min-w-0 border-border/80 bg-muted/30 placeholder:text-[12px] font-mono"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
                        <Shield className="h-3.5 w-3.5" />
                      </span>
                      <span className="w-20 shrink-0 text-[12px] text-muted-foreground/90">권한명</span>
                      <Input
                        value={detailName}
                        onChange={(e) => setDetailName(e.target.value)}
                        style={{ fontSize: '12px' }}
                        className="h-8 flex-1 min-w-0 border-border/80 bg-muted/30 placeholder:text-[12px]"
                        placeholder="권한명"
                      />
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="flex h-5 shrink-0 items-center text-muted-foreground/80">
                      <FileText className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex h-5 shrink-0 items-center w-20 text-[12px] text-muted-foreground/90">
                      비고
                    </span>
                    <textarea
                      value={detailEtc}
                      onChange={(e) => setDetailEtc(e.target.value)}
                      placeholder="-"
                      rows={3}
                      style={{ fontSize: '12px' }}
                      className="min-h-[4.2rem] flex-1 min-w-0 resize-none rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-foreground/90 placeholder:text-muted-foreground focus:outline-none focus:ring-0 focus:border-primary"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col min-h-0 max-h-[min(32vh,260px)]">
                <div className="px-3 py-2 border-b bg-muted/40 text-xs font-medium text-muted-foreground shrink-0">
                  사용자
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-2">
                  {permDetailUsersLoading ? (
                    <p className="text-xs text-muted-foreground px-1 py-2">불러오는 중…</p>
                  ) : permDetailUsers.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-1 py-2">연결된 사용자가 없습니다.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {permDetailUsers.map((u) => {
                        const displayName = (u.usrName ?? '').trim() || u.usrId;
                        const busy = permDetailUserRemoving === u.usrId;
                        return (
                          <div
                            key={u.usrId}
                            className="flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/20 px-2 py-1.5 min-w-0"
                          >
                            <span
                              className="min-w-0 flex-1 text-[11px] leading-snug truncate"
                              title={`${u.utName} ${displayName}`}
                            >
                              <span className="text-muted-foreground">{u.utName}</span>
                              <span className="text-muted-foreground/80"> · </span>
                              <span className="text-foreground">{displayName}</span>
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy || detailSaving || deleteSaving}
                              onClick={() => void removePermFromUser(u.usrId)}
                              className="h-[22px] min-h-[22px] shrink-0 gap-0.5 px-1.5 text-[10px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-destructive hover:bg-destructive/15 hover:text-destructive"
                            >
                              <X className="h-2.5 w-2.5" />
                              {busy ? '…' : '삭제'}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="min-h-[20px] text-sm text-red-600 px-1 truncate">{modalError ?? ''}</div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    onClick={() => removePerm(detailModalPermKey)}
                    disabled={detailSaving || deleteSaving || detailModalPermKey == null}
                    size="sm"
                    variant="outline"
                    className="h-[26px] min-h-[26px] gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-destructive hover:bg-destructive/15 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                    {deleteSaving ? '삭제 중…' : '삭제'}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void submitDetailSave()}
                    disabled={detailSaving || deleteSaving}
                    size="sm"
                    className="h-[26px] min-h-[26px] gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary"
                  >
                    <Check className="h-3 w-3" />
                    {detailSaving ? '저장 중…' : '저장'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setDetailModalOpen(false)}
                    className="h-[26px] min-h-[26px] gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="h-3 w-3" />
                    닫기
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col min-h-0 overflow-auto p-3">
              <p className="text-sm text-muted-foreground">권한 정보를 불러올 수 없습니다.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={addModalOpen}
        onOpenChange={(open) => {
          setAddModalOpen(open);
          if (!open) {
            setModalError(null);
            setAddName('');
            setAddEtc('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>권한 추가</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="perm-add-name" className="text-xs text-muted-foreground">
                권한명
              </label>
              <Input
                id="perm-add-name"
                placeholder="권한명 (비우면 «권한»)"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="perm-add-etc" className="text-xs text-muted-foreground">
                비고
              </label>
              <Input
                id="perm-add-etc"
                placeholder="비고 (선택)"
                value={addEtc}
                onChange={(e) => setAddEtc(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            {modalError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{modalError}</p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" size="sm" disabled={addSaving} onClick={submitAddPerm}>
                {addSaving ? '저장 중…' : '추가'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={addSaving}
                onClick={() => setAddModalOpen(false)}
              >
                취소
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
