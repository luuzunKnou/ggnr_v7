/**
 * 개발행위대장 업로드: 화살표(->, ⇒, →) 또는 당초/변경 신호가 있으면
 * GPT로 분할 여부/당초·변경 값을 판정한 뒤 행을 2행으로 분리하고
 * 시군구코드(하드코딩)-연도-원본행번호-분할순번 형태의 행키 컬럼을 부여한다.
 * 로컬 정규식은 "변경 신호 감지" 용도로만 사용한다.
 */

export const LEDGER_ROW_KEY_HEADER = '개발행위_행키';

/** 하드코딩 시군구코드 (요청에 따라 별도 env 없음) */
const SIGUNGU_CODE = '47170';

/** GPT 배치당 최대 행 수·셀 수 (토큰·지연 완화) */
const MAX_ROWS_PER_GPT_BATCH = 10;
const MAX_CELLS_PER_GPT_BATCH = 64;

function yearYyyy(): string {
  return String(new Date().getFullYear());
}

/** 셀 값이 A↔B 분리 가능하면 [A,B], 아니면 null */
export function splitDevLedgerCell(raw: unknown): [string, string] | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  const arrow = s.match(/^([\s\S]+?)\s*(?:->|⇒|→)\s*([\s\S]+)$/u);
  if (arrow) return [arrow[1].trim(), arrow[2].trim()];

  const dcComma = s.match(/^\s*당초\s*[:\s,，]*\s*([\s\S]+?)\s*[,，]\s*변경\s*[:\s,，]*\s*([\s\S]+)$/u);
  if (dcComma) return [dcComma[1].trim(), dcComma[2].trim()];

  const dcSpace = s.match(/^\s*당초\s+([\s\S]+?)\s+변경\s+([\s\S]+)$/u);
  if (dcSpace) return [dcSpace[1].trim(), dcSpace[2].trim()];

  return null;
}

/** 값에 화살표/당초/변경 토큰이 있으면 GPT 판단 대상 */
export function cellNeedsGptSplitJudgment(raw: unknown): boolean {
  const s = String(raw ?? '');
  if (!s.trim()) return false;
  return /->|⇒|→|당초|변경/.test(s);
}

type GptCellResult = { split: boolean; first?: string; second?: string };

function normalizeGptCellResult(raw: unknown): GptCellResult {
  if (raw && typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>;
    if (o.split === true && typeof o.first === 'string' && typeof o.second === 'string') {
      return { split: true, first: o.first, second: o.second };
    }
    if (o.split === false) return { split: false };
  }
  return { split: false };
}

/** 모델이 results 개수를 틀리게 주는 경우가 있어 기대 길이에 맞게 보정한다 */
function normalizeGptResultsArray(results: unknown, expectedLen: number): GptCellResult[] {
  const arr = Array.isArray(results) ? results : [];
  const out: GptCellResult[] = [];
  for (let i = 0; i < expectedLen; i++) {
    out.push(normalizeGptCellResult(arr[i]));
  }
  return out;
}

function splitOneRowFromPairs(
  row: Record<string, unknown>,
  headers: string[],
  pairByCol: Map<string, [string, string]>
): [Record<string, unknown>, Record<string, unknown>] {
  const a: Record<string, unknown> = {};
  const b: Record<string, unknown> = {};
  for (const h of headers) {
    if (h === LEDGER_ROW_KEY_HEADER) continue;
    const p = pairByCol.get(h);
    if (p) {
      a[h] = p[0];
      b[h] = p[1];
    } else {
      const v = row[h];
      a[h] = v;
      b[h] = v;
    }
  }
  return [a, b];
}

function buildPairMapForRow(
  row: Record<string, unknown>,
  baseHeaders: string[],
  gptByColumn: Record<string, GptCellResult | undefined>
): Map<string, [string, string]> {
  const pairByCol = new Map<string, [string, string]>();
  for (const h of baseHeaders) {
    if (!cellNeedsGptSplitJudgment(row[h])) continue;
    const g = gptByColumn[h];
    if (g?.split && g.first !== undefined && g.second !== undefined) {
      pairByCol.set(h, [String(g.first).trim(), String(g.second).trim()]);
    }
  }
  return pairByCol;
}

function extractJsonObject(text: string): unknown {
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1].trim() : t;
  const obj = body.match(/\{[\s\S]*\}/);
  if (!obj) return null;
  try {
    return JSON.parse(obj[0]) as unknown;
  } catch {
    return null;
  }
}

const GPT_CELL_RULES = `각 셀마다:
- 당초·변경 또는 화살표 앞뒤로 둘로 나뉘어야 하면 split을 true로 하고, first에는 앞(당초/왼쪽), second에는 뒤(변경/오른쪽)만 넣으세요.
- 나눌 수 없거나 일반 문장이면 split을 false로 하세요.`;

async function openAiChatJson(openaiKey: string, userContent: string): Promise<unknown> {
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
    throw new Error(gptJson?.error?.message ?? `OpenAI API 오류 (${gptRes.status})`);
  }
  const content = gptJson?.choices?.[0]?.message?.content?.trim() ?? '';
  return extractJsonObject(content);
}

