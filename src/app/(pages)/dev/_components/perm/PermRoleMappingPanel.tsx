'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { listConsoleMenuCatalog } from '@/lib/consoleMenuAccess/registry';
import { Layers, LayoutGrid, Server } from 'lucide-react';
import { permCall, type PermMappingTab, type SerRow, type SysRow } from './permApi';
import { SerLevelSegments, SysAccessSegments } from './PermAccessSegments';

const MAPPING_TABS = [
  { id: 'ser' as const, label: '기능별 권한관리', icon: Layers },
  { id: 'sys' as const, label: '시스템별 접속권한 관리', icon: Server },
  { id: 'console' as const, label: '콘솔 메뉴 권한', icon: LayoutGrid },
];

export type PermRoleMappingPanelProps = {
  permKey: number | null;
  permName?: string | null;
  tab?: PermMappingTab;
  onTabChange?: (tab: PermMappingTab) => void;
  showTabBar?: boolean;
  showHeader?: boolean;
  className?: string;
  onError?: (message: string) => void;
};

export function PermRoleMappingPanel(props: PermRoleMappingPanelProps) {
  const {
    permKey,
    permName,
    tab: controlledTab,
    onTabChange,
    showTabBar = true,
    showHeader = true,
    className,
    onError,
  } = props;

  const [internalTab, setInternalTab] = useState<PermMappingTab>('ser');
  const tab = controlledTab ?? internalTab;
  const setTab = onTabChange ?? setInternalTab;

  const [privateSers, setPrivateSers] = useState<SerRow[]>([]);
  const [privateSys, setPrivateSys] = useState<SysRow[]>([]);
  const [serpMap, setSerpMap] = useState<Record<string, number>>({});
  const [consoleSerpMap, setConsoleSerpMap] = useState<Record<string, number>>({});
  const [syspSet, setSyspSet] = useState<Set<string>>(new Set());
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  const consoleMenuCatalog = useMemo(() => listConsoleMenuCatalog(), []);

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

  const reportError = useCallback(
    (e: unknown) => {
      const message = e instanceof Error ? e.message : '오류';
      onError?.(message);
    },
    [onError]
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      permCall('listPrivateSers') as Promise<SerRow[]>,
      permCall('listPrivateSys') as Promise<SysRow[]>,
    ])
      .then(([sers, sys]) => {
        if (cancelled) return;
        setPrivateSers(Array.isArray(sers) ? sers : []);
        setPrivateSys(Array.isArray(sys) ? sys : []);
        setCatalogLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) reportError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [reportError]);

  const loadSerp = useCallback(async (key: number) => {
    const rows = (await permCall('getSerpForPerm', { permKey: key })) as {
      serEng: string;
      serpType: number;
    }[];
    const m: Record<string, number> = {};
    for (const r of rows) m[r.serEng] = r.serpType;
    setSerpMap(m);
  }, []);

  const loadSysp = useCallback(async (key: number) => {
    const rows = (await permCall('getSyspForPerm', { permKey: key })) as { sysKey: string | null }[];
    setSyspSet(new Set(rows.map((r) => (r.sysKey != null ? String(r.sysKey) : '')).filter(Boolean)));
  }, []);

  const loadConsoleSerp = useCallback(async (key: number) => {
    const rows = (await permCall('getSerpForPerm', { permKey: key })) as {
      serEng: string;
      serpType: number;
    }[];
    const byEng = new Map(rows.map((r) => [r.serEng, r.serpType]));
    const m: Record<string, number> = {};
    for (const c of listConsoleMenuCatalog()) {
      m[c.permEng] = byEng.get(c.permEng) ?? 0;
    }
    setConsoleSerpMap(m);
  }, []);

  useEffect(() => {
    if (permKey == null) {
      setSerpMap({});
      setConsoleSerpMap({});
      setSyspSet(new Set());
      return;
    }
    if (tab === 'ser') void loadSerp(permKey).catch(reportError);
    else if (tab === 'sys') void loadSysp(permKey).catch(reportError);
    else void loadConsoleSerp(permKey).catch(reportError);
  }, [permKey, tab, loadSerp, loadSysp, loadConsoleSerp, reportError]);

  async function setSerLevel(serEng: string, serpType: number) {
    if (permKey == null) return;
    try {
      await permCall('setSerpForPerm', { permKey, serEng, serpType });
      setSerpMap((prev) => ({ ...prev, [serEng]: serpType }));
    } catch (e) {
      reportError(e);
    }
  }

  async function setConsoleSerLevel(permEng: string, serpType: number) {
    if (permKey == null) return;
    try {
      await permCall('setSerpForPerm', { permKey, serEng: permEng, serpType });
      setConsoleSerpMap((prev) => ({ ...prev, [permEng]: serpType }));
    } catch (e) {
      reportError(e);
    }
  }

  async function toggleSysGroup(sysKeys: string[], on: boolean) {
    if (permKey == null || sysKeys.length === 0) return;
    try {
      for (const sysKey of sysKeys) {
        await permCall('setSyspForPerm', { permKey, sysKey, enabled: on });
      }
      setSyspSet((prev) => {
        const n = new Set(prev);
        for (const k of sysKeys) {
          if (on) n.add(k);
          else n.delete(k);
        }
        return n;
      });
    } catch (e) {
      reportError(e);
    }
  }

  if (permKey == null) {
    return (
      <p className={cn('text-sm text-muted-foreground py-4', className)}>
        권한을 선택하면 기능·시스템·콘솔 메뉴별 매핑을 편집할 수 있습니다.
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2 min-h-0 overflow-hidden', className)}>
      {showHeader ? (
        <div className="flex items-center gap-3 flex-wrap shrink-0 text-sm text-muted-foreground">
          <span>
            선택 권한:{' '}
            <span className="font-medium text-foreground">
              {(permName ?? '').trim() || permKey}
            </span>
            <span className="ml-1.5 font-mono text-xs opacity-80">#{permKey}</span>
          </span>
        </div>
      ) : null}
      {showTabBar ? (
        <div className="shrink-0 flex border rounded-md bg-muted/30 overflow-hidden">
          {MAPPING_TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                className={cn(
                  'flex flex-1 items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium border-r last:border-r-0 transition-colors',
                  tab === t.id
                    ? 'bg-background text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/60'
                )}
                onClick={() => setTab(t.id)}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto border rounded-none bg-muted/20 w-full min-w-0">
        {!catalogLoaded ? (
          <p className="p-4 text-sm text-muted-foreground">목록 불러오는 중…</p>
        ) : tab === 'ser' ? (
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
                        <SerLevelSegments value={v} onChange={(nv) => void setSerLevel(s.serEng, nv)} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        ) : tab === 'sys' ? (
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
                    비공개 시스템이 없습니다. DB 시스템은 sys_is_private, config 전용은 systemList.config
                    의 sys_is_private 을 켜세요.
                  </td>
                </tr>
              ) : (
                privateSysGroups.map((g) => {
                  const allOn = g.sysKeys.length > 0 && g.sysKeys.every((k) => syspSet.has(k));
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
        ) : (
          <table className="w-full text-sm border-collapse min-w-[760px] table-fixed">
            <colgroup>
              <col className="w-[14%]" />
              <col className="w-[22%]" />
              <col className="w-[34%]" />
              <col className="w-[30%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-muted border-b">
              <tr className="text-left">
                <th className="py-1.5 px-2 text-xs font-semibold border-r border-muted-foreground/15 leading-tight">
                  영역
                </th>
                <th className="py-1.5 px-2 text-xs font-semibold border-r border-muted-foreground/15 leading-tight">
                  메뉴
                </th>
                <th className="py-1.5 px-2 text-xs font-semibold border-r border-muted-foreground/15 leading-tight">
                  permEng
                </th>
                <th className="py-1.5 px-2 text-xs font-semibold leading-tight">접근단계</th>
              </tr>
            </thead>
            <tbody>
              {consoleMenuCatalog.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-muted-foreground">
                    등록된 콘솔 메뉴가 없습니다.
                  </td>
                </tr>
              ) : (
                consoleMenuCatalog.map((c) => {
                  const v = consoleSerpMap[c.permEng] ?? 0;
                  return (
                    <tr key={c.permEng} className="border-b border-border/60 hover:bg-muted/50">
                      <td className="py-1.5 px-2 text-xs align-top border-r border-border/40">
                        {c.areaLabel}
                      </td>
                      <td className="py-1.5 px-2 text-xs align-top border-r border-border/40">
                        {c.menuLabel}
                      </td>
                      <td className="py-1.5 px-2 min-w-0 font-mono text-[10px] align-top border-r border-border/40 leading-snug whitespace-normal break-words [overflow-wrap:anywhere]">
                        {c.permEng}
                      </td>
                      <td className="py-1.5 px-2 align-top">
                        <SerLevelSegments
                          value={v}
                          onChange={(nv) => void setConsoleSerLevel(c.permEng, nv)}
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
    </div>
  );
}

export { MAPPING_TABS };
