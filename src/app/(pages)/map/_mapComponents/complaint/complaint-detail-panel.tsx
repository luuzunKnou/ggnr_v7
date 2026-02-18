'use client';

import { useState } from 'react';
import type { CompUI, CompdUI, CompFileUI } from './types';
import { ComplaintInfo, type ComplaintFormValues } from './complaint-info';
import { HistoryList } from './history-list';
import { FileList } from './file-list';
import { ClipboardList, Paperclip, Map, Building2, UserCircle, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';

type DetailTab = 'history' | 'files' | 'parcel' | 'building' | 'consumer' | 'metering';

function TabPlaceholder({ title }: { title: string }) {
  return (
    <div className="flex-1 min-h-0 rounded-xl border border-border bg-card overflow-auto flex flex-col items-center justify-center p-6 text-muted-foreground text-sm">
      {title} 영역 (준비 중)
    </div>
  );
}

interface ComplaintDetailPanelProps {
  /** 'add' = 신규 등록 (정보 폼만 표시), 'edit' = 상세 (이력/첨부 탭 포함) */
  mode?: 'add' | 'edit';
  complaint: CompUI;
  histories: CompdUI[];
  files: CompFileUI[];
  onAddHistory?: (data: {
    compdDate: string;
    compdCu: string;
    compdCt: string;
    compdCg: string;
    compdState: string;
    compdContent: string;
  }) => Promise<void>;
  onEditHistory?: (compdKey: number, data: {
    compdDate: string;
    compdCu: string;
    compdCt: string;
    compdCg: string;
    compdState: string;
    compdContent: string;
  }) => Promise<void>;
  onDeleteHistory?: (compdKey: number) => Promise<void>;
  onSave?: (values: ComplaintFormValues) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  saving?: boolean;
  deleting?: boolean;
}

export function ComplaintDetailPanel({
  mode = 'edit',
  complaint,
  histories,
  files,
  onAddHistory,
  onEditHistory,
  onDeleteHistory,
  onSave,
  onDelete,
  saving,
  deleting,
}: ComplaintDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('history');
  const isAdd = mode === 'add';

  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-background">
      <div className={isAdd ? 'flex-shrink-0 p-4 pb-4' : 'flex-shrink-0 p-4 pb-2'}>
        <ComplaintInfo
          complaint={complaint}
          onSave={onSave}
          onDelete={isAdd ? undefined : onDelete}
          saving={saving}
          deleting={deleting}
        />
      </div>

      {!isAdd && (
      <div className="flex-1 min-h-0 flex flex-col px-4 pb-4">
        <div className="flex border-b border-border shrink-0 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={cn(
                'flex shrink-0 items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-medium transition-colors',
                activeTab === 'history'
                  ? 'border-b-2 border-primary text-primary bg-primary/5'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
            >
              <ClipboardList className="h-3.5 w-3.5 shrink-0" />
              이력관리
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('files')}
              className={cn(
                'flex shrink-0 items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-medium transition-colors',
                activeTab === 'files'
                  ? 'border-b-2 border-primary text-primary bg-primary/5'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0" />
              첨부파일
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('parcel')}
              className={cn(
                'flex shrink-0 items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-medium transition-colors',
                activeTab === 'parcel'
                  ? 'border-b-2 border-primary text-primary bg-primary/5'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
            >
              <Map className="h-3.5 w-3.5 shrink-0" />
              필지정보
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('building')}
              className={cn(
                'flex shrink-0 items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-medium transition-colors',
                activeTab === 'building'
                  ? 'border-b-2 border-primary text-primary bg-primary/5'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
            >
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              건축물대장
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('consumer')}
              className={cn(
                'flex shrink-0 items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-medium transition-colors',
                activeTab === 'consumer'
                  ? 'border-b-2 border-primary text-primary bg-primary/5'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
            >
              <UserCircle className="h-3.5 w-3.5 shrink-0" />
              수용가정보
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('metering')}
              className={cn(
                'flex shrink-0 items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-medium transition-colors',
                activeTab === 'metering'
                  ? 'border-b-2 border-primary text-primary bg-primary/5'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
            >
              <Gauge className="h-3.5 w-3.5 shrink-0" />
              검침정보
            </button>
        </div>

        <div className="flex-1 min-h-0 mt-3 overflow-hidden flex flex-col">
          {activeTab === 'history' && (
            <div className="flex-1 min-h-0 rounded-xl border border-border bg-card overflow-hidden flex flex-col">
              <HistoryList
                histories={histories}
                compKey={complaint.compKey}
                onAddHistory={onAddHistory!}
                onEditHistory={onEditHistory}
                onDeleteHistory={onDeleteHistory}
              />
            </div>
          )}
          {activeTab === 'files' && (
            <div className="flex-1 min-h-0 rounded-xl border border-border bg-card overflow-hidden flex flex-col">
              <FileList files={files} />
            </div>
          )}
          {activeTab === 'parcel' && <TabPlaceholder title="필지정보" />}
          {activeTab === 'building' && <TabPlaceholder title="건축물대장" />}
          {activeTab === 'consumer' && <TabPlaceholder title="수용가정보" />}
          {activeTab === 'metering' && <TabPlaceholder title="검침정보" />}
        </div>
      </div>
      )}
    </div>
  );
}
