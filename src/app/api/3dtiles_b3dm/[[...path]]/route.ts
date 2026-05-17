import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
/** service_data/3dtiles/<데이터셋>/b3dm/... */
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

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;

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

function getEnuToEcefRotation(lonDeg: number, latDeg: number): number[] {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;

  const sLon = Math.sin(lon);
  const cLon = Math.cos(lon);
  const sLat = Math.sin(lat);
  const cLat = Math.cos(lat);

  return [
    -sLon,
    cLon,
    0,
    -sLat * cLon,
    -sLat * sLon,
    cLat,
    cLat * cLon,
    cLat * sLon,
    sLat,
  ];
}

function patchTilesetRootTransformToEcef(json: any): void {
  const root = json.root;
  if (!root || !Array.isArray(root.transform) || root.transform.length !== 16) return;

  const t = root.transform;
  const tx = t[12];
  const ty = t[13];
  const tz = t[14];

  if (Math.abs(tx) <= 180 && Math.abs(ty) <= 90) {
    const [ex, ey, ez] = lonLatHeightToEcef(tx, ty, tz);
    const R = getEnuToEcefRotation(tx, ty);

    root.transform = [
      R[0],
      R[1],
      R[2],
      0,
      R[3],
      R[4],
      R[5],
      0,
      R[6],
      R[7],
      R[8],
      0,
      ex,
      ey,
      ez,
      1,
    ];

    if (!root.boundingVolume || Object.keys(root.boundingVolume).length === 0) {
      root.boundingVolume = {
        sphere: [0, 0, 0, 1000],
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

  const b3dmDir = path.join(TILES_ROOT, dataset, 'b3dm');
  const resolved = path.normalize(path.join(b3dmDir, ...pathSegments.slice(1)));

  if (!resolved.startsWith(b3dmDir)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    }

    let buf = await fs.readFile(resolved);
    const contentType = getContentType(resolved);

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
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    if (err.code === 'ENOENT') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
