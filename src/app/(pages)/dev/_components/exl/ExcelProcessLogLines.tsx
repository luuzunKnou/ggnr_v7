'use client';

import { useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const SECTION_RE = /^={3,}/;
const HR_RE = /^-{3,}$/;
const MD_H2_RE = /^##\s+/;
const MD_H1_RE = /^#\s+/;
const ROW_HEADER_RE = /^행\s+\d+\/\d+\s+처리/;
const BRACKET_RE = /^\[[^\]]+\]/;
const NUMBERED_STEP_RE = /^\d+\.\s+(\[[^\]]+\])?/;
const PNU_ROW_RE = /^row=\S+/i;
const DETAIL_PREFIX_RE =
  /^(물건지\s+주소|물건지\s+분리|조합\s+주소|좌표\s+획득)\s*:/;
const BULLET_RE = /^[·•\-]\s/;
const SUCCESS_RE = /^(완료\.?|삽입\s*행\s*수\s*:)|:\s*성공\b/;
const ERROR_RE = /(실패|오류|에러|error|경고|exception|NOT_FOUND)/i;
const ZERO_COORD_RE = /0개\s*좌표\s*획득/;

function isEmptyLine(line: string): boolean {
  return line.trim() === '';
}

function isSectionHeader(line: string): boolean {
  const t = line.trim();
  return SECTION_RE.test(t) || HR_RE.test(t) || MD_H1_RE.test(t) || MD_H2_RE.test(t);
}

/** 다음 비어 있지 않은 줄이 섹션 헤더이거나 파일이 끝나면 섹션 경계 */
function nextNonEmptyIsSectionOrEof(lines: string[], index: number): boolean {
  for (let j = index + 1; j < lines.length; j++) {
    if (isEmptyLine(lines[j])) continue;
    return isSectionHeader(lines[j]);
  }
  return true;
}

/** 바로 다음이 섹션 헤더일 때만(빈 줄 없이) 내용 줄에 하단 여백 */
function needsContentSectionEndGap(lines: string[], index: number): boolean {
  const next = lines[index + 1];
  if (next === undefined) return true;
  if (isEmptyLine(next)) return false;
  return isSectionHeader(next);
}

function tokenClass(part: string): string {
  const t = part.trim();
  if (/^(pnu=fail|parse=fail|jijuk=not_found)$/i.test(t) || /not_found|=fail$/i.test(t)) {
    return 'text-destructive font-medium';
  }
  if (/^(parse=ok|jijuk=found)$/i.test(t) || /=found$/i.test(t) || /^pnu=\d+/i.test(t)) {
    return 'text-blue-700 dark:text-blue-400';
  }
  if (/^(row=|key=)/i.test(t)) {
    return 'font-semibold text-foreground';
  }
  if (/^(emd=|ri=|bonbun=|bubun=)/i.test(t)) {
    return 'text-muted-foreground';
  }
  return 'text-foreground/85';
}

function renderPnuRowLine(line: string): ReactNode {
  const parts = line.split(/\s*\|\s*/);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 ? <span className="text-border px-0.5">|</span> : null}
          <span className={tokenClass(part)}>{part.trim()}</span>
        </span>
      ))}
    </>
  );
}

function lineClass(line: string, lines: string[], index: number): string {
  const leading = line.match(/^(\s*)/)?.[1]?.length ?? 0;
  const t = line.trim();
  const next = lines[index + 1];
  const prev = lines[index - 1];

  if (!t) {
    // 섹션 헤더 직후 빈 줄 = 1칸, 섹션을 닫는 빈 줄 = 2칸
    if (prev != null && isSectionHeader(prev)) return 'h-2';
    if (nextNonEmptyIsSectionOrEof(lines, index)) return 'h-4';
    return 'h-2';
  }

  if (isSectionHeader(line)) {
    // 헤더 뒤 내용이 바로 오면 1칸 여백 확보
    return cn(
      'mt-3 font-semibold text-foreground/80 tracking-wide break-words',
      next != null && !isEmptyLine(next) ? 'mb-2' : 'mb-0'
    );
  }
  if (PNU_ROW_RE.test(t)) {
    return cn('pl-1 py-0.5 break-words leading-snug', needsContentSectionEndGap(lines, index) && 'mb-4');
  }
  if (ROW_HEADER_RE.test(t)) {
    return cn(
      'mt-2.5 pt-1 border-t border-border/40 font-semibold break-words',
      ZERO_COORD_RE.test(t)
        ? 'text-amber-800 dark:text-amber-300'
        : 'text-foreground',
      needsContentSectionEndGap(lines, index) && 'mb-4'
    );
  }
  if (BRACKET_RE.test(t)) {
    return cn(
      'mt-1.5 font-medium text-teal-700 dark:text-teal-400 break-words',
      needsContentSectionEndGap(lines, index) && 'mb-4'
    );
  }
  if (NUMBERED_STEP_RE.test(t)) {
    return cn(
      'mt-1 font-medium text-foreground break-words',
      needsContentSectionEndGap(lines, index) && 'mb-4'
    );
  }
  if (SUCCESS_RE.test(t)) {
    return cn(
      'mt-2 font-semibold text-blue-700 dark:text-blue-400 break-words',
      needsContentSectionEndGap(lines, index) && 'mb-4'
    );
  }
  if (ERROR_RE.test(t)) {
    return cn(
      'text-destructive break-words',
      (BULLET_RE.test(t) || leading > 0) && 'pl-3',
      needsContentSectionEndGap(lines, index) && 'mb-4'
    );
  }
  if (leading > 0 || DETAIL_PREFIX_RE.test(t) || BULLET_RE.test(t) || t.includes(' > ')) {
    return cn(
      'text-muted-foreground break-words',
      leading === 0 && 'pl-3',
      needsContentSectionEndGap(lines, index) && 'mb-4'
    );
  }
  return cn(
    'text-foreground/90 break-words',
    needsContentSectionEndGap(lines, index) && 'mb-4'
  );
}

type Props = {
  /** 위저드 실시간 로그(줄 배열) 또는 이력 파일 본문 */
  lines?: string[];
  text?: string | null;
  className?: string;
};

export function ExcelProcessLogLines({ lines, text, className }: Props) {
  const resolved = useMemo(() => {
    if (lines) return lines;
    if (text == null || text === '') return [];
    return text.replace(/\r\n/g, '\n').split('\n');
  }, [lines, text]);

  if (resolved.length === 0) {
    return <p className={cn('text-xs text-muted-foreground', className)}>(내용 없음)</p>;
  }

  return (
    <div className={cn('text-xs font-mono leading-relaxed whitespace-pre-wrap', className)}>
      {resolved.map((line, i) => {
        const empty = isEmptyLine(line);
        const t = line.trim();
        return (
          <div key={i} className={lineClass(line, resolved, i)} aria-hidden={empty || undefined}>
            {empty ? '\u00A0' : PNU_ROW_RE.test(t) ? renderPnuRowLine(t) : line}
          </div>
        );
      })}
    </div>
  );
}
