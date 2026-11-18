/**
 * 수치지형도 DXF → PMTiles 한 파일 (DB 없이 서비스하는 벡터타일 파일).
 *
 * 1) 도엽 범위(DXF 헤더)로 도엽 테두리 레이어(frame) 생성 — 좌표계는 읍면동 경계와 겹침으로 자동 감지
 * 2) 도엽마다 ogr2ogr(DXF 드라이버)로 GeoJSONSeq 변환 — 스타일(OGR_STYLE)·글자 포함
 * 3) 색·점선·글자·크기·회전을 속성으로 풀고, 표시 줌 단계(z15~z19)별 레이어로 나눔
 * 4) 레이어를 묶어 ogr2ogr(PMTiles 드라이버)로 타일 생성 — 완성되면 파일 교체
 *
 * 표시 줌: 960m(z14) 이하는 도엽 테두리만, z15 부터 도면.
 *   레이어 코드별 단계: z15 주요 도로·철도·큰 하천·행정경계·계곡선 / z16 도로·하천·등고·지명 /
 *   z17 주곡선·건물 / z18 도로경계·표고점·지명 외 글자 / z19 건물·시설·식생 등 나머지.
 * 타일은 축척별 최대 줌까지만 만들고(25000=17, 5000=18, 1000=19) 그 이상은 화면에서 확대 표시한다.
 * 상위 줌 단계 레이어(z18 등)가 최대 줌보다 크면 최대 줌 타일에 같이 담고 화면 스타일이 줌별로 숨긴다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { findOgr2ogrWithDriver, runOgr, type OgrRun } from './gdalOgr';
import { decodeDxfTextEscapes } from './dxfTextEncoding';

/** 도엽 테두리 레이어 이름 (타일 안 레이어 이름 — 화면 스타일과 공유) */
export const DIGITAL_MAP_PMTILES_FRAME_LAYER = 'frame';
/** 도엽 테두리가 보이는 줌 범위 */
const FRAME_MIN_ZOOM = 6;
const FRAME_MAX_ZOOM = 14;
/** 도면 타일 시작 줌 (테두리 구간 다음) */
const DETAIL_MIN_ZOOM = FRAME_MAX_ZOOM + 1;

const HEADER_READ_BYTES = 64 * 1024;
const CONVERT_CONCURRENCY = 4;
const FRAME_EDGE_POINTS = 24;

export type DigitalMapPmtilesBuildOptions = {
  folder: string;
  dxfFiles: string[];
  /** 도면 평면좌표계 EPSG 숫자. 생략하면 읍면동 경계와 겹치는 좌표계를 자동 감지 */
  crs?: string;
  /** 완성 파일 경로 (임시 파일로 만든 뒤 교체) */
  outFile: string;
  /** 타일 최대 줌 (생략 시 폴더명 축척으로 결정) */
  maxZoom?: number;
  /** 임시 작업 폴더의 상위 (기본: OS 임시 폴더) */
  workBase?: string;
  log?: (message: string) => void;
};

export type DigitalMapPmtilesBuildResult = {
  outFile: string;
  crs: string;
  sheets: number;
  features: number;
  byLayer: Record<string, number>;
  maxZoom: number;
  bytes: number;
  ms: number;
};

/** 폴더명 축척 → 타일 최대 줌 (정밀도가 높은 축척일수록 더 확대해도 타일이 있다) */
export function digitalMapPmtilesMaxZoom(folder: string): number {
  const m = /\((\d{3,5})\)/.exec(folder);
  const scale = m ? Number(m[1]) : 0;
  if (scale === 1000) return 19;
  if (scale === 5000) return 18;
  return 17;
}

/** 적재용 레이어 코드(앞 8자리) → 표시 줌 */
export function digitalMapPmtilesDisplayZoom(l: string): number {
  let step: number;
  if (/^(A00232(12|13)|A01[567]|E003|E0022115|E005|G001|G003|F0017114|F0017124)/.test(l)) step = 11;
  else if (/^F0017131/.test(l)) step = 14;
  else if (/^(F0017111|F0017121)/.test(l)) step = 13;
  else if (/^(A002|E00|F0017|G002|H004)/.test(l)) step = 12;
  else if (/^(A0|F002|H)/.test(l)) step = 14;
  else step = 15;
  if (/^B001/.test(l)) step = 13;
  return step + 4;
}

