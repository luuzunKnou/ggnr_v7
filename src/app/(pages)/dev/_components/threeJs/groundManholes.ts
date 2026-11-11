import * as THREE from 'three';
import { getGeoServerPublicBase } from '@/lib/geoserverUrl';
import { resolveSymbolPreviewUrl } from '@/lib/geoserverStyleUtils';
import type { GroundHeightField, ManholeFeature } from './shapeTypes';
import { elevToSceneY, GROUND_SCENE_M_PER_UNIT } from './shapeTypes';
import { sampleSurfaceY } from './groundSteppedMesh';

export const MANHOLE_MESH_KEY = 'ggnrManholeMesh';
export const MANHOLE_LABEL_KEY = 'ggnrManholeLabel';
export const MANHOLE_SYMBOL_KEY = 'ggnrManholeSymbol';

/** 관경(옆면 평면)과 동일 — 도형 옆면에 붙는 글자 */
function createAttachedFeatureLabel(
  text: string,
  origin: THREE.Vector3,
  faceOut: THREE.Vector3,
  halfW: number
): THREE.Mesh {
  const padX = 8;
  const padY = 5;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const label = text.trim() || '시설';
  if (!ctx) {
    const fallback = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.16),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })
    );
    fallback.position.copy(origin).addScaledVector(faceOut, halfW + 0.04);
    return fallback;
  }

  ctx.font = 'bold 28px "Malgun Gothic", "Nanum Gothic", sans-serif';
  const tw = Math.ceil(ctx.measureText(label).width);
  const th = 32;
  canvas.width = Math.max(24, padX * 2 + tw);
  canvas.height = th + padY * 2;
  ctx.font = 'bold 28px "Malgun Gothic", "Nanum Gothic", sans-serif';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e0f2fe';
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.lineWidth = 3;
  ctx.textBaseline = 'middle';
  ctx.strokeText(label, padX, canvas.height / 2);
  ctx.fillText(label, padX, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  tex.anisotropy = 4;

  const worldH = Math.max(0.16, Math.min(0.36, halfW * 1.1));
  const worldW = worldH * (canvas.width / canvas.height);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(worldW, worldH),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  mesh.position.copy(origin).addScaledVector(faceOut, halfW + 0.03);
  // 면 바깥(+Z) · 가로(+X) · 위(+Y)
  const zAxis = faceOut.clone().normalize();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  if (xAxis.lengthSq() < 1e-8) xAxis.set(1, 0, 0);
  yAxis.crossVectors(zAxis, xAxis).normalize();
  mesh.setRotationFromMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
  mesh.userData[MANHOLE_LABEL_KEY] = true;
  mesh.userData[MANHOLE_MESH_KEY] = true;
  mesh.userData.isEdge = true;
  mesh.raycast = () => {};
  mesh.renderOrder = 6;
  return mesh;
}

/** SLD ExternalGraphic → 직육면체 윗면 텍스처 */
function attachSymbolOnTop(
  root: THREE.Group,
  styleName: string,
  lx: number,
  topY: number,
  lz: number,
  sideM: number
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

  const size = Math.max(0.28, sideM * 0.85);

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
      ctx.fillRect(2, 2, s - 4, s - 4);
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
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
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

/** 지형 메시 샘플 우선 — IDW 지표와 메시 불일치로 공중 부유 방지 */
function resolveSurfaceY(
  m: ManholeFeature,
  lx: number,
  lz: number,
  field: GroundHeightField | null | undefined
): number {
  if (field && field.heights?.length && field.size >= 2) {
    return sampleSurfaceY(field, lx, lz);
  }
  if (m.surfaceElevM != null && Number.isFinite(m.surfaceElevM)) {
    return elevToSceneY(m.surfaceElevM);
  }
  return 0;
}

/**
 * 상수 POINT(ps) 시설 → 지표에 앉힌 직육면체 + 옆면 라벨 + 윗면 SLD 심볼.
 */
export function createManholesOverlay(opts: {
  centerX: number;
  centerY: number;
  manholes: ManholeFeature[];
  color?: string;
  opacity?: number;
  field?: GroundHeightField | null;
  /** SLD 스타일명 → `/www/symbol/water/{name}.svg` */
  symbolStyleName?: string;
  /** 호버 툴팁용 레이어 한글명 */
  layerKorName?: string;
}): THREE.Group {
  const root = new THREE.Group();
  root.name = 'manholesOverlay';
  root.userData[MANHOLE_MESH_KEY] = true;

  const m2p = meterToProjAtY3857(opts.centerY);
  const fallbackColor = opts.color || '#a42b96';
  const opacity = Math.max(0.05, Math.min(1, opts.opacity ?? 0.9));
  const layerKor = String(opts.layerKorName ?? '').trim();

  for (const m of opts.manholes) {
    const featureColor = m.color || fallbackColor;
    const { x: lx, z: lz } = mercatorToLocal(
      m.x3857,
      m.y3857,
      opts.centerX,
      opts.centerY,
      m2p
    );
    const surfY = resolveSurfaceY(m, lx, lz, opts.field);
    const side = Math.max(0.16, m.diameterM || 0.6);
    const h = Math.max(0.2, m.depthM || 0.4);
    const topY = surfY + h;
    const halfW = side / 2;
    const geo = new THREE.BoxGeometry(side, h, side);
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
    // 바닥면이 지표에 닿도록
    mesh.position.set(lx, surfY + h / 2, lz);
    mesh.userData[MANHOLE_MESH_KEY] = true;
    mesh.userData.isFill = true;
    mesh.userData.manholeId = m.id;
    mesh.userData.featureId = m.id;
    mesh.userData.tooltipLayer = layerKor || '시설';
    mesh.userData.tooltipLabel = String(m.label ?? '').trim() || m.id;
    mesh.userData.tooltipProps = m.props ?? null;
    mesh.userData.tooltipFieldsTable = m.fieldsTable || null;
    mesh.renderOrder = 3;
    root.add(mesh);

    // 윗면 테두리
    const rim = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(lx - halfW, topY + 0.02, lz - halfW),
        new THREE.Vector3(lx + halfW, topY + 0.02, lz - halfW),
        new THREE.Vector3(lx + halfW, topY + 0.02, lz + halfW),
        new THREE.Vector3(lx - halfW, topY + 0.02, lz + halfW),
      ]),
      new THREE.LineBasicMaterial({
        color: featureColor,
        depthTest: true,
      })
    );
    rim.userData[MANHOLE_MESH_KEY] = true;
    rim.userData.isEdge = true;
    rim.userData.manholeId = m.id;
    rim.userData.featureId = m.id;
    rim.raycast = () => {};
    root.add(rim);

    if (opts.symbolStyleName) {
      attachSymbolOnTop(root, opts.symbolStyleName, lx, topY, lz, side);
    }

    const labelText = m.label?.trim();
    if (labelText) {
      const mid = new THREE.Vector3(lx, surfY + h / 2, lz);
      const faceOut = new THREE.Vector3(1, 0, 0);
      root.add(createAttachedFeatureLabel(labelText, mid, faceOut, halfW));
    }
  }

  return root;
}
