'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/shadcnComponents/ui/dialog';
import { call } from '@/lib/api';
import { Play, Loader2, ListOrdered } from 'lucide-react';
import {
  ORTHO_TILESET_GROUP_LS_KEY,
  ORTHO_TILESET_OUTPUT_SLUG_LS_KEY,
} from '@/app/(pages)/map/_mapComponents/layerFactory/backgroundLayerFactory';
import type {
  OrthophotoCrsCandidate,
  OrthophotoTileOutputsResult,
  SatelliteTifGroupedUploadsResult,
} from '@/service/orthophotoService';
import { OrthophotoCrsPreviewMap } from './OrthophotoCrsPreviewMap';

const DEFAULT_TILE_SET = 'aerial-2017';

/** 테이블·일괄 작업과 동일: 메타/업로드 목록의 sourceCrs로 원본 EPSG 필요 여부 판별 */
function needsCrsSelectForGroup(g: SatelliteTifGroupedUploadsResult['groups'][number]): boolean {
  const meta = parseGroupMeta(g.groupName);
  const sourceCrs = g.sourceCrs ?? meta.sourceCrs;
  return !sourceCrs || sourceCrs === '-';
}

function parseGroupMeta(groupName: string): { sourceCrs: string; expectedLayerName: string } {
  const m = /^satellite_(\d{4})(?:_(\d{4,5})(?:_(.+))?)?$/i.exec(groupName.trim());
  if (!m) return { sourceCrs: '-', expectedLayerName: '-' };
  const year = m[1] ?? '';
  const seg3 = (m[2] ?? '').trim();
  const seg4 = (m[3] ?? '').trim();
  // 지도 UI에서 쓰는 규칙과 동일:
  // satellite_YYYY[_CRS[_이름] | _이름]
  // - 3번째가 숫자면 CRS, 표시명은 4번째(없으면 항공영상(YYYY))
  // - 3번째가 숫자가 아니면 표시명
  const expectedLayerName = /^\d+$/.test(seg3) ? (seg4 || `항공영상(${year})`) : (seg3 || `항공영상(${year})`);
  return {
    sourceCrs: /^\d+$/.test(seg3) ? `EPSG:${seg3}` : '-',
    expectedLayerName,
  };
}

