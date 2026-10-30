import * as THREE from 'three';
import { getGeoServerPublicBase } from '@/lib/geoserverUrl';
import { resolveSymbolPreviewUrl } from '@/lib/geoserverStyleUtils';
import type { GroundHeightField, GroundSectionLine, ManholeFeature } from './shapeTypes';
import { elevToSceneY, GROUND_SCENE_M_PER_UNIT } from './shapeTypes';
import { isInsideSectionRect, sectionAxesFromField } from './groundSection';
import { sampleSurfaceY } from './groundSteppedMesh';

export const MANHOLE_MESH_KEY = 'ggnrManholeMesh';
export const MANHOLE_LABEL_KEY = 'ggnrManholeLabel';
export const MANHOLE_SYMBOL_KEY = 'ggnrManholeSymbol';

function makeFeatureLabelSprite(text: string): THREE.Sprite {
  const pad = 4;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff }));
  }
  ctx.font = 'bold 22px sans-serif';
  const metrics = ctx.measureText(text);
  const tw = Math.ceil(metrics.width);
  const th = 28;
  canvas.width = tw + pad * 2;
  canvas.height = th + pad * 2;
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  const r = 4;
  const w = canvas.width;
  const h = canvas.height;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r);
  ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(mat);
  const scale = 0.35;
  sprite.scale.set((canvas.width / canvas.height) * scale, scale, 1);
  sprite.userData[MANHOLE_LABEL_KEY] = true;
  sprite.userData[MANHOLE_MESH_KEY] = true;
  sprite.renderOrder = 6;
  sprite.raycast = () => {};
  return sprite;
}

/** SLD ExternalGraphic(/www/symbol/water/…) → 원통 윗면 텍스처 */
function attachSymbolOnTop(
  root: THREE.Group,
  styleName: string,
  lx: number,
  topY: number,
  lz: number,
  diameterM: number
): void {
  const base = styleName.trim().toLowerCase().replace(/\.(svg|png)$/i, '');
  if (!base || !/^[a-z0-9_]+$/.test(base)) return;

  const gsBase = getGeoServerPublicBase();
  const candidates = [
    resolveSymbolPreviewUrl(`${base}.svg`, gsBase),
    resolveSymbolPreviewUrl(`${base}.png`, gsBase),
    resolveSymbolPreviewUrl(`/www/symbol/water/${base}.svg`, gsBase),
    resolveSymbolPreviewUrl(`/www/symbol/water/${base}.png`, gsBase),
  ].filter((u, i, arr): u is string => !!u && arr.indexOf(u) === i);

  if (!candidates.length) return;

  const size = Math.max(0.28, diameterM * 1.6);

  const tryLoad = (idx: number) => {
    const url = candidates[idx];
    if (!url) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const s = 128;
      const canvas = document.createElement('canvas');
      canvas.width = s;
      canvas.height = s;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(img, 8, 8, s - 16, s - 16);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthTest: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(size / 2, 32), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(lx, topY + 0.04, lz);
      mesh.renderOrder = 5;
      mesh.userData[MANHOLE_MESH_KEY] = true;
      mesh.userData[MANHOLE_SYMBOL_KEY] = true;
      mesh.raycast = () => {};
      root.add(mesh);
    };
    img.onerror = () => {
      tryLoad(idx + 1);
    };
    img.src = url;
  };

  tryLoad(0);
}

function meterToProjAtY3857(y3857: number): number {
  const latRad = 2 * Math.atan(Math.exp(y3857 / 6378137)) - Math.PI / 2;
  const cosLat = Math.cos(latRad);
  if (!Number.isFinite(cosLat) || cosLat < 0.2) return 1;
  return 1 / cosLat;
}

function mercatorToLocal(
  x3857: number,
  y3857: number,
  centerX: number,
  centerY: number,
  meterToProj: number
): { x: number; z: number } {
  const scale = GROUND_SCENE_M_PER_UNIT;
  return {
    x: (x3857 - centerX) / meterToProj / scale,
    z: -(y3857 - centerY) / meterToProj / scale,
  };
}

function resolveSurfaceY(
  m: ManholeFeature,
  lx: number,
  lz: number,
  field: GroundHeightField | null | undefined
): number {
  if (m.surfaceElevM != null && Number.isFinite(m.surfaceElevM)) {
    return elevToSceneY(m.surfaceElevM);
  }
  if (field && field.heights?.length && field.size >= 2) {
    return sampleSurfaceY(field, lx, lz);
  }
  return 0;
}

/**
 * 상수 POINT(ps) 시설 → 지표에서 위로 세운 원통 + 윗면 SLD SVG 심볼.
 * (상수관로·급수관로 등 LINE은 groundPipes 담당)
 */
export function createManholesOverlay(opts: {
  centerX: number;
  centerY: number;
  manholes: ManholeFeature[];
  color?: string;
  opacity?: number;
  field?: GroundHeightField | null;
  /** 단면도 — 절단 사각형 밖 제외 */
  sectionLine?: GroundSectionLine | null;
  /** SLD 스타일명 → `/www/symbol/water/{name}.svg` */
  symbolStyleName?: string;
}): THREE.Group {
  const root = new THREE.Group();
  root.name = 'manholesOverlay';
  root.userData[MANHOLE_MESH_KEY] = true;

  const m2p = meterToProjAtY3857(opts.centerY);
  const fallbackColor = opts.color || '#a42b96';
  const opacity = Math.max(0.05, Math.min(1, opts.opacity ?? 0.9));
  const sectionAxes =
    opts.sectionLine && opts.field
      ? sectionAxesFromField(opts.field, opts.sectionLine)
      : null;

  for (const m of opts.manholes) {
    const featureColor = m.color || fallbackColor;
    const { x: lx, z: lz } = mercatorToLocal(
      m.x3857,
      m.y3857,
      opts.centerX,
      opts.centerY,
      m2p
    );
    if (sectionAxes && !isInsideSectionRect(lx, lz, sectionAxes, 0)) {
      continue;
    }
    const surfY = resolveSurfaceY(m, lx, lz, opts.field);
    const r = Math.max(0.08, (m.diameterM || 0.6) / 2);
    const h = Math.max(0.2, m.depthM || 0.4);
    const topY = surfY + h;
    const geo = new THREE.CylinderGeometry(r, r, h, 20);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: featureColor,
        metalness: 0.15,
        roughness: 0.55,
        transparent: opacity < 0.99,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: true,
      })
    );
    // 지표(바닥) → 지상으로 세움
    mesh.position.set(lx, surfY + h / 2, lz);
    mesh.userData[MANHOLE_MESH_KEY] = true;
    mesh.userData.isFill = true;
    mesh.userData.manholeId = m.id;
    mesh.renderOrder = 3;
    root.add(mesh);

    // 윗면 링
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.92, Math.max(0.02, r * 0.08), 8, 24),
      new THREE.MeshStandardMaterial({
        color: featureColor,
        metalness: 0.3,
        roughness: 0.4,
      })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.set(lx, topY + 0.02, lz);
    rim.userData[MANHOLE_MESH_KEY] = true;
    rim.userData.isEdge = true;
    root.add(rim);

    if (opts.symbolStyleName) {
      attachSymbolOnTop(root, opts.symbolStyleName, lx, topY, lz, r * 2);
    }

    const labelText = m.label?.trim();
    if (labelText) {
      const sprite = makeFeatureLabelSprite(labelText);
      sprite.position.set(lx, topY + 0.35, lz);
      root.add(sprite);
    }
  }

  return root;
}
