'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  File as FileIcon,
  Folder,
  FolderPlus,
  Loader2,
  Move,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { call } from '@/lib/api';
import { appFetch, withBasePath } from '@/lib/basePath';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/shadcnComponents/ui/card';
import { Input } from '@/app/shadcnComponents/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/shadcnComponents/ui/table';
import { useChunkedUpload } from './useChunkedUpload';

type DirectoryItem = {
  name: string;
  relativePath: string;
  modified?: string;
};

type FileItem = {
  name: string;
  relativePath: string;
  size: number;
  modified?: string;
};

type BrowseResult = {
  baseDir: string;
  rootName: string;
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryItem[];
  files: FileItem[];
};

type RowItem =
  | (DirectoryItem & { kind: 'directory'; size?: undefined })
  | (FileItem & { kind: 'file' });

type UploadBatchState = {
  running: boolean;
  total: number;
  current: number;
  currentFile: string;
  success: number;
  fail: number;
  mode: 'files' | 'folder' | null;
  message: string | null;
};

const INITIAL_UPLOAD_BATCH: UploadBatchState = {
  running: false,
  total: 0,
  current: 0,
  currentFile: '',
  success: 0,
  fail: 0,
  mode: null,
  message: null,
};

function normalizePath(p?: string | null): string {
  return String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function joinPath(parent: string, child: string): string {
  const p = normalizePath(parent);
  const c = normalizePath(child);
  if (!p) return c;
  if (!c) return p;
  return `${p}/${c}`;
}

function formatSize(bytes?: number): string {
  const n = Number(bytes ?? 0);
  if (!Number.isFinite(n) || n < 1024) return `${Math.max(0, Math.round(n))} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatModified(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function pathDisplayName(relativePath: string, rootName: string): string {
  return relativePath ? relativePath.split('/').pop() ?? relativePath : rootName;
}

function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) return decodeURIComponent(utf8[1]);
  const ascii = /filename="([^"]+)"/i.exec(header);
  return ascii?.[1] ?? null;
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function TreeNode({
  nodePath,
  rootName,
  level,
  expanded,
  treeCache,
  treeLoading,
  currentPath,
  onToggle,
  onOpen,
}: {
  nodePath: string;
  rootName: string;
  level: number;
  expanded: Set<string>;
  treeCache: Record<string, DirectoryItem[]>;
  treeLoading: Set<string>;
  currentPath: string;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const children = treeCache[nodePath] ?? [];
  const isExpanded = expanded.has(nodePath);
  const isLoading = treeLoading.has(nodePath);
  const label = pathDisplayName(nodePath, rootName);

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-accent/70',
          currentPath === nodePath && 'bg-accent text-accent-foreground'
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted"
          onClick={() => onToggle(nodePath)}
          title={isExpanded ? '접기' : '펼치기'}
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => onOpen(nodePath)}
        >
          <Folder className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="truncate">{label}</span>
        </button>
      </div>
      {isExpanded &&
        children.map((child) => (
          <TreeNode
            key={child.relativePath}
            nodePath={child.relativePath}
            rootName={rootName}
            level={level + 1}
            expanded={expanded}
            treeCache={treeCache}
            treeLoading={treeLoading}
            currentPath={currentPath}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        ))}
    </div>
  );
}

export function FileManagerContent() {
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [treeCache, setTreeCache] = useState<Record<string, DirectoryItem[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(['']));
  const [treeLoading, setTreeLoading] = useState<Set<string>>(new Set());
  const [uploadBatch, setUploadBatch] = useState<UploadBatchState>(INITIAL_UPLOAD_BATCH);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef(false);
  const treeLoadingRef = useRef<Set<string>>(new Set());
  const { state: chunkState, upload, cancel, reset } = useChunkedUpload();

  const currentPath = browse?.currentPath ?? '';
  const rootName = browse?.rootName ?? 'data';
  const baseDir = browse?.baseDir ?? '';

  const fetchDirectory = useCallback(async (relativePath?: string, clearSelection = true) => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'fileManagerService',
        action: 'listFileManagerDirectory',
        params: { relativePath: normalizePath(relativePath) || undefined },
      });
      const data = (res?.data ?? res) as BrowseResult;
      setBrowse(data);
      setTreeCache((prev) => ({
        ...prev,
        [data.currentPath]: Array.isArray(data.directories) ? data.directories : [],
      }));
      if (clearSelection) setSelectedPaths(new Set());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTreeChildren = useCallback(async (relativePath: string) => {
    const key = normalizePath(relativePath);
    if (treeLoadingRef.current.has(key)) return;
    treeLoadingRef.current = new Set(treeLoadingRef.current).add(key);
    setTreeLoading(new Set(treeLoadingRef.current));
    try {
      const res = await call('', 'POST', {
        service: 'fileManagerService',
        action: 'listFileManagerDirectory',
        params: { relativePath: key || undefined },
      });
      const data = (res?.data ?? res) as BrowseResult;
      setTreeCache((prev) => ({
        ...prev,
        [data.currentPath]: Array.isArray(data.directories) ? data.directories : [],
      }));
    } catch {
      // tree는 조용히 실패
    } finally {
      const next = new Set(treeLoadingRef.current);
      next.delete(key);
      treeLoadingRef.current = next;
      setTreeLoading(new Set(next));
    }
  }, []);

  useEffect(() => {
    void fetchDirectory('', true);
    void loadTreeChildren('');
  }, [fetchDirectory, loadTreeChildren]);

  const rows = useMemo<RowItem[]>(() => {
    const keyword = search.trim().toLowerCase();
    const dirRows: RowItem[] = (browse?.directories ?? []).map((item) => ({ ...item, kind: 'directory' }));
    const fileRows: RowItem[] = (browse?.files ?? []).map((item) => ({ ...item, kind: 'file' }));
    const merged = [...dirRows, ...fileRows];
    if (!keyword) return merged;
    return merged.filter((row) => row.name.toLowerCase().includes(keyword));
  }, [browse, search]);

  const rowMap = useMemo(() => new Map(rows.map((row) => [row.relativePath, row])), [rows]);
  const selectedRows = useMemo(
    () => Array.from(selectedPaths).map((p) => rowMap.get(p)).filter((v): v is RowItem => Boolean(v)),
    [selectedPaths, rowMap]
  );
  const singleSelected = selectedRows.length === 1 ? selectedRows[0] : null;
  const allSelected = rows.length > 0 && rows.every((row) => selectedPaths.has(row.relativePath));

  const knownDirectories = useMemo(() => {
    const dirs = new Set<string>(['']);
    Object.keys(treeCache).forEach((k) => dirs.add(k));
    Object.values(treeCache).forEach((children) =>
      children.forEach((child) => {
        dirs.add(child.relativePath);
      })
    );
    return Array.from(dirs).sort((a, b) => a.localeCompare(b));
  }, [treeCache]);

  const refreshCurrent = useCallback(async () => {
    await fetchDirectory(currentPath, false);
    await loadTreeChildren('');
    if (currentPath !== '') {
      await loadTreeChildren(currentPath);
    }
  }, [currentPath, fetchDirectory, loadTreeChildren]);

  const handleToggleExpand = useCallback(
    (relativePath: string) => {
      const key = normalizePath(relativePath);
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
          void loadTreeChildren(key);
        }
        return next;
      });
    },
    [loadTreeChildren]
  );

  const handleOpenDirectory = useCallback(
    async (relativePath: string) => {
      const key = normalizePath(relativePath);
      await fetchDirectory(key, true);
      setExpandedPaths((prev) => new Set(prev).add(key));
      void loadTreeChildren(key);
    },
    [fetchDirectory, loadTreeChildren]
  );

  const handleSelectRow = useCallback((relativePath: string, checked: boolean) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (checked) next.add(relativePath);
      else next.delete(relativePath);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((checked: boolean) => {
    setSelectedPaths(checked ? new Set(rows.map((row) => row.relativePath)) : new Set());
  }, [rows]);

  const startUpload = useCallback(
    async (files: File[], mode: 'files' | 'folder') => {
      if (files.length === 0) return;
      uploadAbortRef.current = false;
      setActionError(null);
      setUploadBatch({
        running: true,
        total: files.length,
        current: 0,
        currentFile: '',
        success: 0,
        fail: 0,
        mode,
        message: null,
      });

      let success = 0;
      let fail = 0;
      for (let i = 0; i < files.length; i++) {
        if (uploadAbortRef.current) break;
        const file = files[i]!;
        const webkit = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
        const relativeName = mode === 'folder' && webkit ? webkit : file.name;
        const savePath = joinPath(currentPath, relativeName);
        setUploadBatch((prev) => ({
          ...prev,
          current: i + 1,
          currentFile: savePath,
        }));

        const result = await upload(file, 'fileManager', { fileManagerSavePath: savePath });
        if (result && typeof result === 'object' && 'error' in result && result.error) fail += 1;
        else success += 1;
        setUploadBatch((prev) => ({
          ...prev,
          success,
          fail,
        }));
      }

      reset();
      await refreshCurrent();
      setUploadBatch((prev) => ({
        ...prev,
        running: false,
        currentFile: '',
        message: uploadAbortRef.current
          ? `업로드 취소됨 (${prev.success}건 성공, ${prev.fail}건 실패)`
          : `업로드 완료 (${success}건 성공, ${fail}건 실패)`,
      }));
      uploadAbortRef.current = false;
    },
    [currentPath, refreshCurrent, reset, upload]
  );

  const handleFileUploadSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      void startUpload(files, 'files');
      e.target.value = '';
    },
    [startUpload]
  );

  const handleFolderUploadSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      void startUpload(files, 'folder');
      e.target.value = '';
    },
    [startUpload]
  );

  const handleCancelUpload = useCallback(() => {
    uploadAbortRef.current = true;
    cancel();
  }, [cancel]);

  const handleCreateFolder = useCallback(async () => {
    if (!createName.trim()) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await call('', 'POST', {
        service: 'fileManagerService',
        action: 'createFileManagerDirectory',
        params: { parentPath: currentPath || undefined, name: createName.trim() },
      });
      setCreateOpen(false);
      setCreateName('');
      await refreshCurrent();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  }, [createName, currentPath, refreshCurrent]);

  const openRenameDialog = useCallback(() => {
    if (!singleSelected) return;
    setRenameName(singleSelected.name);
    setRenameOpen(true);
    setActionError(null);
  }, [singleSelected]);

  const handleRename = useCallback(async () => {
    if (!singleSelected || !renameName.trim()) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await call('', 'POST', {
        service: 'fileManagerService',
        action: 'renameFileManagerPath',
        params: { relativePath: singleSelected.relativePath, newName: renameName.trim() },
      });
      setRenameOpen(false);
      await refreshCurrent();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  }, [renameName, refreshCurrent, singleSelected]);

  const openMoveDialog = useCallback(() => {
    setMoveTarget(currentPath);
    setMoveOpen(true);
    setActionError(null);
  }, [currentPath]);

  const handleMove = useCallback(async () => {
    if (selectedRows.length === 0) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await call('', 'POST', {
        service: 'fileManagerService',
        action: 'moveFileManagerPaths',
        params: {
          sourcePaths: selectedRows.map((row) => row.relativePath),
          targetDir: normalizePath(moveTarget),
        },
      });
      setMoveOpen(false);
      setSelectedPaths(new Set());
      await refreshCurrent();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  }, [moveTarget, refreshCurrent, selectedRows]);

  const handleDelete = useCallback(async () => {
    if (selectedRows.length === 0) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await call('', 'POST', {
        service: 'fileManagerService',
        action: 'deleteFileManagerPaths',
        params: { relativePaths: selectedRows.map((row) => row.relativePath) },
      });
      setDeleteOpen(false);
      setSelectedPaths(new Set());
      await refreshCurrent();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  }, [refreshCurrent, selectedRows]);

  const handleDownload = useCallback(async () => {
    if (selectedRows.length === 0) return;
    setActionLoading(true);
    setActionError(null);
    try {
      if (selectedRows.length === 1 && selectedRows[0]!.kind === 'file') {
        const row = selectedRows[0]!;
        const res = await appFetch(
          `/api/file-manager/download?path=${encodeURIComponent(row.relativePath)}`,
          {
            method: 'GET',
            cache: 'no-store',
            credentials: 'include',
          }
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || '다운로드 실패');
        }
        const blob = await res.blob();
        triggerBlobDownload(
          blob,
          fileNameFromDisposition(res.headers.get('content-disposition')) ?? row.name
        );
      } else {
        const res = await appFetch(withBasePath('/api/file-manager/download-zip'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ paths: selectedRows.map((row) => row.relativePath) }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || 'ZIP 다운로드 실패');
        }
        const blob = await res.blob();
        triggerBlobDownload(
          blob,
          fileNameFromDisposition(res.headers.get('content-disposition')) ?? 'download.zip'
        );
      }
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  }, [selectedRows]);

  const breadcrumbs = useMemo(() => {
    const out: Array<{ label: string; path: string }> = [{ label: rootName, path: '' }];
    let acc = '';
    for (const seg of currentPath.split('/').filter(Boolean)) {
      acc = acc ? `${acc}/${seg}` : seg;
      out.push({ label: seg, path: acc });
    }
    return out;
  }, [currentPath, rootName]);

  return (
    <div className="flex h-[calc(100vh-14rem)] min-h-0 flex-col gap-3">
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileUploadSelect} />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFolderUploadSelect}
        {...({ webkitdirectory: 'true', directory: 'true' } as Record<string, string>)}
      />

      <Card className="gap-3 py-4">
        <CardHeader className="px-4 pb-0">
          <CardTitle>FileManager</CardTitle>
          <CardDescription>{baseDir || '데이터 루트 로딩 중...'}</CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              파일 업로드
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => folderInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              폴더 업로드
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <FolderPlus className="h-4 w-4" />
              새 폴더
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleDownload} disabled={selectedRows.length === 0 || actionLoading}>
              <Download className="h-4 w-4" />
              다운로드
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={openMoveDialog} disabled={selectedRows.length === 0 || actionLoading}>
              <Move className="h-4 w-4" />
              이동
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={openRenameDialog} disabled={!singleSelected || actionLoading}>
              <Pencil className="h-4 w-4" />
              이름변경
            </Button>
            <Button type="button" size="sm" variant="destructive" onClick={() => setDeleteOpen(true)} disabled={selectedRows.length === 0 || actionLoading}>
              <Trash2 className="h-4 w-4" />
              삭제
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void refreshCurrent()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              새로고침
            </Button>
          </div>

          {uploadBatch.running || uploadBatch.message ? (
            <div className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">
                  {uploadBatch.running ? '업로드 진행 중' : '업로드 결과'}
                </div>
                {uploadBatch.running ? (
                  <Button type="button" size="xs" variant="outline" onClick={handleCancelUpload}>
                    취소
                  </Button>
                ) : null}
              </div>
              <div className="mt-2 text-muted-foreground">
                {uploadBatch.running ? (
                  <>
                    {uploadBatch.mode === 'folder' ? '폴더 업로드' : '파일 업로드'} {uploadBatch.current}/{uploadBatch.total}
                    {' '}· 현재 파일: <span className="font-mono text-foreground">{uploadBatch.currentFile || '준비 중'}</span>
                    {' '}· 청크 {chunkState.currentChunk}/{chunkState.totalChunks} ({chunkState.progress}%)
                  </>
                ) : (
                  uploadBatch.message
                )}
              </div>
            </div>
          ) : null}

          {actionError ? (
            <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {actionError}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_280px] gap-3">
        <Card className="min-h-0 gap-3 py-4">
          <CardHeader className="px-4 pb-0">
            <CardTitle className="text-base">폴더</CardTitle>
            <CardDescription>{rootName}</CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 overflow-auto px-2">
            <TreeNode
              nodePath=""
              rootName={rootName}
              level={0}
              expanded={expandedPaths}
              treeCache={treeCache}
              treeLoading={treeLoading}
              currentPath={currentPath}
              onToggle={handleToggleExpand}
              onOpen={(p) => void handleOpenDirectory(p)}
            />
          </CardContent>
        </Card>

        <Card className="min-h-0 gap-3 py-4">
          <CardHeader className="px-4 pb-0">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base">파일 목록</CardTitle>
                <CardDescription className="mt-1 flex flex-wrap gap-1">
                  {breadcrumbs.map((item, idx) => (
                    <span key={item.path} className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        className="hover:underline"
                        onClick={() => void handleOpenDirectory(item.path)}
                      >
                        {item.label}
                      </button>
                      {idx < breadcrumbs.length - 1 ? <span>/</span> : null}
                    </span>
                  ))}
                </CardDescription>
              </div>
              <div className="w-[260px] max-w-full">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="파일/폴더명 검색"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 overflow-auto px-4">
            {error ? (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        aria-label="전체 선택"
                      />
                    </TableHead>
                    <TableHead>이름</TableHead>
                    <TableHead className="w-28">종류</TableHead>
                    <TableHead className="w-28 text-right">크기</TableHead>
                    <TableHead className="w-44">수정일</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {browse?.parentPath !== null ? (
                    <TableRow
                      className="cursor-pointer"
                      onDoubleClick={() => void handleOpenDirectory(browse?.parentPath ?? '')}
                    >
                      <TableCell />
                      <TableCell colSpan={4} className="text-muted-foreground">
                        .. (상위 폴더)
                      </TableCell>
                    </TableRow>
                  ) : null}

                  {rows.map((row) => (
                    <TableRow
                      key={row.relativePath}
                      className="cursor-pointer"
                      data-state={selectedPaths.has(row.relativePath) ? 'selected' : undefined}
                      onClick={() =>
                        handleSelectRow(row.relativePath, !selectedPaths.has(row.relativePath))
                      }
                      onDoubleClick={() => {
                        if (row.kind === 'directory') {
                          void handleOpenDirectory(row.relativePath);
                        }
                      }}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedPaths.has(row.relativePath)}
                          onChange={(e) => handleSelectRow(row.relativePath, e.target.checked)}
                          aria-label={`${row.name} 선택`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {row.kind === 'directory' ? (
                            <Folder className="h-4 w-4 text-amber-500" />
                          ) : (
                            <FileIcon className="h-4 w-4 text-slate-500" />
                          )}
                          <span className="truncate">{row.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>{row.kind === 'directory' ? '폴더' : '파일'}</TableCell>
                      <TableCell className="text-right">{row.kind === 'file' ? formatSize(row.size) : '—'}</TableCell>
                      <TableCell>{formatModified(row.modified)}</TableCell>
                    </TableRow>
                  ))}

                  {!loading && rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        표시할 파일이나 폴더가 없습니다.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="min-h-0 gap-3 py-4">
          <CardHeader className="px-4 pb-0">
            <CardTitle className="text-base">선택 정보</CardTitle>
            <CardDescription>
              {selectedRows.length === 0
                ? '선택 없음'
                : selectedRows.length === 1
                  ? '1개 선택'
                  : `${selectedRows.length}개 선택`}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 overflow-auto px-4 text-sm">
            {singleSelected ? (
              <div className="space-y-3">
                <div>
                  <div className="text-muted-foreground">이름</div>
                  <div className="break-all font-medium">{singleSelected.name}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">경로</div>
                  <div className="break-all font-mono text-xs">{singleSelected.relativePath}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">종류</div>
                  <div>{singleSelected.kind === 'directory' ? '폴더' : '파일'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">크기</div>
                  <div>{singleSelected.kind === 'file' ? formatSize(singleSelected.size) : '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">수정일</div>
                  <div>{formatModified(singleSelected.modified)}</div>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-muted-foreground">
                <div>현재 경로: <span className="font-mono text-xs text-foreground">{currentPath || rootName}</span></div>
                <div>폴더 {browse?.directories.length ?? 0}개 / 파일 {browse?.files.length ?? 0}개</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>새 폴더</DialogTitle>
            <DialogDescription>{currentPath || rootName} 아래에 새 폴더를 만듭니다.</DialogDescription>
          </DialogHeader>
          <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="폴더명" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>취소</Button>
            <Button type="button" onClick={() => void handleCreateFolder()} disabled={actionLoading || !createName.trim()}>
              {actionLoading ? '생성 중…' : '생성'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이름변경</DialogTitle>
            <DialogDescription>{singleSelected?.relativePath}</DialogDescription>
          </DialogHeader>
          <Input value={renameName} onChange={(e) => setRenameName(e.target.value)} placeholder="새 이름" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>취소</Button>
            <Button type="button" onClick={() => void handleRename()} disabled={actionLoading || !renameName.trim()}>
              {actionLoading ? '변경 중…' : '변경'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>이동</DialogTitle>
            <DialogDescription>선택한 항목을 대상 폴더로 이동합니다.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={moveTarget} onChange={(e) => setMoveTarget(normalizePath(e.target.value))} placeholder="대상 폴더 경로" />
            <div className="max-h-52 overflow-auto rounded-md border">
              {knownDirectories.map((dir) => (
                <button
                  key={dir || '__root__'}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent/70',
                    normalizePath(moveTarget) === dir && 'bg-accent'
                  )}
                  onClick={() => setMoveTarget(dir)}
                >
                  <Folder className="h-4 w-4 text-amber-500" />
                  <span>{dir || rootName}</span>
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMoveOpen(false)}>취소</Button>
            <Button type="button" onClick={() => void handleMove()} disabled={actionLoading}>
              {actionLoading ? '이동 중…' : '이동'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>삭제</DialogTitle>
            <DialogDescription>선택한 항목을 삭제합니다. 복구할 수 없습니다.</DialogDescription>
          </DialogHeader>
          <div className="max-h-48 overflow-auto rounded-md border px-3 py-2 text-sm">
            {selectedRows.map((row) => (
              <div key={row.relativePath} className="break-all py-1">
                {row.relativePath}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>취소</Button>
            <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={actionLoading}>
              {actionLoading ? '삭제 중…' : '삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
