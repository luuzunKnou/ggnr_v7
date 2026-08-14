'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
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
import { getCoordFromAddress } from '@/app/(pages)/map/_mapComponents/addressSearch/vworldAddressSearch';
import { hangjeongRiAddressAlt } from '@/lib/excelUploadAddressNormalize';
import { ChevronRight, ChevronLeft, ChevronDown, Loader2, Check } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  parseExcelMatrix,
  coerceExcelDateCellsInAoa,
  SHEET_TO_JSON_HEADER1_DISPLAY,
} from '@/lib/excelSheetParse';
import {
  SPREADSHEET_ACCEPT,
  csvEncodingLabel,
  readWorkbookFromBuffer,
} from '@/lib/excelWorkbookRead';
import { LEDGER_ROW_KEY_HEADER, expandDevBehaviorLedgerRowsAsync } from '@/lib/excelDevLedgerExpand';
import { cn } from '@/lib/utils';
import { useSession } from 'next-auth/react';
import {
  buildExcelWizardClosingLines,
  buildExcelWizardMetaLines,
  formatGeocodeFailLine,
  formatProcessDuration,
} from './excelWizardProcessLog';
import { ExcelProcessLogLines } from './ExcelProcessLogLines';
import {
  EXCEL_COMPOSITE_KEY_ENG,
  EXCEL_COMPOSITE_KEY_KOR,
  EXCEL_LAYER_SYSTEM_COLS,
  type ExcelWizardKeyMode,
  buildExcelCompositeKeyValue,
  isExcelSystemAttrField,
  isExcelSystemKeyColumn,
} from './excelWizardKey';
import { SyncDetailModal } from '../shp/SyncDetailModal';
import { requestExcelHistoryRefresh } from '../layerManager/layerManagerUploadBridge';

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

function safeTableName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'layer_table';
}

/** 1단계: 업로드·후속 처리 방식 (항목 추가 시 배열만 확장) */
export const EXCEL_UPLOAD_WORKFLOW_OPTIONS: ReadonlyArray<{
  id: string;
  title: string;
  description: string;
}> = [
  {
    id: 'standard',
    title: '일반 업로드',
    description: '엑셀 헤더·데이터를 그대로 반영하여 레이어를 구성합니다.',
  },
  {
    id: 'dev_behavior_ledger',
    title: '개발행위대장',
    description:
      '4단계에서 행을 나누고 행키를 부여합니다. 단순 패턴은 규칙, 값에 키워드만 섞인 경우 GPT가 분리합니다.',
  },
  {
    id: 'occupancy_ledger',
    title: '점용대장',
    description:
      '개발행위대장과 동일하게 4단계에서 행을 나누고 행키를 부여합니다. 단순 패턴은 규칙, 값에 키워드만 섞인 경우 GPT가 분리합니다.',
  },
  {
    id: 'andong_road_use_ledger',
    title: '안동 도로점용대장',
    description:
      '점용대장정보(1)-부과정보(N)-점용지/물건지(N) 구조로 전산화합니다. 필지 분할은 GPT, 도형은 VWorld+지적 폴백을 사용합니다.',
  },
];

type ParcelSelectMode = 'singleColumn' | 'splitColumns';

/** 시도·시군구·읍면동·리·지번 열 구분용 — 샘플(또는 임의 문자열) 키워드·정규식 점수 */
type SplitParcelRole = 'sido' | 'sigungu' | 'emd' | 'ri' | 'jibun';

/** 열 헤더에 대응하는 샘플 셀 값만 이어 붙임(최대 maxCells개) — 추천 점수는 주로 이 문자열로 계산 */
function joinedSampleText(samples: Record<string, unknown[]>, header: string, maxCells = 5): string {
  const arr = samples[header];
  if (!Array.isArray(arr)) return '';
  const parts: string[] = [];
  for (let i = 0; i < Math.min(arr.length, maxCells); i++) {
    const s = String(arr[i] ?? '').trim();
    if (s) parts.push(s);
  }
  return parts.join(' ');
}

function scoreParcelTextForRole(text: string, role: SplitParcelRole): number {
  const h = String(text ?? '').trim();
  if (!h) return 0;
  const compact = h.replace(/\s/g, '');
  let score = 0;
  switch (role) {
    case 'sido':
      if (/시\s*도|시도명|광역|특별시|광역시|특별자치/.test(h)) score += 14;
      if (/도명|^도$|_도_/.test(h)) score += 5;
      if (/^[가-힣]{2,6}도$/.test(compact)) score += 7;
      if (/^[가-힣]{2,6}도(\s|$)/.test(h)) score += 9;
      break;
    case 'sigungu':
      if (/시\s*군\s*구|시군구|군구|군청|구청|군구명/.test(h)) score += 14;
      if (/[가-힣]+(시|군|구)$/.test(compact) && !/읍면동|행정동|법정동/.test(h)) score += 6;
      if (/(군|구)$/.test(compact)) score += 4;
      if (/[가-힣]{2,8}(시|군|구)(\s|$)/.test(h)) score += 7;
      break;
    case 'emd':
      if (/읍\s*면\s*동|읍면동|법정동|행정동|읍면/.test(h)) score += 14;
      if (/동$|면$|읍$/.test(compact)) score += 8;
      if (/동|면|읍/.test(h)) score += 4;
      if (/[가-힣]{1,8}(읍|면|동)(\s|$)/.test(h)) score += 6;
      break;
    case 'ri':
      if (/리명|마을|자연리/.test(h)) score += 10;
      if (/리$/.test(compact)) score += 8;
      if (/리/.test(h) && !/읍면동|행정동|법정동/.test(h)) score += 3;
      if (/[가-힣\d\s]+리(\s|$)/.test(h)) score += 5;
      break;
    case 'jibun':
      if (/번지|본번|부번|지번|지번본번|번\s*지/.test(h)) score += 14;
      if (/번$/.test(compact)) score += 8;
      if (/호$|호번|블록/.test(compact)) score += 5;
      if (/\d+\s*-\s*\d+/.test(h)) score += 9;
      if (/\d/.test(h) && /번지|번$|호/.test(h)) score += 5;
      break;
  }
  return score;
}

const SPLIT_PARCEL_MIN_SCORE = 5;

function scoreParcelColumnFromSamples(
  header: string,
  samples: Record<string, unknown[]>,
  role: SplitParcelRole
): number {
  const sampleStr = joinedSampleText(samples, header, 6);
  const scSample = sampleStr ? scoreParcelTextForRole(sampleStr, role) : 0;
  const scHeader = scoreParcelTextForRole(header, role);
  return scSample * 2 + Math.min(scHeader, 6);
}

function suggestSplitParcelColumns(
  headers: string[],
  samples: Record<string, unknown[]>
): {
  picks: Record<SplitParcelRole, string | null>;
  recommended: Record<SplitParcelRole, string | null>;
} {
  const picks: Record<SplitParcelRole, string | null> = {
    sido: null,
    sigungu: null,
    emd: null,
    ri: null,
    jibun: null,
  };
  const used = new Set<string>();
  const order: SplitParcelRole[] = ['emd', 'jibun', 'sigungu', 'sido', 'ri'];
  for (const role of order) {
    let best: string | null = null;
    let bestSc = 0;
    for (const cand of headers) {
      if (used.has(cand)) continue;
      const sc = scoreParcelColumnFromSamples(cand, samples, role);
      if (sc > bestSc) {
        bestSc = sc;
        best = cand;
      }
    }
    if (best && bestSc >= SPLIT_PARCEL_MIN_SCORE) {
      picks[role] = best;
      used.add(best);
    }
  }
  return { picks, recommended: { ...picks } };
}

function splitParcelOptionLabel(header: string, role: SplitParcelRole, sug: ReturnType<typeof suggestSplitParcelColumns> | null): string {
  if (!sug?.recommended[role] || sug.recommended[role] !== header) return header;
  return `${header}  [추천]`;
}

function findHeaderByCandidates(headers: string[], candidates: string[]): string | null {
  const normalizedHeaders = headers.map((h) => ({ raw: h, norm: h.replace(/\s/g, '').toLowerCase() }));
  const normalizedCandidates = candidates.map((c) => c.replace(/\s/g, '').toLowerCase());
  for (const cand of normalizedCandidates) {
    const exact = normalizedHeaders.find((h) => h.norm === cand);
    if (exact) return exact.raw;
  }
  for (const cand of normalizedCandidates) {
    const partial = normalizedHeaders.find((h) => h.norm.includes(cand) || cand.includes(h.norm));
    if (partial) return partial.raw;
  }
  return null;
}

/** 한 열 주소 통합: 샘플 문자열 기준 점수 */
function scoreUnifiedAddressText(text: string): number {
  const h = String(text ?? '').trim();
  if (!h) return 0;
  const compact = h.replace(/\s/g, '');
  let score = 0;
  if (/통합\s*주소|전체\s*주소|세부\s*주소|필지\s*주소|주소\s*통합/.test(h)) score += 14;
  if (/주소|번지|지번|도로명|위치/.test(h)) score += 8;
  if (/번$|지번/.test(compact)) score += 6;
  if (/시|군|구|읍|면|동/.test(h)) score += 3;
  if (/\d/.test(h) && (/번지|도로|로\s|길\s/.test(h) || /\d+\s*-\s*\d+/.test(h))) score += 8;
  if (/[가-힣]{2,6}도/.test(h) && /(읍|면|동|리|번지)/.test(h)) score += 10;
  return score;
}

function scoreUnifiedAddressColumn(header: string, samples: Record<string, unknown[]>): number {
  const sampleStr = joinedSampleText(samples, header, 6);
  const scSample = sampleStr ? scoreUnifiedAddressText(sampleStr) : 0;
  const scHeader = scoreUnifiedAddressText(header);
  return scSample * 2 + Math.min(scHeader, 6);
}

function pickUnifiedAddressHeader(
  headers: string[],
  samples: Record<string, unknown[]>,
  options?: { preferGeom?: boolean }
): string | null {
  if (options?.preferGeom) {
    const geomHeader = headers.find((h) => h.trim().toLowerCase() === 'geom');
    if (geomHeader) {
      const vals = samples[geomHeader] ?? [];
      const hasData = vals.some((v) => String(v ?? '').trim() !== '');
      if (hasData) return geomHeader;
    }
  }
  let best: string | null = null;
  let bestSc = 0;
  for (const h of headers) {
    const sc = scoreUnifiedAddressColumn(h, samples);
    if (sc > bestSc) {
      bestSc = sc;
      best = h;
    }
  }
  return best && bestSc >= SPLIT_PARCEL_MIN_SCORE ? best : null;
}

/**
 * 엑셀/대장 흔한 표기 정리: "외 N번지·외N번지·외 N필지"는 검색에서 빼고 대표 지번만 남김.
 * 예: "장기 812외2번지" → "장기 812번지"
 */
function normalizeExcelAddressForGeocode(s: string): string {
  let t = String(s ?? '').trim();
  if (!t) return t;
  // "716-29외2번지" → "716-29번지" (부번 뒤의 외N만; "29"만 잡아 29번지로 바뀌는 오류 방지)
  t = t.replace(/([0-9]+(?:-[0-9]+)?)\s*외\s*\d+\s*(?:번지|필지)/gi, '$1번지');
  t = t.replace(/\s*외\s*\d+\s*(?:번지|필지)\s*/gi, ' ');
  // "번지선", "하천", "하천부지" 같은 지번 뒤 설명어 제거
  t = t.replace(/번지선/gi, '번지');
  t = t.replace(/\s*하천부지\s*/gi, ' ');
  t = t.replace(/\s*하천\s*/gi, ' ');
  // 5자리 이상 숫자는 본번·부번이 아니므로 제거 (주민번호·관리번호 등 오염 방지)
  t = t.replace(/\b\d{5,}\b/g, '');
  return t.replace(/\s{2,}/g, ' ').trim();
}

/** 원주소 실패 시 행정리→법정리 주소로 VWorld GetCoord 재시도 */
async function getCoordFromAddressWithHangjeongRiFallback(
  addr: string,
  apiKey: string
): Promise<{
  ok: boolean;
  lon?: number;
  lat?: number;
  message?: string;
  hangjeongFix: string | null;
}> {
  let coord = await getCoordFromAddress(addr, { apiKey, type: 'ROAD' });
  if (!coord.ok) {
    coord = await getCoordFromAddress(addr, { apiKey, type: 'PARCEL' });
  }
  if (coord.ok) return { ...coord, hangjeongFix: null };
  const alt = hangjeongRiAddressAlt(addr);
  if (!alt) return { ...coord, hangjeongFix: null };
  let retry = await getCoordFromAddress(alt, { apiKey, type: 'ROAD' });
  if (!retry.ok) {
    retry = await getCoordFromAddress(alt, { apiKey, type: 'PARCEL' });
  }
  if (retry.ok) {
    return { ...retry, hangjeongFix: `${addr} → ${alt}` };
  }
  return { ...coord, hangjeongFix: null };
}

type SplitParcelCfg = {
  sidoCol: string | null;
  sidoFixed: string;
  sigunguCol: string | null;
  sigunguFixed: string;
  emdCol: string | null;
  riCol: string | null;
  jibunCol: string | null;
};

function countRegexMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

/**
 * 로컬은 "복수 필지 여부 판단"만 수행.
 * - 콤마/줄바꿈/물결
 * - 하이픈 지번 패턴 다중 등장
 * - '번지' 토큰 다중 등장
 */
function isLikelyMultiParcelAddress(raw: string): boolean {
  const t = normalizeExcelAddressForGeocode(raw);
  if (!t) return false;
  if (/[,\n\r~]/.test(t)) return true;
  if (countRegexMatches(t, /\d+\s*-\s*\d+/g) >= 2) return true;
  if (countRegexMatches(t, /번지/gi) >= 2) return true;
  // 공백으로 이어진 지번 나열(예: 781-4 702-2)
  if (/\d+\s*-\s*\d+\s+\d+\s*-\s*\d+/.test(t)) return true;
  // 숫자-(한글/영문 단어 1개 이상)-숫자 → 지번이 여러 개로 추정 (공백 포함 멀티워드도 감지)
  if (/\d+(?:\s+[가-힣A-Za-z]+)+\s+\d+/.test(t)) return true;
  // "번지" 뒤에 읍/면/동/리가 또 나오면 새 필지 주소가 시작됨 (예: "236번지 입암면 금학리 1203")
  if (/번지\s+[가-힣]+(?:읍|면|동|리)/.test(t)) return true;
  // 시·도 행정구역 단위(도/광역시/특별시 등)가 2번 이상 → 전체 주소가 반복됨 (예: "...도곡리 630 경상북도 영양군...")
  if (countRegexMatches(t, /[가-힣]+(?:도|광역시|특별시|특별자치시|특별자치도)/g) >= 2) return true;
  return false;
}

const SINGLE_COLUMN_GPT_BATCH_MAX = 12;
/** 신규 테이블 클라이언트 배치 INSERT 크기 */
const EXCEL_CLIENT_INSERT_BATCH = 200;
/** geom 모드에서 이 행 수 이상이면 서버 bulk 경로 */
const EXCEL_GEOM_BULK_MIN_ROWS = 2000;
/** geom 모드 상세 로그 간격 */
const EXCEL_GEOM_LOG_EVERY = 1000;

function extractJsonObjectFromGptText(text: string): unknown {
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : t;
  const obj = body.match(/\{[\s\S]*\}/);
  if (!obj) return null;
  try {
    return JSON.parse(obj[0]) as unknown;
  } catch {
    return null;
  }
}

async function fetchGptSingleColumnAddressBatch(
  openaiKey: string,
  chunk: { i: number; text: string }[],
  rulesBlock: string
): Promise<Map<number, string[]>> {
  const byRow = new Map<number, string[]>();
  const n = chunk.length;
  if (n === 0) return byRow;
  const lines = chunk.map((r, order) => `order=${order}: ${r.text}`).join('\n');
  const userContent = `${rulesBlock}

같은 배치에서 여러 행의 주소 입력이 아래에 순서(order)대로 나열되었습니다. 각 order마다 **해당 한 줄 입력만** 보고 위 규칙과 동일하게 필지 단위 주소를 추출하세요.

응답은 JSON 객체 하나만 (설명·마크다운 코드펜스 없이):
{
  "rows": [
    { "order": 0, "addresses": ["필지주소1", "필지주소2"] },
    { "order": 1, "addresses": ["..."] }
  ]
}
- rows 배열 길이는 정확히 ${n}이어야 합니다.
- 각 요소의 order는 0부터 ${n - 1}까지 정확히 한 번씩이어야 합니다.
- 각 addresses는 해당 order 입력에 대한 필지 주소 문자열의 JSON 배열입니다.

배치 입력:
${lines}`;

  const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: userContent }],
      temperature: 0,
    }),
  });
  const gptJson = (await gptRes.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!gptRes.ok) {
    throw new Error(gptJson?.error?.message ?? `OpenAI HTTP ${gptRes.status}`);
  }
  const content = gptJson?.choices?.[0]?.message?.content?.trim() ?? '';
  const parsed = extractJsonObjectFromGptText(content) as {
    rows?: { order?: number; addresses?: unknown }[];
  } | null;
  const rowsOut = parsed?.rows;
  if (!Array.isArray(rowsOut) || rowsOut.length !== n) {
    throw new Error(`GPT 배치 응답 rows 개수 불일치 (기대 ${n}, 실제 ${Array.isArray(rowsOut) ? rowsOut.length : '없음'})`);
  }
  const byOrder = new Map<number, string[]>();
  for (const row of rowsOut) {
    const ord = typeof row.order === 'number' ? row.order : NaN;
    if (!Number.isFinite(ord) || ord < 0 || ord >= n) continue;
    const arr = row.addresses;
    if (!Array.isArray(arr)) continue;
    const strings = arr.map((x) => String(x ?? '').trim()).filter(Boolean);
    if (strings.length > 0) byOrder.set(ord, strings);
  }
  for (let ord = 0; ord < n; ord++) {
    const p = chunk[ord]!;
    const strings = byOrder.get(ord);
    byRow.set(p.i, strings && strings.length > 0 ? strings : [p.text]);
  }
  return byRow;
}

/** 읍면동·리·지번 열을 하나의 통합 문자열로 조립 (0단계) */
function buildUnifiedAddressFromSplit(row: Record<string, unknown>, c: SplitParcelCfg): string {
  const cell = (h: string | null) => (h ? String(row[h] ?? '').trim() : '');
  const sido = (c.sidoCol ? cell(c.sidoCol) : '') || c.sidoFixed.trim();
  const sigungu = (c.sigunguCol ? cell(c.sigunguCol) : '') || c.sigunguFixed.trim();
  const emd = c.emdCol ? cell(c.emdCol) : '';
  const ri = c.riCol ? cell(c.riCol) : '';
  let jibun = c.jibunCol ? cell(c.jibunCol) : '';
  if (jibun && /\d/.test(jibun) && !/번지\s*$/.test(jibun)) jibun = `${jibun}번지`;
  return [sido, sigungu, emd, ri, jibun].filter(Boolean).join(' ');
}

function excelColumnToZeroBasedIndex(col: string): number {
  const up = String(col ?? '').trim().toUpperCase();
  if (!/^[A-Z]+$/.test(up)) return -1;
  let n = 0;
  for (const ch of up) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function headerByExcelColumn(headers: string[], col: string): string | null {
  const idx = excelColumnToZeroBasedIndex(col);
  if (idx < 0 || idx >= headers.length) return null;
  return headers[idx] ?? null;
}

function applyVerticalMergeFillForHeaders(
  rows: Record<string, unknown>[],
  headers: string[],
  merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>,
  targetHeaders: Set<string>
): Record<string, unknown>[] {
  if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(merges) || merges.length === 0) return rows;
  const out = rows.map((row) => ({ ...row }));
  for (const range of merges) {
    if (!range || range.s.c !== range.e.c) continue;
    if (range.e.r <= range.s.r) continue;
    // 엑셀 1행(인덱스 0)은 헤더이므로 데이터는 r>=1부터 rows[r-1]에 대응
    const dataStart = Math.max(1, range.s.r);
    const dataEnd = range.e.r;
    const colIdx = range.s.c;
    const header = headers[colIdx];
    if (!header || !targetHeaders.has(header)) continue;
    const topRowIdx = dataStart - 1;
    if (topRowIdx < 0 || topRowIdx >= out.length) continue;
    const topVal = out[topRowIdx]?.[header];
    for (let rr = dataStart; rr <= dataEnd; rr++) {
      const rowIdx = rr - 1;
      if (rowIdx < 0 || rowIdx >= out.length) continue;
      out[rowIdx]![header] = topVal ?? '';
    }
  }
  return out;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relativePath: string;
  onSuccess?: () => void;
  /** 레이어 관리 등: 1단계 파일 선택 옆 서버 선택 버튼 */
  showServerPickButton?: boolean;
  onPickFromServer?: () => void;
};