export function OrthophotoManagerContent() {
  const [groupedUploads, setGroupedUploads] = useState<SatelliteTifGroupedUploadsResult['groups']>([]);
  const [outputs, setOutputs] = useState<OrthophotoTileOutputsResult>({ groups: [], legacyTileSetIds: [] });
  const [listError, setListError] = useState<string | null>(null);
  const [convertMsg, setConvertMsg] = useState<string | null>(null);
  const [convertingGroup, setConvertingGroup] = useState<string | null>(null);
  const [crsModalGroup, setCrsModalGroup] = useState<string | null>(null);
  const [crsCandidates, setCrsCandidates] = useState<OrthophotoCrsCandidate[]>([]);
  const [crsLoading, setCrsLoading] = useState(false);
  const [crsSaving, setCrsSaving] = useState(false);
  const [selectedSourceCrs, setSelectedSourceCrs] = useState<string>('');
  const refreshAbortRef = useRef<AbortController | null>(null);
  const groupedUploadsRef = useRef<SatelliteTifGroupedUploadsResult['groups']>([]);
  const outputsRef = useRef<OrthophotoTileOutputsResult>({ groups: [], legacyTileSetIds: [] });
  const batchQueueRef = useRef<string[]>([]);
  /** 일괄시작 → 좌표계 순차 설정 후 타일 일괄까지 이어갈 때 */
  const pendingTileBatchAfterCrsRef = useRef(false);
  const crsWizardRemainingRef = useRef<string[]>([]);
  const [jpegQuality, setJpegQuality] = useState('80');
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchUi, setBatchUi] = useState<{ current: number; total: number } | null>(null);
  const [crsWizardForBatch, setCrsWizardForBatch] = useState(false);

  const refresh = useCallback(async () => {
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    setListError(null);
    try {
      const uRes = await call('', 'POST', {
        service: 'orthophotoService',
        action: 'listSatelliteTifGroupedUploads',
        params: {},
      }, { signal: controller.signal });
      const oRes = await call('', 'POST', {
        service: 'orthophotoService',
        action: 'listOrthophotoTileOutputs',
        params: {},
      }, { signal: controller.signal });
      const u = (uRes?.data ?? uRes) as SatelliteTifGroupedUploadsResult;
      const o = (oRes?.data ?? oRes) as OrthophotoTileOutputsResult;
      if (controller.signal.aborted) return;
      const nextGroups = Array.isArray(u?.groups) ? u.groups : [];
      const nextOutputs = {
        groups: Array.isArray(o?.groups) ? o.groups : [],
        legacyTileSetIds: Array.isArray(o?.legacyTileSetIds) ? o.legacyTileSetIds : [],
      };
      groupedUploadsRef.current = nextGroups;
      outputsRef.current = nextOutputs;
      setGroupedUploads(nextGroups);
      setOutputs(nextOutputs);
    } catch (e) {
      if (controller.signal.aborted) return;
      setListError(e instanceof Error ? e.message : String(e));
      groupedUploadsRef.current = [];
      outputsRef.current = { groups: [], legacyTileSetIds: [] };
      setGroupedUploads([]);
      setOutputs({ groups: [], legacyTileSetIds: [] });
    } finally {
      if (refreshAbortRef.current === controller) {
        refreshAbortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      refreshAbortRef.current?.abort();
    };
  }, [refresh]);

  const persistTilesetGroup = (tileSet: string, groupName: string) => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(ORTHO_TILESET_GROUP_LS_KEY) : null;
      const m = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      m[tileSet] = groupName;
      window.localStorage.setItem(ORTHO_TILESET_GROUP_LS_KEY, JSON.stringify(m));
    } catch {
      /* ignore */
    }
  };

  const persistTilesetOutputSlug = (tileSet: string, outputSlug: string) => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(ORTHO_TILESET_OUTPUT_SLUG_LS_KEY) : null;
      const m = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      m[tileSet] = outputSlug;
      window.localStorage.setItem(ORTHO_TILESET_OUTPUT_SLUG_LS_KEY, JSON.stringify(m));
    } catch {
      /* ignore */
    }
  };

  const runGroupConvert = async (groupName: string, sourceCrs?: string): Promise<boolean> => {
    const ts = DEFAULT_TILE_SET;
    const jq = parseInt(jpegQuality, 10);
    setConvertMsg(null);
    setListError(null);
    setConvertingGroup(groupName);
    try {
      const res = await call('', 'POST', {
        service: 'orthophotoService',
        action: 'runSatelliteTifGroupToXyz',
        params: {
          groupName,
          tileSetId: ts,
          sourceCrs,
          jpegQuality: Number.isFinite(jq) ? jq : 80,
        },
      });
      const d = res?.data ?? res;
      setConvertMsg(typeof d?.message === 'string' ? d.message : '그룹 변환을 시작했습니다.');
      persistTilesetGroup(ts, groupName);
      if (typeof d?.outputSlug === 'string' && d.outputSlug) persistTilesetOutputSlug(ts, d.outputSlug);
      await refresh();
      return true;
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setConvertingGroup(null);
    }
  };

  const abortCrsBatchWizard = useCallback(() => {
    pendingTileBatchAfterCrsRef.current = false;
    crsWizardRemainingRef.current = [];
    setCrsWizardForBatch(false);
  }, []);

  const openCrsModal = async (groupName: string) => {
    setCrsModalGroup(groupName);
    setCrsCandidates([]);
    setSelectedSourceCrs('');
    setCrsLoading(true);
    try {
      const res = await call('', 'POST', {
        service: 'orthophotoService',
        action: 'detectOrthophotoGroupCrsCandidates',
        params: { groupName },
      });
      const d = res?.data ?? res;
      const list = Array.isArray(d?.candidates) ? (d.candidates as OrthophotoCrsCandidate[]) : [];
      setCrsCandidates(list);
      if (list[0]?.sourceCrs) setSelectedSourceCrs(list[0].sourceCrs);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
      setCrsModalGroup(null);
      if (pendingTileBatchAfterCrsRef.current) {
        abortCrsBatchWizard();
        setConvertMsg('일괄: 좌표계 후보 조회에 실패해 중단했습니다.');
      }
    } finally {
      setCrsLoading(false);
    }
  };

  const abortBatch = useCallback((message: string) => {
    batchQueueRef.current = [];
    setBatchUi(null);
    setBatchRunning(false);
    setConvertMsg(message);
  }, []);

  const processBatchStep = async (index: number) => {
    const queue = batchQueueRef.current;
    if (index >= queue.length) {
      batchQueueRef.current = [];
      setBatchUi(null);
      setBatchRunning(false);
      setConvertMsg('일괄 작업이 모두 완료되었습니다.');
      return;
    }
    const groupName = queue[index];
    setBatchUi({ total: queue.length, current: index + 1 });
    await refresh();
    const groups = groupedUploadsRef.current;
    const g = groups.find((x) => x.groupName === groupName);
    if (!g) {
      await processBatchStep(index + 1);
      return;
    }
    const meta = parseGroupMeta(groupName);
    const sourceCrs = g.sourceCrs ?? meta.sourceCrs;
    if (!sourceCrs || sourceCrs === '-') {
      abortBatch(`일괄 작업: '${groupName}' 좌표계가 없어 중단했습니다. 좌표계를 저장한 뒤 다시 시도하세요.`);
      return;
    }
    const ok = await runGroupConvert(groupName, sourceCrs);
    if (!ok) {
      abortBatch('일괄 작업: 변환 오류로 중단되었습니다.');
      return;
    }
    await processBatchStep(index + 1);
  };

  const startTileBatchFromRefs = async () => {
    const o = outputsRef.current;
    const groups = groupedUploadsRef.current;
    const unconverted = groups.filter((g) => {
      const converted =
        o.groups.some((x) => x.groupName === g.groupName && x.tileSetIds.length > 0) ||
        o.legacyTileSetIds.includes(g.groupName);
      return !converted;
    });
    const queue = unconverted.filter((g) => !needsCrsSelectForGroup(g)).map((g) => g.groupName);
    if (!queue.length) {
      setConvertMsg(
        unconverted.length
          ? '좌표계 저장 후에도 일괄 변환 가능한 그룹이 없습니다. 타일이 이미 있거나 좌표계가 비어 있습니다.'
          : '미변환 그룹이 없습니다. (타일 변환이 X인 그룹만 일괄합니다)',
      );
      return;
    }
    batchQueueRef.current = queue;
    setBatchRunning(true);
    await processBatchStep(0);
  };

  const startBatchWork = async () => {
    const o = outputsRef.current;
    const unconverted = groupedUploads.filter((g) => {
      const converted =
        o.groups.some((x) => x.groupName === g.groupName && x.tileSetIds.length > 0) ||
        o.legacyTileSetIds.includes(g.groupName);
      return !converted;
    });
    if (!unconverted.length) {
      setConvertMsg('미변환 그룹이 없습니다. (타일 변환이 X인 그룹만 일괄합니다)');
      return;
    }
    const needCrsList = unconverted.filter((g) => needsCrsSelectForGroup(g));
    const needCrsNames = needCrsList.map((g) => g.groupName);
    if (needCrsNames.length > 0) {
      pendingTileBatchAfterCrsRef.current = true;
      crsWizardRemainingRef.current = [...needCrsNames];
      setCrsWizardForBatch(true);
      setConvertMsg(
        `일괄: 원본 좌표계가 필요한 그룹 ${needCrsNames.length}개를 순서대로 엽니다. 저장할 때마다 다음 그룹으로 이동하며, 마지막 저장 후 타일 일괄 변환이 시작됩니다.`,
      );
      await openCrsModal(needCrsNames[0]);
      return;
    }
    const queue = unconverted.map((g) => g.groupName);
    batchQueueRef.current = queue;
    setBatchRunning(true);
    await processBatchStep(0);
  };

  const confirmSourceCrs = async () => {
    if (!crsModalGroup || !selectedSourceCrs) return;
    const groupName = crsModalGroup;
    const crs = selectedSourceCrs;
    const inBatchCrsWizard = pendingTileBatchAfterCrsRef.current;
    setCrsSaving(true);
    try {
      await call('', 'POST', {
        service: 'orthophotoService',
        action: 'setOrthophotoGroupSourceCrs',
        params: { groupName, sourceCrs: crs },
      });
      if (inBatchCrsWizard) {
        crsWizardRemainingRef.current = crsWizardRemainingRef.current.filter((n) => n !== groupName);
      }
      await refresh();
      const remaining = crsWizardRemainingRef.current;
      if (inBatchCrsWizard && remaining.length > 0) {
        await openCrsModal(remaining[0]);
        setConvertMsg(`일괄 좌표계 설정: ${remaining.length}개 그룹 남음 — 다음 그룹을 선택하세요.`);
        return;
      }
      if (inBatchCrsWizard && remaining.length === 0) {
        pendingTileBatchAfterCrsRef.current = false;
        setCrsWizardForBatch(false);
        setCrsModalGroup(null);
        setConvertMsg('원본 좌표계 설정을 마쳤습니다. 타일 일괄 변환을 시작합니다.');
        await startTileBatchFromRefs();
        return;
      }
      setCrsModalGroup(null);
      setConvertMsg('원본 좌표계를 저장했습니다. 「변환시작」 또는 「작업 일괄시작」으로 타일 변환을 실행하세요.');
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setCrsSaving(false);
    }
  };

  const hasConvertedOutput = (groupName: string): boolean =>
    outputs.groups.some((g) => g.groupName === groupName && g.tileSetIds.length > 0) ||
    outputs.legacyTileSetIds.includes(groupName);

  return (
    <div className="flex flex-col gap-4 p-3 text-sm min-h-0 overflow-y-auto max-h-[calc(100vh-14rem)]">
      <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
        <p className="font-medium text-foreground">업로드 · 변환 경로</p>
        <ul className="list-disc pl-5 text-muted-foreground text-xs space-y-0.5">
          <li>
            업로드: <code className="text-foreground">upload_data/satellite_tif/&#123;그룹폴더&#125;/…/*.tif</code>
            — 파일은 재투영 없이 원본 바이트 그대로 저장됩니다.
          </li>
          <li>
            결과: <code className="text-foreground">service_data/2dtiles/&#123;그룹&#125;/z/x/y.jpg</code>
            · 변환은 항상 원본 좌표계 그대로(<code className="text-[10px]">gdal2tiles --profile=raster</code>) JPEG 타일을 굽습니다. 변환 후 브라우저에 그룹·출력폴더명이 저장됩니다.
          </li>
        </ul>
      </div>

      <div className="rounded-lg border border-border p-3 space-y-2">
        <p className="font-medium">공통 변환 옵션</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">JPEG 품질</label>
            <Input
              value={jpegQuality}
              onChange={(e) => setJpegQuality(e.target.value)}
              className="h-8 text-xs"
              inputMode="numeric"
            />
          </div>
        </div>
      </div>

      {listError && (
        <div className="rounded border border-destructive/50 bg-destructive/10 px-2 py-1 text-xs text-destructive">{listError}</div>
      )}
      {convertMsg && (
        <div className="rounded border border-green-600/40 bg-green-500/10 px-2 py-1 text-xs text-green-800 dark:text-green-300">
          {convertMsg}
        </div>
      )}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="space-y-0.5">
                <p className="font-medium">업로드된 GeoTIFF (그룹별)</p>
            {batchUi && (
              <p className="text-[11px] text-muted-foreground">
                일괄 변환 진행 {batchUi.current} / {batchUi.total} · 좌표계가 이미 확정된 미변환 그룹만 순서대로
                변환합니다.
              </p>
            )}
          </div>
          {groupedUploads.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 text-xs shrink-0"
              disabled={convertingGroup != null || batchRunning || crsWizardForBatch}
              onClick={() => void startBatchWork()}
            >
              <ListOrdered className="w-3.5 h-3.5 mr-1" />
              작업 일괄시작
            </Button>
          )}
        </div>
        {!groupedUploads.length ? (
          <p className="text-muted-foreground text-xs">그룹 폴더 하위에 tif가 없습니다.</p>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-xs table-fixed">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left p-2 w-[36%]">그룹 폴더 전체경로</th>
                  <th className="text-left p-2 w-[14%]">좌표계</th>
                  <th className="text-left p-2 w-[22%]">예상 레이어명</th>
                  <th className="text-right p-2 w-24">파일 수</th>
                  <th className="text-center p-2 w-24">타일 변환</th>
                  <th className="text-right p-2 w-28">작업</th>
                </tr>
              </thead>
              <tbody>
                {groupedUploads.map((g) => {
                  const converted = hasConvertedOutput(g.groupName);
                  const meta = parseGroupMeta(g.groupName);
                  const sourceCrs = g.sourceCrs ?? meta.sourceCrs;
                  const requiresCrsSelect = needsCrsSelectForGroup(g);
                  return (
                    <tr key={g.groupName} className="border-t border-border">
                      <td className="p-2 font-mono break-all">{`upload_data/satellite_tif/${g.groupName}`}</td>
                      <td className="p-2 font-mono">{sourceCrs || '-'}</td>
                      <td className="p-2">{meta.expectedLayerName}</td>
                      <td className="p-2 text-right text-muted-foreground">{g.files.length}</td>
                      <td className="p-2 text-center">
                        <span className={converted ? 'text-green-600 dark:text-green-400 font-semibold' : 'text-red-600 dark:text-red-400 font-semibold'}>
                          {converted ? 'O' : 'X'}
                        </span>
                      </td>
                      <td className="p-2 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs"
                          disabled={convertingGroup != null || batchRunning || crsWizardForBatch}
                          onClick={() => {
                            if (requiresCrsSelect) void openCrsModal(g.groupName);
                            else void runGroupConvert(g.groupName, sourceCrs);
                          }}
                        >
                          {convertingGroup === g.groupName ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <>
                              <Play className="w-3 h-3 mr-0.5" />
                              변환시작
                            </>
                          )}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog
        open={!!crsModalGroup}
        onOpenChange={(open) => {
          if (!open) {
            setCrsModalGroup(null);
            if (pendingTileBatchAfterCrsRef.current) {
              abortCrsBatchWizard();
              setConvertMsg('일괄 작업이 취소되었습니다. (좌표계 설정 중단)');
            }
          }
        }}
      >
        <DialogContent className="w-[1100px] max-w-[96vw] max-h-[88vh] overflow-hidden flex flex-col gap-0">
          <DialogHeader className="mb-[10px] shrink-0">
            <DialogTitle>
              원본 좌표계 선택 {crsModalGroup ? `- ${crsModalGroup}` : ''}
              {crsWizardForBatch && crsWizardRemainingRef.current.length > 0
                ? ` · 일괄 (${crsWizardRemainingRef.current.length}개 남음)`
                : ''}
            </DialogTitle>
          </DialogHeader>
          {crsLoading ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              후보 좌표계를 계산하는 중입니다...
            </div>
          ) : (
            <div className="min-h-0 overflow-y-auto pr-1">
              {!crsCandidates.length ? (
                <p className="text-xs text-muted-foreground">EMD와 겹치는 좌표계 후보를 찾지 못했습니다.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {crsCandidates.map((c) => {
                    const selected = selectedSourceCrs === c.sourceCrs;
                    return (
                      <div key={c.sourceCrs} className={`rounded border p-2 space-y-2 ${selected ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20' : 'border-border'}`}>
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            className="text-left font-medium text-sm hover:underline"
                            onClick={() => setSelectedSourceCrs(c.sourceCrs)}
                          >
                            {selected ? '●' : '○'} {c.sourceCrs}
                          </button>
                          <span className="text-[11px] text-muted-foreground">일치율 {(c.overlapRatio * 100).toFixed(1)}%</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          EMD 교차: {c.intersectsEmd ? '있음' : '없음'}
                        </div>
                        {crsModalGroup && <OrthophotoCrsPreviewMap groupName={crsModalGroup} epsg={c.epsg} />}
                        <p className="text-[10px] text-muted-foreground">
                          배경: VWorld 항공영상 · 네모 안: 가정 CRS로 워프한 샘플 TIF(저해상도, 서버 gdalwarp/translate).
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="flex flex-col gap-2 pt-2 border-t">
            <p className="text-[11px] text-muted-foreground">
              {crsWizardForBatch
                ? '저장하면 다음 그룹으로 넘어가며, 마지막 그룹 저장 후 타일 일괄 변환이 자동으로 시작됩니다. 창을 닫으면 일괄 작업 전체가 취소됩니다.'
                : '저장 후에는 닫히며 타일 변환은 시작하지 않습니다. 테이블에서 「변환시작」 또는 상단 「작업 일괄시작」을 사용하세요.'}
            </p>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                선택 좌표계: <span className="font-mono text-foreground">{selectedSourceCrs || '-'}</span>
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCrsModalGroup(null)}
                  disabled={crsSaving}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void confirmSourceCrs()}
                  disabled={!selectedSourceCrs || crsSaving}
                >
                  {crsSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : '좌표계 저장'}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
