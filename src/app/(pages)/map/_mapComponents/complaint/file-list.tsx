'use client';

import type { CompFileUI } from './types';
import { Button } from '@/app/shadcnComponents/ui/button';
import { FileImage, FileText, File, Plus, Download } from 'lucide-react';

interface FileListProps {
  files: CompFileUI[];
}

function getFileIcon(type: CompFileUI['fileType']) {
  switch (type) {
    case 'image':
      return <FileImage className="h-5 w-5 text-sky-500/80" />;
    case 'pdf':
      return <FileText className="h-5 w-5 text-red-500/80" />;
    default:
      return <File className="h-5 w-5 text-muted-foreground/80" />;
  }
}

export function FileList({ files }: FileListProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="flex flex-col gap-2 p-1">
          {files.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-muted-foreground/80">첨부파일이 없습니다.</div>
          ) : (
            files.map((file) => (
              <div
                key={file.fileKey}
                className="flex items-center gap-3 rounded-lg border border-border/80 bg-card p-3 hover:bg-muted/30 transition-colors group cursor-pointer"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted/50">
                  {getFileIcon(file.fileType)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-normal text-foreground/90 truncate">{file.fileName}</p>
                  <p className="text-[12px] text-muted-foreground/90">
                    {file.fileSize} | {file.fileDate}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                >
                  <Download className="h-4 w-4" />
                  <span className="sr-only">다운로드</span>
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border px-4 py-3 mt-auto">
        <span className="text-[12px] text-muted-foreground">
          첨부파일 <span className="font-semibold text-foreground">{files.length}</span>건
        </span>
        <Button size="sm" className="gap-1.5 text-[12px] bg-primary text-primary-foreground hover:bg-primary/90" disabled>
          <Plus className="h-3.5 w-3.5" />
          파일 추가
        </Button>
      </div>
    </div>
  );
}
