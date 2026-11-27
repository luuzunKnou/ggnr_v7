'use client';

/**
 * KRAS 개인정보 관리 — 조회 이력 / 권한 설정 탭
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { LandLinkageQueryLogContent } from './LandLinkageQueryLogContent';
import { KrasPiiPermissionPanel } from './KrasPiiPermissionPanel';
import { USER_MANAGER_UI_STYLE } from './userManagerUiVariants';

type HubTab = 'history' | 'perm';

const uiStyle = USER_MANAGER_UI_STYLE;

const TABS: Array<{ id: HubTab; label: string }> = [
  { id: 'history', label: '조회 이력' },
  { id: 'perm', label: '권한 설정' },
];

export function KrasPiiAccessHub() {
  const [tab, setTab] = useState<HubTab>('history');

  return (
    <div className={cn(uiStyle.page, 'gap-2')}>
      <div className="flex shrink-0 items-center gap-1 border-b border-border pb-0">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'relative -mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === 'history' ? <LandLinkageQueryLogContent /> : <KrasPiiPermissionPanel />}
      </div>
    </div>
  );
}
