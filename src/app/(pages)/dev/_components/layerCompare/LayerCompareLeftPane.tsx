'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { call } from '@/lib/api';
import { useChunkedUpload } from '../useChunkedUpload';
import type {
  PairMethod,
  StructureCompareResult,
  ValueCompareResult,
} from '@/lib/layerCompareTypes';
import { FileUp, Loader2, X } from 'lucide-react';
import {
  ComparePane,
  FieldLabel,
  SectionBox,
  SheetTable,
  controlClass,
} from './layerCompareUi';
import { cn } from '@/lib/utils';

type LayerOpt = { schema: string; table: string; korName: string; group: string };

type FileItem = {
  id: string;
  name: string;
  file: File;
  savedPath?: string;
  status: 'queued' | 'uploading' | 'ready' | 'active' | 'error';
  error?: string;
};

type Props = {
  structure: StructureCompareResult | null;
  values: ValueCompareResult | null;
  pairMethod: PairMethod;
  baseKey: string;
  fileKey: string;
  busy?: boolean;
  onPairMethodChange: (m: PairMethod) => void;
  onBaseKeyChange: (v: string) => void;
  onFileKeyChange: (v: string) => void;
  onStructure: (result: StructureCompareResult, uploadRelativePath?: string) => void;
  onCompareValues: () => void;
  onReset: () => void;
  onError: (message: string) => void;
};

