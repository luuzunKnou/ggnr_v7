'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { call } from '@/lib/api';
import type {
  ColumnMatchRow,
  PairMethod,
  StructureCompareResult,
  ValueCompareResult,
} from '@/lib/layerCompareTypes';
import { CompareSplit } from './layerCompareUi';
import { LayerCompareLeftPane } from './LayerCompareLeftPane';
import { LayerCompareRightPane } from './LayerCompareRightPane';

type RightTab = 'structure' | 'values';

export function LayerCompareContent() {
  const [busy, setBusy] = useState(false);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [structure, setStructure] = useState<StructureCompareResult | null>(null);
  const [columns, setColumns] = useState<ColumnMatchRow[]>([]);
  const [pairMethod, setPairMethod] = useState<PairMethod>('key');
  const [baseKey, setBaseKey] = useState('');
  const [fileKey, setFileKey] = useState('');
  const [values, setValues] = useState<ValueCompareResult | null>(null);
  const [tab, setTab] = useState<RightTab>('structure');
  const leftResetKey = useRef(0);
  const [leftKey, setLeftKey] = useState(0);

  const uploadPathsRef = useRef<string[]>([]);
  const structureRef = useRef<StructureCompareResult | null>(null);
  structureRef.current = structure;

  const cleanupNow = useCallback(async (opts?: { purgeCompareTmp?: boolean }) => {
    const s = structureRef.current;
    try {
      await call('', 'POST', {
        service: 'layerCompareService',
        action: 'cleanupCompareSession',
        params: {
          sessionId: s?.sessionId,
          table: s?.file?.table,
          uploadPaths: [...uploadPathsRef.current],
          purgeCompareTmp: opts?.purgeCompareTmp === true,
        },
      });
    } catch {
      /* ignore */
    }
    if (opts?.purgeCompareTmp) uploadPathsRef.current = [];
  }, []);

  // 페이지 이탈 시에만 임시파일 전체 삭제 (structure 변경 때는 지우지 않음)
  useEffect(() => {
    return () => {
      void cleanupNow({ purgeCompareTmp: true });
    };
  }, [cleanupNow]);

  const reset = async () => {
    await cleanupNow({ purgeCompareTmp: true });
    setStructure(null);
    setColumns([]);
    setPairMethod('key');
    setBaseKey('');
    setFileKey('');
    setValues(null);
    setErrorModal(null);
    setTab('structure');
    leftResetKey.current += 1;
    setLeftKey(leftResetKey.current);
  };

  const onStructure = (result: StructureCompareResult, uploadRelativePath?: string) => {
    if (uploadRelativePath) {
      const p = uploadRelativePath.replace(/\\/g, '/');
      if (p && !uploadPathsRef.current.includes(p)) uploadPathsRef.current.push(p);
    }
    setStructure(result);
    setColumns(result.columns);
    setPairMethod('key');
    setBaseKey('');
    setFileKey('');
    setValues(null);
    setErrorModal(null);
    setTab('structure');
  };

  const runValues = async () => {
    if (!structure) return;
    setBusy(true);
    try {
      const r = await call('', 'POST', {
        service: 'layerCompareService',
        action: 'compareValues',
        params: {
          baseSchema: structure.base.schema,
          baseTable: structure.base.table,
          fileSchema: structure.file.schema,
          fileTable: structure.file.table,
          columns,
          pairMethod,
          baseKey: baseKey || null,
          fileKey: fileKey || null,
        },
      });
      const d = (r?.data ?? r) as ValueCompareResult;
      setValues(d);
      setTab('values');
      if (!d?.success) setErrorModal(String(d?.error ?? '값 비교 실패'));
    } catch (e: unknown) {
      setErrorModal(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportExcel = async () => {
    if (!structure) return;
    setBusy(true);
    try {
      const r = await call('', 'POST', {
        service: 'layerCompareService',
        action: 'exportCompareExcel',
        params: {
          structure,
          values,
          pairMethod,
          baseKey: baseKey || null,
          fileKey: fileKey || null,
          columns,
        },
      });
      const d = r?.data ?? r;
      if (!d?.success || !d.base64) {
        setErrorModal(String(d?.error ?? '엑셀 실패'));
        return;
      }
      const bin = atob(String(d.base64));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = d.fileName || '레이어파일비교.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setErrorModal(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleErrorRestart = () => {
    void reset();
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-3">
      <Dialog
        open={!!errorModal}
        onOpenChange={(open) => {
          if (!open) setErrorModal(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>비교 오류</DialogTitle>
            <DialogDescription className="text-sm whitespace-pre-wrap text-foreground">
              {errorModal}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setErrorModal(null)}>
              닫기
            </Button>
            <Button type="button" onClick={handleErrorRestart}>
              처음으로
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CompareSplit
        left={
          <LayerCompareLeftPane
            key={leftKey}
            structure={structure}
            values={values}
            pairMethod={pairMethod}
            baseKey={baseKey}
            fileKey={fileKey}
            busy={busy}
            onPairMethodChange={setPairMethod}
            onBaseKeyChange={setBaseKey}
            onFileKeyChange={setFileKey}
            onStructure={(r, uploadPath) => onStructure(r, uploadPath)}
            onCompareValues={() => void runValues()}
            onReset={() => void reset()}
            onError={setErrorModal}
          />
        }
        right={
          <LayerCompareRightPane
            structure={structure}
            columns={columns}
            values={values}
            tab={tab}
            busy={busy}
            onColumnsChange={setColumns}
            onTabChange={setTab}
            onExport={() => void exportExcel()}
            onRestart={() => void reset()}
          />
        }
      />
    </div>
  );
}