export type GptBatchRow = {
  /** 엑셀 데이터 행 0-based (헤더 제외 가정과 동일) */
  rowIndex0: number;
  items: { column: string; value: string }[];
};

/**
 * 여러 행의 GPT 필요 셀을 한 번에 분리 결과로 받는다. (행마다 호출 대신 배치)
 */
export async function gptResolveDevLedgerBatch(
  openaiKey: string,
  batchRows: GptBatchRow[]
): Promise<Map<number, GptCellResult[]>> {
  const out = new Map<number, GptCellResult[]>();
  if (batchRows.length === 0) return out;

  const lines: string[] = [];
  for (const br of batchRows) {
    lines.push(`--- rowIndex0=${br.rowIndex0} (이 행의 셀 ${br.items.length}개, 아래 순서=results 순서) ---`);
    br.items.forEach((it, i) => {
      lines.push(`  ${i}. [${it.column}] ${it.value}`);
    });
  }

  const prompt = `개발행위대장 엑셀입니다. 아래는 서로 다른 데이터 행들입니다. rowIndex0는 원본 행 인덱스(0부터)입니다.

${GPT_CELL_RULES}

응답은 JSON 한 개만 (설명 없이):
{
  "rows": [
    { "rowIndex0": 숫자, "results": [ { "split": true, "first": "...", "second": "..." }, { "split": false }, ... ] },
    ...
  ]
}
- rows 배열 길이는 입력 행 개수(${batchRows.length}개)와 같아야 합니다.
- 각 요소의 rowIndex0는 아래에 나온 것과 동일해야 하고, 해당 행의 results 배열은 그 행의 셀 개수와 정확히 같아야 합니다. (셀이 1개면 results도 원소 1개만)
- 각 results[i]는 입력의 i번째 셀과 대응합니다.

입력:
${lines.join('\n')}
`;

  const parsed = (await openAiChatJson(openaiKey, prompt)) as {
    rows?: { rowIndex0?: number; results?: GptCellResult[] }[];
  } | null;
  const rowsOut = parsed?.rows;
  if (!Array.isArray(rowsOut) || rowsOut.length !== batchRows.length) {
    throw new Error(`GPT 배치 응답 형식 오류 (rows 개수: 기대 ${batchRows.length})`);
  }

  const byIndex = new Map(batchRows.map((br) => [br.rowIndex0, br] as const));
  const seenIdx = new Set<number>();
  for (const part of rowsOut) {
    const idx = part?.rowIndex0;
    if (typeof idx !== 'number' || !byIndex.has(idx)) {
      throw new Error(`GPT 배치 응답에 알 수 없는 rowIndex0: ${String(idx)}`);
    }
    if (seenIdx.has(idx)) {
      throw new Error(`GPT 배치 응답에 rowIndex0 중복: ${idx}`);
    }
    seenIdx.add(idx);
    const expected = byIndex.get(idx)!;
    const normalized = normalizeGptResultsArray(part?.results, expected.items.length);
    out.set(idx, normalized);
  }
  for (const br of batchRows) {
    if (!out.has(br.rowIndex0)) {
      throw new Error(`GPT 배치 응답에 rowIndex0=${br.rowIndex0} 누락`);
    }
  }
  return out;
}

/**
 * 단일 행용 (내부·테스트). 배치 API로 위임한다.
 */
export async function gptResolveDevLedgerRowCells(
  openaiKey: string,
  rowIndex1Based: number,
  items: { column: string; value: string }[]
): Promise<GptCellResult[]> {
  if (items.length === 0) return [];
  const m = await gptResolveDevLedgerBatch(openaiKey, [{ rowIndex0: rowIndex1Based - 1, items }]);
  const got = m.get(rowIndex1Based - 1);
  if (!got) {
    throw new Error('GPT 응답 형식이 올바르지 않습니다. (단일 행 results)');
  }
  return got;
}

type RowGptWork = {
  srcIdx: number;
  needCols: string[];
  items: { column: string; value: string }[];
};

