'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/shadcnComponents/ui/dialog';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { Check, FileText, IdCard, Layers, PanelRight, Plus, Search, Server, Shield, X } from 'lucide-react';

type Perm = { permKey: number; permName: string | null; permEtc: string | null };
type PermDetailUserRow = { usrId: string; utName: string; usrName: string | null };
type SerRow = { serEng: string; serKor: string | null };
type SysRow = {
  sysKey: string;
  sysKor: string | null;
  sysEng: string | null;
  sysDetail: string | null;
};

const LEVELS = [
  { v: 0, l: '없음' },
  { v: 1, l: '버튼보기' },
  { v: 2, l: '읽기' },
  { v: 3, l: '쓰기' },
] as const;

function SerLevelSegments(props: {
  value: number;
  onChange: (v: number) => void;
}) {
  const { value, onChange } = props;
  return (
    <div
      role="group"
      aria-label="접근 단계"
      className="inline-flex max-w-full flex-wrap gap-px rounded-md border border-border/70 bg-muted/40 p-px"
    >
      {LEVELS.map((l) => {
        const selected = value === l.v;
        return (
          <button
            key={l.v}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(l.v)}
            className={cn(
              'rounded-[3px] px-1.5 py-0.5 text-[11px] font-normal transition-colors leading-tight',
              selected
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/90 hover:text-foreground'
            )}
          >
            {l.l}
          </button>
        );
      })}
    </div>
  );
}

const SYS_ACCESS_OPTIONS = [
  { allowed: false as const, label: '없음' },
  { allowed: true as const, label: '접속허용' },
] as const;

