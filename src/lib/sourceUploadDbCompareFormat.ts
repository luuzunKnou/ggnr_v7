/** 스키마↔DB 차이 항목 — 클라이언트·서버 공용 표시용 */

export type SchemaDiffItemLike = {
  kind?: string;
  schema: string;
  table: string;
  column?: string;
  detail?: string;
};

export function formatSchemaDiffItemsTitle(
  items: SchemaDiffItemLike[],
  maxItems = 40
): string {
  if (!Array.isArray(items) || items.length === 0) return '';
  const lines = items.slice(0, maxItems).map((i) => {
    const col = i.column ? `.${i.column}` : '';
    return `${i.schema}.${i.table}${col} — ${i.detail ?? i.kind ?? '차이'}`;
  });
  if (items.length > maxItems) {
    lines.push(`…외 ${items.length - maxItems}건`);
  }
  return lines.join('\n');
}