export function ExlWizardModal({
  open,
  onOpenChange,
  relativePath,
  onSuccess,
  showServerPickButton,
  onPickFromServer,
}: Props) {
  const { data: session } = useSession();
  const [step, setStep] = useState(1);
  const [pathOrResult, setPathOrResult] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedGeocodingHeader, setSelectedGeocodingHeader] = useState<string | null>(null);
  /** 필지(지번) 주소: 한 열 통합 vs 시도·시군구·읍면동·리·지번 분리 */
  const [parcelSelectMode, setParcelSelectMode] = useState<ParcelSelectMode>('singleColumn');
  /** 물건지(주소): 한 열 통합 vs 시도·시군구·읍면동·리·지번 분리 */
  const [objectAddressSelectMode, setObjectAddressSelectMode] = useState<ParcelSelectMode>('singleColumn');
  const [selectedObjectAddressHeader, setSelectedObjectAddressHeader] = useState<string | null>(null);
  /** true면 layer.{tableEng}_jijuk 자식 테이블에 필지별 도형·주소, 부모는 합집합 geom·첫 필지 주소 */
  const [createSeparateJijukTable, setCreateSeparateJijukTable] = useState(false);
  /** true면 layer.{tableEng}_mulgunji 자식 테이블에 물건지별 도형·주소를 저장 */
  const [createSeparateMulgunjiTable, setCreateSeparateMulgunjiTable] = useState(true);
  /** 1단계 하단: 업로드 처리 방식 (추가 옵션은 EXCEL_UPLOAD_WORKFLOW_OPTIONS) */
  const [excelUploadWorkflowId, setExcelUploadWorkflowId] = useState<string>(
    () => EXCEL_UPLOAD_WORKFLOW_OPTIONS[0]?.id ?? 'standard'
  );
  const [splitSidoColumn, setSplitSidoColumn] = useState<string | null>(null);
  const [splitSidoFixed, setSplitSidoFixed] = useState('');
  const [splitSigunguColumn, setSplitSigunguColumn] = useState<string | null>(null);
  const [splitSigunguFixed, setSplitSigunguFixed] = useState('');
  const [splitEmdColumn, setSplitEmdColumn] = useState<string | null>(null);
  const [splitRiColumn, setSplitRiColumn] = useState<string | null>(null);
  const [splitJibunColumn, setSplitJibunColumn] = useState<string | null>(null);
  const [objSplitSidoColumn, setObjSplitSidoColumn] = useState<string | null>(null);
  const [objSplitSidoFixed, setObjSplitSidoFixed] = useState('');
  const [objSplitSigunguColumn, setObjSplitSigunguColumn] = useState<string | null>(null);
  const [objSplitSigunguFixed, setObjSplitSigunguFixed] = useState('');
  const [objSplitEmdColumn, setObjSplitEmdColumn] = useState<string | null>(null);
  const [objSplitRiColumn, setObjSplitRiColumn] = useState<string | null>(null);
  const [objSplitJibunColumn, setObjSplitJibunColumn] = useState<string | null>(null);
  const [tableKor, setTableKor] = useState('');
  const [tableEng, setTableEng] = useState('');
  /** 1단계 그룹명 (이력·define 반영) */
  const [tableGroup, setTableGroup] = useState('');
  /** 1단계에서 확인한 layer 테이블 존재 여부·컬럼 메타 (null이면 아직 확인 안 함) */
  const [layerTableMeta, setLayerTableMeta] = useState<{
    exists: boolean;
    columns: { name: string; comment: string | null }[];
  } | null>(null);
  const [tableCheckLoading, setTableCheckLoading] = useState(false);
  const [tableCheckHint, setTableCheckHint] = useState<string | null>(null);
  /** 기존 테이블만: 엑셀에만 있는 열을 DB에 추가하지 않을 때 originalHeader 집합 */
  const [excelOnlySkipAdd, setExcelOnlySkipAdd] = useState<Set<string>>(() => new Set());
  /** 기존 테이블만: DB에만 있어 스키마에서 제거할 컬럼명(영문) */
  const [diffDropColumns, setDiffDropColumns] = useState<Set<string>>(() => new Set());
  /** 3단계 DIFF 펼침 — 기본 펼침, 필요 시 접어 Key 필드 표 공간 확보 */
  const [schemaDiffOpen, setSchemaDiffOpen] = useState(true);
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([]);
  const [keyMode, setKeyMode] = useState<ExcelWizardKeyMode>('single');
  const [syntheticKeyKor, setSyntheticKeyKor] = useState('일련키');
  const [syntheticKeyEng, setSyntheticKeyEng] = useState('feat_key');
  const [compositeKeyKor, setCompositeKeyKor] = useState(EXCEL_COMPOSITE_KEY_KOR);
  const [compositeKeyEng, setCompositeKeyEng] = useState(EXCEL_COMPOSITE_KEY_ENG);
  const useSyntheticKeyField = keyMode === 'synthetic';
  const usesCompositeKey = keyMode === 'composite';
  const [geometryType, setGeometryType] = useState<'Point' | 'Polygon' | null>(null);
  /** geom 열 WKT 입력 좌표계 (저장은 항상 5181) */
  const [excelGeomSridMode, setExcelGeomSridMode] = useState<'auto' | 4326 | 5181>('auto');
  /** 엑셀 타이틀(헤더) 1행 또는 2행(이중 헤더) */
  const [titleRowLines, setTitleRowLines] = useState<1 | 2 | 3>(1);
  const [step1Blocked, setStep1Blocked] = useState(true);
  /** 시트 무결성 검사 실패 시 표시할 문구 (한 줄씩, 빨간색 텍스트) */
  const [step1Warnings, setStep1Warnings] = useState<string[]>([]);
  /** 시트가 2개 이상이고 파싱은 성공했을 때만 표시 (빨간색, 차단 아님) */
  const [step1MultiSheetWarning, setStep1MultiSheetWarning] = useState<string | null>(null);
  /** CSV일 때 감지된 인코딩 안내 */
  const [csvEncodingHint, setCsvEncodingHint] = useState<string | null>(null);
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
  /** 기존 테이블 정합성 모달 */
  const [excelSyncOpen, setExcelSyncOpen] = useState(false);
  const [excelSyncApplying, setExcelSyncApplying] = useState(false);
  const integrityPendingRef = useRef<{
    stagedRows: Array<{
      attrs: Record<string, unknown>;
      parcels: { address: string; x?: number; y?: number; geom?: string }[];
      mulgunjis: { address: string; x?: number; y?: number; geom?: string }[];
    }>;
    columns: Array<{
      define_field_name: string;
      define_field_kor_name: string;
      define_field_show_list?: boolean;
      define_field_show_search?: boolean;
      define_field_is_key?: boolean;
    }>;
    keyField: string;
    appendKeys: string[];
    tableEng: string;
    tableKor: string;
    tableGroup: string;
    geometryType: 'Point' | 'Polygon';
    separateJijukTable: boolean;
    separateMulgunjiTable: boolean;
    effectivePath: string | null;
    oldRowCount: number;
    startedMs: number;
    operatorId: string;
    operatorLabel: string;
    totalExtractCount: number;
    totalCoordOk: number;
    geocodeFailCount: number;
    syncKeyField: string;
  } | null>(null);
  /** 파일 input에 파일이 올라왔는지 확인용 (선택된 파일명 표시) */
  const [selectedFileInfo, setSelectedFileInfo] = useState<{ name: string; size: number } | null>(null);
  const step4StartedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingLogScrollRef = useRef<HTMLDivElement>(null);
  const isLedgerWorkflow =
    excelUploadWorkflowId === 'dev_behavior_ledger' || excelUploadWorkflowId === 'occupancy_ledger';
  const isAndongRoadUseWorkflow = excelUploadWorkflowId === 'andong_road_use_ledger';

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

  const runExcelParse = useCallback(async (file: File, lines: 1 | 2 | 3) => {
    setStep1Warnings([]);
    setStep1MultiSheetWarning(null);
    setCsvEncodingHint(null);
    setStep1Validating(true);
    try {
      const buf = await file.arrayBuffer();
      const { workbook: wb, isCsv, csvEncoding } = readWorkbookFromBuffer(buf, file.name);
      const sheetNames = wb.SheetNames;
      const sheetCount = sheetNames.length;

      if (sheetCount === 0) {
        setStep1Blocked(true);
        setParseResult(null);
        setStep1MultiSheetWarning(null);
        setStep1Warnings(['시트가 없습니다.']);
        return;
      }

      const ws = wb.Sheets[sheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { ...SHEET_TO_JSON_HEADER1_DISPLAY }) as unknown[][];
      coerceExcelDateCellsInAoa(data);
      if (!data || data.length === 0) {
        setStep1Blocked(true);
        setParseResult(null);
        setStep1MultiSheetWarning(null);
        setStep1Warnings(['데이터가 없습니다.']);
        return;
      }

      try {
        const { headers, rows, samples } = parseExcelMatrix(data, lines);
        setParseResult({ headers, rows, samples });
        setStep1Blocked(false);
        setStep1Warnings([]);
        setCsvEncodingHint(isCsv ? csvEncodingLabel(csvEncoding) : null);
        setStep1MultiSheetWarning(
          !isCsv && sheetCount > 1
            ? `시트가 ${sheetCount}개 있습니다. 첫 번째 시트만 업로드·처리에 사용됩니다.`
            : null
        );
        setSelectedGeocodingHeader((prev) => (prev && headers.includes(prev) ? prev : null));
      } catch (inner: unknown) {
        const msg = inner instanceof Error ? inner.message : String(inner);
        setStep1Blocked(true);
        setParseResult(null);
        setStep1MultiSheetWarning(null);
        setCsvEncodingHint(null);
        setStep1Warnings([msg || '헤더를 해석하지 못했습니다.']);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStep1Blocked(true);
      setParseResult(null);
      setStep1MultiSheetWarning(null);
      setCsvEncodingHint(null);
      setStep1Warnings([msg || '파일을 읽는 중 오류가 났습니다. 다시 시도해 주세요.']);
    } finally {
      setStep1Validating(false);
    }
  }, []);

  /** 클라이언트에서 엑셀 파일 읽어서 검사 (업로드 없음) */
  const handleFileSelected = useCallback(
    async (file: File) => {
      setSelectedFile(file);
      setSelectedFileInfo({ name: file.name, size: file.size });
      await runExcelParse(file, titleRowLines);
    },
    [runExcelParse, titleRowLines]
  );

  const onTitleRowLinesChange = useCallback(
    (lines: 1 | 2 | 3) => {
      setTitleRowLines(lines);
      if (selectedFile) void runExcelParse(selectedFile, lines);
    },
    [selectedFile, runExcelParse]
  );

    const TOTAL_STEPS = 4;
  const stepLabels: Record<number, string> = {
    1: '파일 업로드',
    2: '지도에 표현할 값 선택',
    3: '영문·한글 파일명 및 필드명',
    4: '데이터 처리',
  };

  const hasKorean = (s: string) => /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(s);
  const hasSpace = (s: string) => /\s/.test(s);
  const tableEngOk =
    tableEng.trim().length > 0 &&
    /^[a-zA-Z0-9_]+$/.test(tableEng.trim()) &&
    !hasKorean(tableEng.trim()) &&
    !hasSpace(tableEng.trim());

  /** 1단계 통과: 파싱 성공 + 테이블 한글/영문 + layer 테이블 존재 여부 확인 완료 */
  const canLeaveStep1 =
    !step1Blocked &&
    !step1Validating &&
    !!parseResult &&
    !!tableKor.trim() &&
    tableEngOk &&
    layerTableMeta !== null;
  const step2AddressOk =
    !!geometryType &&
    (isAndongRoadUseWorkflow
      ? true
      : parcelSelectMode === 'singleColumn'
      ? !!selectedGeocodingHeader
      : !!(splitEmdColumn && splitJibunColumn));
  const step2ObjectAddressOk =
    isAndongRoadUseWorkflow
      ? true
      : objectAddressSelectMode === 'singleColumn'
      ? !!selectedObjectAddressHeader
      : !!(objSplitEmdColumn && objSplitJibunColumn);
  const bothGeomConflict =
    !isAndongRoadUseWorkflow &&
    parcelSelectMode === 'singleColumn' &&
    objectAddressSelectMode === 'singleColumn' &&
    !!selectedGeocodingHeader &&
    selectedGeocodingHeader.trim().toLowerCase() === 'geom' &&
    !!selectedObjectAddressHeader &&
    selectedObjectAddressHeader.trim().toLowerCase() === 'geom';
  const canLeaveStep2 =
    !!geometryType && step2AddressOk && step2ObjectAddressOk && !bothGeomConflict;

  /** 2~3단계: 원본 파싱 결과만 사용 (개발행위 행 확장은 4단계에서 수행) */
  const workflowParseResult = parseResult;

  /** 주소·필지 열 선택 시 개발행위 행키 컬럼은 제외 (확장 전에는 해당 열 없음) */
  const geoColumnPickHeaders = useMemo(
    () => (workflowParseResult?.headers ?? []).filter((h) => h !== LEDGER_ROW_KEY_HEADER),
    [workflowParseResult?.headers]
  );

  useEffect(() => {
    if (isLedgerWorkflow || isAndongRoadUseWorkflow) {
      setKeyMode('single');
      setCreateSeparateJijukTable(true);
      setCreateSeparateMulgunjiTable(true);
      if (isAndongRoadUseWorkflow) {
        setGeometryType('Polygon');
        setTitleRowLines(1);
        setParcelSelectMode('splitColumns');
        setObjectAddressSelectMode('splitColumns');
        setSplitSidoFixed('경상북도');
        setSplitSigunguFixed('안동시');
        setObjSplitSidoFixed('경상북도');
        setObjSplitSigunguFixed('안동시');
      }
    }
  }, [isLedgerWorkflow, isAndongRoadUseWorkflow]);

  useEffect(() => {
    if (!isAndongRoadUseWorkflow || !selectedFile) return;
    void runExcelParse(selectedFile, 1);
  }, [isAndongRoadUseWorkflow, selectedFile, runExcelParse]);

  const activeFieldDefs = useMemo(() => {
    if (!layerTableMeta?.exists) return fieldDefs;
    const dbCols = layerTableMeta.columns.filter((c) => !EXCEL_LAYER_SYSTEM_COLS.has(c.name));
    const matchDb = (f: FieldDef) => {
      const k = f.headerKor.trim();
      let db = dbCols.find((c) => (c.comment ?? '').trim() === k);
      if (!db) db = dbCols.find((c) => c.name === safeColumnName(f.headerEng));
      return db;
    };
    return fieldDefs.filter((f) => matchDb(f) || !excelOnlySkipAdd.has(f.originalHeader));
  }, [layerTableMeta, fieldDefs, excelOnlySkipAdd]);

  const schemaDiff = useMemo(() => {
    if (!layerTableMeta?.exists) return null;
    const dbCols = layerTableMeta.columns.filter((c) => !EXCEL_LAYER_SYSTEM_COLS.has(c.name));
    const matchedDb = new Set<string>();
    const excelBoth: FieldDef[] = [];
    const excelOnly: FieldDef[] = [];
    for (const f of fieldDefs) {
      const k = f.headerKor.trim();
      let db = dbCols.find((c) => (c.comment ?? '').trim() === k);
      if (!db) db = dbCols.find((c) => c.name === safeColumnName(f.headerEng));
      if (db) {
        excelBoth.push(f);
        matchedDb.add(db.name);
      } else {
        excelOnly.push(f);
      }
    }
    const dbOnly = dbCols.filter((c) => !matchedDb.has(c.name));
    return { excelBoth, excelOnly, dbOnly };
  }, [layerTableMeta, fieldDefs]);

  const keyFieldDefs = useMemo(
    () => activeFieldDefs.filter((f) => f.isKey && !isExcelSystemKeyColumn(f.headerEng)),
    [activeFieldDefs]
  );
  const syntheticKeyAllowed = !layerTableMeta?.exists;
  const syntheticKeyEngTrim = syntheticKeyEng.trim();
  const compositeKeyEngTrim = compositeKeyEng.trim();
  const compositeKeyEngOk =
    usesCompositeKey &&
    compositeKeyEngTrim.length > 0 &&
    /^[a-zA-Z0-9_]+$/.test(compositeKeyEngTrim) &&
    !/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(compositeKeyEngTrim) &&
    !/\s/.test(compositeKeyEngTrim) &&
    !activeFieldDefs.some((f) => f.headerEng === compositeKeyEngTrim) &&
    !isExcelSystemKeyColumn(compositeKeyEngTrim);
  const syntheticKeyEngOk =
    useSyntheticKeyField &&
    syntheticKeyAllowed &&
    syntheticKeyEngTrim.length > 0 &&
    /^[a-zA-Z0-9_]+$/.test(syntheticKeyEngTrim) &&
    !/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(syntheticKeyEngTrim) &&
    !/\s/.test(syntheticKeyEngTrim) &&
    !activeFieldDefs.some((f) => f.headerEng === syntheticKeyEngTrim) &&
    !isExcelSystemKeyColumn(syntheticKeyEngTrim);
  const hasKeyOk =
    isLedgerWorkflow || isAndongRoadUseWorkflow
      ? true
      : keyMode === 'synthetic'
        ? syntheticKeyEngOk
        : keyMode === 'composite'
          ? keyFieldDefs.length >= 2 && compositeKeyEngOk
          : keyFieldDefs.length === 1;
  const hasListSearchSelected = activeFieldDefs.some((f) => f.showList);
  const listSearchAllSelected = fieldDefs.length > 0 && fieldDefs.every((f) => f.showList);
  const listSearchSomeSelected = fieldDefs.some((f) => f.showList);
  const keyEngTrim = useSyntheticKeyField ? syntheticKeyEng.trim() : '';
  const keyColSafe = useSyntheticKeyField
    ? safeColumnName(keyEngTrim)
    : usesCompositeKey
      ? safeColumnName(compositeKeyEngTrim)
      : safeColumnName(keyFieldDefs[0]?.headerEng ?? '');
  const keyNotDropped =
    isLedgerWorkflow || isAndongRoadUseWorkflow
      ? true
      : !layerTableMeta?.exists ||
        !keyColSafe ||
        useSyntheticKeyField ||
        usesCompositeKey ||
        !diffDropColumns.has(keyColSafe);
  const canGoStep4 =
    canLeaveStep2 &&
    tableEng.trim() &&
    tableEngOk &&
    activeFieldDefs.every((f) => /^[a-zA-Z0-9_]+$/.test(f.headerEng)) &&
    hasKeyOk &&
    (isAndongRoadUseWorkflow ? true : hasListSearchSelected) &&
    keyNotDropped &&
    !keyDuplicateError &&
    !engNameKoreanError;
  const goNext = () => {
    if (step === 1 && canLeaveStep1) setStep(2);
    else if (step === 2 && canLeaveStep2) setStep(3);
    else if (step === 3 && canGoStep4) setStep(4);
  };
  const goPrev = () => setStep((s) => Math.max(1, s - 1));

  useEffect(() => {
    if (step !== 3 || !parseResult) return;
    const loadFieldMap = async () => {
      const res = await call('', 'POST', { service: 'excelUploadService', action: 'readExcelFieldNameMap', params: {} });
      const d = res?.data ?? res;
      const map = (d?.map ?? {}) as Record<string, string>;
      setFieldDefs(
        parseResult.headers.map((h, idx) => {
          let headerEng = map[h] ?? `value_${String(idx + 1).padStart(3, '0')}`;
          if (layerTableMeta?.exists) {
            const dbCols = layerTableMeta.columns.filter((c) => !EXCEL_LAYER_SYSTEM_COLS.has(c.name));
            const byComment = dbCols.find((c) => (c.comment ?? '').trim() === String(h).trim());
            if (byComment) headerEng = byComment.name;
          }
          return {
            originalHeader: h,
            headerKor: h,
            headerEng,
            showList: false,
            showSearch: false,
            isKey: false,
          };
        })
      );
    };
    void loadFieldMap();
  }, [step, parseResult, selectedFile?.name, pathOrResult, layerTableMeta]);

  const runLayerTableCheck = useCallback(async () => {
    const te = tableEng.trim();
    if (!te) {
      setTableCheckHint('테이블 영문명을 입력한 뒤 확인해 주세요.');
      return;
    }
    if (!tableEngOk) {
      setTableCheckHint('테이블 영문명은 영문·숫자·언더스코어(_)만 사용할 수 있습니다.');
      return;
    }
    setTableCheckLoading(true);
    setTableCheckHint(null);
    try {
      const res = await call('', 'POST', {
        service: 'excelUploadService',
        action: 'getExcelLayerTableColumnMeta',
        params: { tableName: te },
      });
      const d = res?.data ?? res;
      if (!d?.success) {
        setLayerTableMeta(null);
        setTableCheckHint(String(d?.error ?? '조회에 실패했습니다.'));
        return;
      }
      const exists = !!d.exists;
      const columns = (d.columns ?? []) as { name: string; comment: string | null }[];
      setLayerTableMeta({ exists, columns });
      setDiffDropColumns(new Set());
      setExcelOnlySkipAdd(new Set());
      const nm = String(d.normalizedTableName ?? safeTableName(te));
      setTableCheckHint(
        exists
          ? `layer.${nm} 테이블이 있습니다. 다음 단계에서 엑셀과 컬럼 DIFF를 확인할 수 있습니다.`
          : `동일 이름의 layer 테이블이 없습니다. 신규 테이블로 생성합니다.`
      );
    } catch (e: unknown) {
      setLayerTableMeta(null);
      setTableCheckHint(e instanceof Error ? e.message : String(e));
    } finally {
      setTableCheckLoading(false);
    }
  }, [tableEng, tableEngOk]);

  useEffect(() => {
    setLayerTableMeta(null);
    setTableCheckHint(null);
  }, [tableEng]);

  useEffect(() => {
    if (!parseResult?.headers?.length) return;
    const fileName =
      selectedFile?.name?.replace(/\.(xlsx|xls|csv)$/i, '') ??
      pathOrResult?.replace(/^.*[/\\]/, '').replace(/\.(xlsx|xls|csv)$/i, '') ??
      '';
    setTableKor((prev) => (prev.trim() ? prev : fileName || parseResult.headers[0] || ''));
  }, [parseResult, selectedFile?.name, pathOrResult]);

  const keyField = useMemo(() => {
    if (isLedgerWorkflow) return 'ledger_row_key';
    if (isAndongRoadUseWorkflow) return 'andong_charge_row';
    if (keyMode === 'synthetic') return syntheticKeyEng.trim() || '';
    if (keyMode === 'composite') return compositeKeyEng.trim() || '';
    if (keyFieldDefs.length === 0) return '';
    return keyFieldDefs[0].headerEng.trim() || '';
  }, [
    isLedgerWorkflow,
    isAndongRoadUseWorkflow,
    keyMode,
    syntheticKeyEng,
    compositeKeyEng,
    keyFieldDefs,
  ]);

  useEffect(() => {
    if (layerTableMeta?.exists && keyMode === 'synthetic') {
      setKeyMode('single');
    }
  }, [layerTableMeta?.exists, keyMode]);

  useEffect(() => {
    if (isLedgerWorkflow || isAndongRoadUseWorkflow) {
      setKeyDuplicateError(null);
      return;
    }
    if (keyMode === 'synthetic') {
      setKeyDuplicateError(null);
      return;
    }
    if (step !== 3 || !workflowParseResult?.rows?.length) {
      setKeyDuplicateError(null);
      return;
    }
    if (keyMode === 'composite' && keyFieldDefs.length < 2) {
      setKeyDuplicateError('복합키는 Key 열을 2개 이상 선택하세요.');
      return;
    }
    if (keyMode === 'single' && keyFieldDefs.length === 0) {
      setKeyDuplicateError(null);
      return;
    }
    if (keyFieldDefs.length === 0) {
      setKeyDuplicateError(null);
      return;
    }
    for (const def of keyFieldDefs) {
      if (isExcelSystemKeyColumn(def.headerEng)) {
        setKeyDuplicateError(
          `「${def.headerKor || def.headerEng}」은(는) 시스템 컬럼이라 정합성 키로 쓸 수 없습니다. 다른 열을 선택하세요.`
        );
        return;
      }
    }
    const values = workflowParseResult.rows.map((r) =>
      buildExcelCompositeKeyValue(keyFieldDefs.map((def) => r[def.originalHeader]))
    );
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    const dupEntries = [...counts.entries()].filter(([, n]) => n > 1);
    if (dupEntries.length === 0) {
      setKeyDuplicateError(null);
      return;
    }
    const MAX_SHOW = 15;
    const formatDup = (val: string, n: number) => {
      if (val === '') return `빈 값 (${n}건)`;
      const shortened = val.length > 48 ? `${val.slice(0, 48)}…` : val;
      return `"${shortened}" (${n}건)`;
    };
    const shown = dupEntries.slice(0, MAX_SHOW).map(([val, n]) => formatDup(val, n));
    const keyLabel =
      keyFieldDefs.length === 1
        ? keyFieldDefs[0].headerKor || keyFieldDefs[0].headerEng
        : keyFieldDefs.map((d) => d.headerKor || d.headerEng).join(' + ');
    let msg = `Key로 선택한 열(${keyLabel})에 같은 값이 여러 행에 있습니다. 중복 값: ${shown.join(', ')}`;
    if (dupEntries.length > MAX_SHOW) msg += ` … 외 ${dupEntries.length - MAX_SHOW}종`;
    setKeyDuplicateError(msg);
  }, [step, keyFieldDefs, workflowParseResult, keyMode, isLedgerWorkflow, isAndongRoadUseWorkflow]);

  useEffect(() => {
    if (step === 1) {
      if (hasKorean(tableEng.trim())) {
        setEngNameKoreanError('테이블 영문명에는 한글을 사용할 수 없습니다.');
        return;
      }
      if (hasSpace(tableEng)) {
        setEngNameKoreanError('테이블 영문명에는 공백을 사용할 수 없습니다.');
        return;
      }
      if (tableEng.trim() && !/^[a-zA-Z0-9_]+$/.test(tableEng.trim())) {
        setEngNameKoreanError('테이블 영문명은 영문, 숫자, 언더스코어(_)만 사용해 주세요.');
        return;
      }
      setEngNameKoreanError(null);
      return;
    }
    if (step !== 3) {
      setEngNameKoreanError(null);
      return;
    }
    if (useSyntheticKeyField) {
      if (hasKorean(syntheticKeyEng.trim())) {
        setEngNameKoreanError('신규 키 필드 영문명에는 한글을 사용할 수 없습니다.');
        return;
      }
      if (hasSpace(syntheticKeyEng.trim())) {
        setEngNameKoreanError('신규 키 필드 영문명에는 공백을 사용할 수 없습니다.');
        return;
      }
      const dup = fieldDefs.some((f) => f.headerEng === syntheticKeyEng.trim());
      if (dup && syntheticKeyEng.trim()) {
        setEngNameKoreanError(`신규 키 필드 영문명이 엑셀 필드 "${syntheticKeyEng.trim()}"와 같습니다. 다른 이름을 사용하세요.`);
        return;
      }
    }
    if (usesCompositeKey) {
      if (hasKorean(compositeKeyEng.trim())) {
        setEngNameKoreanError('복합키 필드 영문명에는 한글을 사용할 수 없습니다.');
        return;
      }
      if (hasSpace(compositeKeyEng.trim())) {
        setEngNameKoreanError('복합키 필드 영문명에는 공백을 사용할 수 없습니다.');
        return;
      }
      const dup = fieldDefs.some((f) => f.headerEng === compositeKeyEng.trim());
      if (dup && compositeKeyEng.trim()) {
        setEngNameKoreanError(`복합키 필드 영문명이 엑셀 필드 "${compositeKeyEng.trim()}"와 같습니다. 다른 이름을 사용하세요.`);
        return;
      }
    }
    if (hasKorean(tableEng.trim())) {
      setEngNameKoreanError('테이블 영문명에는 한글을 사용할 수 없습니다.');
      return;
    }
    if (hasSpace(tableEng)) {
      setEngNameKoreanError('테이블 영문명에는 공백을 사용할 수 없습니다.');
      return;
    }
    const fieldWithKorean = fieldDefs.find((f) => hasKorean(f.headerEng));
    if (fieldWithKorean) {
      setEngNameKoreanError(`필드 영문명 '${fieldWithKorean.headerEng}'에 한글이 포함되어 있습니다. 영문, 숫자, 언더스코어(_)만 사용해 주세요.`);
      return;
    }
    const fieldWithSpace = fieldDefs.find((f) => hasSpace(f.headerEng));
    if (fieldWithSpace) {
      setEngNameKoreanError(`필드 영문명 '${fieldWithSpace.headerEng}'에 공백이 포함되어 있습니다. 영문, 숫자, 언더스코어(_)만 사용해 주세요.`);
      return;
    }
    setEngNameKoreanError(null);
  }, [step, tableEng, fieldDefs, useSyntheticKeyField, syntheticKeyEng, usesCompositeKey, compositeKeyEng]);

  useEffect(() => {
    const H = workflowParseResult?.headers?.filter((h) => h !== LEDGER_ROW_KEY_HEADER);
    if (!H?.length) return;
    const set = new Set(H);
    const pick = (v: string | null) => (v && set.has(v) ? v : null);
    setSplitSidoColumn((c) => pick(c));
    setSplitSigunguColumn((c) => pick(c));
    setSplitEmdColumn((c) => pick(c));
    setSplitRiColumn((c) => pick(c));
    setSplitJibunColumn((c) => pick(c));
    setObjSplitSidoColumn((c) => pick(c));
    setObjSplitSigunguColumn((c) => pick(c));
    setObjSplitEmdColumn((c) => pick(c));
    setObjSplitRiColumn((c) => pick(c));
    setObjSplitJibunColumn((c) => pick(c));
  }, [workflowParseResult?.headers]);

  const parcelSplitSuggest = useMemo(() => {
    const headers = workflowParseResult?.headers?.filter((h) => h !== LEDGER_ROW_KEY_HEADER);
    const samples = workflowParseResult?.samples;
    if (!headers?.length || !samples) return null;
    return suggestSplitParcelColumns(headers, samples);
  }, [workflowParseResult?.headers, workflowParseResult?.samples]);

  const unifiedAddressRecommend = useMemo(() => {
    const headers = workflowParseResult?.headers?.filter((h) => h !== LEDGER_ROW_KEY_HEADER);
    const samples = workflowParseResult?.samples;
    if (!headers?.length || !samples) return null;
    return pickUnifiedAddressHeader(headers, samples, { preferGeom: true });
  }, [workflowParseResult?.headers, workflowParseResult?.samples]);

  const objectAddressRecommend = useMemo(() => {
    const headers = workflowParseResult?.headers?.filter((h) => h !== LEDGER_ROW_KEY_HEADER);
    const samples = workflowParseResult?.samples;
    if (!headers?.length || !samples) return null;
    const parcelTakesGeom =
      parcelSelectMode === 'singleColumn' &&
      (selectedGeocodingHeader?.trim().toLowerCase() === 'geom' ||
        pickUnifiedAddressHeader(headers, samples, { preferGeom: true })?.trim().toLowerCase() ===
          'geom');
    return pickUnifiedAddressHeader(headers, samples, { preferGeom: !parcelTakesGeom });
  }, [
    workflowParseResult?.headers,
    workflowParseResult?.samples,
    parcelSelectMode,
    selectedGeocodingHeader,
  ]);

  useEffect(() => {
    if (!isAndongRoadUseWorkflow) return;
    const headers = workflowParseResult?.headers?.filter((h) => h !== LEDGER_ROW_KEY_HEADER);
    if (!headers?.length) return;
    const occEmd = findHeaderByCandidates(headers, ['점용지 읍면동', '점용지읍면동']);
    const occRi = findHeaderByCandidates(headers, ['점용지 리', '점용지리']);
    const occJibun = findHeaderByCandidates(headers, ['점용지 지번', '점용지지번']);
    const objJibun = findHeaderByCandidates(headers, ['물건지 (인근지번)', '물건지(인근지번)', '물건지 지번', '물건지지번']);
    if (occEmd) {
      setSplitEmdColumn(occEmd);
      setObjSplitEmdColumn(occEmd);
    }
    if (occRi) {
      setSplitRiColumn(occRi);
      setObjSplitRiColumn(occRi);
    }
    if (occJibun) setSplitJibunColumn(occJibun);
    if (objJibun) setObjSplitJibunColumn(objJibun);
  }, [isAndongRoadUseWorkflow, workflowParseResult?.headers]);

  /** 열 구분: 비어 있을 때만 정규식 추천으로 시도·시군구·읍면동·리·지번 열 채움 */
  useEffect(() => {
    if (step !== 2 || parcelSelectMode !== 'splitColumns') return;
    const headers = workflowParseResult?.headers?.filter((h) => h !== LEDGER_ROW_KEY_HEADER);
    const samples = workflowParseResult?.samples;
    if (!headers?.length || !samples) return;
    const { picks } = suggestSplitParcelColumns(headers, samples);
    setSplitEmdColumn((c) => c ?? picks.emd);
    setSplitJibunColumn((c) => c ?? picks.jibun);
    setSplitSigunguColumn((c) => c ?? picks.sigungu);
    setSplitSidoColumn((c) => c ?? picks.sido);
    setSplitRiColumn((c) => c ?? picks.ri);
  }, [step, parcelSelectMode, workflowParseResult?.headers, workflowParseResult?.samples]);

  /** 한 열 주소: 선택 없을 때만 추천 열을 기본 선택 (geom 열·데이터 있으면 우선) */
  useEffect(() => {
    if (step !== 2 || parcelSelectMode !== 'singleColumn') return;
    const headers = workflowParseResult?.headers?.filter((h) => h !== LEDGER_ROW_KEY_HEADER);
    const samples = workflowParseResult?.samples;
    if (!headers?.length || !samples) return;
    const rec = pickUnifiedAddressHeader(headers, samples, { preferGeom: true });
    if (!rec) return;
    setSelectedGeocodingHeader((prev) => {
      if (prev && headers.includes(prev)) return prev;
      return rec;
    });
  }, [step, parcelSelectMode, workflowParseResult?.headers, workflowParseResult?.samples]);

  /** 물건지 열 구분: 비어 있을 때만 정규식 추천으로 시도·시군구·읍면동·리·지번 열 채움 */
  useEffect(() => {
    if (step !== 2 || objectAddressSelectMode !== 'splitColumns') return;
    const headers = workflowParseResult?.headers?.filter((h) => h !== LEDGER_ROW_KEY_HEADER);
    const samples = workflowParseResult?.samples;
    if (!headers?.length || !samples) return;
    const { picks } = suggestSplitParcelColumns(headers, samples);
    setObjSplitEmdColumn((c) => c ?? picks.emd);
    setObjSplitJibunColumn((c) => c ?? picks.jibun);
    setObjSplitSigunguColumn((c) => c ?? picks.sigungu);
    setObjSplitSidoColumn((c) => c ?? picks.sido);
    setObjSplitRiColumn((c) => c ?? picks.ri);
  }, [step, objectAddressSelectMode, workflowParseResult?.headers, workflowParseResult?.samples]);

  /** 물건지 한 열 주소: 선택 없을 때만 추천 열을 기본 선택 (필지가 geom이면 물건지는 geom 비우선) */
  useEffect(() => {
    if (step !== 2 || objectAddressSelectMode !== 'singleColumn') return;
    const headers = workflowParseResult?.headers?.filter((h) => h !== LEDGER_ROW_KEY_HEADER);
    const samples = workflowParseResult?.samples;
    if (!headers?.length || !samples) return;
    const parcelTakesGeom =
      parcelSelectMode === 'singleColumn' &&
      (selectedGeocodingHeader?.trim().toLowerCase() === 'geom' ||
        pickUnifiedAddressHeader(headers, samples, { preferGeom: true })?.trim().toLowerCase() ===
          'geom');
    const rec = pickUnifiedAddressHeader(headers, samples, { preferGeom: !parcelTakesGeom });
    if (!rec) return;
    if (parcelTakesGeom && rec.trim().toLowerCase() === 'geom') return;
    setSelectedObjectAddressHeader((prev) => {
      if (prev && headers.includes(prev)) {
        if (
          parcelTakesGeom &&
          prev.trim().toLowerCase() === 'geom' &&
          selectedGeocodingHeader?.trim().toLowerCase() === 'geom'
        ) {
          return rec.trim().toLowerCase() === 'geom' ? null : rec;
        }
        return prev;
      }
      return rec;
    });
  }, [
    step,
    objectAddressSelectMode,
    parcelSelectMode,
    selectedGeocodingHeader,
    workflowParseResult?.headers,
    workflowParseResult?.samples,
  ]);

  const runStep4 = useCallback(async () => {
    if (!parseResult || !tableEng.trim() || !geometryType) return;
    if (!isLedgerWorkflow && !isAndongRoadUseWorkflow && !keyField) return;
    if (!isAndongRoadUseWorkflow) {
      if (parcelSelectMode === 'singleColumn') {
        if (!selectedGeocodingHeader) return;
      } else if (!splitEmdColumn || !splitJibunColumn) return;
      if (
        parcelSelectMode === 'singleColumn' &&
        objectAddressSelectMode === 'singleColumn' &&
        selectedGeocodingHeader?.trim().toLowerCase() === 'geom' &&
        selectedObjectAddressHeader?.trim().toLowerCase() === 'geom'
      ) {
        return;
      }
    }
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

    const skEngRaw = syntheticKeyEng.trim();
    const skSafe = safeColumnName(skEngRaw);
    const ckEngRaw = compositeKeyEng.trim();
    const ckSafe = safeColumnName(ckEngRaw);
    const ckKorRaw = compositeKeyKor.trim() || ckEngRaw;
    const startedAt = new Date();
    const startedMs = Date.now();
    const operatorId = String(session?.user?.id ?? '').trim();
    const operatorName = String(session?.user?.name ?? '').trim();
    const operatorLabel =
      operatorId && operatorName
        ? `${operatorId}(${operatorName})`
        : operatorId || operatorName || '미확인';
    const writeMode = layerTableMeta?.exists
      ? '전체 교체'
      : '신규';
    const parcelAddressMode =
      parcelSelectMode === 'splitColumns'
        ? '열 구분 조합'
        : `한 열(${selectedGeocodingHeader ?? '-'})`;
    const objectAddressMode =
      objectAddressSelectMode === 'splitColumns'
        ? '열 구분 조합'
        : selectedObjectAddressHeader
          ? `한 열(${selectedObjectAddressHeader})`
          : '미사용';

    pushLog(
      ...buildExcelWizardMetaLines({
        operatorLabel,
        startedAtLabel: startedAt.toLocaleString(),
        tableEng: tableEng.trim(),
        tableKor: tableKor.trim() || tableEng.trim(),
        writeMode,
        keyFieldLabel:
          keyField ||
          (useSyntheticKeyField
            ? skEngRaw
            : keyFieldDefs.map((d) => d.headerEng).filter(Boolean).join(' + ')) ||
          '',
        geometryType: geometryType ?? '-',
        parcelAddressMode,
        objectAddressMode,
        sourcePath: pathOrResult,
      })
    );
    pushLog('주소 추출 및 지오코딩을 시작합니다.');
    if (isLedgerWorkflow) {
      pushLog('대장 업로드: 행키는 규칙(ledger_row_key) 고정, 4단계에서 행 확장 후 삽입합니다.');
    } else if (useSyntheticKeyField) {
      pushLog(`신규 키 필드 사용: ${skEngRaw} → 행마다 k00000001 형식으로 부여`);
    } else if (usesCompositeKey) {
      pushLog(
        `복합 Key 사용: ${keyFieldDefs.map((d) => d.headerKor || d.headerEng).join(' + ')} → ${ckEngRaw} (${ckKorRaw})`
      );
    }
    if (parcelSelectMode === 'splitColumns') {
      pushLog('필지 주소: 열 구분 조합 방식 — 행마다 시·군구·읍·리·지번을 이어 붙입니다. (GPT 미사용)');
    } else if (
      parcelSelectMode === 'singleColumn' &&
      selectedGeocodingHeader?.trim().toLowerCase() === 'geom'
    ) {
      pushLog(
        `필지: geom 열 선택 — WKT를 도형으로 그대로 반영합니다. (GPT·지오코딩 생략, 입력 SRID=${excelGeomSridMode})`
      );
    }
    if (
      objectAddressSelectMode === 'singleColumn' &&
      selectedObjectAddressHeader?.trim().toLowerCase() === 'geom'
    ) {
      pushLog('물건지: geom 열 선택 — WKT를 도형으로 그대로 반영합니다. (GPT·지오코딩 생략)');
    }
    const separateJijukTable = isLedgerWorkflow || createSeparateJijukTable;
    const separateMulgunjiTable = createSeparateMulgunjiTable;
    if (separateJijukTable) {
      pushLog(`별도 지적 테이블 사용: layer.${tableEng.trim()}_jijuk 에 필지별 행 저장, 부모 geom 은 자식 합집합`);
    }
    if (separateMulgunjiTable) {
      pushLog(`별도 물건지 테이블 사용: layer.${tableEng.trim()}_mulgunji 에 물건지별 행 저장, 부모 geom 은 자식 합집합`);
    }
    setProcessingProgress(2);

    let effectivePath: string | null = pathOrResult;
    if (selectedFile && !pathOrResult) {
      pushLog('파일을 서버에 저장 중...');
      const te = safeTableName(tableEng.trim());
      const up = await upload(selectedFile, 'excel', {
        excelSavePath: `${te}/${selectedFile.name}`,
      });
      if (!up?.savedPath) {
        const msg = up?.error ?? '파일 저장에 실패했습니다.';
        setProcessingError(msg);
        pushLog(msg);
        await flushLogToFile(effectivePath ?? undefined);
        return;
      }
      setPathOrResult(up.savedPath);
      effectivePath = up.savedPath;
      pushLog(`파일 저장 완료: ${up.savedPath}`);
    }
    setProcessingProgress(5);

    if (isAndongRoadUseWorkflow) {
      const headers = parseResult.headers ?? [];
      const byCol = (col: string) => headerByExcelColumn(headers, col);
      const occupancySplit = {
        emd: byCol('E'),
        ri: byCol('F'),
        jibun: byCol('G'),
      };
      const objectSplit = {
        emd: occupancySplit.emd,
        ri: occupancySplit.ri,
        jibun: byCol('H'),
      };
      const andongFieldMap = {
        permitNo: byCol('A'),
        permitDate: byCol('B'),
        completionConfirmDate: byCol('W'),
        feeTotal: byCol('X'),
        temporaryTotal: byCol('Y'),
        usageFeeTotal: byCol('Z'),
        vatTotal: byCol('AA'),
        licenseTaxYn: byCol('AB'),
        reductionReason: byCol('AC'),
        changeDetail: byCol('AH'),
        changePermitDate: byCol('AI'),
        completionCheckDate: byCol('AJ'),
        convertedDiameter: byCol('AL'),
        excavationDetail: byCol('AN'),
        roadNameType: byCol('C'),
        roadRouteNo: byCol('D'),
        occupancyEmd: byCol('E'),
        occupancyRi: byCol('F'),
        occupancyJibun: byCol('G'),
        objectNearbyJibun: byCol('H'),
        occupantAddress: byCol('I'),
        occupantName: byCol('J'),
        manager: byCol('K'),
        occupantRegNo: byCol('L'),
        occupantContact: byCol('M'),
        occupancyPurpose: byCol('N'),
        workName: byCol('O'),
        permanentArea: byCol('P'),
        permanentAreaDetail: byCol('R'),
        quantityTemporary: byCol('S'),
        permanentPeriod: byCol('T'),
        temporaryPeriod: byCol('U'),
        restoration: byCol('V'),
        roadMgmtReviewYn: byCol('AD'),
        excavationYn: byCol('AE'),
        pavingLedger: byCol('AF'),
        poleNo: byCol('AG'),
        note: byCol('AK'),
        cuttingPavingDoneDate: byCol('AM'),
        consultationResult: byCol('AO'),
        occupancyParcelText: '__andong_occupancy_address',
        objectParcelText: '__andong_object_address',
      };
      const missingMaster = Object.entries(andongFieldMap)
        .filter(([k, v]) => !v && k !== 'occupancyParcelText' && k !== 'objectParcelText')
        .map(([k]) => k);
      if (missingMaster.length > 0) {
        const msg = `안동 도로점용대장 필수 헤더 매핑 실패: ${missingMaster.join(', ')}`;
        setProcessingError(msg);
        pushLog(msg);
        await flushLogToFile(effectivePath);
        return;
      }

      const canUseOccupancySplit = Boolean(occupancySplit.emd && occupancySplit.jibun);
      const canUseObjectSplit = Boolean(objectSplit.emd && objectSplit.jibun);
      if (!canUseOccupancySplit) {
        const msg = '점용지 읍면동/점용지 지번 열을 찾지 못했습니다.';
        setProcessingError(msg);
        pushLog(msg);
        await flushLogToFile(effectivePath);
        return;
      }
      if (!canUseObjectSplit) {
        const msg = '점용지 읍면동/물건지(인근지번) 열을 찾지 못했습니다.';
        setProcessingError(msg);
        pushLog(msg);
        await flushLogToFile(effectivePath);
        return;
      }

      let sourceRows = parseResult.rows;
      if (selectedFile) {
        try {
          const buf = await selectedFile.arrayBuffer();
          const { workbook: wb } = readWorkbookFromBuffer(buf, selectedFile.name);
          const ws = wb.Sheets[wb.SheetNames[0] ?? ''];
          const merges = (ws?.['!merges'] ?? []) as Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>;
          const infoFillHeaders = new Set<string>(
            [
              andongFieldMap.roadNameType,
              andongFieldMap.roadRouteNo,
              andongFieldMap.occupancyEmd,
              andongFieldMap.occupancyRi,
              // 점용지/물건지 지번은 빈값일 때 이전행 보정 금지
              andongFieldMap.occupantAddress,
              andongFieldMap.occupantName,
              andongFieldMap.manager,
              andongFieldMap.occupantRegNo,
              andongFieldMap.occupantContact,
              andongFieldMap.occupancyPurpose,
              andongFieldMap.workName,
              andongFieldMap.permanentArea,
              andongFieldMap.permanentAreaDetail,
              andongFieldMap.quantityTemporary,
              andongFieldMap.permanentPeriod,
              andongFieldMap.temporaryPeriod,
              andongFieldMap.restoration,
              andongFieldMap.roadMgmtReviewYn,
              andongFieldMap.excavationYn,
              andongFieldMap.pavingLedger,
              andongFieldMap.poleNo,
              andongFieldMap.note,
              andongFieldMap.cuttingPavingDoneDate,
              andongFieldMap.consultationResult,
            ].filter((x): x is string => Boolean(x))
          );
          sourceRows = applyVerticalMergeFillForHeaders(sourceRows, headers, merges, infoFillHeaders);
        } catch {
          // 병합 메타를 읽지 못하면 원본 parseResult.rows 그대로 진행
        }
      }

      const andongRows = sourceRows.map((row) => {
        const next = { ...row } as Record<string, unknown>;
        next.__andong_occupancy_address = buildUnifiedAddressFromSplit(row, {
          sidoCol: null,
          sidoFixed: '경상북도',
          sigunguCol: null,
          sigunguFixed: '안동시',
          emdCol: occupancySplit.emd,
          riCol: occupancySplit.ri,
          jibunCol: occupancySplit.jibun,
        });
        next.__andong_object_address = buildUnifiedAddressFromSplit(row, {
          sidoCol: null,
          sidoFixed: '경상북도',
          sigunguCol: null,
          sigunguFixed: '안동시',
          emdCol: objectSplit.emd,
          riCol: objectSplit.ri,
          jibunCol: objectSplit.jibun,
        });
        return next;
      });
      const finalFieldMap = { ...andongFieldMap } as Record<string, string>;
      const missing = Object.entries(finalFieldMap)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      if (missing.length > 0) {
        const msg = `안동 도로점용대장 필수 헤더 매핑 실패: ${missing.join(', ')}`;
        setProcessingError(msg);
        pushLog(msg);
        await flushLogToFile(effectivePath);
        return;
      }
      setProcessingProgress(15);
      pushLog('데이터를 처리하고 지도 레이어를 생성합니다.');
      pushLog(`총 행 수: ${andongRows.length}`);
      const andongJobId = `andong_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const andongEventSource = new EventSource(`/api/excel-wizard-events?jobId=${encodeURIComponent(andongJobId)}`);
      andongEventSource.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data ?? '{}') as { message?: unknown };
          const line = String(payload?.message ?? '').trim();
          if (line) pushLog(line);
        } catch {
          // ignore malformed SSE payload
        }
      };
      andongEventSource.onerror = () => {
        // connection hiccups are tolerated; request result still decides success/fail
      };
      try {
        const buildRes = await call('', 'POST', {
          service: 'roadUseAndongService',
          action: 'buildRoadUseAndongHierarchy',
          params: {
            rows: andongRows,
            fieldMap: finalFieldMap,
            openaiApiKey: apiKeys.OPENAI_API_KEY,
            vworldApiKey: apiKeys.VWORLD_API_KEY,
            geometryMode: geometryType,
            tablePrefix: safeTableName(tableEng),
            jobId: andongJobId,
            appendOnly: false,
          },
        });
        andongEventSource.close();
        const buildData = buildRes?.data ?? buildRes;
        if (!buildData?.success) {
          const msg = buildData?.error ?? '안동 도로점용대장 처리 실패';
          setProcessingError(msg);
          pushLog(msg);
          await flushLogToFile(effectivePath);
          return;
        }
        const inserted = buildData?.inserted ?? {};
        const geom = buildData?.geometryStats ?? {};
        const totalInsertCount =
          Number(inserted.ledgerInfo ?? 0) +
          Number(inserted.charge ?? 0) +
          Number(inserted.occupancyParcel ?? 0) +
          Number(inserted.objectParcel ?? 0);
        setProcessingProgress(95);
        setProcessingProgress(100);
        pushLog(
          '완료.',
          `삽입 행 수: ${totalInsertCount}`,
          `점용대장정보 ${inserted.ledgerInfo ?? 0}건, 부과정보 ${inserted.charge ?? 0}건, 점용지 ${inserted.occupancyParcel ?? 0}건, 물건지 ${inserted.objectParcel ?? 0}건`,
          `도형 매칭: 성공 ${geom.resolved ?? 0}건, NULL ${geom.nullGeom ?? 0}건`
        );
        pushLog(
          ...buildExcelWizardClosingLines({
            endedAtLabel: new Date().toLocaleString(),
            durationLabel: formatProcessDuration(Date.now() - startedMs),
            extractCount: andongRows.length,
            coordOk: Number(geom.resolved ?? 0),
            coordFail: Number(geom.nullGeom ?? 0),
            pnuAttempt: 0,
            pnuOk: 0,
            jijukOk: Number(geom.resolved ?? 0),
            jijukNull: Number(geom.nullGeom ?? 0),
            insertCount: totalInsertCount,
            defineResult: '안동 전용 처리(서버 내장)',
            geoserverResult: '안동 전용 처리(서버 내장)',
          })
        );
        await flushLogToFile(effectivePath);
        setProcessingDone(true);
        return;
      } catch (e: unknown) {
        andongEventSource.close();
        const msg = e instanceof Error ? e.message : String(e);
        setProcessingError(msg);
        pushLog(msg);
        await flushLogToFile(effectivePath);
        return;
      }
    }

    let workHeaders = parseResult.headers;
    let workRows = parseResult.rows;
    if (isLedgerWorkflow) {
      try {
        const expanded = await expandDevBehaviorLedgerRowsAsync(
          parseResult.headers,
          parseResult.rows,
          apiKeys.OPENAI_API_KEY,
          { onProgress: (m) => pushLog(m) }
        );
        workHeaders = expanded.headers;
        workRows = expanded.rows;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setProcessingError(msg);
        pushLog(msg);
        await flushLogToFile(effectivePath);
        return;
      }
    }

    const openaiKey = apiKeys.OPENAI_API_KEY;
    const vworldKey = apiKeys.VWORLD_API_KEY;
    if (!vworldKey) {
      const msg = 'VWORLD_API_KEY가 설정되지 않았습니다.';
      setProcessingError(msg);
      pushLog(msg);
      await flushLogToFile(effectivePath);
      return;
    }

    const GPT_PROMPT = `다음 주소 문자열을 "필지 단위 주소 배열"로 정규화해 JSON 배열로 답해줘.
                        규칙:
                        1. 입력에 복수 필지가 섞여 있으면 필지마다 하나의 주소 문자열로 분리한다.
                        2. 결과 각 원소는 가능한 한 동일한 형식(시도 시군구 읍면동 리 지번)으로 맞춘다.
                        3. "외 N번지", "외N번지", "외 N필지"는 제외하고 대표 지번만 남긴다.
                        4. "경북 영양군 수비면 수하리 781-4, 702-2"처럼 읍면동·리는 공통이고 지번만 콤마로 붙은 경우, 공통 접두를 각 필지에 복제해
                           ["경북 영양군 수비면 수하리 781-4", "경북 영양군 수비면 수하리 702-2"] 형태로 반환한다.
                        5. 응답은 JSON 배열만 출력한다. 설명/코드펜스 금지.
                        6. 주소가 있으면 빈 배열을 반환하지 않는다. 단일 필지면 길이 1 배열로 반환한다.
                        7. "652번지 5호"처럼 "번지" 뒤에 오는 "N호"는 호수/건물번호이므로 부번(-N)으로 보지 말고 제외한다. "652번지"로만 반환하고 절대 "652-5"로 만들지 않는다.
                        8. "번지" 뒤에 읍/면/동/리가 다시 나오면 새 필지의 시작으로 보고 분리한다. (예: "입암면 금학리 236번지 입암면 금학리 1203" → ["...입암면 금학리 236번지", "...입암면 금학리 1203번지"])
                        9. "하천", "하천부지", "번지선" 등 지번이 아닌 설명어는 제거한다.`;

    const splitCfg =
      parcelSelectMode === 'splitColumns'
        ? {
            sidoCol: splitSidoColumn,
            sidoFixed: splitSidoFixed,
            sigunguCol: splitSigunguColumn,
            sigunguFixed: splitSigunguFixed,
            emdCol: splitEmdColumn,
            riCol: splitRiColumn,
            jibunCol: splitJibunColumn,
          }
        : null;

    const attributeFieldDefs = activeFieldDefs.filter(
      (f) => !isExcelSystemAttrField(f.headerEng, f.originalHeader)
    );

    const columns =
      useSyntheticKeyField
        ? [
            {
              define_field_name: skEngRaw,
              define_field_kor_name: syntheticKeyKor.trim() || skEngRaw,
              define_field_show_list: true,
              define_field_show_search: true,
              define_field_is_key: true,
            },
            ...attributeFieldDefs.map((f) => ({
              define_field_name: f.headerEng,
              define_field_kor_name: f.headerKor,
              define_field_show_list: f.showList,
              define_field_show_search: f.showSearch,
              define_field_is_key: false,
            })),
          ]
        : isLedgerWorkflow
          ? [
              {
                define_field_name: 'ledger_row_key',
                define_field_kor_name: '개발행위_행키',
                define_field_show_list: true,
                define_field_show_search: true,
                define_field_is_key: true,
              },
              ...attributeFieldDefs.map((f) => ({
                define_field_name: f.headerEng,
                define_field_kor_name: f.headerKor,
                define_field_show_list: f.showList,
                define_field_show_search: f.showSearch,
                define_field_is_key: false,
              })),
            ]
          : usesCompositeKey
            ? [
                {
                  define_field_name: ckEngRaw,
                  define_field_kor_name: ckKorRaw,
                  define_field_show_list: true,
                  define_field_show_search: true,
                  define_field_is_key: true,
                },
                ...attributeFieldDefs.map((f) => ({
                  define_field_name: f.headerEng,
                  define_field_kor_name: f.headerKor,
                  define_field_show_list: f.showList,
                  define_field_show_search: f.showSearch,
                  define_field_is_key: false,
                })),
              ]
            : attributeFieldDefs.map((f) => ({
                define_field_name: f.headerEng,
                define_field_kor_name: f.headerKor,
                define_field_show_list: f.showList,
                define_field_show_search: f.showSearch,
                define_field_is_key: f.isKey && !isExcelSystemKeyColumn(f.headerEng),
              }));

    if (layerTableMeta?.exists) {
      const dropList = [...diffDropColumns]
        .map((c) => safeColumnName(c))
        .filter((c) => c && !EXCEL_LAYER_SYSTEM_COLS.has(c));
      const dbNames = new Set(
        layerTableMeta.columns.map((c) => c.name).filter((n) => !EXCEL_LAYER_SYSTEM_COLS.has(n))
      );
      for (const d of dropList) dbNames.delete(d);
      const addCols: Array<{
        define_field_name: string;
        define_field_kor_name: string;
        define_field_show_list?: boolean;
        define_field_show_search?: boolean;
        define_field_is_key?: boolean;
      }> = [];
      for (const f of activeFieldDefs) {
        if (isExcelSystemAttrField(f.headerEng, f.originalHeader)) continue;
        const cn = safeColumnName(f.headerEng);
        if (!dbNames.has(cn)) {
          addCols.push({
            define_field_name: f.headerEng,
            define_field_kor_name: f.headerKor,
            define_field_show_list: false,
            define_field_show_search: false,
            define_field_is_key: false,
          });
        }
      }
      if (isLedgerWorkflow && !dbNames.has('ledger_row_key')) {
        addCols.push({
          define_field_name: 'ledger_row_key',
          define_field_kor_name: '개발행위_행키',
          define_field_show_list: false,
          define_field_show_search: false,
          define_field_is_key: false,
        });
      }
      if (useSyntheticKeyField && skEngRaw) {
        const skCol = safeColumnName(skEngRaw);
        if (skCol && !dbNames.has(skCol) && !addCols.some((c) => safeColumnName(c.define_field_name) === skCol)) {
          addCols.push({
            define_field_name: skEngRaw,
            define_field_kor_name: syntheticKeyKor.trim() || skEngRaw,
            define_field_show_list: true,
            define_field_show_search: true,
            define_field_is_key: true,
          });
        }
      }
      if (usesCompositeKey && ckSafe && !dbNames.has(ckSafe)) {
        addCols.push({
          define_field_name: ckEngRaw,
          define_field_kor_name: ckKorRaw,
          define_field_show_list: true,
          define_field_show_search: true,
          define_field_is_key: true,
        });
      }
      if (dropList.length > 0 || addCols.length > 0) {
        pushLog(`기존 테이블 스키마 조정: DROP ${dropList.length}건, ADD ${addCols.length}건`);
        try {
          const alterRes = await call('', 'POST', {
            service: 'excelUploadService',
            action: 'applyExcelLayerTableSchemaDiff',
            params: { tableName: tableEng, addColumns: addCols, dropColumnNames: dropList },
          });
          const alterData = alterRes?.data ?? alterRes;
          if (!alterData?.success) {
            const err = alterData?.error ?? '스키마 변경에 실패했습니다.';
            setProcessingError(err);
            pushLog(err);
            await flushLogToFile(effectivePath);
            return;
          }
        } catch (e: unknown) {
          const err = e instanceof Error ? e.message : String(e);
          setProcessingError(err);
          pushLog(err);
          await flushLogToFile(effectivePath);
          return;
        }
      }
    }

    const useGeomAsParcel =
      parcelSelectMode === 'singleColumn' &&
      !!selectedGeocodingHeader &&
      selectedGeocodingHeader.trim().toLowerCase() === 'geom';
    const useGeomAsMulgunji =
      objectAddressSelectMode === 'singleColumn' &&
      !!selectedObjectAddressHeader &&
      selectedObjectAddressHeader.trim().toLowerCase() === 'geom';

    const unifiedAddressByRow = new Map<number, string>();
    const objectUnifiedAddressByRow = new Map<number, string>();
    const addressesByRow = new Map<number, string[]>();
    const geomByRow = new Map<number, string>();
    const mulgunjiGeomByRow = new Map<number, string>();
    const mulgunjiByRow = new Map<number, string[]>();
    const pendingMultiRows: { i: number; text: string }[] = [];
    const pendingMultiMulgunjiRows: { i: number; text: string }[] = [];
    for (let i = 0; i < workRows.length; i++) {
      const row = workRows[i];

      if (useGeomAsMulgunji && selectedObjectAddressHeader) {
        const mgWkt = String(row[selectedObjectAddressHeader] ?? '').trim();
        if (mgWkt) mulgunjiGeomByRow.set(i, mgWkt);
        objectUnifiedAddressByRow.set(i, '');
        mulgunjiByRow.set(i, []);
      } else {
        const objectUnifiedRaw =
          objectAddressSelectMode === 'splitColumns'
            ? buildUnifiedAddressFromSplit(row, {
                sidoCol: objSplitSidoColumn,
                sidoFixed: objSplitSidoFixed,
                sigunguCol: objSplitSigunguColumn,
                sigunguFixed: objSplitSigunguFixed,
                emdCol: objSplitEmdColumn,
                riCol: objSplitRiColumn,
                jibunCol: objSplitJibunColumn,
              })
            : objectAddressSelectMode === 'singleColumn' && selectedObjectAddressHeader
              ? String(row[selectedObjectAddressHeader] ?? '').trim()
              : '';
        objectUnifiedAddressByRow.set(i, normalizeExcelAddressForGeocode(objectUnifiedRaw));
        const objectUnified = normalizeExcelAddressForGeocode(objectUnifiedRaw);
        if (!objectUnified) {
          mulgunjiByRow.set(i, []);
        } else if (isLikelyMultiParcelAddress(objectUnified)) {
          pendingMultiMulgunjiRows.push({ i, text: objectUnified });
        } else {
          mulgunjiByRow.set(i, [objectUnified]);
        }
      }

      if (useGeomAsParcel && selectedGeocodingHeader) {
        const wkt = String(row[selectedGeocodingHeader] ?? '').trim();
        if (wkt) geomByRow.set(i, wkt);
        unifiedAddressByRow.set(i, '');
        addressesByRow.set(i, []);
        continue;
      }

      const unifiedRaw =
        parcelSelectMode === 'splitColumns' && splitCfg
          ? buildUnifiedAddressFromSplit(row, splitCfg)
          : parcelSelectMode === 'singleColumn' && selectedGeocodingHeader
            ? String(row[selectedGeocodingHeader] ?? '').trim()
            : '';
      const unified = normalizeExcelAddressForGeocode(unifiedRaw);
      unifiedAddressByRow.set(i, unified);
      if (!unified) {
        addressesByRow.set(i, []);
        continue;
      }
      if (isLikelyMultiParcelAddress(unified)) {
        pendingMultiRows.push({ i, text: unified });
      } else {
        addressesByRow.set(i, [unified]);
      }
    }

    if (pendingMultiRows.length > 0) {
      if (!openaiKey?.trim()) {
        const msg = 'OPENAI_API_KEY가 설정되지 않았습니다. 복수 필지 정규화에 필요합니다.';
        setProcessingError(msg);
        pushLog(msg);
        await flushLogToFile(effectivePath);
        return;
      }
      const batchCount = Math.ceil(pendingMultiRows.length / SINGLE_COLUMN_GPT_BATCH_MAX);
      for (let b = 0; b < pendingMultiRows.length; b += SINGLE_COLUMN_GPT_BATCH_MAX) {
        const chunk = pendingMultiRows.slice(b, b + SINGLE_COLUMN_GPT_BATCH_MAX);
        try {
          const batchMap = await fetchGptSingleColumnAddressBatch(openaiKey, chunk, GPT_PROMPT);
          for (const p of chunk) {
            const arr = batchMap.get(p.i);
            addressesByRow.set(p.i, arr && arr.length > 0 ? arr : [p.text]);
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          pushLog(`복수 필지 GPT 배치 실패 (${chunk.length}행): ${msg} — 원문 1건으로 진행합니다.`);
          for (const p of chunk) {
            addressesByRow.set(p.i, [p.text]);
          }
        }
      }
      pushLog(`복수 필지 판정 ${pendingMultiRows.length}행을 GPT로 정규화 (${batchCount}회 호출)`);
    }
    if (pendingMultiMulgunjiRows.length > 0) {
      if (!openaiKey?.trim()) {
        const msg = 'OPENAI_API_KEY가 설정되지 않았습니다. 물건지 복수 주소 정규화에 필요합니다.';
        setProcessingError(msg);
        pushLog(msg);
        await flushLogToFile(effectivePath);
        return;
      }
      const batchCount = Math.ceil(pendingMultiMulgunjiRows.length / SINGLE_COLUMN_GPT_BATCH_MAX);
      for (let b = 0; b < pendingMultiMulgunjiRows.length; b += SINGLE_COLUMN_GPT_BATCH_MAX) {
        const chunk = pendingMultiMulgunjiRows.slice(b, b + SINGLE_COLUMN_GPT_BATCH_MAX);
        try {
          const batchMap = await fetchGptSingleColumnAddressBatch(openaiKey, chunk, GPT_PROMPT);
          for (const p of chunk) {
            const arr = batchMap.get(p.i);
            mulgunjiByRow.set(p.i, arr && arr.length > 0 ? arr : [p.text]);
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          pushLog(`물건지 GPT 배치 실패 (${chunk.length}행): ${msg} — 원문 1건으로 진행합니다.`);
          for (const p of chunk) {
            mulgunjiByRow.set(p.i, [p.text]);
          }
        }
      }
      pushLog(`물건지 복수 주소 판정 ${pendingMultiMulgunjiRows.length}행을 GPT로 정규화 (${batchCount}회 호출)`);
    }

    let geocodeFailCount = 0;
    const geocodeFailReasons: { row: number; key: string; rawCell: string; address: string; reason: string }[] = [];
    const totalRows = workRows.length;
    let totalInsertCount = 0;
    let totalPolygonMatched = 0;
    let totalPolygonNull = 0;
    let totalExtractCount = 0;
    let totalCoordOk = 0;
    let totalPnuAttempt = 0;
    let totalPnuOk = 0;
    let totalHangjeongRiFixOk = 0;
    const hangjeongRiFixGeocodeLines: string[] = [];

    let oldRowCount = 0;
    if (layerTableMeta?.exists) {
      try {
        const cntRes = await call('', 'POST', {
          service: 'excelHistoryService',
          action: 'countExcelLayerRows',
          params: { tableName: tableEng.trim() },
        });
        const cntData = cntRes?.data ?? cntRes;
        if (cntData?.success !== false && cntData?.count != null) {
          oldRowCount = Number(cntData.count) || 0;
          pushLog(`기존 테이블 행 수(이전): ${oldRowCount.toLocaleString('ko-KR')}건`);
        }
      } catch (e: unknown) {
        pushLog(`이전 행 수 조회 오류(계속 진행): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const syncKeyForCapture = safeColumnName(keyField);
    const integrityMode = !!layerTableMeta?.exists && !!syncKeyForCapture;
    let integrityAppliedWithoutModal = false;
    if (integrityMode) {
      pushLog(`기존 테이블 정합성 모드: 키=${syncKeyForCapture} (전체 덮어쓰기 없이 비교·선택 반영)`);
    }

    const stagedRows: Array<{
      attrs: Record<string, unknown>;
      parcels: { address: string; x?: number; y?: number; geom?: string }[];
      mulgunjis: { address: string; x?: number; y?: number; geom?: string }[];
    }> = [];

    const canServerGeomBulk =
      useGeomAsParcel &&
      !integrityMode &&
      !separateJijukTable &&
      !separateMulgunjiTable &&
      !isLedgerWorkflow &&
      !usesCompositeKey &&
      !!effectivePath &&
      !!selectedGeocodingHeader &&
      totalRows >= EXCEL_GEOM_BULK_MIN_ROWS;

    let usedServerGeomBulk = false;
    if (canServerGeomBulk) {
      usedServerGeomBulk = true;
      pushLog(
        `대용량 geom: 서버 bulk 적재 (${totalRows.toLocaleString('ko-KR')}행, 배치 ${EXCEL_CLIENT_INSERT_BATCH}+, SRID=${excelGeomSridMode})`
      );
      const bulkJobId = `excel_geom_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const bulkEs = new EventSource(`/api/excel-wizard-events?jobId=${encodeURIComponent(bulkJobId)}`);
      bulkEs.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data ?? '{}') as { message?: unknown };
          const line = String(payload?.message ?? '').trim();
          if (line) pushLog(line);
        } catch {
          /* ignore */
        }
      };
      try {
        const fieldMappings = attributeFieldDefs.map((f) => ({
          originalHeader: f.originalHeader,
          headerEng: f.headerEng,
        }));
        const bulkRes = await call('', 'POST', {
          service: 'excelUploadService',
          action: 'bulkLoadExcelGeomFromFile',
          params: {
            pathOrResult: effectivePath,
            tableName: tableEng,
            tableKorName: tableKor || tableEng,
            keyField,
            columns,
            geometryType,
            geomHeader: selectedGeocodingHeader,
            fieldMappings,
            geomInputSrid: excelGeomSridMode,
            titleRowLines,
            batchSize: EXCEL_CLIENT_INSERT_BATCH,
            jobId: bulkJobId,
            syntheticKeyField: useSyntheticKeyField ? skEngRaw : null,
          },
        });
        const bulkData = bulkRes?.data ?? bulkRes;
        if (!bulkData?.success) {
          const err = bulkData?.error ?? '서버 geom bulk 실패';
          setProcessingError(err);
          pushLog(err);
          await flushLogToFile(effectivePath);
          bulkEs.close();
          return;
        }
        totalInsertCount = Number(bulkData.rowCount ?? 0);
        totalExtractCount = Number(bulkData.totalRows ?? totalRows);
        totalCoordOk = Number(bulkData.polygonMatchedCount ?? 0);
        totalPolygonMatched = Number(bulkData.polygonMatchedCount ?? 0);
        totalPolygonNull = Number(bulkData.polygonNullCount ?? 0);
        setProcessingProgress(80);
        pushLog(
          `서버 geom bulk 완료: 삽입 ${totalInsertCount.toLocaleString('ko-KR')}건`
        );
      } catch (e: unknown) {
        const err = e instanceof Error ? e.message : String(e);
        setProcessingError(err);
        pushLog(err);
        await flushLogToFile(effectivePath);
        bulkEs.close();
        return;
      } finally {
        bulkEs.close();
      }
    }

    const pendingInsertRows: Array<{
      attrs: Record<string, unknown>;
      parcels: { address: string; x?: number; y?: number; geom?: string }[];
      mulgunjis: { address: string; x?: number; y?: number; geom?: string }[];
    }> = [];
    let insertCallCount = 0;
    const flushPendingInserts = async (): Promise<boolean> => {
      if (pendingInsertRows.length === 0) return true;
      const chunk = pendingInsertRows.splice(0, pendingInsertRows.length);
      insertCallCount += 1;
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
            rows: chunk,
            appendOnly: insertCallCount > 1,
            separateJijukTable,
            separateMulgunjiTable,
            jijukTableComment: `${(tableKor || tableEng).trim()}_필지목록`,
            mulgunjiTableComment: `${(tableKor || tableEng).trim()}_물건지`,
            geomInputSrid: useGeomAsParcel ? excelGeomSridMode : 'auto',
          },
        });
        const createData = createRes?.data ?? createRes;
        if (!createData?.success) {
          const err = createData?.error ?? '행 삽입 실패';
          setProcessingError(err);
          pushLog(err);
          await flushLogToFile(effectivePath);
          return false;
        }
        totalInsertCount += createData.rowCount ?? 0;
        totalPnuAttempt += createData.pnuAttemptCount ?? 0;
        totalPnuOk += createData.pnuOkCount ?? 0;
        totalHangjeongRiFixOk += createData.hangjeongRiFixOkCount ?? 0;
        if (geometryType === 'Polygon') {
          totalPolygonMatched += createData.polygonMatchedCount ?? 0;
          totalPolygonNull += createData.polygonNullCount ?? 0;
        }
        if (useGeomAsParcel || insertCallCount === 1 || insertCallCount % 5 === 0) {
          pushLog(
            `INSERT 배치 ${insertCallCount}: ${chunk.length}행 (누적 삽입 ${totalInsertCount.toLocaleString('ko-KR')})`
          );
        }
        return true;
      } catch (e: unknown) {
        const err = e instanceof Error ? e.message : String(e);
        setProcessingError(err);
        pushLog(err);
        await flushLogToFile(effectivePath);
        return false;
      }
    };

    if (!usedServerGeomBulk) for (let i = 0; i < workRows.length; i++) {
      const row = workRows[i];
      let rawText = '';
      const attrs: Record<string, unknown> = {};
      workHeaders.forEach((h) => {
        if (h === LEDGER_ROW_KEY_HEADER) {
          attrs.ledger_row_key = row[h];
          return;
        }
        const def = activeFieldDefs.find((f) => f.originalHeader === h);
        if (!def) return;
        if (isExcelSystemAttrField(def.headerEng, def.originalHeader)) return;
        attrs[safeColumnName(def.headerEng)] = row[h];
      });
      if (useSyntheticKeyField && skSafe) {
        attrs[skSafe] = `k${String(i + 1).padStart(8, '0')}`;
      } else if (usesCompositeKey && ckSafe) {
        attrs[ckSafe] = buildExcelCompositeKeyValue(
          keyFieldDefs.map((def) => row[def.originalHeader])
        );
      }

      const addresses = (addressesByRow.get(i) ?? []).map((a) => normalizeExcelAddressForGeocode(a)).filter(Boolean);
      rawText = unifiedAddressByRow.get(i) ?? '';
      const objectRawText = objectUnifiedAddressByRow.get(i) ?? '';
      const rowKeyVal = String(
        attrs[safeColumnName(keyField)] ?? attrs.ledger_row_key ?? attrs[skSafe] ?? ''
      ).trim();
      const pushGeocodeFail = (address: string, reason: string) => {
        geocodeFailCount++;
        geocodeFailReasons.push({
          row: i + 1,
          key: rowKeyVal,
          rawCell: rawText || objectRawText,
          address,
          reason,
        });
      };
      const mulgunjiAddrs = (mulgunjiByRow.get(i) ?? [])
        .map((a) => normalizeExcelAddressForGeocode(a))
        .filter(Boolean);
      const mulgunjis: { address: string; x?: number; y?: number; geom?: string }[] = [];
      if (useGeomAsMulgunji) {
        const mgWkt = mulgunjiGeomByRow.get(i) ?? '';
        if (mgWkt) mulgunjis.push({ address: '', geom: mgWkt });
      } else {
        for (const addr of mulgunjiAddrs) {
          if (!addr.trim()) continue;
          try {
            const coord = await getCoordFromAddressWithHangjeongRiFallback(addr, vworldKey);
            if (coord.ok) {
              mulgunjis.push({ address: addr, x: coord.lon, y: coord.lat });
              if (coord.hangjeongFix) {
                totalHangjeongRiFixOk++;
                hangjeongRiFixGeocodeLines.push(`행 ${i + 1} 물건지: ${coord.hangjeongFix}`);
              }
            } else {
              mulgunjis.push({ address: addr });
              pushGeocodeFail(addr, coord.message || '물건지 GetCoord 실패');
            }
          } catch (e: unknown) {
            mulgunjis.push({ address: addr });
            const msg = e instanceof Error ? e.message : String(e);
            pushGeocodeFail(addr, msg || '물건지 API 오류');
          }
        }
      }

      const parcels: { address: string; x?: number; y?: number; geom?: string }[] = [];
      if (useGeomAsParcel) {
        const wkt = geomByRow.get(i) ?? '';
        if (wkt) {
          parcels.push({ address: '', geom: wkt });
        } else {
          parcels.push({ address: '' });
        }
      } else {
        for (const addr of addresses) {
          if (!addr.trim()) continue;
          try {
            // 원주소 실패 시 행정리→법정리로 GetCoord 재시도 (엑셀 업로드만)
            const coord = await getCoordFromAddressWithHangjeongRiFallback(addr, vworldKey);
            if (coord.ok) {
              parcels.push({ address: addr, x: coord.lon, y: coord.lat });
              if (coord.hangjeongFix) {
                totalHangjeongRiFixOk++;
                hangjeongRiFixGeocodeLines.push(`행 ${i + 1} 필지: ${coord.hangjeongFix}`);
              }
            } else {
              parcels.push({ address: addr });
              pushGeocodeFail(addr, coord.message || 'GetCoord 실패');
            }
          } catch (e: unknown) {
            parcels.push({ address: addr });
            const msg = e instanceof Error ? e.message : String(e);
            pushGeocodeFail(addr, msg || 'API 오류');
          }
        }
        if (addresses.length === 0) parcels.push({ address: '' });
      }

      const extractN = useGeomAsParcel
        ? (geomByRow.get(i) ? 1 : 0)
        : addresses.filter((a) => a.trim()).length;
      const coordOk = useGeomAsParcel
        ? (geomByRow.get(i) ? 1 : 0)
        : parcels.filter((p) => p.x != null && p.y != null).length;
      totalExtractCount += extractN;
      totalCoordOk += coordOk;
      const resultText = useGeomAsParcel
        ? geomByRow.get(i)
          ? ` — geom WKT 반영 (${String(geomByRow.get(i)).length}자)`
          : ' — geom 없음 (셀 비어 있음)'
        : addresses.length > 0
          ? ` — 필지 ${addresses.length}개 추출, ${coordOk}개 좌표 획득`
          : parcelSelectMode === 'splitColumns'
            ? ' — 주소 없음 (열 조합 결과 없음)'
            : !rawText
              ? ' — 주소 없음 (엑셀 셀 비어 있음)'
              : ' — 주소 없음 (필지 추출 결과 없음)';
      const rowLogLines = [`행 ${i + 1}/${totalRows} 처리${resultText}`];
      if (useGeomAsParcel) {
        if (geomByRow.get(i)) rowLogLines.push('  geom → 도형 그대로 삽입');
      } else if (rawText) {
        if (parcelSelectMode === 'splitColumns') {
          addresses.filter((a) => a.trim()).forEach((a) => rowLogLines.push(`  조합 주소: ${a}`));
        } else {
          addresses.filter((a) => a.trim()).forEach((a) => rowLogLines.push(`  ${rawText} > ${a}`));
        }
      } else {
        addresses.filter((a) => a.trim()).forEach((a) => rowLogLines.push(`  · ${a}`));
      }
      rowLogLines.push(
        useGeomAsMulgunji
          ? mulgunjiGeomByRow.get(i)
            ? `  물건지: geom WKT 반영 (${String(mulgunjiGeomByRow.get(i)).length}자)`
            : '  물건지: geom 없음'
          : `  물건지 주소: ${objectRawText || '(없음)'}`
      );
      if (!useGeomAsMulgunji && mulgunjis.length > 1) {
        rowLogLines.push(`  물건지 분리: ${mulgunjis.length}건`);
      }
      if (useGeomAsMulgunji && mulgunjiGeomByRow.get(i)) {
        rowLogLines.push('  물건지 geom → 도형 그대로 삽입');
      }
      parcels.filter((p) => p.x != null && p.y != null).forEach((p) => {
        rowLogLines.push(`    좌표 획득: ${p.address} → (x: ${p.x}, y: ${p.y})`);
      });
      setProcessingProgress(Math.round(15 + (65 * (i + 1)) / totalRows));
      const shouldLogRow =
        !useGeomAsParcel ||
        i === 0 ||
        i === totalRows - 1 ||
        (i + 1) % EXCEL_GEOM_LOG_EVERY === 0;
      if (shouldLogRow) {
        pushLog(...rowLogLines);
      }

      stagedRows.push({ attrs, parcels, mulgunjis });

      // 신규 테이블만 배치 INSERT. 기존 테이블은 지오코딩 후 정합성 비교.
      if (integrityMode) {
        continue;
      }

      pendingInsertRows.push({ attrs, parcels, mulgunjis });
      if (pendingInsertRows.length >= EXCEL_CLIENT_INSERT_BATCH) {
        const ok = await flushPendingInserts();
        if (!ok) return;
      }
    }

    if (!usedServerGeomBulk && !integrityMode) {
      const ok = await flushPendingInserts();
      if (!ok) return;
    }

    if (integrityMode) {
      pushLog(`지오코딩 완료 ${stagedRows.length}건 — 키 기준 정합성 비교 중…`);
      try {
        const INTEGRITY_SYNC_CHUNK = 20;
        const excelKeysUniverse = stagedRows
          .map((r) =>
            String(
              r.attrs[syncKeyForCapture] ?? r.attrs.ledger_row_key ?? r.attrs[skSafe] ?? ''
            ).trim()
          )
          .filter(Boolean);
        const chunkTotal = Math.max(1, Math.ceil(stagedRows.length / INTEGRITY_SYNC_CHUNK));
        let unchangedCount = 0;
        let appendCount = 0;
        let conflictCount = 0;
        let removeCount = 0;
        let appendKeys: string[] = [];
        let prepOk = false;

        for (let ci = 0; ci < chunkTotal; ci++) {
          const chunk = stagedRows.slice(
            ci * INTEGRITY_SYNC_CHUNK,
            (ci + 1) * INTEGRITY_SYNC_CHUNK
          );
          if (chunk.length === 0) continue;
          pushLog(`정합성 비교 배치 ${ci + 1}/${chunkTotal} (${chunk.length}행)…`);
          const prepRes = await call('', 'POST', {
            service: 'excelUploadService',
            action: 'prepareExcelIntegritySync',
            params: {
              tableName: tableEng.trim(),
              keyField: syncKeyForCapture,
              rows: chunk,
              geometryType: geometryType ?? undefined,
              excelKeysUniverse,
              chunkIndex: ci,
              chunkTotal,
            },
          });
          const prep = prepRes?.data ?? prepRes;
          if (!prep?.success) {
            const err = prep?.error ?? '정합성 비교 실패';
            setProcessingError(err);
            pushLog(err);
            await flushLogToFile(effectivePath);
            return;
          }
          unchangedCount += Number(prep.unchangedCount ?? 0);
          appendCount += Number(prep.appendCount ?? 0);
          conflictCount += Number(prep.conflictCount ?? 0);
          removeCount += Number(prep.removeCount ?? 0);
          if (Array.isArray(prep.appendKeys)) appendKeys = prep.appendKeys;
          prepOk = true;
        }

        if (!prepOk) {
          const err = '정합성 비교 실패';
          setProcessingError(err);
          pushLog(err);
          await flushLogToFile(effectivePath);
          return;
        }

        pushLog(
          `정합성 비교: 동일 ${unchangedCount} · 신규 ${appendCount} · 충돌 ${conflictCount} · 삭제 ${removeCount}`
        );
        if (conflictCount > 0 && geometryType) {
          pushLog(
            `도형 모드(${geometryType}) 기준으로 속성·도형 차이를 충돌로 분류했습니다. 정합성 화면에서 geom 변경을 확인하세요.`
          );
        }
        if (
          unchangedCount === 0 &&
          conflictCount === 0 &&
          appendCount > 0 &&
          removeCount > 0
        ) {
          pushLog(
            '경고: 키가 하나도 겹치지 않습니다. 복합키 구성·영문명이 이전과 다르거나, DB에 키 값이 없을 수 있습니다. 삭제 탭에서 기존 행 삭제 여부를 확인하세요.'
          );
        }
        integrityPendingRef.current = {
          stagedRows,
          columns,
          keyField: syncKeyForCapture,
          appendKeys,
          tableEng: tableEng.trim(),
          tableKor: tableKor || tableEng,
          tableGroup: tableGroup.trim(),
          geometryType: geometryType ?? 'Point',
          separateJijukTable,
          separateMulgunjiTable,
          effectivePath,
          oldRowCount,
          startedMs,
          operatorId,
          operatorLabel,
          totalExtractCount,
          totalCoordOk,
          geocodeFailCount,
          syncKeyField: syncKeyForCapture,
        };
        if (appendCount + conflictCount + removeCount === 0) {
          pushLog(
            `정합성 비교: 변경 없음 (동일 ${unchangedCount}건) — 모달 없이 이어서 마무리합니다.`
          );
          integrityPendingRef.current = null;
          integrityAppliedWithoutModal = true;
        } else {
          setExcelSyncOpen(true);
          pushLog(
            '정합성 검증 화면에서 반영/유지를 선택한 뒤 닫으면 DB에 확정됩니다. (미결이 남아 있으면 취소)'
          );
          setProcessingProgress(88);
          await flushLogToFile(effectivePath);
          return;
        }
      } catch (e: unknown) {
        const err =
          e && typeof e === 'object' && 'message' in e && (e as { message?: unknown }).message === 'Response is not JSON'
            ? `서버 응답이 JSON이 아닙니다(HTTP ${(e as { status?: unknown }).status ?? '?'}). 요청이 너무 크거나 서버 오류일 수 있습니다.`
            : e instanceof Error
              ? e.message
              : String(e);
        setProcessingError(err);
        pushLog(err);
        await flushLogToFile(effectivePath);
        return;
      }
    }

    const failLogLines = [`지오코딩 실패: ${geocodeFailCount}건`];
    geocodeFailReasons.forEach((f) => {
      failLogLines.push(formatGeocodeFailLine(f));
    });
    pushLog(...failLogLines);
    if (hangjeongRiFixGeocodeLines.length > 0) {
      pushLog(
        `[행정리→법정리] VWorld 좌표 보정 성공 ${hangjeongRiFixGeocodeLines.length}건`,
        ...hangjeongRiFixGeocodeLines.slice(0, 50).map((l) => `  ${l}`),
        ...(hangjeongRiFixGeocodeLines.length > 50
          ? [`  …외 ${hangjeongRiFixGeocodeLines.length - 50}건 (서버 .log·처리로그 참고)`]
          : [])
      );
    }
    setProcessingProgress(85);

    try {
      if (geometryType === 'Polygon' && (totalPolygonMatched > 0 || totalPolygonNull > 0)) {
        pushLog(
          `[지적(jijuk) 폴리곤 매칭] 성공 ${totalPolygonMatched}건, 미매칭(geom NULL) ${totalPolygonNull}건`,
          '  - 서버 .log 하단에 PNU 폴백 상세(행·키·주소)가 이어 붙습니다.',
        );
      }
      if (totalHangjeongRiFixOk > 0) {
        pushLog(
          `[행정리→법정리] 보정 후 매칭 성공 누적 ${totalHangjeongRiFixOk}건 (지오코딩·PNU 지적 합산, 상세는 .log riFix=…)`
        );
      }
      setProcessingProgress(90);
      let defineResult = '미실행';
      let geoserverResult = '미실행';
      let fieldMapResult = '미실행';
      const defineRes = await call('', 'POST', {
        service: 'excelUploadService',
        action: 'createDefineTableAndFieldsForExcel',
        params: {
          tableName: tableEng,
          tableKorName: tableKor || tableEng,
          geometryType,
          columns,
          group: tableGroup.trim() || undefined,
          ...(separateJijukTable && tableEng.trim()
            ? {
                jijukChild: {
                  tableName: `${tableEng.trim()}_jijuk`,
                  tableKorName: `${(tableKor || tableEng).trim()}_필지목록`,
                },
              }
            : {}),
          ...(separateMulgunjiTable && tableEng.trim()
            ? {
                mulgunjiChild: {
                  tableName: `${tableEng.trim()}_mulgunji`,
                  tableKorName: `${(tableKor || tableEng).trim()}_물건지`,
                },
              }
            : {}),
        },
      });
      const defineData = defineRes?.data ?? defineRes;
      defineResult = defineData?.success === false
        ? `실패: ${defineData?.error ?? '알 수 없음'}`
        : '성공';
      setProcessingProgress(95);
      const gsRes = await call('', 'POST', {
        service: 'excelUploadService',
        action: 'createGeoServerLayerForExcel',
        params: {
          tableName: tableEng,
          geometryType,
          ...(separateJijukTable && tableEng.trim()
            ? { jijukTableName: `${tableEng.trim()}_jijuk` }
            : {}),
          ...(separateMulgunjiTable && tableEng.trim()
            ? { mulgunjiTableName: `${tableEng.trim()}_mulgunji` }
            : {}),
        },
      });
      const gsData = gsRes?.data ?? gsRes;
      geoserverResult = gsData?.success === false
        ? `실패: ${gsData?.error ?? '알 수 없음'}`
        : '성공';
      const fieldMap: Record<string, string> = {};
      if (isLedgerWorkflow) {
        fieldMap[LEDGER_ROW_KEY_HEADER] = 'ledger_row_key';
      }
      activeFieldDefs.forEach((f) => {
        if (f.headerEng) fieldMap[f.originalHeader] = f.headerEng;
      });
      const mapRes = await call('', 'POST', {
        service: 'excelUploadService',
        action: 'writeExcelFieldNameMap',
        params: { entries: fieldMap },
      });
      const mapData = mapRes?.data ?? mapRes;
      fieldMapResult = mapData?.success === false
        ? `실패: ${mapData?.error ?? '알 수 없음'}`
        : '성공';
      setProcessingProgress(100);
      pushLog('완료.', `삽입 행 수: ${totalInsertCount}`);
      pushLog(
        ...buildExcelWizardClosingLines({
          endedAtLabel: new Date().toLocaleString(),
          durationLabel: formatProcessDuration(Date.now() - startedMs),
          extractCount: totalExtractCount,
          coordOk: totalCoordOk,
          coordFail: geocodeFailCount,
          pnuAttempt: totalPnuAttempt,
          pnuOk: totalPnuOk,
          jijukOk: totalPolygonMatched,
          jijukNull: totalPolygonNull,
          hangjeongRiFixOk: totalHangjeongRiFixOk,
          insertCount: totalInsertCount,
          defineResult,
          geoserverResult,
          fieldMapResult,
        })
      );
      await flushLogToFile(effectivePath);
      const geocodingDef =
        parcelSelectMode === 'singleColumn' && selectedGeocodingHeader
          ? activeFieldDefs.find((f) => f.originalHeader === selectedGeocodingHeader)
          : undefined;
      const syncKeyField = safeColumnName(
        isLedgerWorkflow
          ? 'ledger_row_key'
          : keyField.trim() || (useSyntheticKeyField ? skEngRaw : '')
      );
      let ehKey: number | undefined;
      try {
        const histRes = await call('', 'POST', {
          service: 'excelHistoryService',
          action: 'createExcelHistory',
          params: {
            sourcePath: effectivePath ?? undefined,
            tableName: tableEng,
            tableKorName: tableKor || tableEng,
            group: tableGroup.trim() || undefined,
            rowCount: totalInsertCount,
            result: '성공',
            oldRowCount,
            contents: undefined,
            createUser: /^\d+$/.test(operatorId) ? Number(operatorId) : undefined,
            geocodingHeaderKor:
              parcelSelectMode === 'singleColumn' ? selectedGeocodingHeader ?? undefined : '시도·시군구·읍면동·리·지번(열 구분)',
            geocodingHeaderEng: geocodingDef?.headerEng,
            geometryType: geometryType ?? undefined,
          },
        });
        const histData = histRes?.data ?? histRes;
        ehKey = typeof histData?.ehKey === 'number' ? histData.ehKey : undefined;
      } catch {
        /* ignore */
      }
      // 행 비교 스냅샷 없이 현재 적재분 append → data_log 반영
      if (ehKey != null && syncKeyField && !integrityAppliedWithoutModal) {
        try {
          const finRes = await call('', 'POST', {
            service: 'excelHistoryService',
            action: 'finalizeExcelSyncLogsAfterUpload',
            params: {
              ehKey,
              tableName: tableEng.trim(),
              keyField: syncKeyField,
              logUser: operatorLabel !== '미확인' ? operatorLabel : operatorId || undefined,
            },
          });
          const finData = finRes?.data ?? finRes;
          if (finData?.success === false) {
            pushLog(`데이터 이력 반영 실패: ${finData?.error ?? '알 수 없음'}`);
          } else {
            pushLog(
              `데이터 이력 반영: 추가 ${finData?.appendCount ?? 0}` +
                (finData?.conflictCount || finData?.removeCount
                  ? `, 변경 ${finData?.conflictCount ?? 0}, 삭제 ${finData?.removeCount ?? 0}`
                  : '') +
                (finData?.unchangedSkipped ? `, 동일생략 ${finData.unchangedSkipped}` : '')
            );
          }
        } catch (e: unknown) {
          pushLog(`데이터 이력 반영 오류: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (ehKey != null && integrityAppliedWithoutModal) {
        try {
          const attachRes = await call('', 'POST', {
            service: 'excelHistoryService',
            action: 'attachExcelIntegritySyncToHistory',
            params: {
              ehKey,
              tableName: tableEng.trim(),
              logUser: operatorLabel !== '미확인' ? operatorLabel : operatorId || undefined,
            },
          });
          const attachData = attachRes?.data ?? attachRes;
          if (attachData?.success === false) {
            pushLog(`정합성 이력 연결 실패: ${attachData?.error ?? '알 수 없음'}`);
          } else {
            pushLog(
              `정합성 이력 연결: 추가 ${attachData?.appendCount ?? 0}, 변경 ${attachData?.conflictCount ?? 0}, 삭제 ${attachData?.removeCount ?? 0}` +
                (attachData?.keptCount ? `, 유지 ${attachData.keptCount}` : '')
            );
          }
        } catch (e: unknown) {
          pushLog(`정합성 이력 연결 오류: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (ehKey != null && !syncKeyField) {
        pushLog('키 필드가 없어 데이터 이력 반영을 건너뜁니다.');
      }
      setProcessingDone(true);
      requestExcelHistoryRefresh();
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      setProcessingError(err);
      pushLog(err);
      pushLog(
        ...buildExcelWizardClosingLines({
          endedAtLabel: new Date().toLocaleString(),
          durationLabel: formatProcessDuration(Date.now() - startedMs),
          extractCount: totalExtractCount,
          coordOk: totalCoordOk,
          coordFail: geocodeFailCount,
          pnuAttempt: totalPnuAttempt,
          pnuOk: totalPnuOk,
          jijukOk: totalPolygonMatched,
          jijukNull: totalPolygonNull,
          hangjeongRiFixOk: totalHangjeongRiFixOk,
          insertCount: totalInsertCount,
          defineResult: '오류로 중단',
          geoserverResult: '오류로 중단',
          fieldMapResult: '오류로 중단',
        })
      );
      await flushLogToFile(effectivePath);
    }
  }, [
    parseResult,
    isLedgerWorkflow,
    isAndongRoadUseWorkflow,
    parcelSelectMode,
    objectAddressSelectMode,
    selectedGeocodingHeader,
    selectedObjectAddressHeader,
    splitSidoColumn,
    splitSidoFixed,
    splitSigunguColumn,
    splitSigunguFixed,
    splitEmdColumn,
    splitRiColumn,
    splitJibunColumn,
    objSplitSidoColumn,
    objSplitSidoFixed,
    objSplitSigunguColumn,
    objSplitSigunguFixed,
    objSplitEmdColumn,
    objSplitRiColumn,
    objSplitJibunColumn,
    tableEng,
    tableKor,
    tableGroup,
    keyField,
    keyFieldDefs,
    usesCompositeKey,
    keyMode,
    fieldDefs,
    activeFieldDefs,
    layerTableMeta,
    diffDropColumns,
    geometryType,
    apiKeys,
    selectedFile,
    pathOrResult,
    upload,
    useSyntheticKeyField,
    syntheticKeyEng,
    syntheticKeyKor,
    compositeKeyEng,
    compositeKeyKor,
    createSeparateJijukTable,
    createSeparateMulgunjiTable,
    session?.user?.id,
    session?.user?.name,
  ]);

  useEffect(() => {
    if (step === 4 && !step4StartedRef.current && !processingDone && !processingError) {
      step4StartedRef.current = true;
      runStep4();
    }
  }, [step, processingDone, processingError, runStep4]);

  const appendProcessLog = useCallback((...entries: string[]) => {
    setProcessingLog((prev) => [...prev, ...entries]);
  }, []);

  const handleExcelSyncReviewClose = useCallback(async () => {
    const pending = integrityPendingRef.current;
    setExcelSyncOpen(false);
    if (!pending) {
      appendProcessLog('정합성 검증을 종료했습니다.');
      setProcessingDone(true);
      return;
    }
    setExcelSyncApplying(true);
    try {
      const sumRes = await call('', 'POST', {
        service: 'excelHistoryService',
        action: 'getExcelIntegrityIntentSummary',
        params: { tableName: pending.tableEng },
      });
      const sum = sumRes?.data ?? sumRes;
      if (!sum?.success) {
        const err = sum?.error ?? '정합성 선택 상태 조회 실패';
        setProcessingError(err);
        appendProcessLog(err);
        return;
      }
      const pendingCount = Number(sum.pendingCount ?? 0);
      const appendKeys = (sum.appendKeys ?? []) as string[];
      const conflictKeys = (sum.conflictKeys ?? []) as string[];
      const removeKeys = (sum.removeKeys ?? []) as string[];
      const keptKeys = (sum.keptKeys ?? []) as string[];
      const intentTotal =
        appendKeys.length + conflictKeys.length + removeKeys.length + keptKeys.length;

      if (pendingCount > 0 || intentTotal === 0) {
        await call('', 'POST', {
          service: 'excelHistoryService',
          action: 'discardExcelIntegrityReview',
          params: { tableName: pending.tableEng },
        }).catch(() => undefined);
        integrityPendingRef.current = null;
        appendProcessLog(
          pendingCount > 0
            ? `정합성 검증을 취소했습니다. 미결 ${pendingCount}건이 남아 DB는 변경되지 않았습니다.`
            : '정합성 검증을 취소했습니다. 선택한 반영/유지가 없어 DB는 변경되지 않았습니다.'
        );
        setProcessingDone(true);
        return;
      }

      appendProcessLog(
        `정합성 확정 중… 신규 ${appendKeys.length} · 변경 ${conflictKeys.length} · 삭제 ${removeKeys.length} · 유지 ${keptKeys.length}`
      );
      const applyRes = await call('', 'POST', {
        service: 'excelUploadService',
        action: 'applyExcelIntegritySync',
        params: {
          tableName: pending.tableEng,
          tableKorName: pending.tableKor,
          keyField: pending.keyField,
          columns: pending.columns,
          rows: pending.stagedRows,
          geometryType: pending.geometryType,
          conflictKeysUseExcel: conflictKeys,
          removeKeys,
          conflictKeysKeepDb: keptKeys,
          appendKeys,
          separateJijukTable: pending.separateJijukTable,
          separateMulgunjiTable: pending.separateMulgunjiTable,
          jijukTableComment: `${pending.tableKor.trim()}_필지목록`,
          mulgunjiTableComment: `${pending.tableKor.trim()}_물건지`,
        },
      });
      const ad = applyRes?.data ?? applyRes;
      if (!ad?.success) {
        const err = ad?.error ?? '정합성 적용 실패';
        setProcessingError(err);
        appendProcessLog(err);
        return;
      }
      appendProcessLog(
        `정합성 적용 완료: 추가/갱신 삽입 ${ad.insertedCount ?? 0}, 삭제 ${ad.deletedCount ?? 0}, 충돌반영 ${ad.updatedCount ?? 0}, 유지 ${ad.keptCount ?? 0}`
      );

      setProcessingProgress(92);
      const defineRes = await call('', 'POST', {
        service: 'excelUploadService',
        action: 'createDefineTableAndFieldsForExcel',
        params: {
          tableName: pending.tableEng,
          tableKorName: pending.tableKor,
          geometryType: pending.geometryType,
          columns: pending.columns,
          group: pending.tableGroup.trim() || undefined,
        },
      });
      const defineData = defineRes?.data ?? defineRes;
      const defineResult =
        defineData?.success === false ? `실패: ${defineData?.error ?? '알 수 없음'}` : '성공';
      const gsRes = await call('', 'POST', {
        service: 'excelUploadService',
        action: 'createGeoServerLayerForExcel',
        params: { tableName: pending.tableEng, geometryType: pending.geometryType },
      });
      const gsData = gsRes?.data ?? gsRes;
      const geoserverResult =
        gsData?.success === false ? `실패: ${gsData?.error ?? '알 수 없음'}` : '성공';

      let finalRowCount = ad.insertedCount ?? 0;
      try {
        const cntRes = await call('', 'POST', {
          service: 'excelHistoryService',
          action: 'countExcelLayerRows',
          params: { tableName: pending.tableEng },
        });
        const cntData = cntRes?.data ?? cntRes;
        if (cntData?.success && typeof cntData.count === 'number') {
          finalRowCount = cntData.count;
        }
      } catch {
        /* ignore */
      }

      const integrityContentsParts: string[] = [];
      if (appendKeys.length > 0) {
        integrityContentsParts.push(`추가 ${appendKeys.length.toLocaleString('ko-KR')}건`);
      }
      if (conflictKeys.length > 0) {
        integrityContentsParts.push(`변경 ${conflictKeys.length.toLocaleString('ko-KR')}건`);
      }
      if (removeKeys.length > 0) {
        integrityContentsParts.push(`삭제 ${removeKeys.length.toLocaleString('ko-KR')}건`);
      }
      if (keptKeys.length > 0) {
        integrityContentsParts.push(`유지 ${keptKeys.length.toLocaleString('ko-KR')}건`);
      }
      const integrityContents =
        integrityContentsParts.length > 0 ? integrityContentsParts.join(' · ') : '변경 없음';

      try {
        const histRes = await call('', 'POST', {
          service: 'excelHistoryService',
          action: 'createExcelHistory',
          params: {
            sourcePath: pending.effectivePath ?? undefined,
            tableName: pending.tableEng,
            tableKorName: pending.tableKor,
            group: pending.tableGroup.trim() || undefined,
            rowCount: finalRowCount,
            result: '성공',
            oldRowCount: pending.oldRowCount,
            contents: integrityContents,
            createUser: /^\d+$/.test(pending.operatorId) ? Number(pending.operatorId) : undefined,
            geometryType: pending.geometryType,
          },
        });
        const histData = histRes?.data ?? histRes;
        const ehKey = typeof histData?.ehKey === 'number' ? histData.ehKey : undefined;
        if (ehKey != null) {
          const attachRes = await call('', 'POST', {
            service: 'excelHistoryService',
            action: 'attachExcelIntegritySyncToHistory',
            params: {
              ehKey,
              tableName: pending.tableEng,
              logUser:
                pending.operatorLabel !== '미확인'
                  ? pending.operatorLabel
                  : pending.operatorId || undefined,
              fallbackCounts: {
                append: appendKeys.length,
                conflict: conflictKeys.length,
                remove: removeKeys.length,
                kept: keptKeys.length,
              },
            },
          });
          const attachData = attachRes?.data ?? attachRes;
          if (attachData?.success === false) {
            appendProcessLog(`정합성 이력 연결 실패: ${attachData?.error ?? '알 수 없음'}`);
          } else {
            appendProcessLog(
              `이력 조회 반영: 추가 ${attachData?.appendCount ?? 0}, 변경 ${attachData?.conflictCount ?? 0}, 삭제 ${attachData?.removeCount ?? 0}` +
                (attachData?.keptCount ? `, 유지 ${attachData.keptCount}` : '')
            );
          }
        }
      } catch {
        /* ignore */
      }

      appendProcessLog(
        '완료.',
        `정합성 반영 삽입 ${ad.insertedCount ?? 0}`,
        ...buildExcelWizardClosingLines({
          endedAtLabel: new Date().toLocaleString(),
          durationLabel: formatProcessDuration(Date.now() - pending.startedMs),
          extractCount: pending.totalExtractCount,
          coordOk: pending.totalCoordOk,
          coordFail: pending.geocodeFailCount,
          pnuAttempt: 0,
          pnuOk: 0,
          jijukOk: 0,
          jijukNull: 0,
          insertCount: ad.insertedCount ?? 0,
          defineResult,
          geoserverResult,
          fieldMapResult: '정합성 경로',
        })
      );
      integrityPendingRef.current = null;
      setProcessingProgress(100);
      setProcessingDone(true);
      requestExcelHistoryRefresh();
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      setProcessingError(err);
      appendProcessLog(err);
    } finally {
      setExcelSyncApplying(false);
    }
  }, [appendProcessLog]);

  const handleClose = () => {
    const shouldNotifySuccess = processingDone;
    const pendingTable = integrityPendingRef.current?.tableEng?.trim() || '';
    if (!shouldNotifySuccess && pendingTable) {
      void call('', 'POST', {
        service: 'excelHistoryService',
        action: 'discardExcelIntegrityReview',
        params: { tableName: pendingTable },
      }).catch(() => undefined);
    }
    step4StartedRef.current = false;
    setExcelSyncOpen(false);
    integrityPendingRef.current = null;
    setStep(1);
    setPathOrResult(null);
    setSelectedFile(null);
    setParseResult(null);
    setSelectedGeocodingHeader(null);
    setStep1Warnings([]);
    setStep1MultiSheetWarning(null);
    setCsvEncodingHint(null);
    setStep1Validating(false);
    setSelectedFileInfo(null);
    setTitleRowLines(1);
    setParcelSelectMode('singleColumn');
    setObjectAddressSelectMode('singleColumn');
    setSelectedObjectAddressHeader(null);
    setCreateSeparateJijukTable(false);
    setCreateSeparateMulgunjiTable(true);
    setExcelUploadWorkflowId(EXCEL_UPLOAD_WORKFLOW_OPTIONS[0]?.id ?? 'standard');
    setSplitSidoColumn(null);
    setSplitSidoFixed('');
    setSplitSigunguColumn(null);
    setSplitSigunguFixed('');
    setSplitEmdColumn(null);
    setSplitRiColumn(null);
    setSplitJibunColumn(null);
    setObjSplitSidoColumn(null);
    setObjSplitSidoFixed('');
    setObjSplitSigunguColumn(null);
    setObjSplitSigunguFixed('');
    setObjSplitEmdColumn(null);
    setObjSplitRiColumn(null);
    setObjSplitJibunColumn(null);
    setGeometryType(null);
    setKeyMode('single');
    setSyntheticKeyKor('일련키');
    setSyntheticKeyEng('feat_key');
    setCompositeKeyKor(EXCEL_COMPOSITE_KEY_KOR);
    setCompositeKeyEng(EXCEL_COMPOSITE_KEY_ENG);
    setTableKor('');
    setTableEng('');
    setTableGroup('');
    setEngNameKoreanError(null);
    setLayerTableMeta(null);
    setTableCheckHint(null);
    setTableCheckLoading(false);
    setExcelOnlySkipAdd(new Set());
    setDiffDropColumns(new Set());
    setSchemaDiffOpen(true);
    setProcessingLog([]);
    setProcessingProgress(0);
    setProcessingDone(false);
    setProcessingError(null);
    onOpenChange(false);
    // 4단계 완료 직후가 아니라 닫기(버튼·ESC·바깥 클릭) 시에만 이력 탭 등으로 이동
    if (shouldNotifySuccess) {
      requestExcelHistoryRefresh();
      onSuccess?.();
    }
  };

  /** ESC·바깥 클릭·X — 실수 닫힘 방지. 4단계 완료/오류 후 «닫기»는 skipConfirm */
  const dismissConfirmLockRef = useRef(false);
  const requestClose = (opts?: { skipConfirm?: boolean }) => {
    if (excelSyncOpen) return;
    if (dismissConfirmLockRef.current) return;
    const doneOrError = processingDone || Boolean(processingError);
    if (!opts?.skipConfirm && !doneOrError) {
      dismissConfirmLockRef.current = true;
      const ok = window.confirm(
        '위저드를 닫으면 진행 중인 설정이 모두 초기화됩니다. 닫으시겠습니까?'
      );
      // confirm OK 클릭이 바깥 클릭으로 다시 잡히지 않도록 잠시 잠금
      window.setTimeout(() => {
        dismissConfirmLockRef.current = false;
      }, 300);
      if (!ok) return;
    }
    handleClose();
  };

  const preventOutsideDismiss = (e: Event) => {
    e.preventDefault();
  };

  /** pointerDown만 닫기 요청 — interact와 동시 호출 시 confirm이 두 번 뜸 */
  const onPointerDownOutsideDismiss = (e: Event) => {
    e.preventDefault();
    if (excelSyncOpen) return;
    window.setTimeout(() => requestClose(), 0);
  };

  const onEscapeDismiss = (e: Event) => {
    e.preventDefault();
    if (excelSyncOpen) return;
    requestClose();
  };

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) requestClose();
      }}
      modal={!excelSyncOpen}
    >
      <DialogContent
        className="w-[1200px] h-[800px] min-w-[1200px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col gap-y-2 p-4"
        showCloseButton={!excelSyncOpen}
        onInteractOutside={preventOutsideDismiss}
        onPointerDownOutside={onPointerDownOutsideDismiss}
        onFocusOutside={(e) => {
          if (excelSyncOpen) e.preventDefault();
        }}
        onEscapeKeyDown={onEscapeDismiss}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden />
            Excel 파일 업로드 - {stepLabels[step] ?? step} ({step}/{TOTAL_STEPS})
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden py-2">
          <div
            className={cn(
              'flex-1 min-h-0 pr-1',
              step === 3 ? 'flex min-h-0 flex-col overflow-y-auto' : 'overflow-y-auto space-y-4'
            )}
          >
          {step === 1 && (
            <div className="space-y-3">
              <div className="rounded-md border border-gray-200 bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2 text-black dark:text-zinc-100">
                  <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                  파일 선택
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={SPREADSHEET_ACCEPT}
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
                  {showServerPickButton && onPickFromServer ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onPickFromServer}
                      disabled={step1Validating}
                    >
                      서버에서 선택
                    </Button>
                  ) : null}
                  {selectedFileInfo && !step1Validating && (
                    <span className="text-sm text-muted-foreground">
                      {selectedFileInfo.name} · {selectedFileInfo.size.toLocaleString()} bytes
                      {csvEncodingHint ? ` · ${csvEncodingHint}` : ''}
                    </span>
                  )}
                  {uploadState.status === 'uploading' && (
                    <span className="text-sm text-muted-foreground">파일 저장 중... {uploadState.progress}%</span>
                  )}
                </div>

                {(step1Validating ||
                  step1Warnings.length > 0 ||
                  (!step1Blocked && !!step1MultiSheetWarning)) && (
                  <div className="mt-2 space-y-1.5">
                    {step1Validating ? (
                      <p className="text-sm text-muted-foreground">파일 내용을 읽고 검사 중입니다...</p>
                    ) : (
                      <>
                        {step1Warnings.map((msg, i) => (
                          <p key={`w-${i}`} className="text-sm text-red-600 dark:text-red-400">
                            {msg}
                          </p>
                        ))}
                        {!step1Blocked && step1MultiSheetWarning ? (
                          <p className="text-sm text-red-600 dark:text-red-400">{step1MultiSheetWarning}</p>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-gray-200 bg-muted/30 p-3 space-y-3">
                <p className="text-sm font-medium flex items-center gap-2 text-black dark:text-zinc-100">
                  <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                  테이블 그룹명·한글명·영문명
                </p>
                <div className="flex flex-wrap items-end gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">그룹명</span>
                    <Input
                      value={tableGroup}
                      onChange={(e) => setTableGroup(e.target.value)}
                      className="h-8 w-48 text-sm"
                      placeholder="그룹명"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">테이블 한글명</span>
                    <Input
                      value={tableKor}
                      onChange={(e) => setTableKor(e.target.value)}
                      className="h-8 w-56 text-sm"
                      placeholder="레이어에 표시할 이름"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">테이블 영문명 (layer)</span>
                    <Input
                      value={tableEng}
                      onChange={(e) => setTableEng(e.target.value)}
                      className="h-8 w-56 text-sm !text-gray-600"
                      placeholder="예: water_facility"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-gray-200 bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2 text-black dark:text-zinc-100">
                  <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                  동일 테이블 존재 여부
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={tableCheckLoading || !tableEng.trim()}
                    onClick={() => void runLayerTableCheck()}
                  >
                    {tableCheckLoading ? (
                      <>
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        확인 중
                      </>
                    ) : (
                      'layer 테이블 확인'
                    )}
                  </Button>
                  {layerTableMeta !== null && (
                    <span
                      className={`text-sm font-medium ${layerTableMeta.exists ? 'text-amber-800 dark:text-amber-200' : 'text-green-700 dark:text-green-400'}`}
                    >
                      {layerTableMeta.exists ? '기존 테이블 있음' : '신규 테이블 (동일 이름 없음)'}
                    </span>
                  )}
                </div>
                {tableCheckHint ? <p className="text-xs text-muted-foreground">{tableCheckHint}</p> : null}
              </div>

              <div className="rounded-md border border-gray-200 bg-muted/30 p-3 flex flex-col min-h-0 gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium flex items-center gap-2 text-black dark:text-zinc-100">
                    <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                    업로드 처리 방식
                  </p>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {EXCEL_UPLOAD_WORKFLOW_OPTIONS.length}개 중 선택
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">
                  이후 단계에서 적용할 처리 규칙입니다. 항목이 추가될 수 있습니다.
                </p>
                <div
                  className="max-h-[min(320px,42vh)] overflow-y-auto rounded-md border border-border/60 bg-background/40 pr-1"
                  role="radiogroup"
                  aria-label="업로드 처리 방식"
                >
                  <ul className="divide-y divide-border/50">
                    {EXCEL_UPLOAD_WORKFLOW_OPTIONS.map((opt) => {
                      const selected = excelUploadWorkflowId === opt.id;
                      return (
                        <li key={opt.id}>
                          <label
                            className={cn(
                              'flex cursor-pointer gap-3 px-3 py-2.5 text-left transition-colors',
                              selected ? 'bg-teal-600/10 dark:bg-teal-500/10' : 'hover:bg-muted/50'
                            )}
                          >
                            <input
                              type="radio"
                              name="excelUploadWorkflow"
                              value={opt.id}
                              checked={selected}
                              onChange={() => setExcelUploadWorkflowId(opt.id)}
                              className="mt-0.5 h-4 w-4 shrink-0"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-foreground">{opt.title}</span>
                              <span className="mt-0.5 block text-xs text-muted-foreground leading-relaxed">
                                {opt.description}
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </div>
          )}
          {step === 2 && workflowParseResult && (
            <div className="space-y-3">
              <div className="rounded-md border border-gray-200 bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2 text-black dark:text-zinc-100">
                  <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                  타이틀 행 선택
                </p>
                {isAndongRoadUseWorkflow ? (
                  <p className="text-xs text-muted-foreground">안동 도로점용대장은 타이틀 1행으로 고정됩니다.</p>
                ) : null}
                <div className="flex flex-wrap gap-6 text-sm">
                  <label className={cn('flex items-center gap-2 cursor-pointer', isAndongRoadUseWorkflow && 'cursor-default opacity-80')}>
                    <input
                      type="radio"
                      name="titleRows"
                      checked={titleRowLines === 1}
                      disabled={isAndongRoadUseWorkflow}
                      onChange={() => onTitleRowLinesChange(1)}
                    />
                    타이틀 1행 (헤더 한 줄)
                  </label>
                  <label className={cn('flex items-center gap-2 cursor-pointer', isAndongRoadUseWorkflow && 'cursor-default opacity-80')}>
                    <input
                      type="radio"
                      name="titleRows"
                      checked={titleRowLines === 2}
                      disabled={isAndongRoadUseWorkflow}
                      onChange={() => onTitleRowLinesChange(2)}
                    />
                    타이틀 2행 (헤더 두 줄)
                  </label>
                  <label className={cn('flex items-center gap-2 cursor-pointer', isAndongRoadUseWorkflow && 'cursor-default opacity-80')}>
                    <input
                      type="radio"
                      name="titleRows"
                      checked={titleRowLines === 3}
                      disabled={isAndongRoadUseWorkflow}
                      onChange={() => onTitleRowLinesChange(3)}
                    />
                    타이틀 3행 (헤더 세 줄)
                  </label>
                </div>
              </div>

              <div className="rounded-md border border-gray-200 bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2 text-black dark:text-zinc-100">
                  <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                  폴리곤(필지) / 포인트 표현
                </p>
                {isAndongRoadUseWorkflow ? (
                  <p className="text-xs text-muted-foreground">안동 도로점용대장은 필지 모양(폴리곤)으로 고정됩니다.</p>
                ) : null}
                <div className="flex flex-wrap gap-6 text-sm">
                  <label className={cn('flex items-center gap-2 cursor-pointer', isAndongRoadUseWorkflow && 'cursor-default opacity-80')}>
                    <input
                      type="radio"
                      name="geomTypeStep2"
                      checked={geometryType === 'Polygon'}
                      disabled={isAndongRoadUseWorkflow}
                      onChange={() => setGeometryType('Polygon')}
                    />
                    필지 모양(폴리곤)
                  </label>
                  <label className={cn('flex items-center gap-2 cursor-pointer', isAndongRoadUseWorkflow && 'cursor-default opacity-80')}>
                    <input
                      type="radio"
                      name="geomTypeStep2"
                      checked={geometryType === 'Point'}
                      disabled={isAndongRoadUseWorkflow}
                      onChange={() => setGeometryType('Point')}
                    />
                    점(포인트)
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
                <div className="min-w-0 rounded-md border border-gray-200 bg-muted/30 p-3 space-y-2">
                  <p className="text-sm font-medium flex items-center gap-2 text-black dark:text-zinc-100">
                    <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                    필지(주소) 선택 방식
                  </p>
                {isAndongRoadUseWorkflow ? (
                  <p className="text-xs text-muted-foreground">안동 도로점용대장은 주소 열 자동 매핑(한 열 주소)으로 고정됩니다.</p>
                ) : null}
                  <div className="flex flex-wrap gap-6 text-sm mb-1">
                    <label className={cn('flex items-center gap-2 cursor-pointer', isAndongRoadUseWorkflow && 'cursor-default opacity-80')}>
                      <input
                        type="radio"
                        name="parcelMode"
                        checked={parcelSelectMode === 'singleColumn'}
                        disabled={isAndongRoadUseWorkflow}
                        onChange={() => setParcelSelectMode('singleColumn')}
                      />
                      한 열에 주소(통합 입력)
                    </label>
                    <label className={cn('flex items-center gap-2 cursor-pointer', isAndongRoadUseWorkflow && 'cursor-default opacity-80')}>
                      <input
                        type="radio"
                        name="parcelMode"
                        checked={parcelSelectMode === 'splitColumns'}
                        disabled={isAndongRoadUseWorkflow}
                        onChange={() => setParcelSelectMode('splitColumns')}
                      />
                      시도·시군구·읍면동·리·지번 열 구분
                    </label>
                  </div>
                  {parcelSelectMode === 'splitColumns' && (
                    <div className="rounded-md border border-gray-200 bg-muted/30 p-3 space-y-2.5 text-sm">
                      <p className="text-xs text-muted-foreground mb-2">
                        시도·시군구는 열을 지정하거나, 아래에 고정으로 직접 입력할 수 있습니다. 읍면동·지번 열은 필수입니다.
                      </p>
                      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 gap-y-2 items-center">
                        <span className="text-muted-foreground shrink-0">시도</span>
                        <select
                          className="h-8 rounded border border-input bg-background px-2 text-sm min-w-0"
                          value={splitSidoColumn ?? ''}
                          disabled={isAndongRoadUseWorkflow}
                          onChange={(e) => setSplitSidoColumn(e.target.value || null)}
                        >
                          <option value="">선택</option>
                          {geoColumnPickHeaders.map((h) => (
                            <option key={`sido-${h}`} value={h}>
                              {splitParcelOptionLabel(h, 'sido', parcelSplitSuggest)}
                            </option>
                          ))}
                        </select>
                        <Input
                          className="h-8 text-sm min-w-0"
                          placeholder="고정 시도"
                          value={splitSidoFixed}
                          disabled={isAndongRoadUseWorkflow}
                          onChange={(e) => setSplitSidoFixed(e.target.value)}
                        />
                        <span className="text-muted-foreground shrink-0">시군구</span>
                        <select
                          className="h-8 rounded border border-input bg-background px-2 text-sm min-w-0"
                          value={splitSigunguColumn ?? ''}
                          disabled={isAndongRoadUseWorkflow}
                          onChange={(e) => setSplitSigunguColumn(e.target.value || null)}
                        >
                          <option value="">선택</option>
                          {geoColumnPickHeaders.map((h) => (
                            <option key={`sgg-${h}`} value={h}>
                              {splitParcelOptionLabel(h, 'sigungu', parcelSplitSuggest)}
                            </option>
                          ))}
                        </select>
                        <Input
                          className="h-8 text-sm min-w-0"
                          placeholder="고정 시군구"
                          value={splitSigunguFixed}
                          disabled={isAndongRoadUseWorkflow}
                          onChange={(e) => setSplitSigunguFixed(e.target.value)}
                        />
                        <span className="text-muted-foreground shrink-0">
                          읍면동 <span className="text-destructive">*</span>
                        </span>
                        <select
                          className="h-8 rounded border border-input bg-background px-2 text-sm col-span-2 min-w-0"
                          value={splitEmdColumn ?? ''}
                          disabled={isAndongRoadUseWorkflow}
                          onChange={(e) => setSplitEmdColumn(e.target.value || null)}
                        >
                          <option value="">선택</option>
                          {geoColumnPickHeaders.map((h) => (
                            <option key={`emd-${h}`} value={h}>
                              {splitParcelOptionLabel(h, 'emd', parcelSplitSuggest)}
                            </option>
                          ))}
                        </select>
                        <span className="text-muted-foreground shrink-0">리</span>
                        <select
                          className="h-8 rounded border border-input bg-background px-2 text-sm col-span-2 min-w-0"
                          value={splitRiColumn ?? ''}
                          disabled={isAndongRoadUseWorkflow}
                          onChange={(e) => setSplitRiColumn(e.target.value || null)}
                        >
                          <option value="">선택</option>
                          {geoColumnPickHeaders.map((h) => (
                            <option key={`ri-${h}`} value={h}>
                              {splitParcelOptionLabel(h, 'ri', parcelSplitSuggest)}
                            </option>
                          ))}
                        </select>
                        <span className="text-muted-foreground shrink-0">
                          지번 <span className="text-destructive">*</span>
                        </span>
                        <select
                          className="h-8 rounded border border-input bg-background px-2 text-sm col-span-2 min-w-0"
                          value={splitJibunColumn ?? ''}
                          disabled={isAndongRoadUseWorkflow}
                          onChange={(e) => setSplitJibunColumn(e.target.value || null)}
                        >
                          <option value="">선택</option>
                          {geoColumnPickHeaders.map((h) => (
                            <option key={`jb-${h}`} value={h}>
                              {splitParcelOptionLabel(h, 'jibun', parcelSplitSuggest)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                <div className="min-w-0 rounded-md border border-gray-200 bg-muted/30 p-3 space-y-3 flex flex-col">
                  <div className="flex min-w-0 items-center gap-3">
                    <p className="text-sm font-medium flex shrink-0 items-center gap-2 text-black dark:text-zinc-100">
                      <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                      지적 데이터 입력
                    </p>
                    <p className="min-w-0 flex-1 text-xs text-muted-foreground leading-snug">
                      한 셀에 여러 필지가 입력된 경우 별도의 지적테이블을 생성합니다.
                    </p>
                  </div>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-2 text-sm',
                      (isLedgerWorkflow || isAndongRoadUseWorkflow) && 'cursor-default opacity-80'
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 rounded border-input"
                      disabled={isLedgerWorkflow || isAndongRoadUseWorkflow}
                      checked={
                        isLedgerWorkflow || isAndongRoadUseWorkflow ? true : createSeparateJijukTable
                      }
                      onChange={(e) => setCreateSeparateJijukTable(e.target.checked)}
                    />
                    별도 지적 테이블 생성
                    {isLedgerWorkflow || isAndongRoadUseWorkflow ? (
                      <span className="text-xs text-muted-foreground">(대장 업로드는 항상 사용)</span>
                    ) : null}
                  </label>
                  <label className={cn('flex cursor-pointer items-center gap-2 text-sm', isAndongRoadUseWorkflow && 'cursor-default opacity-80')}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 rounded border-input"
                      disabled={isAndongRoadUseWorkflow}
                      checked={isAndongRoadUseWorkflow ? true : createSeparateMulgunjiTable}
                      onChange={(e) => setCreateSeparateMulgunjiTable(e.target.checked)}
                    />
                    별도 물건지 테이블 생성
                    <span className="text-xs text-muted-foreground">
                      {isAndongRoadUseWorkflow ? '(안동 도로점용대장은 항상 사용)' : '(기본값: 사용)'}
                    </span>
                  </label>
                </div>
              </div>

              <div className="rounded-md border border-gray-200 bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2 text-black dark:text-zinc-100">
                  <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                  주소 열 또는 시도·시군구·읍면동·리·지번 지정
                </p>
                {step1Validating && (
                  <p className="text-sm text-muted-foreground">헤더·데이터를 다시 읽는 중입니다...</p>
                )}
                {parcelSelectMode === 'singleColumn' ? (
                  <div className="rounded-md border border-gray-200 bg-muted/30 max-h-[min(255px,42vh)] min-h-[10rem] overflow-y-auto">
                    {geoColumnPickHeaders.map((h, idx) => {
                      const sampleLine = [0, 1, 2]
                        .map((i) => workflowParseResult.samples[h]?.[i])
                        .filter((v) => v != null && String(v).trim() !== '')
                        .map((v) => String(v).trim())
                        .join(' · ');
                      return (
                      <label
                        key={`geocode-col-${idx}`}
                        htmlFor={`geocode-col-${idx}`}
                        className={cn(
                          'grid grid-cols-[1.125rem_minmax(0,11rem)_minmax(0,1fr)] gap-x-3 items-center border-b border-gray-200 last:border-b-0 px-3 py-2 min-h-[2.5rem] cursor-pointer',
                          isAndongRoadUseWorkflow && 'cursor-default opacity-80'
                        )}
                      >
                        <input
                          type="radio"
                          name="geocoding"
                          id={`geocode-col-${idx}`}
                          className="shrink-0"
                          disabled={
                            isAndongRoadUseWorkflow ||
                            (h.trim().toLowerCase() === 'geom' &&
                              selectedObjectAddressHeader?.trim().toLowerCase() === 'geom')
                          }
                          checked={selectedGeocodingHeader === h}
                          onChange={() => setSelectedGeocodingHeader(h)}
                        />
                        <span className="flex min-w-0 items-center gap-1 text-sm font-medium" title={h}>
                          <span className="truncate">{h}</span>
                          {unifiedAddressRecommend === h ? (
                            <span className="shrink-0 rounded bg-teal-600/15 px-1 py-0 text-[10px] font-semibold leading-tight text-teal-700 dark:bg-teal-500/20 dark:text-teal-300">
                              추천
                            </span>
                          ) : null}
                        </span>
                        <span
                          className="min-w-0 border-l border-border/60 pl-3 text-left text-muted-foreground text-xs leading-snug truncate"
                          title={sampleLine || undefined}
                        >
                          {sampleLine}
                        </span>
                      </label>
                    );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    열 구분 방식에서는 위에서 시도·시군구·읍면동·리·지번 열을 지정했습니다. 추가로 선택할 항목이 없으면 다음으로 진행하세요.
                  </p>
                )}
                {parcelSelectMode === 'singleColumn' &&
                selectedGeocodingHeader?.trim().toLowerCase() === 'geom' ? (
                  <div className="mt-2 space-y-1.5 rounded-md border border-teal-600/30 bg-teal-600/5 p-2">
                    <p className="text-xs font-medium text-teal-800 dark:text-teal-200">
                      geom(WKT) 입력 좌표계 — DB 저장은 항상 EPSG:5181
                    </p>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="excelGeomSrid"
                          checked={excelGeomSridMode === 'auto'}
                          onChange={() => setExcelGeomSridMode('auto')}
                        />
                        자동(좌표 크기)
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="excelGeomSrid"
                          checked={excelGeomSridMode === 5181}
                          onChange={() => setExcelGeomSridMode(5181)}
                        />
                        EPSG:5181
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="excelGeomSrid"
                          checked={excelGeomSridMode === 4326}
                          onChange={() => setExcelGeomSridMode(4326)}
                        />
                        EPSG:4326 → 5181 변환
                      </label>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      5179·5186 등 다른 TM은 지원하지 않습니다. 자동은 큰 좌표면 5181로 봅니다.
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="rounded-md border border-gray-200 bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2 text-black dark:text-zinc-100">
                  <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                  물건지(주소) 선택 방식
                </p>
                {isAndongRoadUseWorkflow ? (
                  <p className="text-xs text-muted-foreground">안동 도로점용대장은 물건지 주소도 자동 매핑(한 열 주소)으로 고정됩니다.</p>
                ) : null}
                <div className="flex flex-wrap gap-6 text-sm mb-1">
                  <label className={cn('flex items-center gap-2 cursor-pointer', isAndongRoadUseWorkflow && 'cursor-default opacity-80')}>
                    <input
                      type="radio"
                      name="objectAddressMode"
                      checked={objectAddressSelectMode === 'singleColumn'}
                      disabled={isAndongRoadUseWorkflow}
                      onChange={() => setObjectAddressSelectMode('singleColumn')}
                    />
                    한 열에 주소(통합 입력)
                  </label>
                  <label className={cn('flex items-center gap-2 cursor-pointer', isAndongRoadUseWorkflow && 'cursor-default opacity-80')}>
                    <input
                      type="radio"
                      name="objectAddressMode"
                      checked={objectAddressSelectMode === 'splitColumns'}
                      disabled={isAndongRoadUseWorkflow}
                      onChange={() => setObjectAddressSelectMode('splitColumns')}
                    />
                    시도·시군구·읍면동·리·지번 열 구분
                  </label>
                </div>
                {objectAddressSelectMode === 'splitColumns' && (
                  <div className="rounded-md border border-gray-200 bg-muted/30 p-3 space-y-2.5 text-sm">
                    <p className="text-xs text-muted-foreground mb-2">
                      시도·시군구는 열을 지정하거나, 아래에 고정으로 직접 입력할 수 있습니다. 읍면동·지번 열은 필수입니다.
                    </p>
                    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 gap-y-2 items-center">
                      <span className="text-muted-foreground shrink-0">시도</span>
                      <select
                        className="h-8 rounded border border-input bg-background px-2 text-sm min-w-0"
                        value={objSplitSidoColumn ?? ''}
                        disabled={isAndongRoadUseWorkflow}
                        onChange={(e) => setObjSplitSidoColumn(e.target.value || null)}
                      >
                        <option value="">선택</option>
                        {geoColumnPickHeaders.map((h) => (
                          <option key={`obj-sido-${h}`} value={h}>
                            {splitParcelOptionLabel(h, 'sido', parcelSplitSuggest)}
                          </option>
                        ))}
                      </select>
                      <Input
                        className="h-8 text-sm min-w-0"
                        placeholder="고정 시도"
                        value={objSplitSidoFixed}
                        disabled={isAndongRoadUseWorkflow}
                        onChange={(e) => setObjSplitSidoFixed(e.target.value)}
                      />
                      <span className="text-muted-foreground shrink-0">시군구</span>
                      <select
                        className="h-8 rounded border border-input bg-background px-2 text-sm min-w-0"
                        value={objSplitSigunguColumn ?? ''}
                        disabled={isAndongRoadUseWorkflow}
                        onChange={(e) => setObjSplitSigunguColumn(e.target.value || null)}
                      >
                        <option value="">선택</option>
                        {geoColumnPickHeaders.map((h) => (
                          <option key={`obj-sgg-${h}`} value={h}>
                            {splitParcelOptionLabel(h, 'sigungu', parcelSplitSuggest)}
                          </option>
                        ))}
                      </select>
                      <Input
                        className="h-8 text-sm min-w-0"
                        placeholder="고정 시군구"
                        value={objSplitSigunguFixed}
                        disabled={isAndongRoadUseWorkflow}
                        onChange={(e) => setObjSplitSigunguFixed(e.target.value)}
                      />
                      <span className="text-muted-foreground shrink-0">
                        읍면동 <span className="text-destructive">*</span>
                      </span>
                      <select
                        className="h-8 rounded border border-input bg-background px-2 text-sm col-span-2 min-w-0"
                        value={objSplitEmdColumn ?? ''}
                        disabled={isAndongRoadUseWorkflow}
                        onChange={(e) => setObjSplitEmdColumn(e.target.value || null)}
                      >
                        <option value="">선택</option>
                        {geoColumnPickHeaders.map((h) => (
                          <option key={`obj-emd-${h}`} value={h}>
                            {splitParcelOptionLabel(h, 'emd', parcelSplitSuggest)}
                          </option>
                        ))}
                      </select>
                      <span className="text-muted-foreground shrink-0">리</span>
                      <select
                        className="h-8 rounded border border-input bg-background px-2 text-sm col-span-2 min-w-0"
                        value={objSplitRiColumn ?? ''}
                        disabled={isAndongRoadUseWorkflow}
                        onChange={(e) => setObjSplitRiColumn(e.target.value || null)}
                      >
                        <option value="">선택</option>
                        {geoColumnPickHeaders.map((h) => (
                          <option key={`obj-ri-${h}`} value={h}>
                            {splitParcelOptionLabel(h, 'ri', parcelSplitSuggest)}
                          </option>
                        ))}
                      </select>
                      <span className="text-muted-foreground shrink-0">
                        지번 <span className="text-destructive">*</span>
                      </span>
                      <select
                        className="h-8 rounded border border-input bg-background px-2 text-sm col-span-2 min-w-0"
                        value={objSplitJibunColumn ?? ''}
                        disabled={isAndongRoadUseWorkflow}
                        onChange={(e) => setObjSplitJibunColumn(e.target.value || null)}
                      >
                        <option value="">선택</option>
                        {geoColumnPickHeaders.map((h) => (
                          <option key={`obj-jb-${h}`} value={h}>
                            {splitParcelOptionLabel(h, 'jibun', parcelSplitSuggest)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-md border border-gray-200 bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2 text-black dark:text-zinc-100">
                  <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                  물건지 주소 열 또는 시도·시군구·읍면동·리·지번 지정
                </p>
                {objectAddressSelectMode === 'singleColumn' ? (
                  <div className="rounded-md border border-gray-200 bg-muted/30 max-h-[min(255px,42vh)] min-h-[10rem] overflow-y-auto">
                    {geoColumnPickHeaders.map((h, idx) => {
                      const sampleLine = [0, 1, 2]
                        .map((i) => workflowParseResult.samples[h]?.[i])
                        .filter((v) => v != null && String(v).trim() !== '')
                        .map((v) => String(v).trim())
                        .join(' · ');
                      return (
                      <label
                        key={`obj-address-col-${idx}`}
                        htmlFor={`obj-address-col-${idx}`}
                        className={cn(
                          'grid grid-cols-[1.125rem_minmax(0,11rem)_minmax(0,1fr)] gap-x-3 items-center border-b border-gray-200 last:border-b-0 px-3 py-2 min-h-[2.5rem] cursor-pointer',
                          isAndongRoadUseWorkflow && 'cursor-default opacity-80'
                        )}
                      >
                        <input
                          type="radio"
                          name="objectAddress"
                          id={`obj-address-col-${idx}`}
                          className="shrink-0"
                          disabled={
                            isAndongRoadUseWorkflow ||
                            (h.trim().toLowerCase() === 'geom' &&
                              selectedGeocodingHeader?.trim().toLowerCase() === 'geom')
                          }
                          checked={selectedObjectAddressHeader === h}
                          onChange={() => setSelectedObjectAddressHeader(h)}
                        />
                        <span className="flex min-w-0 items-center gap-1 text-sm font-medium" title={h}>
                          <span className="truncate">{h}</span>
                          {objectAddressRecommend === h ? (
                            <span className="shrink-0 rounded bg-teal-600/15 px-1 py-0 text-[10px] font-semibold leading-tight text-teal-700 dark:bg-teal-500/20 dark:text-teal-300">
                              추천
                            </span>
                          ) : null}
                        </span>
                        <span
                          className="min-w-0 border-l border-border/60 pl-3 text-left text-muted-foreground text-xs leading-snug truncate"
                          title={sampleLine || undefined}
                        >
                          {sampleLine}
                        </span>
                      </label>
                    );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    열 구분 방식에서는 위에서 시도·시군구·읍면동·리·지번 열을 지정했습니다. 추가로 선택할 항목이 없으면 다음으로 진행하세요.
                  </p>
                )}
              </div>

              {bothGeomConflict ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  필지와 물건지에 동시에 geom 열을 지정할 수 없습니다. 한쪽만 geom을 선택해 주세요.
                </div>
              ) : null}
            </div>
          )}
          {step === 3 && workflowParseResult && (
            <div className="flex min-h-0 flex-1 flex-col gap-5">
              {layerTableMeta?.exists && schemaDiff ? (
                <div className="shrink-0 rounded-md border border-gray-200 bg-muted/30 p-3 space-y-3 text-sm">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 text-left text-sm font-medium text-black dark:text-zinc-100"
                    onClick={() => setSchemaDiffOpen((v) => !v)}
                    aria-expanded={schemaDiffOpen}
                  >
                    {schemaDiffOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                    <span className="shrink-0">기존 테이블과의 DIFF</span>
                    <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
                      양쪽 {schemaDiff.excelBoth.length} · 추가 {schemaDiff.excelOnly.length} · 삭제후보{' '}
                      {schemaDiff.dbOnly.length}
                      {!schemaDiffOpen ? ' · 펼치기' : ''}
                    </span>
                  </button>
                  {schemaDiffOpen ? (
                    <>
                      {schemaDiff.excelBoth.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-green-800 dark:text-green-300 mb-1">
                            양쪽에 있음 ({schemaDiff.excelBoth.length})
                          </p>
                          <ul className="text-xs space-y-0.5 list-disc list-inside text-muted-foreground max-h-32 overflow-y-auto">
                            {schemaDiff.excelBoth.map((f) => (
                              <li key={f.originalHeader}>
                                {f.headerKor} →{' '}
                                <span className="font-mono text-foreground">{safeColumnName(f.headerEng)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {schemaDiff.excelOnly.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-blue-900 dark:text-blue-200 mb-1">
                            엑셀에만 있음 — DB에 추가
                          </p>
                          <div className="space-y-1 max-h-32 overflow-y-auto border border-dashed rounded p-2">
                            {schemaDiff.excelOnly.map((f) => (
                              <label
                                key={f.originalHeader}
                                className="flex items-center gap-2 cursor-pointer text-xs"
                              >
                                <input
                                  type="checkbox"
                                  checked={!excelOnlySkipAdd.has(f.originalHeader)}
                                  onChange={(e) => {
                                    const on = e.target.checked;
                                    setExcelOnlySkipAdd((prev) => {
                                      const n = new Set(prev);
                                      if (on) n.delete(f.originalHeader);
                                      else n.add(f.originalHeader);
                                      return n;
                                    });
                                  }}
                                />
                                <span className="truncate" title={f.originalHeader}>
                                  {f.headerKor} → <span className="font-mono">{f.headerEng}</span>
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      {schemaDiff.dbOnly.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-destructive mb-1">
                            DB에만 있음 — 스키마에서 삭제(주의)
                          </p>
                          <div className="space-y-1 max-h-32 overflow-y-auto border border-dashed border-destructive/30 rounded p-2">
                            {schemaDiff.dbOnly.map((c) => (
                              <label key={c.name} className="flex items-center gap-2 cursor-pointer text-xs">
                                <input
                                  type="checkbox"
                                  checked={diffDropColumns.has(c.name)}
                                  onChange={(e) => {
                                    const on = e.target.checked;
                                    setDiffDropColumns((prev) => {
                                      const n = new Set(prev);
                                      if (on) n.add(c.name);
                                      else n.delete(c.name);
                                      return n;
                                    });
                                  }}
                                />
                                <span className="font-mono">{c.name}</span>
                                {c.comment ? (
                                  <span className="text-muted-foreground truncate">({c.comment})</span>
                                ) : null}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      {schemaDiff.excelBoth.length === 0 &&
                        schemaDiff.excelOnly.length === 0 &&
                        schemaDiff.dbOnly.length === 0 && (
                          <p className="text-xs text-muted-foreground">비교할 사용자 컬럼이 없습니다.</p>
                        )}
                    </>
                  ) : null}
                </div>
              ) : null}

              <div className="shrink-0 rounded-md border border-gray-200 bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2 text-black dark:text-zinc-100">
                  <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                  테이블명 요약
                </p>
                <p className="text-sm flex flex-wrap items-baseline gap-x-8 gap-y-1">
                  <span className="inline-flex items-baseline gap-3">
                    <span className="text-muted-foreground shrink-0">그룹</span>
                    <span>{tableGroup || '—'}</span>
                  </span>
                  <span className="inline-flex items-baseline gap-3">
                    <span className="text-muted-foreground shrink-0">한글</span>
                    <span>{tableKor || '—'}</span>
                  </span>
                  <span className="inline-flex items-baseline gap-3">
                    <span className="text-muted-foreground shrink-0">영문</span>
                    <span className="font-mono">{tableEng || '—'}</span>
                  </span>
                </p>
              </div>

              {!isLedgerWorkflow && !isAndongRoadUseWorkflow ? (
                <div className="shrink-0 rounded-md border border-gray-200 bg-muted/30 p-3 space-y-3 text-sm">
                  <p className="font-medium flex items-center gap-2 text-black dark:text-zinc-100">
                    <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                    Key(식별자) 설정
                  </p>
                  <p className="text-xs text-muted-foreground">
                    id·geom 등 시스템 컬럼은 Key로 선택할 수 없습니다. 복합키는 표에서 구성 열을 2개 이상 체크하세요.
                  </p>
                  <div className="flex flex-wrap gap-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="keyMode"
                        checked={keyMode === 'single'}
                        onChange={() => {
                          setKeyMode('single');
                          setFieldDefs((prev) => {
                            const first = prev.findIndex(
                              (f) => f.isKey && !isExcelSystemKeyColumn(f.headerEng)
                            );
                            return prev.map((f, i) => ({
                              ...f,
                              isKey: first >= 0 ? i === first : false,
                            }));
                          });
                        }}
                      />
                      기존 열을 Key로 사용 (단일)
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="keyMode"
                        checked={keyMode === 'composite'}
                        onChange={() => setKeyMode('composite')}
                      />
                      기존 열을 복합키로 사용
                    </label>
                    <label
                      className={cn(
                        'flex items-center gap-2',
                        syntheticKeyAllowed ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                      )}
                      title={
                        syntheticKeyAllowed
                          ? undefined
                          : '기존 테이블이 있으면 행번호 임시 키를 쓸 수 없습니다. 업무 키(또는 복합키)를 선택하세요.'
                      }
                    >
                      <input
                        type="radio"
                        name="keyMode"
                        checked={keyMode === 'synthetic'}
                        disabled={!syntheticKeyAllowed}
                        onChange={() => {
                          if (!syntheticKeyAllowed) return;
                          setKeyMode('synthetic');
                          setFieldDefs((prev) => prev.map((f) => ({ ...f, isKey: false })));
                        }}
                      />
                      신규 키 필드 사용 (신규 테이블만, 행마다 고유값 자동 부여)
                    </label>
                  </div>
                  {keyMode === 'composite' && (
                    <div className="flex flex-wrap items-end gap-4 pl-0.5">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">복합키 한글명</span>
                        <Input
                          className="h-8 w-40 text-sm"
                          value={compositeKeyKor}
                          onChange={(e) => setCompositeKeyKor(e.target.value)}
                          placeholder={EXCEL_COMPOSITE_KEY_KOR}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">복합키 영문명</span>
                        <Input
                          className="h-8 w-40 text-sm !text-gray-500"
                          value={compositeKeyEng}
                          onChange={(e) => setCompositeKeyEng(e.target.value)}
                          placeholder={EXCEL_COMPOSITE_KEY_ENG}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground max-w-md pb-1">
                        선택한 열 값을 | 로 이어 붙여 이 컬럼에 저장하고 정합성 비교에 사용합니다.
                        {keyFieldDefs.length > 0
                          ? ` 구성: ${keyFieldDefs.map((d) => d.headerKor || d.headerEng).join(' + ')}`
                          : ''}
                      </p>
                    </div>
                  )}
                  {useSyntheticKeyField && syntheticKeyAllowed && (
                    <div className="flex flex-wrap items-end gap-4 pl-0.5">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">한글명</span>
                        <Input
                          className="h-8 w-40 text-sm"
                          value={syntheticKeyKor}
                          onChange={(e) => setSyntheticKeyKor(e.target.value)}
                          placeholder="일련키"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">영문명</span>
                        <Input
                          className="h-8 w-40 text-sm !text-gray-500"
                          value={syntheticKeyEng}
                          onChange={(e) => setSyntheticKeyEng(e.target.value)}
                          placeholder="feat_key"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground max-w-md pb-1">
                        DB에는 k00000001, k00000002 … 형태로 저장됩니다. 재업로드 정합성에는 적합하지 않으므로 신규 테이블에만 사용하세요.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="shrink-0 rounded-md border border-gray-200 bg-muted/30 p-3 text-sm text-muted-foreground">
                  {isAndongRoadUseWorkflow
                    ? '안동 도로점용대장: 전용 파이프라인에서 점용대장정보/부과정보/점용지/물건지 구조로 처리되며, 별도 Key 설정이 없습니다.'
                    : '대장 업로드: 행키는 4단계 처리 시 규칙에 따라 자동 부여되며(ledger_row_key), 별도 Key 설정이 없습니다.'}
                </div>
              )}

              <div className="flex min-h-[180px] flex-1 flex-col gap-1.5 rounded-md border border-gray-200 bg-muted/30 p-2">
                <p className="shrink-0 text-xs font-medium flex items-center gap-2 text-black dark:text-zinc-100">
                  <Check className="h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
                  {isLedgerWorkflow || isAndongRoadUseWorkflow
                    ? '필드 한글·영문명 및 목록'
                    : '필드 한글·영문명 및 목록·Key'}
                </p>
                <div className="min-h-0 flex-1 overflow-auto rounded-md border border-gray-200 bg-muted/30">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-100 border-b border-gray-200 sticky top-0 z-[1]">
                        <th className="text-left font-medium py-1 px-2 border-r border-gray-200 last:border-r-0 w-[43%]">한글명</th>
                        <th className="text-left font-medium py-1 px-2 border-r border-gray-200 last:border-r-0 w-[43%]">영문명</th>
                        <th className="text-center font-medium py-1 px-1 border-r border-gray-200 last:border-r-0 w-20">
                          <label className="inline-flex cursor-pointer items-center justify-center gap-1" title="목록·검색 전체 선택/해제">
                            <input
                              type="checkbox"
                              checked={listSearchAllSelected}
                              ref={(el) => {
                                if (el) el.indeterminate = listSearchSomeSelected && !listSearchAllSelected;
                              }}
                              onChange={() => {
                                const next = !listSearchAllSelected;
                                setFieldDefs((prev) =>
                                  prev.map((f) => ({ ...f, showList: next, showSearch: next }))
                                );
                              }}
                            />
                            <span>목록·검색</span>
                          </label>
                        </th>
                        {!isLedgerWorkflow && !isAndongRoadUseWorkflow ? (
                          <th
                            className={cn(
                              'text-center font-medium py-1 px-1 w-11 border-l border-transparent',
                              useSyntheticKeyField && 'bg-muted/80 text-muted-foreground'
                            )}
                            title={
                              useSyntheticKeyField
                                ? '신규 키 필드 사용 시 표에서 열 Key를 선택할 수 없습니다.'
                                : keyMode === 'composite'
                                  ? '복합키 구성 열을 2개 이상 체크하세요.'
                                  : '단일 Key 열을 하나 선택하세요.'
                            }
                          >
                            Key
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {fieldDefs.map((f, idx) => {
                        const systemKeyBlocked = isExcelSystemKeyColumn(f.headerEng);
                        const keyToggleDisabled = useSyntheticKeyField || systemKeyBlocked;
                        return (
                        <tr key={idx} className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50/50">
                          <td className="p-0 h-7 border-r border-gray-200 align-middle">
                            <Input
                              className="h-full w-full border-0 border-l-2 border-l-transparent rounded-none bg-transparent text-foreground focus-visible:ring-1 focus-visible:border-l-primary focus-visible:border-l-2 px-2 py-0 text-xs [color:inherit]"
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
                          <td className="p-0 h-7 border-r border-gray-200 align-middle">
                            <Input
                              className="h-full w-full border-0 border-l-2 border-l-transparent rounded-none bg-transparent !text-gray-500 focus-visible:ring-1 focus-visible:border-l-primary focus-visible:border-l-2 px-2 py-0 text-xs"
                              value={f.headerEng}
                              onChange={(e) =>
                                setFieldDefs((prev) => {
                                  const next = [...prev];
                                  const eng = e.target.value;
                                  next[idx] = {
                                    ...next[idx],
                                    headerEng: eng,
                                    isKey: isExcelSystemKeyColumn(eng) ? false : next[idx].isKey,
                                  };
                                  return next;
                                })
                              }
                            />
                          </td>
                          <td className="p-0 h-7 border-r border-gray-200 align-middle">
                            <label className="flex h-full w-full cursor-pointer items-center justify-center py-0 px-1">
                              <input
                                type="checkbox"
                                checked={f.showList}
                                onChange={(e) => {
                                  const v = e.target.checked;
                                  setFieldDefs((prev) => {
                                    const n = [...prev];
                                    n[idx] = { ...n[idx], showList: v, showSearch: v };
                                    return n;
                                  });
                                }}
                              />
                            </label>
                          </td>
                          {!isLedgerWorkflow && !isAndongRoadUseWorkflow ? (
                            <td
                              className={cn(
                                'p-0 h-7 align-middle border-l border-border/40',
                                keyToggleDisabled && 'pointer-events-none cursor-not-allowed bg-muted/50 opacity-40'
                              )}
                              title={
                                systemKeyBlocked
                                  ? '시스템 컬럼은 정합성 키로 사용할 수 없습니다.'
                                  : useSyntheticKeyField
                                    ? '신규 키 필드 사용 시 표에서 열 Key를 선택할 수 없습니다.'
                                    : keyMode === 'composite'
                                      ? '복합키 구성 열 (여러 개 선택)'
                                      : '단일 Key 열'
                              }
                            >
                              <label className="flex h-full w-full items-center justify-center py-0 px-1">
                                <input
                                  type={keyMode === 'composite' ? 'checkbox' : 'radio'}
                                  name={keyMode === 'composite' ? undefined : 'keyField'}
                                  disabled={keyToggleDisabled}
                                  tabIndex={keyToggleDisabled ? -1 : undefined}
                                  checked={f.isKey}
                                  onChange={() => {
                                    if (keyToggleDisabled) return;
                                    if (keyMode === 'composite') {
                                      setFieldDefs((prev) =>
                                        prev.map((x, i) =>
                                          i === idx ? { ...x, isKey: !x.isKey } : x
                                        )
                                      );
                                    } else {
                                      setFieldDefs((prev) =>
                                        prev.map((x, i) => ({ ...x, isKey: i === idx }))
                                      );
                                    }
                                  }}
                                />
                              </label>
                            </td>
                          ) : null}
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          {step === 4 && (
            <div className="space-y-3">
              <div className="rounded-md border border-gray-200 bg-muted/30 p-3 space-y-3">
                <p className="text-sm font-medium flex items-center gap-2 text-black dark:text-zinc-100">
                  <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                  4. 데이터 처리
                </p>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>데이터를 처리하고 지도 레이어를 만듭니다.</p>
                  <p>진행 상황은 아래 로그에서 확인할 수 있습니다.</p>
                </div>
                <div className="w-full bg-muted rounded h-2">
                  <div className="bg-primary h-2 rounded transition-all" style={{ width: `${processingProgress}%` }} />
                </div>
                {processingError && <p className="text-sm text-destructive">{processingError}</p>}
              </div>
              <div
                ref={processingLogScrollRef}
                className="rounded-md border border-gray-200 bg-muted/30 p-3 h-[530px] overflow-auto shadow-xs"
              >
                <ExcelProcessLogLines lines={processingLog} />
              </div>
            </div>
          )}
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t border-border bg-background pt-3 pb-2 mt-0 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {(step === 1 || step === 3) && (keyDuplicateError || engNameKoreanError) && (
            <div className="w-full sm:flex-1 sm:min-w-0 text-left space-y-1">
              {step === 3 && keyDuplicateError && (
                <p className="text-sm text-destructive break-words max-h-24 overflow-y-auto pr-1">{keyDuplicateError}</p>
              )}
              {engNameKoreanError && (
                <p className="text-sm text-destructive break-words max-h-24 overflow-y-auto pr-1">{engNameKoreanError}</p>
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
            <Button
              variant="outline"
              onClick={goNext}
              disabled={
                (step === 1 && !canLeaveStep1) ||
                (step === 2 && (!canLeaveStep2 || step1Validating || !parseResult)) ||
                (step === 3 && !canGoStep4)
              }
            >
              다음
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 4 && (processingDone || processingError) && !excelSyncOpen && (
            <Button onClick={() => requestClose({ skipConfirm: true })}>닫기</Button>
          )}
          {step === 4 && excelSyncOpen && (
            <Button variant="outline" onClick={() => void handleExcelSyncReviewClose()} disabled={excelSyncApplying}>
              정합성 닫기
            </Button>
          )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
      {excelSyncOpen && integrityPendingRef.current ? (
        <SyncDetailModal
          source="excel"
          tableName={integrityPendingRef.current.tableEng}
          pendingOnly
          deferDbWrite
          onClose={() => {
            void handleExcelSyncReviewClose();
          }}
        />
      ) : null}
    </>
  );
}
