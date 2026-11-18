'use client';

import { Loader2 } from 'lucide-react';
import { Switch } from '@/app/shadcnComponents/ui/switch';
import { cn } from '@/lib/utils';
import {
  MAP_LAYER_PANEL_MAX_H_CLASS,
  MAP_LAYER_PANEL_SURFACE_CLASS,
} from '../../_mapComponents/mapControlPanel/mapLayerPanelLayout';

export type DigitalMapFolderRow = {
  name: string;
  dxfCount: number;
  indexed: boolean;
};

type Props = {
  folders: DigitalMapFolderRow[];
  loading: boolean;
  error: string | null;
  checkedNames: Set<string>;
  loadingFolders: Set<string>;
  onCheckedChange: (name: string, checked: boolean) => void;
  onClose: () => void;
};

/** 우측 «수치지형도» — 폴더 체크 목록 */
export function DigitalMapListPanel({
  folders,
  loading,
  error,
  checkedNames,
  loadingFolders,
  onCheckedChange,
  onClose,
}: Props) {
  return (
    <div
      className={cn(
        'flex w-60 flex-col overflow-hidden',
        MAP_LAYER_PANEL_SURFACE_CLASS,
        MAP_LAYER_PANEL_MAX_H_CLASS
      )}
    >
      <div className="standard-map-float-header shrink-0">
        <span className="standard-map-float-header-title">수치지형도</span>
        <button
          type="button"
          onClick={onClose}
          className="standard-map-float-header-close px-1 text-xs"
          aria-label="닫기"
          title="닫기"
        >
          닫기
        </button>
      </div>

      {error ? (
        <div className="shrink-0 border-b border-slate-100 px-3 py-2 dark:border-white/10">
          <p className="text-[11px] text-destructive">{error}</p>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && folders.length === 0 ? (
          <div className="flex items-center justify-center gap-1.5 px-3 py-8 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            폴더 목록 불러오는 중…
          </div>
        ) : folders.length === 0 ? (
          <p className="px-3 py-8 text-center text-[11px] text-muted-foreground">표시할 폴더가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/10">
            {folders.map((folder) => {
              const on = checkedNames.has(folder.name);
              const busy = loadingFolders.has(folder.name);
              return (
                <li
                  key={folder.name}
                  className="standard-map-float-row-hover flex items-center gap-2 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-slate-800 dark:text-white/90" title={folder.name}>
                      {folder.name}
                    </p>
                    {busy ? (
                      <p className="text-[10px] text-slate-500 dark:text-white/55">불러오는 중…</p>
                    ) : null}
                  </div>
                  {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" /> : null}
                  <Switch
                    checked={on}
                    onCheckedChange={(v) => onCheckedChange(folder.name, v)}
                    aria-label={`${folder.name} 표시`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
