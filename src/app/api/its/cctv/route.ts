import { NextRequest, NextResponse } from 'next/server';

const ITS_CCTV_URL = 'https://openapi.its.go.kr:9443/cctvInfo';

function pickXmlTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(block);
  if (!m) return '';
  return m[1].trim().replace(/;+\s*$/g, '').trim();
}

function parseItsCctvXml(xml: string) {
  const items: {
    cctvname: string;
    coordx: string;
    coordy: string;
    cctvurl: string;
    cctvtype: string;
    cctvformat: string;
    roadsectionid: string;
    filecreatetime: string;
    cctvresolution: string;
  }[] = [];

  const re = /<data>([\s\S]*?)<\/data>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const cctvname = pickXmlTag(block, 'cctvname');
    const coordx = pickXmlTag(block, 'coordx');
    const coordy = pickXmlTag(block, 'coordy');
    const cctvurl = pickXmlTag(block, 'cctvurl');
    if (!cctvurl) continue;
    const cx = parseFloat(coordx.replace(/,/g, '.'));
    const cy = parseFloat(coordy.replace(/,/g, '.'));
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    items.push({
      cctvname: cctvname || 'CCTV',
      coordx,
      coordy,
      cctvurl,
      cctvtype: pickXmlTag(block, 'cctvtype'),
      cctvformat: pickXmlTag(block, 'cctvformat'),
      roadsectionid: pickXmlTag(block, 'roadsectionid'),
      filecreatetime: pickXmlTag(block, 'filecreatetime'),
      cctvresolution: pickXmlTag(block, 'cctvresolution'),
    });
  }
  return items;
}

/** ITS JSON 응답이 배열/객체 형태로 올 때 */
function parseItsCctvJson(raw: unknown) {
  const items: ReturnType<typeof parseItsCctvXml> = [];
  const root = raw as Record<string, unknown>;
  const dataArr = root.data;
  const list = Array.isArray(dataArr) ? dataArr : dataArr != null ? [dataArr] : [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const cctvurl = String(r.cctvurl ?? '').trim();
    if (!cctvurl) continue;
    const coordx = String(r.coordx ?? '').replace(/;+\s*$/g, '').trim();
    const coordy = String(r.coordy ?? '').replace(/;+\s*$/g, '').trim();
    const cx = parseFloat(coordx.replace(/,/g, '.'));
    const cy = parseFloat(coordy.replace(/,/g, '.'));
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    items.push({
      cctvname: String(r.cctvname ?? 'CCTV').trim() || 'CCTV',
      coordx,
      coordy,
      cctvurl,
      cctvtype: String(r.cctvtype ?? ''),
      cctvformat: String(r.cctvformat ?? ''),
      roadsectionid: String(r.roadsectionid ?? ''),
      filecreatetime: String(r.filecreatetime ?? ''),
      cctvresolution: String(r.cctvresolution ?? ''),
    });
  }
  return items;
}

/**
 * ITS CCTV 목록 프록시 (apiKey는 서버 env만 사용)
 * Query: minX,maxX,minY,maxY (WGS84 경위도), type(기본 all), cctvType(기본 1), getType(xml|json)
 */
export async function GET(req: NextRequest) {
  const apiKey = process.env.ITS_CCTV_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'ITS_CCTV_API_KEY is not configured' }, { status: 503 });
  }

  const sp = req.nextUrl.searchParams;
  const minX = sp.get('minX');
  const maxX = sp.get('maxX');
  const minY = sp.get('minY');
  const maxY = sp.get('maxY');
  if (!minX || !maxX || !minY || !maxY) {
    return NextResponse.json({ error: 'minX, maxX, minY, maxY are required' }, { status: 400 });
  }

  const type = sp.get('type') ?? 'all';
  const cctvType = sp.get('cctvType') ?? '1';
  const getType = (sp.get('getType') ?? 'xml').toLowerCase();

  const u = new URL(ITS_CCTV_URL);
  u.searchParams.set('apiKey', apiKey);
  u.searchParams.set('type', type);
  u.searchParams.set('cctvType', cctvType);
  u.searchParams.set('minX', minX);
  u.searchParams.set('maxX', maxX);
  u.searchParams.set('minY', minY);
  u.searchParams.set('maxY', maxY);
  u.searchParams.set('getType', getType === 'json' ? 'json' : 'xml');

  try {
    const res = await fetch(u.toString(), {
      method: 'GET',
      headers: { Accept: getType === 'json' ? 'application/json' : 'text/xml' },
      next: { revalidate: 0 },
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: 'ITS API request failed', status: res.status, body: text.slice(0, 500) },
        { status: 502 }
      );
    }

    let rows: ReturnType<typeof parseItsCctvXml>;
    if (getType === 'json') {
      try {
        const j = JSON.parse(text) as unknown;
        rows = parseItsCctvJson(j);
      } catch {
        rows = parseItsCctvXml(text);
      }
    } else {
      rows = parseItsCctvXml(text);
    }

    const items = rows.map((r, i) => {
      const cx = parseFloat(String(r.coordx).replace(/,/g, '.'));
      const cy = parseFloat(String(r.coordy).replace(/,/g, '.'));
      return {
        key: `${cx.toFixed(5)}_${cy.toFixed(5)}_${i}`,
        cctvname: r.cctvname,
        coordx: cx,
        coordy: cy,
        cctvurl: r.cctvurl,
        cctvtype: r.cctvtype,
        cctvformat: r.cctvformat,
        roadsectionid: r.roadsectionid,
        filecreatetime: r.filecreatetime,
        cctvresolution: r.cctvresolution,
      };
    });

    return NextResponse.json({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
