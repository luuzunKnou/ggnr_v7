'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/app/shadcnComponents/ui/dialog';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { call } from '@/lib/api';
import { useChunkedUpload } from '../useChunkedUpload';
import { searchAddress } from '@/app/(pages)/map/_mapComponents/addressSearch/vworldAddressSearch';
import { Table2, ChevronRight, ChevronLeft, Loader2, Check } from 'lucide-react';
import * as XLSX from 'xlsx';

type ParseResult = {
  headers: string[];
  rows: Record<string, unknown>[];
  samples: Record<string, unknown[]>;
};

type FieldDef = { originalHeader: string; headerKor: string; headerEng: string; showList: boolean; showSearch: boolean; isKey: boolean };

/** 서버 excelUploadService.safeColumnName과 동일한 규칙으로 컬럼명 정규화 (attrs 키가 서버 colNames와 일치하도록) */
function safeColumnName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'col';
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relativePath: string;
  onSuccess?: () => void;
};

export function ExlWizardModal({ open, onOpenChange, relativePath, onSuccess }: Props) {
  const [step, setStep] = useState(1);
  const [pathOrResult, setPathOrResult] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedGeocodingHeader, setSelectedGeocodingHeader] = useState<string | null>(null);
  const [tableKor, setTableKor] = useState('');
  const [tableEng, setTableEng] = useState('');
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([]);
  const [geometryType, setGeometryType] = useState<'Point' | 'Polygon' | null>(null);
  const [step1Blocked, setStep1Blocked] = useState(true);
  /** 검사 실패 시 표시할 경고 문구 (한 줄씩) */
  const [step1Warnings, setStep1Warnings] = useState<string[]>([]);
  /** 엑셀 내용 읽어서 검사 중인지 */
  const [step1Validating, setStep1Validating] = useState(false);
  const [keyDuplicateError, setKeyDuplicateError] = useState<string | null>(null);
  /** 테이블/필드 영문명에 한글이 포함된 경우 경고 */
  const [engNameKoreanError, setEngNameKoreanError] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<{ VWORLD_API_KEY: string; OPENAI_API_KEY: string }>({ VWORLD_API_KEY: '', OPENAI_API_KEY: '' });
  const [processingLog, setProcessingLog] = useState<string[]>([]);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingDone, setProcessingDone] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  /** 파일 input에 파일이 올라왔는지 확인용 (선택된 파일명 표시) */
  const [selectedFileInfo, setSelectedFileInfo] = useState<{ name: string; size: number } | null>(null);
  const step4StartedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingLogScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    processingLogScrollRef.current?.scrollTo({ top: processingLogScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [processingLog]);

  const { upload, state: uploadState } = useChunkedUpload();

  useEffect(() => {
    if (open) {
      call('', 'POST', { service: 'configService', action: 'getMapConfig', params: {} })
        .then((r) => {
          const d = r?.data ?? r;
          setApiKeys({ VWORLD_API_KEY: d?.VWORLD_API_KEY ?? '', OPENAI_API_KEY: d?.OPENAI_API_KEY ?? '' });
        })
        .catch(() => {});
    }
  }, [open]);

  /** 클라이언트에서 엑셀 파일 읽어서 검사 (업로드 없음) */
  const handleFileSelected = useCallback(async (file: File) => {
    setSelectedFile(file);
    setStep1Warnings([]);
    setStep1Validating(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheetNames = wb.SheetNames;
      const sheetCount = sheetNames.length;
      const hasSingleSheet = sheetCount === 1;

      if (sheetCount === 0) {
        setStep1Blocked(true);
        setStep1Warnings(['시트가 없습니다.']);
        return;
      }
      if (!hasSingleSheet) {
        setStep1Blocked(true);
        setStep1Warnings(['엑셀 시트가 2개 이상입니다. 시트를 하나로 합친 뒤 다시 선택해 주세요.']);
        return;
      }

      const ws = wb.Sheets[sheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown as unknown[][];
      if (!data || data.length === 0) {
        setStep1Blocked(true);
        setStep1Warnings(['데이터가 없습니다.']);
        return;
      }

      // 헤더는 시트 맨 위 1행만 사용 (다음 행부터 데이터)
      const headerRow = (data[0] ?? []) as unknown[];
      const colCount = Math.max((headerRow ?? []).length, 1);
      // 병합 셀: 같은 행에서 빈 칸은 왼쪽 헤더 값으로 채움
      const carried: string[] = [];
      for (let j = 0; j < colCount; j++) {
        const v = String(headerRow[j] ?? '').trim();
        carried.push(v || (j > 0 ? carried[j - 1] : ''));
      }
      const usedHeaderNames = new Set<string>();
      const headers = carried.map((raw, j) => {
        const base = (raw.trim() || `col_${j}`) || `col_${j}`;
        let name = base;
        let n = 1;
        while (usedHeaderNames.has(name)) {
          n += 1;
          name = `${base}_${n}`;
        }
        usedHeaderNames.add(name);
        return name;
      });

      const rows: Record<string, unknown>[] = [];
      for (let i = 1; i < data.length; i++) {
        const row = data[i] as unknown[];
        const obj: Record<string, unknown> = {};
        headers.forEach((h, j) => {
          obj[h || `col_${j}`] = row[j] ?? '';
        });
        rows.push(obj);
      }
      const samples: Record<string, unknown[]> = {};
      headers.forEach((h, j) => {
        const key = h || `col_${j}`;
        samples[key] = rows.slice(0, 3).map((r) => r[key]);
      });

      setStep1Blocked(false);
      setStep1Warnings([]);
      setParseResult({ headers, rows, samples });
      setSelectedFileInfo({ name: file.name, size: file.size });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStep1Blocked(true);
      setStep1Warnings([msg || '파일을 읽는 중 오류가 났습니다. 다시 시도해 주세요.']);
    } finally {
      setStep1Validating(false);
    }
  }, []);

    const TOTAL_STEPS = 4;
  const stepLabels: Record<number, string> = {
    1: '01. 파일 업로드 및 무결성 검사',
    2: '02. 지도에 표현할 값 선택',
    3: '03. 영문·한글 파일명 및 필드명',
    4: '04. 데이터 처리',
  };

  const canGoStep2 = !step1Blocked && !step1Validating && !!parseResult;
  const hasKeySelected = fieldDefs.some((f) => f.isKey);
  const hasListSearchSelected = fieldDefs.some((f) => f.showList);
  const canGoStep3 =
    canGoStep2 &&
    selectedGeocodingHeader &&
    geometryType &&
    tableEng.trim() &&
    fieldDefs.every((f) => /^[a-zA-Z0-9_]+$/.test(f.headerEng)) &&
    hasKeySelected &&
    hasListSearchSelected &&
    !keyDuplicateError &&
    !engNameKoreanError;
  const goNext = () => {
    if (step === 1 && canGoStep2) setStep(2);
    else if (step === 2) setStep(3);
    else if (step === 3 && canGoStep3) setStep(4);
  };
  const goPrev = () => setStep((s) => Math.max(1, s - 1));

  useEffect(() => {
    if (step !== 3 || !parseResult) return;
    const loadFieldMap = async () => {
      const res = await call('', 'POST', { service: 'excelUploadService', action: 'readExcelFieldNameMap', params: {} });
      const d = res?.data ?? res;
      const map = (d?.map ?? {}) as Record<string, string>;
      const fileName = selectedFile?.name?.replace(/\.(xlsx|xls)$/i, '') ?? pathOrResult?.replace(/^.*[/\\]/, '').replace(/\.(xlsx|xls)$/i, '') ?? '';
      setTableKor((fileName || parseResult.headers[0]) ?? '');
      setTableEng('');
      setFieldDefs(
        parseResult.headers.map((h, idx) => ({
          originalHeader: h,
          headerKor: h,
          headerEng: map[h] ?? `value_${String(idx + 1).padStart(3, '0')}`,
          showList: false,
          showSearch: false,
          isKey: false,
        }))
      );
    };
    loadFieldMap();
  }, [step, parseResult, selectedFile?.name, pathOrResult]);

  const keyField = fieldDefs.find((f) => f.isKey)?.headerEng;
  useEffect(() => {
    if (step !== 3 || !parseResult?.rows?.length) {
      setKeyDuplicateError(null);
      return;
    }
    const keyFieldDef = fieldDefs.find((f) => f.isKey);
    if (!keyFieldDef) {
      setKeyDuplicateError(null);
      return;
    }
    const keyIdx = parseResult.headers.indexOf(keyFieldDef.originalHeader);
    if (keyIdx < 0) {
      setKeyDuplicateError(null);
      return;
    }
    const colKey = parseResult.headers[keyIdx];
    const values = parseResult.rows.map((r) => String(r[colKey] ?? '').trim());
    const set = new Set(values);
    const hasDuplicates = set.size < values.length;
    setKeyDuplicateError(
      hasDuplicates
        ? 'Key로 선택한 열에 중복된 값이 있습니다. 중복이 없는 열을 Key로 선택해 주세요.'
        : null
    );
  }, [step, fieldDefs, parseResult]);

  const hasKorean = (s: string) => /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(s);
  const hasSpace = (s: string) => /\s/.test(s);
  useEffect(() => {
    if (step !== 3) {
      setEngNameKoreanError(null);
      return;
    }
    if (hasKorean(tableEng.trim())) {
      setEngNameKoreanError('테이블 영문명에는 한글을 사용할 수 없습니다.');
      return;
    }
    const fieldWithKorean = fieldDefs.find((f) => hasKorean(f.headerEng));
    if (fieldWithKorean) {
      setEngNameKoreanError(`필드 영문명 '${fieldWithKorean.headerEng}'에 한글이 포함되어 있습니다. 영문, 숫자, 언더스코어(_)만 사용해 주세요.`);
      return;
    }
    if (hasSpace(tableEng)) {
      setEngNameKoreanError('테이블 영문명에는 공백을 사용할 수 없습니다.');
      return;
    }
    const fieldWithSpace = fieldDefs.find((f) => hasSpace(f.headerEng));
    if (fieldWithSpace) {
      setEngNameKoreanError(`필드 영문명 '${fieldWithSpace.headerEng}'에 공백이 포함되어 있습니다. 영문, 숫자, 언더스코어(_)만 사용해 주세요.`);
      return;
    }
    setEngNameKoreanError(null);
  }, [step, tableEng, fieldDefs]);

  const runStep4 = useCallback(async () => {
    if (!parseResult || !selectedGeocodingHeader || !tableEng.trim() || !keyField || !geometryType) return;
    setProcessingError(null);
    const lines: string[] = [];
    const pushLog = (...entries: string[]) => {
      for (const e of entries) lines.push(e);
      setProcessingLog((prev) => [...prev, ...entries]);
    };
    const flushLogToFile = async (effPath: string | null | undefined) => {
      const p = effPath?.trim();
      if (!p) return;
      try {
        await call('', 'POST', {
          service: 'excelUploadService',
          action: 'writeExcelWizardLog',
          params: { pathOrResult: p, uiLines: [...lines] },
        });
      } catch {
        /* ignore */
      }
    };

    pushLog('주소 추출 및 지오코딩을 시작합니다.');
    setProcessingProgress(2);

    let effectivePath: string | null = pathOrResult;
    if (selectedFile && !pathOrResult) {
      pushLog('파일을 서버에 저장 중...');
      const up = await upload(selectedFile, 'excel');
      if (!up?.savedPath) {
        const msg = up?.error ?? '파일 저장에 실패했습니다.';
        setProcessingError(msg);
        pushLog(msg);
        await flushLogToFile(effectivePath ?? undefined);
        return;
      }
      setPathOrResult(up.savedPath);
      effectivePath = up.savedPath;
      pushLog('파일 저장 완료.');
    }
    setProcessingProgress(5);

    const openaiKey = apiKeys.OPENAI_API_KEY;
    const vworldKey = apiKeys.VWORLD_API_KEY;
    if (!openaiKey) {
      const msg = 'OPENAI_API_KEY가 설정되지 않았습니다. runtime.env에 추가하세요.';
      setProcessingError(msg);
      pushLog(msg);
      await flushLogToFile(effectivePath);
      return;
    }
    if (!vworldKey) {
      const msg = 'VWORLD_API_KEY가 설정되지 않았습니다.';
      setProcessingError(msg);
      pushLog(msg);
      await flushLogToFile(effectivePath);
      return;
    }

    const GPT_PROMPT = `다음 주소 문자열에서 필지 단위 주소만 추출해서 JSON 배열로 답해줘.
                        규칙:
                        1. 쉼표나 공백으로 구분된 여러 본번-부번(예: "수하리 781-4, 702-2 번지", "신암리 25-4, 29-7, 38-3번지")이 있으면, 앞에 나온 시군구·읍면·리를 공통으로 붙여서 필지 하나당 주소 하나씩 나열해줘. 예: ["경상북도 영양군 수비면 수하리 781-4번지", "경상북도 영양군 수비면 수하리 702-2번지"]
                        2. "외 n필지"는 무시하고 대표필지로 입력된 필지만 입력해줘.
                        3. 각 주소는 "시도 시군구 읍면동 리 본번-부번번지" 또는 "시도 시군구 읍면동 리 도로명주소" 형식으로 통일해줘. "도로명주소" 같은 플레이스홀더는 쓰지 말고, 실제 주소만 넣어줘.
                        4. 응답은 JSON 배열만 출력해줘. 예: ["경상북도 영양군 수비면 수하리 781-4번지", "경상북도 영양군 수비면 수하리 702-2번지"]
                        5. 입력 문자열에 주소가 포함되어 있으면 반드시 추출한 주소들을 JSON 배열로 반환해줘. 주소가 있는데 빈 배열을 반환하거나 응답을 생략하지 마.`;

    const columns = fieldDefs.map((f) => ({
      define_field_name: f.headerEng,
      define_field_kor_name: f.headerKor,
      define_field_show_list: f.showList,
      define_field_show_search: f.showSearch,
      define_field_is_key: f.isKey,
    }));

    let geocodeFailCount = 0;
    const geocodeFailReasons: { address: string; reason: string }[] = [];
    const totalRows = parseResult.rows.length;
    let totalInsertCount = 0;
    let totalPolygonMatched = 0;
    let totalPolygonNull = 0;

    for (let i = 0; i < parseResult.rows.length; i++) {
      const row = parseResult.rows[i];
      const rawText = String(row[selectedGeocodingHeader] ?? '').trim();
      const attrs: Record<string, unknown> = {};
      parseResult.headers.forEach((h) => {
        const eng = fieldDefs.find((f) => f.originalHeader === h)?.headerEng ?? h;
        attrs[safeColumnName(eng)] = row[h];
      });

      let addresses: string[] = [];
      if (rawText) {
        try {
          const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: `${GPT_PROMPT}\n\n${rawText}` }],
              temperature: 0,
            }),
          });
          const gptJson = await gptRes.json();
          const content = gptJson?.choices?.[0]?.message?.content?.trim() ?? '';
          const match = content.match(/\[[\s\S]*\]/);
          if (match) {
            try {
              addresses = JSON.parse(match[0]) as string[];
            } catch {
              addresses = rawText ? [rawText] : [];
            }
          } else {
            addresses = rawText ? [rawText] : [];
          }
        } catch (e) {
          addresses = rawText ? [rawText] : [];
        }
      }

      const parcels: { address: string; x?: number; y?: number }[] = [];
      for (const addr of addresses) {
        if (!addr.trim()) continue;
        try {
          const items = await searchAddress(addr, { apiKey: vworldKey, maxResults: 1 });
          const first = items?.[0];
          if (first?.point?.x != null && first.point.y != null) {
            parcels.push({ address: addr, x: first.point.x, y: first.point.y });
          } else {
            geocodeFailCount++;
            parcels.push({ address: addr });
            geocodeFailReasons.push({ address: addr, reason: '검색 결과 없음 또는 좌표 없음' });
          }
        } catch (e: unknown) {
          geocodeFailCount++;
          parcels.push({ address: addr });
          const msg = e instanceof Error ? e.message : String(e);
          geocodeFailReasons.push({ address: addr, reason: msg || 'API 오류' });
        }
      }
      if (addresses.length === 0) parcels.push({ address: '' });

      const coordOk = parcels.filter((p) => p.x != null && p.y != null).length;
      const resultText =
        addresses.length > 0
          ? ` — 필지 ${addresses.length}개 추출, ${coordOk}개 좌표 획득`
          : !rawText
            ? ' — 주소 없음 (엑셀 셀 비어 있음)'
            : ' — 주소 없음 (GPT 변환 결과 없음)';
      const rowLogLines = [`행 ${i + 1}/${totalRows} 처리${resultText}`];
      if (rawText) {
        addresses.filter((a) => a.trim()).forEach((a) => rowLogLines.push(`  ${rawText} > ${a}`));
      } else {
        addresses.filter((a) => a.trim()).forEach((a) => rowLogLines.push(`  · ${a}`));
      }
      parcels.filter((p) => p.x != null && p.y != null).forEach((p) => {
        rowLogLines.push(`    좌표 획득: ${p.address} → (x: ${p.x}, y: ${p.y})`);
      });
      setProcessingProgress(Math.round(15 + (65 * (i + 1)) / totalRows));
      pushLog(...rowLogLines);

      // 좌표 가져온 직후 해당 행만 서버에 INSERT (한 줄씩)
      try {
        const createRes = await call('', 'POST', {
          service: 'excelUploadService',
          action: 'createTableFromExcel',
          params: {
            pathOrResult: effectivePath ?? undefined,
            tableName: tableEng,
            tableKorName: tableKor || tableEng,
            keyField,
            columns,
            geometryType,
            rows: [{ attrs, parcels }],
            appendOnly: i > 0,
          },
        });
        const createData = createRes?.data ?? createRes;
        if (!createData?.success) {
          const err = createData?.error ?? '행 삽입 실패';
          setProcessingError(err);
          pushLog(err);
          await flushLogToFile(effectivePath);
          return;
        }
        totalInsertCount += createData.rowCount ?? 0;
        if (geometryType === 'Polygon') {
          totalPolygonMatched += createData.polygonMatchedCount ?? 0;
          totalPolygonNull += createData.polygonNullCount ?? 0;
        }
      } catch (e: unknown) {
        const err = e instanceof Error ? e.message : String(e);
        setProcessingError(err);
        pushLog(err);
        await flushLogToFile(effectivePath);
        return;
      }
    }

    const failLogLines = [`지오코딩 실패: ${geocodeFailCount}건`];
    geocodeFailReasons.forEach(({ address, reason }) => {
      failLogLines.push(`  · ${address}: ${reason}`);
    });
    pushLog(...failLogLines);
    setProcessingProgress(85);

    try {
      if (geometryType === 'Polygon' && (totalPolygonMatched > 0 || totalPolygonNull > 0)) {
        pushLog(
          `[지적(jijuk) 폴리곤 매칭] 성공 ${totalPolygonMatched}건, 미매칭(geom NULL) ${totalPolygonNull}건`,
          '  - 서버 콘솔에서 상세 로그 확인 가능 (매칭 성공/미매칭 좌표, 오류 메시지)',
        );
      }
      setProcessingProgress(90);
      await call('', 'POST', {
        service: 'excelUploadService',
        action: 'createDefineTableAndFieldsForExcel',
        params: { tableName: tableEng, tableKorName: tableKor || tableEng, geometryType, columns },
      });
      setProcessingProgress(95);
      await call('', 'POST', {
        service: 'excelUploadService',
        action: 'createGeoServerLayerForExcel',
        params: { tableName: tableEng, geometryType },
      });
      const fieldMap: Record<string, string> = {};
      fieldDefs.forEach((f) => {
        if (f.headerEng) fieldMap[f.originalHeader] = f.headerEng;
      });
      await call('', 'POST', {
        service: 'excelUploadService',
        action: 'writeExcelFieldNameMap',
        params: { entries: fieldMap },
      });
      setProcessingProgress(100);
      pushLog('완료.', `삽입 행 수: ${totalInsertCount}`);
      await flushLogToFile(effectivePath);
      const geocodingDef = selectedGeocodingHeader
        ? fieldDefs.find((f) => f.originalHeader === selectedGeocodingHeader)
        : undefined;
      await call('', 'POST', {
        service: 'excelHistoryService',
        action: 'createExcelHistory',
        params: {
          sourcePath: effectivePath ?? undefined,
          tableName: tableEng,
          tableKorName: tableKor || tableEng,
          group: '',
          rowCount: totalInsertCount,
          result: '성공',
          contents: `삽입 ${totalInsertCount}건`,
          geocodingHeaderKor: selectedGeocodingHeader ?? undefined,
          geocodingHeaderEng: geocodingDef?.headerEng,
          geometryType: geometryType ?? undefined,
        },
      }).catch(() => {});
      setProcessingDone(true);
      onSuccess?.();
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      setProcessingError(err);
      pushLog(err);
      await flushLogToFile(effectivePath);
    }
  }, [parseResult, selectedGeocodingHeader, tableEng, tableKor, keyField, fieldDefs, geometryType, apiKeys, onSuccess, selectedFile, pathOrResult, upload]);

  useEffect(() => {
    if (step === 4 && !step4StartedRef.current && !processingDone && !processingError) {
      step4StartedRef.current = true;
      runStep4();
    }
  }, [step, processingDone, processingError, runStep4]);

  const handleClose = () => {
    step4StartedRef.current = false;
    setStep(1);
    setPathOrResult(null);
    setSelectedFile(null);
    setParseResult(null);
    setSelectedGeocodingHeader(null);
    setStep1Warnings([]);
    setStep1Validating(false);
    setSelectedFileInfo(null);
    setEngNameKoreanError(null);
    setProcessingLog([]);
    setProcessingProgress(0);
    setProcessingDone(false);
    setProcessingError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="w-[1200px] h-[700px] min-w-[1200px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col gap-y-2 p-4" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Table2 className="h-5 w-5 shrink-0 text-primary" />
            Excel 파일 업로드 - {stepLabels[step] ?? step} ({step}/{TOTAL_STEPS})
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 space-y-4 py-2">
          {step === 1 && (
            <>
              <div className="text-sm text-muted-foreground space-y-1">
                <p className="flex items-center gap-2 text-primary mb-3">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  시스템에 업로드할 엑셀 파일을 선택합니다.
                </p>
                <p>원활한 데이터 처리를 위해 단일 시트로 구성된 파일만 업로드해 주세요.</p>
              </div>
              <div className="border rounded p-2 mt-5">
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelected(file);
                      else setSelectedFileInfo(null);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={step1Validating}
                  >
                    파일 선택
                  </Button>
                  {selectedFileInfo && !step1Validating && (
                    <span className="text-sm text-muted-foreground">
                      {selectedFileInfo.name} · {selectedFileInfo.size.toLocaleString()} bytes
                    </span>
                  )}
                  {uploadState.status === 'uploading' && (
                    <span className="text-sm text-muted-foreground">파일 저장 중... {uploadState.progress}%</span>
                  )}
                </div>
              </div>
              {step1Validating && (
                <p className="text-sm text-muted-foreground">엑셀 파일 내용을 읽고 검사 중입니다...</p>
              )}
              {step1Warnings.length > 0 && (
                <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {step1Warnings.map((msg, i) => (
                    <p key={i}>{msg}</p>
                  ))}
                </div>
              )}
              {parseResult && !step1Blocked && !step1Validating && (
                <div className="rounded-md border border-green-500/50 bg-green-500/5 px-3 py-2 text-sm text-green-600">
                  <p>검사 결과를 확인했습니다. 다음 버튼을 눌러 계속 진행해 주세요.</p>
                </div>
              )}
            </>
          )}
          {step === 2 && parseResult && (
            <>
              <p className="flex items-center gap-2 text-primary mb-3 text-sm">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                지도에 도형으로 표현할 값을 선택합니다.
              </p>
              <div className="text-sm text-muted-foreground space-y-1 mb-5">
                <p>1. 주소가 입력되어 있는 열을 선택하세요.</p>
                <p>2. 선택한 열은 지도에 표시할 위치를 만드는 데 사용됩니다.</p>
                <p>3. 선택된 값은 설정에 따라 필지모양 또는 점 형태로 표현됩니다.</p>
              </div>
              <div className="mb-7">
                <p className="flex items-center gap-2 text-sm font-medium mb-2">
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                  지도에 표현할 형태를 선택해주세요.
                </p>
                <div className="flex gap-6 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="geomType" checked={geometryType === 'Polygon'} onChange={() => setGeometryType('Polygon')} />
                    필지모양으로 표현
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="geomType" checked={geometryType === 'Point'} onChange={() => setGeometryType('Point')} />
                    점 형태로 표현
                  </label>
                </div>
              </div>
              <div className="border border-gray-200 rounded-[5px] h-[380px] overflow-auto">
                {parseResult.headers.map((h, idx) => (
                  <div
                    key={`geocode-col-${idx}`}
                    className="flex items-center gap-2 border-b border-gray-200 last:border-b-0 px-3 py-2 min-h-[2.5rem]"
                  >
                    <input
                      type="radio"
                      name="geocoding"
                      id={`geocode-col-${idx}`}
                      checked={selectedGeocodingHeader === h}
                      onChange={() => setSelectedGeocodingHeader(h)}
                    />
                    <label htmlFor={`geocode-col-${idx}`} className="flex-1 flex items-center gap-2 cursor-pointer text-sm font-medium min-w-0">
                      <span className="shrink-0 w-[180px] truncate" title={h}>
                        {h}
                      </span>
                      <span className="text-muted-foreground text-xs truncate">
                        {[0, 1, 2].map((i) => parseResult.samples[h]?.[i]).filter(Boolean).join(', ')}
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </>
          )}
          {step === 3 && parseResult && (
            <>
              <p className="flex items-center gap-2 text-primary mb-3 text-sm">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                테이블 및 필드의 한글/영문 명칭과 표시 옵션을 설정해 주세요.
              </p>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>1. 데이터의 한글명·영문명을 입력해 주세요.</p>
                <p>2. 목록보기·검색에 사용할 값을 선택해주세요(3~4개 추천).</p>
                <p>3. 식별번호로 활용할 값을 선택해주세요. 중복된 값이 있는 열은 사용할 수 없습니다.</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-green-600" aria-hidden />
                  <label className="text-sm font-medium shrink-0">테이블 한글명</label>
                  <Input value={tableKor} onChange={(e) => setTableKor(e.target.value)} className="w-48 h-7 px-1.5 py-0.5 text-sm !text-gray-500" />
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-green-600" aria-hidden />
                  <label className="text-sm font-medium shrink-0">테이블 영문명</label>
                  <Input
                    value={tableEng}
                    onChange={(e) => setTableEng(e.target.value)}
                    className="w-48 h-7 px-1.5 py-0.5 text-sm !text-gray-500"
                  />
                </div>
              </div>
              <div className="border border-gray-200 rounded-[5px] h-[430px] overflow-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-100 border-b border-gray-200">
                      <th className="text-left font-medium py-1.5 px-3 border-r border-gray-200 last:border-r-0 text-sm">한글명</th>
                      <th className="text-left font-medium py-1.5 px-3 border-r border-gray-200 last:border-r-0 text-sm">영문명</th>
                      <th className="text-center font-medium py-1.5 px-3 border-r border-gray-200 last:border-r-0 w-20 text-sm">목록·검색</th>
                      <th className="text-center font-medium py-1.5 px-3 w-14 text-sm">Key</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fieldDefs.map((f, idx) => (
                      <tr key={idx} className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50/50">
                        <td className="p-0 h-8 border-r border-gray-200 align-middle">
                          <Input
                            className="h-full w-full border-0 border-l-2 border-l-transparent rounded-none bg-transparent text-foreground focus-visible:ring-1 focus-visible:border-l-primary focus-visible:border-l-2 px-3 py-1 [color:inherit]"
                            value={f.headerKor}
                            onChange={(e) =>
                              setFieldDefs((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], headerKor: e.target.value };
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="p-0 h-8 border-r border-gray-200 align-middle">
                          <Input
                            className="h-full w-full border-0 border-l-2 border-l-transparent rounded-none bg-transparent !text-gray-500 focus-visible:ring-1 focus-visible:border-l-primary focus-visible:border-l-2 px-3 py-1"
                            value={f.headerEng}
                            onChange={(e) =>
                              setFieldDefs((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], headerEng: e.target.value };
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="p-0 h-8 border-r border-gray-200 align-middle">
                          <label className="flex h-full w-full cursor-pointer items-center justify-center py-1 px-2">
                            <input
                              type="checkbox"
                              checked={f.showList}
                              onChange={(e) => {
                                const v = e.target.checked;
                                setFieldDefs((prev) => { const n = [...prev]; n[idx] = { ...n[idx], showList: v, showSearch: v }; return n; });
                              }}
                            />
                          </label>
                        </td>
                        <td className="p-0 h-8 align-middle">
                          <label className="flex h-full w-full cursor-pointer items-center justify-center py-1 px-2">
                            <input
                              type="radio"
                              name="keyField"
                              checked={f.isKey}
                              onChange={() => setFieldDefs((prev) => prev.map((x, i) => ({ ...x, isKey: i === idx })))}
                            />
                          </label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
          )}
          {step === 4 && (
            <>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>데이터를 처리하고 지도 레이어를 만듭니다.</p>
                <p>진행 상황은 아래 로그에서 확인할 수 있습니다.</p>
              </div>
              <div className="w-full bg-muted rounded h-2">
                <div className="bg-primary h-2 rounded transition-all" style={{ width: `${processingProgress}%` }} />
              </div>
              {processingError && <p className="text-sm text-destructive">{processingError}</p>}
              <div
                ref={processingLogScrollRef}
                className="border border-input rounded-md bg-background shadow-xs p-3 text-xs font-mono h-[340px] overflow-auto"
              >
                {processingLog.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </>
          )}
        </div>
        <DialogFooter className="pt-1 pb-0 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {step === 3 && (
            <div className="w-full sm:flex-1 sm:min-w-0 text-left">
              {(keyDuplicateError || engNameKoreanError) && (
                <p className="text-sm text-destructive">
                  {keyDuplicateError ?? engNameKoreanError}
                </p>
              )}
            </div>
          )}
          <div className="flex gap-2 sm:ml-auto">
          {step > 1 && step < 4 && (
            <Button variant="outline" onClick={goPrev}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              이전
            </Button>
          )}
          {step < 4 && (
            <Button variant="outline" onClick={goNext} disabled={(step === 1 && !canGoStep2) || (step === 2 && (!selectedGeocodingHeader || !geometryType)) || (step === 3 && !canGoStep3)}>
              다음
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 4 && (processingDone || processingError) && (
            <Button onClick={handleClose}>닫기</Button>
          )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
