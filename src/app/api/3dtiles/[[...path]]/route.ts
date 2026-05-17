import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
/** service_data/3dtiles/<데이터셋>/pnts/... */
const TILES_ROOT = path.join(GGNR_DATA_DIR, 'service_data', '3dtiles');

function getContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const types: Record<string, string> = {
    '.json': 'application/json',
    '.pnts': 'application/octet-stream',
    '.b3dm': 'application/octet-stream',
    '.i3dm': 'application/octet-stream',
    '.cmpt': 'application/octet-stream',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
  };
  return types[ext] || 'application/octet-stream';
}

// --- WGS84 Constants & ECEF Conversion ---
const WGS84_A = 6378137.0; // semi-major axis
const WGS84_F = 1 / 298.257223563; // flattening
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F; // eccentricity squared

/** 경위도(도), 고도(m) -> ECEF(x, y, z) 변환 */
function lonLatHeightToEcef(lonDeg: number, latDeg: number, heightM: number): [number, number, number] {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const sl = Math.sin(lat);
  const cl = Math.cos(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sl * sl);

  const x = (N + heightM) * cl * Math.cos(lon);
  const y = (N + heightM) * cl * Math.sin(lon);
  const z = (N * (1 - WGS84_E2) + heightM) * sl;
  return [x, y, z];
}

/** * ENU (East-North-Up) to ECEF Rotation Matrix (3x3)
 * Cesium은 Column-major를 사용하므로 열 단위로 구성합니다.
 */
function getEnuToEcefRotation(lonDeg: number, latDeg: number): number[] {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  
  const sLon = Math.sin(lon);
  const cLon = Math.cos(lon);
  const sLat = Math.sin(lat);
  const cLat = Math.cos(lat);

  // Column-major order (열 우선)
  // [0,1,2] -> East vector
  // [3,4,5] -> North vector
  // [6,7,8] -> Up vector
  return [
    -sLon,           cLon,           0,     // Column 0 (East)
    -sLat * cLon,   -sLat * sLon,    cLat,  // Column 1 (North)
     cLat * cLon,    cLat * sLon,    sLat   // Column 2 (Up)
  ];
}

/** tileset.json의 root.transform이 경위도 기반일 경우 ECEF Matrix로 패치 */
function patchTilesetRootTransformToEcef(json: any): void {
  const root = json.root;
  if (!root || !Array.isArray(root.transform) || root.transform.length !== 16) return;

  const t = root.transform;
  // 3D Tiles 규격상 [12, 13, 14]는 Translation(위치) 성분입니다.
  const tx = t[12];
  const ty = t[13];
  const tz = t[14];

  // 휴리스틱: 값이 경위도 범위 내에 있는지 확인 (-180~180, -90~90)
  if (Math.abs(tx) <= 180 && Math.abs(ty) <= 90) {
    const [ex, ey, ez] = lonLatHeightToEcef(tx, ty, tz);
    const R = getEnuToEcefRotation(tx, ty);

    // Cesium Column-major 4x4 Matrix 구성
    root.transform = [
      R[0], R[1], R[2], 0,  // Column 0 (X-axis)
      R[3], R[4], R[5], 0,  // Column 1 (Y-axis)
      R[6], R[7], R[8], 0,  // Column 2 (Z-axis)
      ex,   ey,   ez,   1   // Column 3 (Translation)
    ];

    // BoundingVolume이 없을 경우, 보정된 위치를 감싸는 간단한 sphere라도 넣어줘야 렌더링됨
    if (!root.boundingVolume || Object.keys(root.boundingVolume).length === 0) {
      root.boundingVolume = {
        sphere: [0, 0, 0, 1000] // 로컬 좌표계 기준 (transform이 적용되므로 0,0,0 중심)
      };
    }
  }
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const { path: pathSegments } = await context.params;
  
  if (!pathSegments || pathSegments.length < 2) {
    return NextResponse.json({ error: 'Path required: /데이터셋/…파일' }, { status: 400 });
  }

  const dataset = pathSegments[0];
  if (!dataset || dataset.includes('..')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pntsDir = path.join(TILES_ROOT, dataset, 'pnts');
  const resolved = path.normalize(path.join(pntsDir, ...pathSegments.slice(1)));

  if (!resolved.startsWith(pntsDir)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    }

    let buf = await fs.readFile(resolved);
    const contentType = getContentType(resolved);

    // tileset.json 요청 시에만 실시간 보정 로직 실행
    if (path.basename(resolved).toLowerCase() === 'tileset.json') {
      try {
        const json = JSON.parse(buf.toString('utf-8'));
        patchTilesetRootTransformToEcef(json);
        buf = Buffer.from(JSON.stringify(json), 'utf-8');
      } catch (e) {
        console.error('Failed to patch tileset.json:', e);
      }
    }

    return new NextResponse(buf, {
      headers: { 
        'Content-Type': contentType,
        'Cache-Control': 'no-store' // 실시간 변환 시 캐시 주의
      },
    });

  } catch (err: any) {
    if (err.code === 'ENOENT') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}