export function LayerCompareLeftPane({
  structure,
  values,
  pairMethod,
  baseKey,
  fileKey,
  busy,
  onPairMethodChange,
  onBaseKeyChange,
  onFileKeyChange,
  onStructure,
  onCompareValues,
  onReset,
  onError,
}: Props) {
  const [layers, setLayers] = useState<LayerOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [baseSel, setBaseSel] = useState('');
  const [fileItems, setFileItems] = useState<FileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { upload, state: up } = useChunkedUpload();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await call('', 'POST', {
          service: 'layerCompareService',
          action: 'listCompareLayers',
          params: {},
        });
        const d = r?.data ?? r;
        if (!cancelled) {
          if (d?.success === false) onError(String(d.error ?? '목록 실패'));
          else setLayers(Array.isArray(d?.layers) ? d.layers : []);
        }
      } catch (e: unknown) {
        if (!cancelled) onError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return layers;
    return layers.filter(
      (l) =>
        l.table.toLowerCase().includes(s) ||
        l.korName.toLowerCase().includes(s) ||
        l.group.toLowerCase().includes(s)
    );
  }, [layers, q]);

  const base = layers.find((l) => `${l.schema}:${l.table}` === baseSel) ?? null;
  const working = uploading || up.status === 'uploading' || !!busy;

  const canCompareValues =
    !!structure &&
    !working &&
    (pairMethod === 'spatial' || (!!baseKey && !!fileKey));

  const clearLocal = () => {
    setQ('');
    setBaseSel('');
    setFileItems([]);
  };

  const handleReset = () => {
    clearLocal();
    onReset();
  };

  const ensureUploaded = async (item: FileItem): Promise<string | null> => {
    if (item.savedPath) return item.savedPath;
    setFileItems((prev) =>
      prev.map((f) =>
        f.id === item.id ? { ...f, status: 'uploading', error: undefined } : f
      )
    );
    const savePath = `compare_tmp/${Date.now()}/${item.name}`;
    const upRes = await upload(item.file, 'fileManager', {
      fileManagerSavePath: savePath,
    });
    if (!upRes || upRes.error || !upRes.savedPath) {
      const msg = upRes?.error ?? '업로드 실패';
      setFileItems((prev) =>
        prev.map((f) => (f.id === item.id ? { ...f, status: 'error', error: msg } : f))
      );
      onError(msg);
      return null;
    }
    setFileItems((prev) =>
      prev.map((f) =>
        f.id === item.id
          ? { ...f, status: 'ready', savedPath: upRes.savedPath, error: undefined }
          : f
      )
    );
    return upRes.savedPath;
  };

  const compareWithLayer = async (item: FileItem, layer: LayerOpt, savedPath: string) => {
    const r = await call('', 'POST', {
      service: 'layerCompareService',
      action: 'compareStructure',
      params: {
        baseSchema: layer.schema,
        baseTable: layer.table,
        baseLabel: layer.korName || layer.table,
        relativePath: savedPath,
      },
    });
    const d = (r?.data ?? r) as StructureCompareResult;
    if (!d?.success) {
      const msg = String(d?.error ?? '구조 비교 실패');
      setFileItems((prev) =>
        prev.map((f) =>
          f.id === item.id ? { ...f, status: 'error', error: msg, savedPath } : f
        )
      );
      onError(msg);
      return;
    }
    setFileItems((prev) =>
      prev.map((f) =>
        f.id === item.id
          ? { ...f, status: 'active', savedPath }
          : f.status === 'active'
            ? { ...f, status: 'ready' }
            : f
      )
    );
    onStructure(d, savedPath);
  };

  const uploadAndCompare = async (item: FileItem, layer: LayerOpt) => {
    setUploading(true);
    try {
      const savedPath = await ensureUploaded(item);
      if (!savedPath) return;
      await compareWithLayer(item, layer, savedPath);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setFileItems((prev) =>
        prev.map((f) => (f.id === item.id ? { ...f, status: 'error', error: msg } : f))
      );
      onError(msg);
    } finally {
      setUploading(false);
    }
  };

  const addFiles = (files: FileList | File[]) => {
    if (!base) {
      onError('기준 레이어를 먼저 선택하세요.');
      return;
    }
    const list = Array.from(files);
    if (list.length === 0) return;
    const added: FileItem[] = list.map((file) => ({
      id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      file,
      status: 'queued' as const,
    }));
    setFileItems((prev) => [...prev, ...added]);
    void (async () => {
      setUploading(true);
      try {
        let compared = false;
        for (const item of added) {
          const path = await ensureUploaded(item);
          if (!path) continue;
          if (!compared) {
            compared = true;
            await compareWithLayer(item, base, path);
          }
        }
      } catch (e: unknown) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading(false);
      }
    })();
  };

  const removeFile = (id: string) => {
    const wasActive = fileItems.find((f) => f.id === id)?.status === 'active';
    setFileItems((prev) => prev.filter((f) => f.id !== id));
    if (wasActive) {
      onReset();
    }
  };

  return (
    <ComparePane
      footer={
        structure || fileItems.length > 0 || baseSel ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-sm"
              disabled={working}
              onClick={handleReset}
            >
              다시 선택
            </Button>
            <Button
              type="button"
              size="sm"
              className="text-sm"
              disabled={!canCompareValues}
              onClick={onCompareValues}
            >
              {busy ? '비교 중…' : values ? '값 비교 다시' : '맞춰서 값 비교'}
            </Button>
          </>
        ) : (
          <p className="text-sm text-foreground">
            {base
              ? '파일을 올리면 오른쪽에 결과가 표시됩니다.'
              : '기준 레이어를 먼저 선택하세요.'}
          </p>
        )
      }
    >
      <div className="grid shrink-0 grid-cols-2 gap-2.5">
        <SectionBox title="기준 레이어" bodyClassName="space-y-2">
          <div>
            <FieldLabel>검색</FieldLabel>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="한글명 · 영문명 · 그룹"
              className="h-9 text-sm"
              disabled={working || !!structure}
            />
          </div>
          <div>
            <FieldLabel>레이어</FieldLabel>
            <select
              className={controlClass}
              value={baseSel}
              onChange={(e) => setBaseSel(e.target.value)}
              disabled={loading || working || !!structure}
            >
              <option value="">{loading ? '불러오는 중…' : '선택'}</option>
              {filtered.map((l) => (
                <option key={`${l.schema}:${l.table}`} value={`${l.schema}:${l.table}`}>
                  {l.korName ? `${l.korName} (${l.table})` : l.table}
                  {l.group ? ` · ${l.group}` : ''}
                </option>
              ))}
            </select>
          </div>
        </SectionBox>

        <SectionBox title="비교 파일" bodyClassName="space-y-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".shp,.zip,.xlsx,.xls,.csv,.dbf"
            className="hidden"
            disabled={!base || working}
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <FieldLabel>파일 목록</FieldLabel>
          <button
            type="button"
            disabled={!base || working}
            onClick={() => fileRef.current?.click()}
            className={cn(
              'flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-2 py-2 text-sm',
              !base || working
                ? 'cursor-not-allowed bg-muted/20 opacity-60'
                : 'bg-muted/20 hover:bg-muted/35'
            )}
          >
            {uploading || up.status === 'uploading' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                업로드 {up.status === 'uploading' ? `${up.progress}%` : '중…'}
              </>
            ) : (
              <>
                <FileUp className="h-4 w-4" />
                파일 추가 (여러 개 가능)
              </>
            )}
          </button>
          <ul className="max-h-28 space-y-1 overflow-auto">
            {fileItems.length === 0 ? (
              <li className="rounded-md border border-dashed border-border px-2 py-2 text-sm text-foreground">
                xlsx · shp · zip · csv
              </li>
            ) : (
              fileItems.map((f) => (
                <li
                  key={f.id}
                  className={cn(
                    'flex items-center gap-1 rounded-md border px-2 py-1.5 text-sm',
                    f.status === 'active'
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-card'
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    disabled={working || f.status === 'uploading'}
                    onClick={() => {
                      if (!base || f.status === 'active') return;
                      void uploadAndCompare(f, base);
                    }}
                    title={f.error || f.name}
                  >
                    <span className="block truncate">{f.name}</span>
                    <span className="text-foreground">
                      {f.status === 'uploading'
                        ? '업로드 중'
                        : f.status === 'active'
                          ? '비교 중'
                          : f.status === 'error'
                            ? '오류'
                            : f.status === 'ready'
                              ? '선택하여 비교'
                              : '대기'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    disabled={working}
                    onClick={() => removeFile(f.id)}
                    aria-label="제거"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))
            )}
          </ul>
        </SectionBox>
      </div>

      <SectionBox fill title="맞춤 설정" bodyClassName="space-y-2.5">
        <div>
          <FieldLabel>맞춤 방식</FieldLabel>
          <div
            className={cn(
              'grid grid-cols-2 gap-2',
              !structure && 'pointer-events-none opacity-50'
            )}
          >
            <button
              type="button"
              onClick={() => onPairMethodChange('key')}
              className={cn(
                'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                pairMethod === 'key'
                  ? 'border-primary/40 bg-primary/8'
                  : 'border-border hover:bg-muted/40'
              )}
            >
              식별키
            </button>
            <button
              type="button"
              onClick={() => onPairMethodChange('spatial')}
              className={cn(
                'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                pairMethod === 'spatial'
                  ? 'border-primary/40 bg-primary/8'
                  : 'border-border hover:bg-muted/40'
              )}
            >
              위치
            </button>
          </div>
        </div>

        {!structure ? (
          <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-sm text-foreground">
            기준 키 · 파일 키가 여기에 나타납니다.
          </p>
        ) : pairMethod === 'key' ? (
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <FieldLabel>기준 키</FieldLabel>
              <select
                className={controlClass}
                value={baseKey}
                onChange={(e) => onBaseKeyChange(e.target.value)}
              >
                <option value="">선택</option>
                {structure.base.columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.korName ? `${c.korName} (${c.name})` : c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>파일 키</FieldLabel>
              <select
                className={controlClass}
                value={fileKey}
                onChange={(e) => onFileKeyChange(e.target.value)}
              >
                <option value="">선택</option>
                {structure.file.columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.korName ? `${c.korName} (${c.name})` : c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <p className="text-sm text-foreground">
            기준 도형({structure.base.geomKind}) 기본 거리·겹침으로 위치를 맞춥니다.
          </p>
        )}

        {structure ? (
          <div className="space-y-1.5">
            <FieldLabel>구조 요약</FieldLabel>
            <SheetTable
              columns={[
                { key: 'item', label: '항목' },
                { key: 'base', label: '기준' },
                { key: 'file', label: '파일' },
                { key: 'result', label: '결과' },
              ]}
              rows={[
                {
                  item: '건수',
                  base: `${structure.base.rowCount.toLocaleString()}건`,
                  file: `${structure.file.rowCount.toLocaleString()}건`,
                  result: structure.countSame ? '같음' : '다름',
                },
                {
                  item: '도형',
                  base: structure.base.geomKind,
                  file: structure.file.geomKind,
                  result: structure.geomSame ? '같음' : '다름',
                },
                {
                  item: '좌표계',
                  base:
                    structure.base.srid != null ? `EPSG:${structure.base.srid}` : '없음',
                  file:
                    structure.file.srid != null ? `EPSG:${structure.file.srid}` : '없음',
                  result: structure.sridSame ? '같음' : '다름',
                },
                {
                  item: '컬럼',
                  base: `같음 ${structure.columns.filter((c) => c.kind === 'same').length}`,
                  file: `후보 ${structure.columns.filter((c) => c.kind === 'candidate').length}`,
                  result: `기준만 ${structure.columns.filter((c) => c.kind === 'baseOnly').length} · 파일만 ${structure.columns.filter((c) => c.kind === 'fileOnly').length}`,
                },
              ]}
            />
          </div>
        ) : null}
      </SectionBox>
    </ComparePane>
  );
}
