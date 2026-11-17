/**
 * EPSG:3857 범위의 구글 항공 타일을 이어 붙여 data URL로 반환.
 * (브이월드 차단 환경 — GroundPick·Cesium 분할과 동일하게 Google 사용)
 */

const ORIGIN_SHIFT = 20037508.342789244;
const TILE_SIZE = 256;
const MAX_TILES_PER_SIDE = 8;
const MAX_ZOOM = 20;

function meterToProjAtY3857(y3857: number): number {
  const latRad = 2 * Math.atan(Math.exp(y3857 / 6378137)) - Math.PI / 2;
  const cosLat = Math.cos(latRad);
  if (!Number.isFinite(cosLat) || cosLat < 0.2) return 1;
  return 1 / cosLat;
}

function resolutionAtZoom(z: number): number {
  return (2 * ORIGIN_SHIFT) / (TILE_SIZE * Math.pow(2, z));
}

function chooseZoom(extentW: number, targetPx: number): number {
  let z = 0;
  for (let i = 0; i <= MAX_ZOOM; i++) {
    const px = extentW / resolutionAtZoom(i);
    z = i;
    if (px >= targetPx) break;
  }
  while (z > 0 && extentW / resolutionAtZoom(z) / TILE_SIZE > MAX_TILES_PER_SIDE) {
    z -= 1;
  }
  return z;
}

function googleTileUrl(z: number, x: number, y: number): string {
  const host = `mt${(x + y) % 4}.google.com`;
  return `https://${host}/vt/lyrs=s&hl=ko&x=${x}&y=${y}&z=${z}`;
}

async function loadTile(
  z: number,
  x: number,
  y: number
): Promise<HTMLImageElement | ImageBitmap | null> {
  const url = googleTileUrl(z, x, y);
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (typeof createImageBitmap === 'function') {
      return await createImageBitmap(blob);
    }
    return await new Promise((resolve) => {
      const img = new Image();
      const obj = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(obj);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(obj);
        resolve(null);
      };
      img.src = obj;
    });
  } catch {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
}

export function extent3857FromCenterRadius(
  centerX: number,
  centerY: number,
  radiusM: number
): [number, number, number, number] {
  const m2p = meterToProjAtY3857(centerY);
  const half = Math.max(1, radiusM) * m2p;
  return [centerX - half, centerY - half, centerX + half, centerY + half];
}

/**
 * 지도 타일 합성. 실패·전부 로드 실패 시 null.
 */
export async function captureExtentTileImage(
  extent3857: [number, number, number, number],
  opts?: { targetPx?: number }
): Promise<string | null> {
  const [minX, minY, maxX, maxY] = extent3857;
  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return null;

  const targetPx = Math.max(256, Math.min(2048, opts?.targetPx ?? 1024));
  const z = chooseZoom(Math.max(w, h), targetPx);
  const res = resolutionAtZoom(z);
  const worldSize = TILE_SIZE * Math.pow(2, z);

  const clampTile = (n: number) => Math.max(0, Math.min(worldSize - 1, n));
  const x0 = clampTile(Math.floor((minX + ORIGIN_SHIFT) / res / TILE_SIZE));
  const x1 = clampTile(Math.floor((maxX + ORIGIN_SHIFT) / res / TILE_SIZE));
  // 웹 메르카토르 타일 Y는 북→남. 3857 Y 증가 = 북
  const yTop = clampTile(Math.floor((ORIGIN_SHIFT - maxY) / res / TILE_SIZE));
  const yBot = clampTile(Math.floor((ORIGIN_SHIFT - minY) / res / TILE_SIZE));

  const tilesX = x1 - x0 + 1;
  const tilesY = yBot - yTop + 1;
  if (tilesX < 1 || tilesY < 1 || tilesX * tilesY > MAX_TILES_PER_SIDE * MAX_TILES_PER_SIDE) {
    return null;
  }

  const mosaic = document.createElement('canvas');
  mosaic.width = tilesX * TILE_SIZE;
  mosaic.height = tilesY * TILE_SIZE;
  const mctx = mosaic.getContext('2d');
  if (!mctx) return null;
  mctx.fillStyle = '#2a2a2e';
  mctx.fillRect(0, 0, mosaic.width, mosaic.height);

  let loaded = 0;
  const jobs: Promise<void>[] = [];
  for (let ty = yTop; ty <= yBot; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      jobs.push(
        loadTile(z, tx, ty).then((img) => {
          if (!img) return;
          loaded += 1;
          mctx.drawImage(img, (tx - x0) * TILE_SIZE, (ty - yTop) * TILE_SIZE);
        })
      );
    }
  }
  await Promise.all(jobs);
  if (loaded === 0) return null;

  const outW = Math.max(2, Math.round(Math.min(targetPx, w / res)));
  const outH = Math.max(2, Math.round(Math.min(targetPx, h / res)));

  const cropX = (minX + ORIGIN_SHIFT) / res - x0 * TILE_SIZE;
  const cropY = (ORIGIN_SHIFT - maxY) / res - yTop * TILE_SIZE;
  const cropW = w / res;
  const cropH = h / res;

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.drawImage(mosaic, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
  try {
    return out.toDataURL('image/jpeg', 0.9);
  } catch {
    // CORS로 캔버스가 오염된 경우 — 실패
    return null;
  }
}