function SysAccessSegments(props: { allowed: boolean; onChange: (allowed: boolean) => void }) {
  const { allowed, onChange } = props;
  return (
    <div
      role="group"
      aria-label="시스템 접속"
      className="inline-flex max-w-full flex-wrap gap-px rounded-md border border-border/70 bg-muted/40 p-px"
    >
      {SYS_ACCESS_OPTIONS.map((o) => {
        const selected = allowed === o.allowed;
        return (
          <button
            key={o.label}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.allowed)}
            className={cn(
              'rounded-[3px] px-1.5 py-0.5 text-[11px] font-normal transition-colors leading-tight',
              selected
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/90 hover:text-foreground'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const PERM_TABS = [
  { id: 'ser' as const, label: '기능별 권한관리', icon: Layers },
  { id: 'sys' as const, label: '시스템별 접속권한 관리', icon: Server },
];

/** 레이어 속성관리(`LayerAttrManager`) 왼쪽 목록과 동일 폭 */
const PERM_LIST_WIDTH = 280;

async function permCall(action: string, params: Record<string, unknown> = {}) {
  const res = await call('', 'POST', { service: 'permissionService', action, params });
  if (!res?.success) throw new Error(res?.error ?? 'failed');
  return res.data;
}

export function PermissionFeatureManager() {
  const [tab, setTab] = useState<'ser' | 'sys'>('ser');
  const [perms, setPerms] = useState<Perm[]>([]);
  const [selPerm, setSelPerm] = useState<number | null>(null);
  const [privateSers, setPrivateSers] = useState<SerRow[]>([]);
  const [privateSys, setPrivateSys] = useState<SysRow[]>([]);
  const [serpMap, setSerpMap] = useState<Record<string, number>>({});
  const [syspSet, setSyspSet] = useState<Set<string>>(new Set());
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

  /** sys_eng 가 같으면 한 행(접속 토글은 그룹 내 sys_key 전체에 적용) */
  const privateSysGroups = useMemo(() => {
    type G = {
      rowKey: string;
      displayEng: string;
      sysKeys: string[];
      korLines: string;
      detailLines: string;
    };
    const byEng = new Map<string, SysRow[]>();
    for (const s of privateSys) {
      const eng = (s.sysEng ?? '').trim();
      const bucket = eng || `\0${s.sysKey}`;
      if (!byEng.has(bucket)) byEng.set(bucket, []);
      byEng.get(bucket)!.push(s);
    }
    const out: G[] = [];
    for (const [bucket, rows] of byEng) {
      const sysKeys = rows.map((r) => r.sysKey);
      const displayEng = bucket.startsWith('\0') ? rows[0].sysEng ?? rows[0].sysKey : bucket;
      const kors = [...new Set(rows.map((r) => (r.sysKor ?? '').trim()).filter(Boolean))];
      const details = [...new Set(rows.map((r) => (r.sysDetail ?? '').trim()).filter(Boolean))];
      out.push({
        rowKey: [...sysKeys].sort().join('|'),
        displayEng,
        sysKeys,
        korLines: kors.join('\n'),
        detailLines: details.join('\n'),
      });
    }
    out.sort(
      (a, b) =>
        a.displayEng.localeCompare(b.displayEng, 'ko') || a.sysKeys[0].localeCompare(b.sysKeys[0])
    );
    return out;
  }, [privateSys]);

  const loadPerms = useCallback(async () => {
    const rows = (await permCall('listPerms')) as Perm[];
    setPerms(rows);
    setSelPerm((prev) => {
      if (prev == null) return null;
      return rows.some((r) => r.permKey === prev) ? prev : null;
    });
  }, []);

  const loadPrivateSers = useCallback(async () => {
    const rows = (await permCall('listPrivateSers')) as SerRow[];
    setPrivateSers(rows);
  }, []);

  const loadPrivateSys = useCallback(async () => {
    const rows = (await permCall('listPrivateSys')) as SysRow[];
    setPrivateSys(rows);
  }, []);

  const loadSerp = useCallback(async (permKey: number) => {
    const rows = (await permCall('getSerpForPerm', { permKey })) as {
      serEng: string;
      serpType: number;
    }[];
    const m: Record<string, number> = {};
    for (const r of rows) m[r.serEng] = r.serpType;
    setSerpMap(m);
  }, []);

  const loadSysp = useCallback(async (permKey: number) => {
    const rows = (await permCall('getSyspForPerm', { permKey })) as { sysKey: string | null }[];
    setSyspSet(new Set(rows.map((r) => (r.sysKey != null ? String(r.sysKey) : '')).filter(Boolean)));
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadPerms(), loadPrivateSers(), loadPrivateSys()])
      .catch((e) => setMsg(String(e.message)))
      .finally(() => setLoading(false));
  }, [loadPerms, loadPrivateSers, loadPrivateSys]);

  useEffect(() => {
    if (selPerm == null) return;
    if (tab === 'ser') loadSerp(selPerm);
    else loadSysp(selPerm);
  }, [selPerm, tab, loadSerp, loadSysp]);

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

  async function setSerLevel(serEng: string, serpType: number) {
    if (selPerm == null) return;
    try {
      await permCall('setSerpForPerm', { permKey: selPerm, serEng, serpType });
      setSerpMap((prev) => ({ ...prev, [serEng]: serpType }));
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : '오류');
    }
  }

  async function toggleSysGroup(sysKeys: string[], on: boolean) {
    if (selPerm == null || sysKeys.length === 0) return;
    try {
      for (const sysKey of sysKeys) {
        await permCall('setSyspForPerm', { permKey: selPerm, sysKey, enabled: on });
      }
      setSyspSet((prev) => {
        const n = new Set(prev);
        for (const k of sysKeys) {
          if (on) n.add(k);
          else n.delete(k);
        }
        return n;
      });
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : '오류');
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
          {selPerm == null ? (
            <p className="text-sm text-muted-foreground py-4">
              왼쪽에서 권한을 선택하면 기능별·시스템별 매핑을 편집할 수 있습니다.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap shrink-0 text-sm text-muted-foreground">
                <span>
                  선택 권한:{' '}
                  <span className="font-medium text-foreground">
                    {detailPerm?.permName ?? selPerm}
                  </span>
                  <span className="ml-1.5 font-mono text-xs opacity-80">#{selPerm}</span>
                </span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto border rounded-none bg-muted/20 w-full min-w-0">
                {tab === 'ser' ? (
                  <table className="w-full text-sm border-collapse min-w-[560px] table-fixed">
                    <colgroup>
                      <col className="w-[28%]" />
                      <col className="w-[32%]" />
                      <col className="w-[40%]" />
                    </colgroup>
                    <thead className="sticky top-0 z-10 bg-muted border-b">
                      <tr className="text-left">
                        <th className="py-1.5 px-2 text-xs font-semibold border-r border-muted-foreground/15 leading-tight">
                          서비스
                        </th>
                        <th className="py-1.5 px-2 text-xs font-semibold border-r border-muted-foreground/15 leading-tight">
                          한글명
                        </th>
                        <th className="py-1.5 px-2 text-xs font-semibold leading-tight">접근단계</th>
                      </tr>
                    </thead>
                    <tbody>
                      {privateSers.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-4 text-muted-foreground">
                            비공개(ser_is_private) 서비스가 없습니다. 기능 목록에서 비공개로 설정하세요.
                          </td>
                        </tr>
                      ) : (
                        privateSers.map((s) => {
                          const v = serpMap[s.serEng] ?? 0;
                          return (
                            <tr key={s.serEng} className="border-b border-border/60 hover:bg-muted/50">
                              <td className="py-1.5 px-2 min-w-0 font-mono text-[11px] align-top border-r border-border/40 leading-snug whitespace-normal break-words [overflow-wrap:anywhere]">
                                {s.serEng}
                              </td>
                              <td className="py-1.5 px-2 min-w-0 align-top border-r border-border/40 text-xs leading-snug whitespace-pre-line break-words">
                                {s.serKor ?? ''}
                              </td>
                              <td className="py-1.5 px-2 align-top">
                                <SerLevelSegments value={v} onChange={(nv) => setSerLevel(s.serEng, nv)} />
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-sm border-collapse min-w-[720px] table-fixed">
                    <colgroup>
                      <col className="w-[22%]" />
                      <col className="w-[20%]" />
                      <col className="w-[30%]" />
                      <col className="w-[28%]" />
                    </colgroup>
                    <thead className="sticky top-0 z-10 bg-muted border-b">
                      <tr className="text-left">
                        <th className="py-1.5 px-2 text-xs font-semibold border-r border-muted-foreground/15 leading-tight">
                          한글명
                        </th>
                        <th className="py-1.5 px-2 text-xs font-semibold border-r border-muted-foreground/15 leading-tight">
                          시스템
                        </th>
                        <th className="py-1.5 px-2 text-xs font-semibold border-r border-muted-foreground/15 leading-tight">
                          상세
                        </th>
                        <th className="py-1.5 px-2 text-xs font-semibold leading-tight">접속</th>
                      </tr>
                    </thead>
                    <tbody>
                      {privateSys.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="p-4 text-muted-foreground">
                            비공개 시스템이 없습니다. DB 시스템은 sys_is_private, config 전용은
                            systemList.config 의 sys_is_private 을 켜세요.
                          </td>
                        </tr>
                      ) : (
                        privateSysGroups.map((g) => {
                          const allOn =
                            g.sysKeys.length > 0 && g.sysKeys.every((k) => syspSet.has(k));
                          return (
                            <tr key={g.rowKey} className="border-b border-border/60 hover:bg-muted/50">
                              <td className="py-1.5 px-2 min-w-0 align-top border-r border-border/40 text-xs leading-snug whitespace-pre-line break-words">
                                {g.korLines || ''}
                              </td>
                              <td className="py-1.5 px-2 min-w-0 font-mono text-[11px] align-top border-r border-border/40 leading-snug whitespace-normal break-words [overflow-wrap:anywhere]">
                                {g.displayEng}
                              </td>
                              <td className="py-1.5 px-2 min-w-0 align-top border-r border-border/40 text-[11px] text-muted-foreground leading-snug whitespace-pre-line break-words">
                                {g.detailLines || '—'}
                              </td>
                              <td className="py-1.5 px-2 align-top">
                                <SysAccessSegments
                                  allowed={allOn}
                                  onChange={(on) => void toggleSysGroup(g.sysKeys, on)}
                                />
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
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
