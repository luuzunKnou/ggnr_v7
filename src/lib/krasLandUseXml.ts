/** KRAS XML BODY 파싱 — KRAS000025 토지이용계획 등 (v6 resultMapToList 동일) */

export type KrasBodyRecord = Record<string, string>;

function extractBody(xml: string): string {
  const m = xml.match(/<BODY[^>]*>([\s\S]*?)<\/BODY>/i);
  return m?.[1] ?? '';
}

function matchDirectChildElements(fragment: string): Array<{ tag: string; content: string }> {
  const results: Array<{ tag: string; content: string }> = [];
  const re = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) {
    results.push({ tag: m[1]!, content: m[2] ?? '' });
  }
  return results;
}

function hasElementChildren(content: string): boolean {
  return matchDirectChildElements(content).length > 0;
}

function leavesToMap(elements: Array<{ tag: string; content: string }>): KrasBodyRecord {
  const map: KrasBodyRecord = {};
  for (const leaf of elements) {
    if (!hasElementChildren(leaf.content)) {
      map[leaf.tag] = leaf.content.trim();
    }
  }
  return map;
}

function pushIfAny(out: KrasBodyRecord[], map: KrasBodyRecord): void {
  if (Object.keys(map).length) out.push(map);
}

/**
 * BODY 안 레코드 수집.
 * - 한 겹: ATTR → 필드
 * - 두 겹: ATTR_SET → ATTR → 필드  (KRAS000025 LAND_USE_PLAN_CNF_ATTR_SET)
 * - 평탄: BODY에 UNAME 등이 바로 붙음
 */
function collectBodyRecords(fragment: string, out: KrasBodyRecord[]): void {
  const children = matchDirectChildElements(fragment);
  if (!children.length) return;

  if (children.every((c) => !hasElementChildren(c.content))) {
    pushIfAny(out, leavesToMap(children));
    return;
  }

  for (const child of children) {
    const innerChildren = matchDirectChildElements(child.content);
    if (!innerChildren.length) continue;

    if (innerChildren.some((c) => hasElementChildren(c.content))) {
      for (const inner of innerChildren) {
        const recordChildren = matchDirectChildElements(inner.content);
        if (!recordChildren.length) continue;
        if (recordChildren.some((c) => hasElementChildren(c.content))) {
          collectBodyRecords(inner.content, out);
          continue;
        }
        pushIfAny(out, leavesToMap(recordChildren));
      }
      continue;
    }

    pushIfAny(out, leavesToMap(innerChildren));
  }
}

/** KRAS XML 본문을 필드 맵 배열로 변환 */
export function parseKrasBodyFieldMaps(xml: string): KrasBodyRecord[] {
  const body = extractBody(xml);
  if (!body.trim()) return [];
  const out: KrasBodyRecord[] = [];
  collectBodyRecords(body, out);
  return out;
}

/** 토지이용계획 레코드 → 용도지역명 목록 (CTYPE=1 우선) */
export function zonesFromKrasLandUseRows(rows: KrasBodyRecord[]): string[] {
  if (!rows.length) return [];
  const type1 = rows.filter((r) => String(r.CTYPE ?? '1').trim() === '1');
  const source = type1.length ? type1 : rows;
  const zones = new Set<string>();
  for (const row of source) {
    const name = String(row.UNAME ?? '').trim();
    if (name) zones.add(name);
  }
  return [...zones];
}