type Extent = { minX: number; minY: number; maxX: number; maxY: number };

/** DXF 헤더에서 EXTMIN/EXTMAX 추출 (전체 파싱 없음) */
export function parseDxfHeaderExtent(headerAscii: string): Extent | null {
  const extMin = /\$EXTMIN\s+10\s+([^\r\n]+)\s+20\s+([^\r\n]+)/i.exec(headerAscii);
  const extMax = /\$EXTMAX\s+10\s+([^\r\n]+)\s+20\s+([^\r\n]+)/i.exec(headerAscii);
  if (!extMin || !extMax) return null;
  const minX = Number(String(extMin[1]).trim());
  const minY = Number(String(extMin[2]).trim());
  const maxX = Number(String(extMax[1]).trim());
  const maxY = Number(String(extMax[2]).trim());
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  if (!(maxX > minX) || !(maxY > minY)) return null;
  return { minX, minY, maxX, maxY };
}

function readDxfHeaderExtent(file: string): Extent | null {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEADER_READ_BYTES);
    const n = fs.readSync(fd, buf, 0, HEADER_READ_BYTES, 0);
    return parseDxfHeaderExtent(buf.subarray(0, n).toString('latin1'));
  } finally {
    fs.closeSync(fd);
  }
}

/** 도엽 범위 합집합이 우리 지역 읍면동과 겹치는 좌표계 (DB 필요 — 적재 때만 사용) */
async function detectCrs(box: Extent): Promise<string> {
  const { detectCrsCandidatesByExtent } = await import('../service/shpUploadService');
  const res = await detectCrsCandidatesByExtent(box);
  const top = res.candidates?.[0]?.epsg;
  if (typeof top === 'number' && Number.isFinite(top)) return String(top);
  throw new Error(
    `좌표계를 자동으로 감지하지 못했습니다${res.error ? ` (${res.error})` : ''}. --crs=5187 처럼 직접 지정하세요.`
  );
}

/**
 * 헤더 범위가 비정상인 도엽 제외 — 도면에 원점(0,0) 쓰레기 객체가 있으면 EXTMIN 이 0 근처가 되어
 * 테두리가 원점까지 뻗는다. 같은 폴더 도엽 크기 중앙값의 3배를 넘으면 비정상으로 본다.
 */
function filterSaneExtents<T extends { ext: Extent }>(list: T[]): { sane: T[]; bad: T[] } {
  if (list.length < 3) return { sane: list, bad: [] };
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const mw = med(list.map((r) => r.ext.maxX - r.ext.minX));
  const mh = med(list.map((r) => r.ext.maxY - r.ext.minY));
  const sane: T[] = [];
  const bad: T[] = [];
  for (const r of list) {
    const ok = r.ext.maxX - r.ext.minX <= mw * 3 && r.ext.maxY - r.ext.minY <= mh * 3;
    (ok ? sane : bad).push(r);
  }
  return sane.length ? { sane, bad } : { sane: list, bad: [] };
}

/** 지오메트리의 첫 좌표 (경위도) — 범위 밖 쓰레기 객체 걸러내기용 */
function firstCoord(geom: unknown): [number, number] | null {
  let c: unknown = (geom as { coordinates?: unknown } | null)?.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number' ? [c[0], c[1]] : null;
}

/** 테두리(경위도) 범위를 이만큼(도, 약 5km) 넓힌 안쪽만 도면 객체로 인정 */
const FRAME_BOX_MARGIN_DEG = 0.05;

function unionExtent(list: Extent[]): Extent {
  return {
    minX: Math.min(...list.map((e) => e.minX)),
    minY: Math.min(...list.map((e) => e.minY)),
    maxX: Math.max(...list.map((e) => e.maxX)),
    maxY: Math.max(...list.map((e) => e.maxY)),
  };
}