/** GPT가 필요한 행 목록을 행 수·셀 수 한도로 나눈다 */
function chunkGptWorks(works: RowGptWork[]): RowGptWork[][] {
  const batches: RowGptWork[][] = [];
  let cur: RowGptWork[] = [];
  let cells = 0;
  for (const w of works) {
    const wCells = w.items.length;
    const mustFlush =
      cur.length > 0 &&
      (cur.length >= MAX_ROWS_PER_GPT_BATCH || cells + wCells > MAX_CELLS_PER_GPT_BATCH);
    if (mustFlush) {
      batches.push(cur);
      cur = [];
      cells = 0;
    }
    cur.push(w);
    cells += wCells;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/**
 * 개발행위대장 규칙으로 행 확장 + 행키 부여 (동기, 정규식만).
 * GPT가 필요한 셀이 있으면 expandDevBehaviorLedgerRowsAsync를 사용하세요.
 */
export function expandDevBehaviorLedgerRows(
  headers: string[],
  rows: Record<string, unknown>[]
): { headers: string[]; rows: Record<string, unknown>[] } {
  return expandDevBehaviorLedgerRowsWithGptMap(headers, rows, new Map());
}

/**
 * rowIndex(0-based) → 해당 행의 GPT 열(column → 결과) (이미 조회된 경우 재호출 생략)
 */
function expandDevBehaviorLedgerRowsWithGptMap(
  headers: string[],
  rows: Record<string, unknown>[],
  gptRowMap: Map<number, Record<string, GptCellResult>>
): { headers: string[]; rows: Record<string, unknown>[] } {
  const baseHeaders = headers.filter((h) => h !== LEDGER_ROW_KEY_HEADER);
  const y = yearYyyy();
  const out: Record<string, unknown>[] = [];

  rows.forEach((row, srcIdx) => {
    const rowNo = String(srcIdx + 1);
    const baseKey = (part: number) => `${SIGUNGU_CODE}-${y}-${rowNo}-${part}`;
    const gptColMap = gptRowMap.get(srcIdx) ?? {};

    const pairByCol = buildPairMapForRow(row, baseHeaders, gptColMap);
    if (pairByCol.size === 0) {
      out.push({
        ...row,
        [LEDGER_ROW_KEY_HEADER]: baseKey(1),
      });
      return;
    }

    const [r1, r2] = splitOneRowFromPairs(row, baseHeaders, pairByCol);
    r1[LEDGER_ROW_KEY_HEADER] = baseKey(1);
    r2[LEDGER_ROW_KEY_HEADER] = baseKey(2);
    out.push(r1, r2);
  });

  const nextHeaders = baseHeaders.includes(LEDGER_ROW_KEY_HEADER)
    ? baseHeaders
    : [...baseHeaders, LEDGER_ROW_KEY_HEADER];

  return { headers: nextHeaders, rows: out };
}

/**
 * GPT가 필요한 셀이 있으면 OpenAI를 **배치(여러 행 묶음)**로 호출한 뒤 확장. openaiKey 없으면 에러.
 * GPT 불필요 행은 동기 로직만 사용.
 */
export async function expandDevBehaviorLedgerRowsAsync(
  headers: string[],
  rows: Record<string, unknown>[],
  openaiKey: string,
  options?: { onProgress?: (message: string) => void }
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const onProgress = options?.onProgress;
  const baseHeaders = headers.filter((h) => h !== LEDGER_ROW_KEY_HEADER);
  const gptRowMap = new Map<number, Record<string, GptCellResult>>();

  onProgress?.(`[행 확장] 원본 ${rows.length}행 분석 중…`);

  const works: RowGptWork[] = [];
  for (let srcIdx = 0; srcIdx < rows.length; srcIdx++) {
    const row = rows[srcIdx];
    const needCols = baseHeaders.filter((h) => cellNeedsGptSplitJudgment(row[h]));
    if (needCols.length === 0) continue;
    works.push({
      srcIdx,
      needCols,
      items: needCols.map((column) => ({
        column,
        value: String(row[column] ?? '').trim() || '(빈값)',
      })),
    });
  }

  if (works.length > 0) {
    const key = openaiKey?.trim();
    if (!key) {
      throw new Error('OPENAI_API_KEY가 필요합니다. (화살표·당초·변경이 섞인 셀 분석)');
    }

    onProgress?.(`[행 확장] GPT 분석 대상 행 ${works.length}개 (배치 처리)`);

    const chunks = chunkGptWorks(works);
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const rowLabels = chunk.map((w) => w.srcIdx + 1).join(', ');
      onProgress?.(`[행 확장] GPT 배치 ${ci + 1}/${chunks.length} (원본 행 번호: ${rowLabels})`);
      const batchRows: GptBatchRow[] = chunk.map((w) => ({
        rowIndex0: w.srcIdx,
        items: w.items,
      }));
      const resolved = await gptResolveDevLedgerBatch(key, batchRows);
      for (const w of chunk) {
        const gptResults = resolved.get(w.srcIdx);
        if (!gptResults || gptResults.length !== w.needCols.length) {
          throw new Error(`GPT 배치 결과 누락 또는 길이 불일치 (행 ${w.srcIdx + 1})`);
        }
        const colMap: Record<string, GptCellResult> = {};
        w.needCols.forEach((h, i) => {
          colMap[h] = gptResults[i] ?? { split: false };
        });
        gptRowMap.set(w.srcIdx, colMap);
      }
    }
  } else {
    onProgress?.('[행 확장] GPT 없이 규칙만으로 처리 (해당 패턴 없음)');
  }

  const expanded = expandDevBehaviorLedgerRowsWithGptMap(headers, rows, gptRowMap);
  onProgress?.(`[행 확장] 완료 → 결과 ${expanded.rows.length}행 (키 컬럼 포함)`);
  return expanded;
}

export function buildSamplesFromRows(
  rows: Record<string, unknown>[],
  headers: string[],
  max = 3
): Record<string, unknown[]> {
  const samples: Record<string, unknown[]> = {};
  for (const h of headers) {
    samples[h] = rows.slice(0, max).map((r) => r[h]);
  }
  return samples;
}
