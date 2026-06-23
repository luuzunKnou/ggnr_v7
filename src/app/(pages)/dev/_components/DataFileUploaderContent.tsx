'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Upload, Layers, History } from 'lucide-react';
import { FileDataUploadTab } from './fileData/FileDataUploadTab';
import { FileDataStatusTab } from './fileData/FileDataStatusTab';
import { FileDataHistoryTab } from './fileData/FileDataHistoryTab';

const TABS = [
  { id: 'upload', label: 'File 업로드', icon: Upload },
  { id: 'status', label: '데이터 상태', icon: Layers },
  { id: 'history', label: '이력 조회', icon: History },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function DataFileUploaderContent() {
  const [activeTab, setActiveTab] = useState<TabId>('upload');
  const [sharedRelativePath, setSharedRelativePath] = useState('file_data');

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="shrink-0 flex border-b bg-muted/30">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div className="absolute inset-0 flex flex-col" style={{ display: activeTab === 'upload' ? 'flex' : 'none' }}>
          <FileDataUploadTab
            relativePath={sharedRelativePath}
            onPathChange={setSharedRelativePath}
            onGoHistory={() => setActiveTab('history')}
          />
        </div>
        <div className="absolute inset-0 flex flex-col" style={{ display: activeTab === 'status' ? 'flex' : 'none' }}>
          <FileDataStatusTab />
        </div>
        <div className="absolute inset-0 flex flex-col" style={{ display: activeTab === 'history' ? 'flex' : 'none' }}>
          <FileDataHistoryTab />
        </div>
      </div>
    </div>
  );
}
