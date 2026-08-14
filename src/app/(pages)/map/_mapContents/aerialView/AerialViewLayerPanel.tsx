'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/app/shadcnComponents/ui/input';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import type { WorkUnitItem } from './aerialMediaTypes';
import {
  mockUnitsForKind,
  replaceOrthoUnitsFromServer,
  subscribeMockWorkUnits,
} from './aerialMediaMockData';
import { deriveOrthoUnitStatus } from './aerialMediaTypes';

type Props = {
  checkedUnitIds: Set<string>;
  onCheckedChange: (next: Set<string>) => void;
  onClose?: () => void;
  className?: string;
};

function matchesKeyword(unit: WorkUnitItem, keyword: string): boolean {
  const q = keyword.trim().toLowerCase();
  if (!q) return true;
  return unit.workName.toLowerCase().includes(q);
}

/** 우측 컨트롤 «드론영상» — 드론영상(ortho) 작업단위 검색·체크 */
export function AerialViewLayerPanel({
  checkedUnitIds,
  onCheckedChange,
  onClose,
  className,
}: Props) {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [listTick, setListTick] = useState(0);

  useEffect(() => subscribeMockWorkUnits(() => setListTick((t) => t + 1)), []);

  const refreshOrtho = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await call('', 'POST', {
        service: 'aerialUploadService',
        action: 'listWorkUnits',
        params: { kind: 'ortho' },
      });
      if (!res?.success) {
        setLoadError('목록을 불러오지 못했습니다.');
        return;
      }
      const data = (res.data ?? res) as {
        units?: Array<{
          wuKey: number;
          folderName: string;
          workName: string;
          workDate: string | null;
          srKey: number | null;
          items: Array<{
            tuKey?: number;
            fuKey?: number;
            fileName: string;
            sizeLabel: string;
            format: string;
            convertStatus?: string;
            tilesRelativePath?: string | null;
            relativePath?: string;
            previewKind?: string;
            locationLabel?: string | null;
            x5181?: number | null;
            y5181?: number | null;
          }>;
        }>;
      };
      replaceOrthoUnitsFromServer(data.units ?? []);
      setListTick((t) => t + 1);
    } catch {
      setLoadError('목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshOrtho();
  }, [refreshOrtho]);

  const units = useMemo(() => {
    void listTick;
    return mockUnitsForKind('ortho').filter((u) => {
      const st = u.status ?? deriveOrthoUnitStatus(u.files);
      return st === 'done' || u.files.some((f) => f.status === 'done' || f.status === 'registered');
    });
  }, [listTick]);

  const filtered = useMemo(
    () => units.filter((u) => matchesKeyword(u, keyword)),
    [units, keyword]
  );

  const checkedInList = filtered.filter((u) => checkedUnitIds.has(u.id)).length;
  const allChecked = filtered.length > 0 && checkedInList === filtered.length;
  const someChecked = checkedInList > 0 && !allChecked;

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(checkedUnitIds);
    if (checked) next.add(id);
    else next.delete(id);
    onCheckedChange(next);
  };

  const toggleAll = (checked: boolean) => {
    const next = new Set(checkedUnitIds);
    for (const u of filtered) {
      if (checked) next.add(u.id);
      else next.delete(u.id);
    }
    onCheckedChange(next);
  };

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-64 flex-col overflow-hidden rounded-[5px] bg-white opacity-90 shadow-xl',
        className
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-[13px] font-medium text-slate-800">드론영상</span>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-700"
            aria-label="닫기"
          >
            닫기
          </button>
        ) : null}
      </div>

      <div className="shrink-0 border-b border-slate-100 px-2.5 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="작업단위명"
            className="h-8 border-slate-200 bg-slate-50/80 pl-7 text-[11px] focus-visible:bg-white"
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center border-b border-slate-100 px-2.5 py-1.5">
        <label
          className={cn(
            'flex items-center gap-2',
            filtered.length === 0 ? 'pointer-events-none opacity-40' : 'cursor-pointer'
          )}
        >
          <input
            type="checkbox"
            className="h-3.5 w-3.5 shrink-0 rounded border-slate-300"
            checked={allChecked}
            disabled={filtered.length === 0}
            ref={(el) => {
              if (el) el.indeterminate = someChecked;
            }}
            onChange={(e) => toggleAll(e.target.checked)}
            aria-label="전체"
          />
          <span className="text-[11px] text-slate-600">전체</span>
        </label>
        <span className="ml-auto text-[10px] text-slate-400">
          {loading ? '불러오는 중…' : `${filtered.length}건`}
        </span>
      </div>

      <div className="min-h-0 max-h-[min(420px,calc(100vh-260px))] flex-1 overflow-y-auto">
        {loadError ? (
          <p className="px-3 py-6 text-center text-[11px] text-rose-500">{loadError}</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-slate-400">
            {loading
              ? '목록을 불러오는 중입니다.'
              : units.length === 0
                ? '표시할 작업단위가 없습니다.'
                : '검색 조건에 맞는 작업단위가 없습니다.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((u) => {
              const checked = checkedUnitIds.has(u.id);
              return (
                <li key={u.id}>
                  <label className="flex cursor-pointer items-start gap-2 px-2.5 py-2 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300"
                      checked={checked}
                      onChange={(e) => toggle(u.id, e.target.checked)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-slate-800">
                        {u.workName}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-slate-400">{u.workDate}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
