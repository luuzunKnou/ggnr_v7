'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { cn } from '@/lib/utils';
import { X, Check, AlertTriangle, Plus, Trash2 } from 'lucide-react';

type SyncConflictRow = {
  key: string;
  diffFields: string[];
  dbValues: Record<string, unknown>;
  shpValues: Record<string, unknown>;
};
type SyncRemoveRow = { key: string; values: Record<string, unknown> };

type SyncData = {
  tableName: string;
  keyField: string;
  columns: string[];
  appendCount: number;
  conflictCount: number;
  removeCount: number;
  unchangedCount: number;
  conflicts: SyncConflictRow[];
  removes: SyncRemoveRow[];
  pathOrResult: string;
};

type Props = {
  data: SyncData;
  onApply: (conflictKeys: string[], removeKeys: string[], dbKeptKeys: string[]) => void;
  onCancel: () => void;
};

type TabId = 'conflict' | 'remove' | 'append';

export function ShpSyncModal({ data, onApply, onCancel }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>(
    data.conflictCount > 0 ? 'conflict' : data.removeCount > 0 ? 'remove' : 'append'
  );

  const [conflictChoices, setConflictChoices] = useState<Record<string, 'shp' | 'db'>>(() => {
    const init: Record<string, 'shp' | 'db'> = {};
    for (const c of data.conflicts) init[c.key] = 'shp';
    return init;
  });

  const [removeChecked, setRemoveChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const r of data.removes) init[r.key] = false;
    return init;
  });

  const selectedConflictKeys = useMemo(
    () => Object.entries(conflictChoices).filter(([, v]) => v === 'shp').map(([k]) => k),
    [conflictChoices]
  );
  const dbKeptKeys = useMemo(
    () => Object.entries(conflictChoices).filter(([, v]) => v === 'db').map(([k]) => k),
    [conflictChoices]
  );
  const selectedRemoveKeys = useMemo(
    () => Object.entries(removeChecked).filter(([, v]) => v).map(([k]) => k),
    [removeChecked]
  );

  const allConflictsShp = data.conflicts.every((c) => conflictChoices[c.key] === 'shp');
  const allRemovesChecked = data.removes.every((r) => removeChecked[r.key]);
  const noRemovesChecked = data.removes.every((r) => !removeChecked[r.key]);

  const displayCols = useMemo(() => {
    const allDiff = new Set<string>();
    for (const c of data.conflicts) {
      for (const f of c.diffFields) allDiff.add(f);
    }
    return Array.from(allDiff).slice(0, 8);
  }, [data.conflicts]);

  const removeCols = useMemo(() => {
    return data.columns.filter((c) => c !== 'geom').slice(0, 8);
  }, [data.columns]);

  const handleApply = () => {
    onApply(selectedConflictKeys, selectedRemoveKeys, dbKeptKeys);
  };

  const tabs = [
    { id: 'conflict' as TabId, label: `충돌 (${data.conflictCount})`, icon: AlertTriangle, disabled: data.conflictCount === 0 },
    { id: 'remove' as TabId, label: `삭제 (${data.removeCount})`, icon: Trash2, disabled: data.removeCount === 0 },
    { id: 'append' as TabId, label: `신규 (${data.appendCount})`, icon: Plus, disabled: false },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg shadow-xl w-[90vw] max-w-[900px] max-h-[80vh] flex flex-col">
        {/* header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="text-sm font-semibold">레이어 데이터 정합성 검증 — {data.tableName}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              동일 {data.unchangedCount}건 · 신규 <span className="text-green-600">{data.appendCount}</span>건 · 충돌 <span className="text-orange-600">{data.conflictCount}</span>건 · 삭제 <span className="text-red-500">{data.removeCount}</span>건
            </p>
          </div>
          <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* tabs */}
        <div className="shrink-0 flex border-b bg-muted/20">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                disabled={tab.disabled}
                className={cn(
                  'flex items-center gap-1 px-3 py-2 text-xs font-medium border-b-2 transition-colors',
                  activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
                  tab.disabled && 'opacity-40 cursor-not-allowed',
                )}
                onClick={() => !tab.disabled && setActiveTab(tab.id)}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* body */}
        <div className="flex-1 min-h-0 overflow-auto p-3">
          {activeTab === 'conflict' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">
                  각 행에서 적용할 값을 클릭하세요. 선택된 값이 파란색으로 표시됩니다.
                </span>
                <button
                  type="button"
                  className="text-[10px] text-blue-600 hover:underline"
                  onClick={() => {
                    const newChoice = allConflictsShp ? 'db' : 'shp';
                    const updated: Record<string, 'shp' | 'db'> = {};
                    for (const c of data.conflicts) updated[c.key] = newChoice;
                    setConflictChoices(updated);
                  }}
                >
                  {allConflictsShp ? '전체 DB 유지' : '전체 SHP 적용'}
                </button>
              </div>
              <div className="overflow-auto max-h-[40vh] border rounded">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-muted z-10">
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1.5 px-2 border-b" rowSpan={2}>{data.keyField}</th>
                      {displayCols.map((col) => (
                        <th key={col} className="py-1 px-1 border-b border-l text-center" colSpan={2}>
                          <span className={cn(data.conflicts.some((c) => c.diffFields.includes(col)) && 'text-orange-600')}>
                            {col}
                          </span>
                        </th>
                      ))}
                    </tr>
                    <tr className="text-[10px] text-muted-foreground">
                      {displayCols.map((col) => (
                        [
                          <th key={`${col}-db`} className="py-0.5 px-1 border-b border-l text-center font-normal bg-blue-50/50 dark:bg-blue-950/20">기존(DB)</th>,
                          <th key={`${col}-shp`} className="py-0.5 px-1 border-b border-l text-center font-normal bg-green-50/50 dark:bg-green-950/20">변경(SHP)</th>,
                        ]
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.conflicts.map((row) => {
                      const choice = conflictChoices[row.key] ?? 'shp';
                      return (
                        <tr key={row.key} className="border-t hover:bg-muted/20">
                          <td className="py-1.5 px-2 font-mono whitespace-nowrap">{row.key}</td>
                          {displayCols.map((col) => {
                            const isDiff = row.diffFields.includes(col);
                            const dbVal = String(row.dbValues[col] ?? '—');
                            const shpVal = String(row.shpValues[col] ?? '—');
                            if (!isDiff) {
                              return (
                                <td key={`${col}-same`} colSpan={2} className="py-1 px-1.5 border-l text-center text-[10px] text-muted-foreground">
                                  {dbVal}
                                </td>
                              );
                            }
                            return [
                              <td
                                key={`${col}-db`}
                                className={cn(
                                  'py-1 px-1.5 border-l text-[10px] text-center cursor-pointer transition-colors',
                                  choice === 'db'
                                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 font-semibold ring-1 ring-inset ring-blue-300 dark:ring-blue-700'
                                    : 'text-muted-foreground hover:bg-blue-50 dark:hover:bg-blue-950/30',
                                )}
                                onClick={() => setConflictChoices((prev) => ({ ...prev, [row.key]: 'db' }))}
                                title="DB 값 유지"
                              >
                                {dbVal}
                              </td>,
                              <td
                                key={`${col}-shp`}
                                className={cn(
                                  'py-1 px-1.5 border-l text-[10px] text-center cursor-pointer transition-colors',
                                  choice === 'shp'
                                    ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 font-semibold ring-1 ring-inset ring-green-300 dark:ring-green-700'
                                    : 'text-muted-foreground hover:bg-green-50 dark:hover:bg-green-950/30',
                                )}
                                onClick={() => setConflictChoices((prev) => ({ ...prev, [row.key]: 'shp' }))}
                                title="SHP 값으로 변경"
                              >
                                {shpVal}
                              </td>,
                            ];
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {data.conflictCount > 500 && (
                <p className="text-[10px] text-muted-foreground mt-1">* 처음 500건만 표시됩니다. 나머지 {data.conflictCount - 500}건은 DB 유지됩니다.</p>
              )}
            </div>
          )}

          {activeTab === 'remove' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">
                  SHP에 없고 DB에만 존재하는 데이터입니다. 삭제할 항목을 선택하세요.
                </span>
                <button
                  type="button"
                  className="text-[10px] text-blue-600 hover:underline"
                  onClick={() => {
                    const newVal = noRemovesChecked;
                    const updated: Record<string, boolean> = {};
                    for (const r of data.removes) updated[r.key] = newVal;
                    setRemoveChecked(updated);
                  }}
                >
                  {allRemovesChecked ? '전체 해제' : '전체 선택'}
                </button>
              </div>
              <div className="overflow-auto max-h-[40vh] border rounded">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted z-10">
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 px-2 w-10 text-center">삭제</th>
                      <th className="py-1 px-2">{data.keyField}</th>
                      {removeCols.filter((c) => c !== data.keyField).slice(0, 5).map((col) => (
                        <th key={col} className="py-1 px-2">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.removes.map((row) => (
                      <tr key={row.key} className={cn('border-t hover:bg-muted/30', removeChecked[row.key] && 'bg-red-50 dark:bg-red-950/20')}>
                        <td className="py-1 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={removeChecked[row.key] ?? false}
                            onChange={(e) => setRemoveChecked((prev) => ({ ...prev, [row.key]: e.target.checked }))}
                          />
                        </td>
                        <td className="py-1 px-2 font-mono">{row.key}</td>
                        {removeCols.filter((c) => c !== data.keyField).slice(0, 5).map((col) => (
                          <td key={col} className="py-1 px-2 text-[10px]">{String(row.values[col] ?? '—')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.removeCount > 500 && (
                <p className="text-[10px] text-muted-foreground mt-1">* 처음 500건만 표시됩니다.</p>
              )}
            </div>
          )}

          {activeTab === 'append' && (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Plus className="w-8 h-8 text-green-500" />
              <p className="text-sm font-medium">신규 데이터 {data.appendCount}건</p>
              <p className="text-xs text-muted-foreground">적용 시 자동으로 추가됩니다.</p>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-t bg-muted/10">
          <div className="text-xs text-muted-foreground">
            적용 예정: 추가 {data.appendCount}건
            {selectedConflictKeys.length > 0 && <>, 업데이트 {selectedConflictKeys.length}건</>}
            {selectedRemoveKeys.length > 0 && <>, 삭제 <span className="text-red-500">{selectedRemoveKeys.length}건</span></>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onCancel}>취소</Button>
            <Button size="sm" onClick={handleApply} className="gap-1">
              <Check className="w-3.5 h-3.5" /> 적용
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
