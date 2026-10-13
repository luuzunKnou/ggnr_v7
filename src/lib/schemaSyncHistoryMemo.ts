import type { SchemaSyncPreviewResult } from '@/lib/schemaSyncPreviewTypes';

const MEMO_MAX_CHARS = 12000;

function pushSection(lines: string[], title: string, items: { summary: string; sql: string }[]): void {
  if (items.length === 0) return;
  lines.push(`[${title}]`);
  for (const it of items) {
    lines.push(`- ${it.summary} — ${it.sql}`);
  }
  lines.push('');
}

/** 최신소스 적용 성공 이력 — Drizzle 스키마 미리보기 요약 */
export function formatSchemaSyncHistoryMemo(preview: SchemaSyncPreviewResult | null | undefined): string | null {
  if (!preview) return null;

  const lines: string[] = ['[Drizzle 스키마]'];
  if (!preview.ok) {
    lines.push(`미리보기 실패: ${preview.error?.trim() || '알 수 없음'}`);
    lines.push('(고정 규칙으로 재기동·스키마 동기화 진행)');
    lines.push('');
  }

  const { create, drop, delete: del, alter } = preview.counts;
  lines.push(`생성(적용): ${create}`);
  lines.push(`DROP(거부): ${drop}`);
  lines.push(`DELETE·TRUNCATE(거부): ${del}`);
  lines.push(`ALTER(스킵): ${alter}`);
  lines.push('');

  const items = preview.items ?? [];
  pushSection(
    lines,
    '생성 (적용 예정)',
    items.filter((i) => i.category === 'create')
  );
  pushSection(
    lines,
    'DROP·DELETE (거부)',
    items.filter((i) => i.category === 'drop' || i.category === 'delete')
  );
  pushSection(
    lines,
    'ALTER (스킵 · 수동 확인 필요)',
    items.filter((i) => i.category === 'alter')
  );

  if (preview.warnings?.length) {
    lines.push('[경고]');
    for (const w of preview.warnings) {
      if (w.trim()) lines.push(`- ${w.trim()}`);
    }
    lines.push('');
  }

  if (
    preview.ok &&
    create === 0 &&
    drop === 0 &&
    del === 0 &&
    alter === 0 &&
    items.length === 0
  ) {
    lines.push('적용·스킵할 스키마 변경 없음');
  }

  let text = lines.join('\n').trim();
  if (!text) return null;
  if (text.length > MEMO_MAX_CHARS) {
    text = `${text.slice(0, MEMO_MAX_CHARS)}\n…(이하 생략)`;
  }
  return text;
}