/** 도엽 사각형 테두리 — 변을 잘게 나눠 좌표계 변환 후에도 휘어진 모양이 유지되게 한다 */
function frameRing(e: Extent): number[][] {
  const pts: number[][] = [];
  const n = FRAME_EDGE_POINTS;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  for (let i = 0; i < n; i++) pts.push([lerp(e.minX, e.maxX, i / n), e.minY]);
  for (let i = 0; i < n; i++) pts.push([e.maxX, lerp(e.minY, e.maxY, i / n)]);
  for (let i = 0; i < n; i++) pts.push([lerp(e.maxX, e.minX, i / n), e.maxY]);
  for (let i = 0; i < n; i++) pts.push([e.minX, lerp(e.maxY, e.minY, i / n)]);
  pts.push([e.minX, e.minY]);
  return pts;
}

async function forEachPool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        await fn(items[i], i);
      }
    })
  );
}

const RAW_SQL = 'SELECT Layer AS dxf_layer, Text AS text_raw, OGR_STYLE AS ogr_style FROM entities';

export async function buildDigitalMapPmtiles(
  opt: DigitalMapPmtilesBuildOptions
): Promise<DigitalMapPmtilesBuildResult> {
  const log = opt.log ?? (() => {});
  const t0 = Date.now();
  if (!opt.dxfFiles.length) throw new Error('변환할 DXF 가 없습니다.');
  const maxZoom = opt.maxZoom ?? digitalMapPmtilesMaxZoom(opt.folder);

  const ogr: OgrRun = await findOgr2ogrWithDriver('PMTiles');

  // 도엽 범위 → 테두리 + 좌표계 감지
  const extents: Array<{ file: string; ext: Extent }> = [];
  for (const f of opt.dxfFiles) {
    try {
      const ext = readDxfHeaderExtent(f);
      if (ext) extents.push({ file: f, ext });
    } catch {
      /* 헤더를 못 읽는 도엽은 테두리만 생략 */
    }
  }
  if (!extents.length) throw new Error('DXF 헤더에서 도엽 범위를 읽지 못했습니다.');
  const { sane: saneExtents, bad: badExtents } = filterSaneExtents(extents);
  for (const b of badExtents) {
    log(`경고: ${path.basename(b.file)} 헤더 범위가 비정상이라 도엽 테두리에서 제외합니다.`);
  }
  let crs = (opt.crs ?? '').trim();
  if (!crs) {
    crs = await detectCrs(unionExtent(saneExtents.map((e) => e.ext)));
    log(`좌표계 자동 감지: EPSG:${crs}`);
  }
  if (!/^\d{4,5}$/.test(crs)) throw new Error(`좌표계 코드가 올바르지 않습니다: ${crs}`);

  fs.mkdirSync(opt.workBase ?? os.tmpdir(), { recursive: true });
  const work = fs.mkdtempSync(path.join(opt.workBase ?? os.tmpdir(), 'ggnr_dm_pmtiles_'));
  const streams = new Map<string, fs.WriteStream>();
  const counts = new Map<string, number>();
  const stream = (layer: string) => {
    let s = streams.get(layer);
    if (!s) {
      s = fs.createWriteStream(path.join(work, `${layer}.geojsonl`));
      streams.set(layer, s);
    }
    return s;
  };

  const tmpOut = `${opt.outFile}.building`;
  try {
    // 도엽 테두리
    const frameSrc = path.join(work, 'frame_src.geojson');
    fs.writeFileSync(
      frameSrc,
      JSON.stringify({
        type: 'FeatureCollection',
        features: saneExtents.map(({ file, ext }) => ({
          type: 'Feature',
          properties: { n: path.basename(file, path.extname(file)) },
          geometry: { type: 'LineString', coordinates: frameRing(ext) },
        })),
      })
    );
    const frameOut = path.join(work, `${DIGITAL_MAP_PMTILES_FRAME_LAYER}.geojsonl`);
    const fr = await runOgr(ogr, [
      '-f', 'GeoJSONSeq', frameOut, frameSrc,
      '-s_srs', `EPSG:${crs}`, '-t_srs', 'EPSG:4326',
      '-lco', 'COORDINATE_PRECISION=9',
    ]);
    if (fr.code !== 0) throw new Error(`도엽 테두리 변환 실패: ${(fr.stderr || fr.stdout).trim().slice(0, 400)}`);
    counts.set(DIGITAL_MAP_PMTILES_FRAME_LAYER, saneExtents.length);

    // 테두리 경위도 범위 — 이 밖(예: 원점 쓰레기 객체)은 도면에서 제외
    let boxMinX = Infinity;
    let boxMinY = Infinity;
    let boxMaxX = -Infinity;
    let boxMaxY = -Infinity;
    for (const line of fs.readFileSync(frameOut, 'utf8').split('\n')) {
      if (!line) continue;
      const coords = (JSON.parse(line) as { geometry?: { coordinates?: number[][] } }).geometry?.coordinates ?? [];
      for (const [lon, lat] of coords) {
        boxMinX = Math.min(boxMinX, lon);
        boxMaxX = Math.max(boxMaxX, lon);
        boxMinY = Math.min(boxMinY, lat);
        boxMaxY = Math.max(boxMaxY, lat);
      }
    }
    boxMinX -= FRAME_BOX_MARGIN_DEG;
    boxMaxX += FRAME_BOX_MARGIN_DEG;
    boxMinY -= FRAME_BOX_MARGIN_DEG;
    boxMaxY += FRAME_BOX_MARGIN_DEG;
    // 헤더 범위가 없거나 0인 도엽이 있으면 테두리만으로 자르면 실제 도면이 잘린다 → 한반도 범위로 완화
    if (saneExtents.length < opt.dxfFiles.length) {
      boxMinX = Math.min(boxMinX, 124);
      boxMaxX = Math.max(boxMaxX, 132);
      boxMinY = Math.min(boxMinY, 33);
      boxMaxY = Math.max(boxMaxY, 39);
      log(
        `경고: 헤더 범위가 없는 도엽 ${opt.dxfFiles.length - saneExtents.length}장이 있어 객체 필터를 한반도 범위로 완화합니다.`
      );
    }
    let dropped = 0;

    // 도면
    let done = 0;
    await forEachPool(opt.dxfFiles, CONVERT_CONCURRENCY, async (file, i) => {
      const t1 = Date.now();
      const raw = path.join(work, `raw_${i}.geojsonl`);
      const res = await runOgr(ogr, [
        '-f', 'GeoJSONSeq', raw, file,
        '-dialect', 'OGRSQL', '-sql', RAW_SQL,
        '-s_srs', `EPSG:${crs}`,
        // GeoJSONSeq 는 좌표를 경위도로 쓴다 — 소수 9자리(약 0.1mm)로 손실 최소화
        '-t_srs', 'EPSG:4326', '-lco', 'COORDINATE_PRECISION=9',
        '-nlt', 'GEOMETRY', '-dim', 'XY',
      ]);
      if (res.code !== 0) {
        throw new Error(`ogr2ogr 실패(${path.basename(file)}): ${(res.stderr || res.stdout).trim().slice(0, 600)}`);
      }

      let n = 0;
      const rl = readline.createInterface({ input: fs.createReadStream(raw), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line) continue;
        const ft = JSON.parse(line) as {
          geometry?: unknown;
          properties?: { dxf_layer?: string; text_raw?: string; ogr_style?: string };
        };
        if (!ft.geometry) continue;
        const fc = firstCoord(ft.geometry);
        if (!fc || fc[0] < boxMinX || fc[0] > boxMaxX || fc[1] < boxMinY || fc[1] > boxMaxY) {
          dropped++;
          continue;
        }
        const p = ft.properties ?? {};
        const style = String(p.ogr_style ?? '');
        const l = String(p.dxf_layer ?? '').slice(0, 8);
        const isLabel = style.startsWith('LABEL');
        const text = isLabel ? decodeDxfTextEscapes(String(p.text_raw ?? '')).trim() : '';
        if (isLabel && !text) continue;

        const props: Record<string, string | number> = { l };
        const c = /[(,]c:(#[0-9a-fA-F]{6})/.exec(style);
        if (c) props.c = c[1];
        const d = /p:"([^"]*)"/.exec(style);
        if (d) props.d = d[1].replace(/g/g, '');
        if (isLabel) {
          props.t = text;
          const h = /,s:([0-9.]+)g/.exec(style);
          if (h) props.h = Number(h[1]);
          const a = /,a:(-?[0-9.]+)/.exec(style);
          props.a = a ? Number(a[1]) : 0;
        }
        const layer = `z${digitalMapPmtilesDisplayZoom(l)}`;
        stream(layer).write(`${JSON.stringify({ type: 'Feature', properties: props, geometry: ft.geometry })}\n`);
        counts.set(layer, (counts.get(layer) ?? 0) + 1);
        n++;
      }
      fs.rmSync(raw, { force: true });
      done++;
      log(`[${done}/${opt.dxfFiles.length}] ${path.basename(file)} ${n}건 ${Date.now() - t1}ms`);
    });
    await Promise.all([...streams.values()].map((s) => new Promise<void>((resolve) => s.end(resolve))));
    if (dropped) log(`도엽 범위 밖 객체 ${dropped}개 제외`);

    const detailLayers = [...counts.keys()]
      .filter((k) => k !== DIGITAL_MAP_PMTILES_FRAME_LAYER)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    if (!detailLayers.length) throw new Error('변환된 도면 객체가 없습니다.');
    const layers = [DIGITAL_MAP_PMTILES_FRAME_LAYER, ...detailLayers];

    const vrt =
      '<OGRVRTDataSource>\n' +
      layers
        .map(
          (name) =>
            `  <OGRVRTLayer name="${name}"><SrcDataSource>${path.join(work, `${name}.geojsonl`)}</SrcDataSource>` +
            `<SrcLayer>${name}</SrcLayer><LayerSRS>EPSG:4326</LayerSRS><GeometryType>wkbUnknown</GeometryType></OGRVRTLayer>`
        )
        .join('\n') +
      '\n</OGRVRTDataSource>\n';
    const vrtPath = path.join(work, 'all.vrt');
    fs.writeFileSync(vrtPath, vrt);

    const conf: Record<string, { minzoom: number; maxzoom: number }> = {
      [DIGITAL_MAP_PMTILES_FRAME_LAYER]: { minzoom: FRAME_MIN_ZOOM, maxzoom: FRAME_MAX_ZOOM },
    };
    for (const name of detailLayers) {
      const z = Number(name.slice(1));
      conf[name] = { minzoom: Math.min(Math.max(z, DETAIL_MIN_ZOOM), maxZoom), maxzoom: maxZoom };
    }

    log('PMTiles 생성 중…');
    fs.mkdirSync(path.dirname(opt.outFile), { recursive: true });
    fs.rmSync(tmpOut, { force: true });
    const t2 = Date.now();
    const out = await runOgr(ogr, [
      '-f', 'PMTiles', tmpOut, vrtPath,
      '-dsco', `MINZOOM=${FRAME_MIN_ZOOM}`,
      '-dsco', `MAXZOOM=${maxZoom}`,
      '-dsco', `CONF=${JSON.stringify(conf)}`,
      '-dsco', 'SIMPLIFICATION=0.6',
      '-dsco', `SIMPLIFICATION_MAX_ZOOM=${Math.min(16, maxZoom - 1)}`,
      '-dsco', 'MAX_SIZE=2000000',
      '-dsco', 'MAX_FEATURES=500000',
      '-dsco', `NAME=${path.basename(opt.outFile).replace(/\.pmtiles$/i, '')}`,
    ]);
    if (out.code !== 0 || !fs.existsSync(tmpOut)) {
      throw new Error(`PMTiles 생성 실패: ${(out.stderr || out.stdout).trim().slice(0, 600)}`);
    }
    log(`PMTiles 생성 완료 ${Date.now() - t2}ms`);

    // 완성본으로 교체 — 이 시점부터 서비스된다 (중간 실패 시 기존 파일 유지)
    fs.rmSync(opt.outFile, { force: true });
    fs.renameSync(tmpOut, opt.outFile);

    const byLayer: Record<string, number> = {};
    let features = 0;
    for (const name of layers) {
      byLayer[name] = counts.get(name) ?? 0;
      if (name !== DIGITAL_MAP_PMTILES_FRAME_LAYER) features += counts.get(name) ?? 0;
    }
    return {
      outFile: opt.outFile,
      crs,
      sheets: saneExtents.length,
      features,
      byLayer,
      maxZoom,
      bytes: fs.statSync(opt.outFile).size,
      ms: Date.now() - t0,
    };
  } finally {
    for (const s of streams.values()) s.destroy();
    fs.rmSync(tmpOut, { force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
}
