import * as THREE from 'three';
import { createDiameterDimAtEnd } from './cadDimensions';
import type { GroundHeightField, PipeSegment } from './shapeTypes';
import { elevToSceneY } from './shapeTypes';
import { sampleSurfaceY } from './groundSteppedMesh';

/** 지표 Y: 고도장 보간 > 관별 surfaceElevM > 0 */
function resolvePipeSurfaceY(
  pipe: PipeSegment,
  localX: number,
  localZ: number,
  surfaceMode: 'zero' | 'field',
  field?: GroundHeightField | null
): number {
  if (surfaceMode === 'field' && field) {
    return sampleSurfaceY(field, localX, localZ);
  }
  if (pipe.surfaceElevM != null && Number.isFinite(pipe.surfaceElevM)) {
    return elevToSceneY(pipe.surfaceElevM);
  }
  return 0;
}

export const PIPE_MESH_KEY = 'ggnrPipeMesh';
export const PIPE_LABEL_KEY = 'ggnrPipeLabel';
/** @deprecated */
export const GROUND_PIPE_KEY = PIPE_MESH_KEY;

const EDGE_COLOR = 0x7dd3fc;
const DEPTH_COLOR = 0xfbbf24;

/**
 * 상수도용 도복장 강관(KS D 3565) 간이 관두께(m).
 * 호칭지름(std_dip, mm) 기준 — 350A 미만 4.2mm, 이후 단계 증가.
 */
export function pipeWallThicknessM(outerDiameterM: number): number {
  const dnMm = Math.max(0, outerDiameterM * 1000);
  if (dnMm < 350) return 0.0042;
  if (dnMm < 600) return 0.0075;
  if (dnMm < 1000) return 0.0095;
  return 0.0125;
}

function fmtDepthM(m: number): string {
  const v = Math.round(m * 100) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function fmtDipMm(diameterM: number): string {
  return `${Math.max(1, Math.round(diameterM * 1000))}`;
}

function horizontalPerp(tangent: THREE.Vector3): THREE.Vector3 {
  const t = tangent.clone();
  t.y = 0;
  if (t.lengthSq() < 1e-10) {
    return new THREE.Vector3(1, 0, 0);
  }
  t.normalize();
  // 진행 방향 기준 왼쪽(수평)
  return new THREE.Vector3(-t.z, 0, t.x).normalize();
}

/** 관로 지반고: 이미 표기한 고도와 이 이상 차이날 때만 추가 */
const PIPE_JIBANGO_MIN_DELTA_M = 0.5;

/**
 * 지형(지표) ↔ 관 윗면 토피 치수 바.
 * 지반고는 고도 차가 나는 관에만 (shownElevs에 기록).
 * 토피 = 지표면 → 관 외경 상단 (심도−관반경). 심도 DB는 관 중심 기준.
 */
function createDepthBar(
  pipeCenter: THREE.Vector3,
  surfaceY: number,
  depthM: number,
  tangent: THREE.Vector3,
  outerR: number,
  shownElevs: number[]
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'pipeDepthBar';
  root.userData[PIPE_MESH_KEY] = true;
  root.raycast = () => {};

  const coverM = Math.max(0, depthM - outerR);
  const perp = horizontalPerp(tangent);
  const side = outerR + 0.35;
  // 지표 · 관 윗면(크라운)
  const topOnSurf = new THREE.Vector3(pipeCenter.x, surfaceY, pipeCenter.z);
  const botOnCrown = new THREE.Vector3(
    pipeCenter.x,
    pipeCenter.y + outerR,
    pipeCenter.z
  );
  const top = topOnSurf.clone().addScaledVector(perp, side);
  const bot = botOnCrown.clone().addScaledVector(perp, side);

  const tick = 0.08;
  const positions = [
    topOnSurf.x,
    topOnSurf.y,
    topOnSurf.z,
    top.x,
    top.y,
    top.z,
    botOnCrown.x,
    botOnCrown.y,
    botOnCrown.z,
    bot.x,
    bot.y,
    bot.z,
    top.x,
    top.y,
    top.z,
    bot.x,
    bot.y,
    bot.z,
    top.x - perp.x * tick,
    top.y,
    top.z - perp.z * tick,
    top.x + perp.x * tick,
    top.y,
    top.z + perp.z * tick,
    bot.x - perp.x * tick,
    bot.y,
    bot.z - perp.z * tick,
    bot.x + perp.x * tick,
    bot.y,
    bot.z + perp.z * tick,
  ];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({
      color: DEPTH_COLOR,
      depthTest: true,
      transparent: true,
      opacity: 0.95,
    })
  );
  lines.userData.isEdge = true;
  lines.userData[PIPE_MESH_KEY] = true;
  lines.raycast = () => {};
  root.add(lines);

  const coverSprite = makeDepthValueSprite(`토피 ${fmtDepthM(coverM)}m`);
  coverSprite.position.set(
    (top.x + bot.x) / 2 + perp.x * 0.18,
    (top.y + bot.y) / 2,
    (top.z + bot.z) / 2 + perp.z * 0.18
  );
  root.add(coverSprite);

  // 지반고: 이미 비슷한 고도가 표기됐으면 생략
  const groundElevM = Math.round(surfaceY * 10) / 10;
  const isNewElev = shownElevs.every(
    (e) => Math.abs(e - groundElevM) >= PIPE_JIBANGO_MIN_DELTA_M
  );
  if (isNewElev) {
    shownElevs.push(groundElevM);
    const jibanSprite = makeDepthValueSprite(`지반고 ${fmtDepthM(groundElevM)}m`);
    jibanSprite.position.set(
      top.x + perp.x * 0.18,
      top.y + 0.22,
      top.z + perp.z * 0.18
    );
    root.add(jibanSprite);
  }
  return root;
}

function makeDepthValueSprite(text: string): THREE.Sprite {
  const pad = 5;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.Sprite(new THREE.SpriteMaterial({ color: DEPTH_COLOR }));
  }
  ctx.font = 'bold 26px "Malgun Gothic", "Nanum Gothic", sans-serif';
  const tw = Math.ceil(ctx.measureText(text).width);
  const th = 30;
  canvas.width = tw + pad * 2;
  canvas.height = th + pad * 2;
  ctx.font = 'bold 26px "Malgun Gothic", "Nanum Gothic", sans-serif';
  ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 1.5;
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
  ctx.fillStyle = '#fef3c7';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    })
  );
  const aspect = w / Math.max(1, h);
  sprite.scale.set(0.32 * aspect, 0.32, 1);
  sprite.raycast = () => {};
  sprite.userData[PIPE_LABEL_KEY] = true;
  sprite.userData[PIPE_MESH_KEY] = true;
  return sprite;
}

/** 관 옆면 라벨 — 외곽선 위에 관 진행 방향으로 붙는 평면 텍스트 */
function createSideLabelPlane(
  text: string,
  origin: THREE.Vector3,
  tangent: THREE.Vector3,
  outward: THREE.Vector3,
  outerR: number
): THREE.Mesh {
  const padX = 10;
  const padY = 6;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const label = text.trim() || '관로';
  if (!ctx) {
    const fallback = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.2),
      new THREE.MeshBasicMaterial({ color: EDGE_COLOR, side: THREE.DoubleSide })
    );
    fallback.position.copy(origin).addScaledVector(outward, outerR + 0.04);
    return fallback;
  }

  // 라벨 + 우측 10px + 흐름 화살표(geom 진행 방향 = 글자 우측)
  const arrow = '→';
  const gapPx = 10;
  ctx.font = 'bold 32px "Malgun Gothic", "Nanum Gothic", sans-serif';
  const labelW = Math.ceil(ctx.measureText(label).width);
  const arrowW = Math.ceil(ctx.measureText(arrow).width);
  const th = 36;
  canvas.width = Math.max(32, padX + labelW + gapPx + arrowW + padX);
  canvas.height = th + padY * 2;
  ctx.font = 'bold 32px "Malgun Gothic", "Nanum Gothic", sans-serif';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e0f2fe';
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.lineWidth = 4;
  ctx.textBaseline = 'middle';
  const cy = canvas.height / 2;
  ctx.strokeText(label, padX, cy);
  ctx.fillText(label, padX, cy);
  const arrowX = padX + labelW + gapPx;
  ctx.strokeText(arrow, arrowX, cy);
  ctx.fillText(arrow, arrowX, cy);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  tex.anisotropy = 4;

  const worldH = Math.max(0.18, Math.min(0.45, outerR * 1.2));
  const worldW = worldH * (canvas.width / canvas.height);
  const geo = new THREE.PlaneGeometry(worldW, worldH);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(origin).addScaledVector(outward, outerR + 0.03);
  // 관 진행=로컬 X, 바깥=로컬 Z, 위=Y — 옆면에 붙인 글씨
  const xAxis = tangent.clone();
  xAxis.y = 0;
  if (xAxis.lengthSq() < 1e-10) xAxis.set(1, 0, 0);
  else xAxis.normalize();
  const zAxis = outward.clone().normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  if (yAxis.lengthSq() < 1e-8) yAxis.set(0, 1, 0);
  xAxis.crossVectors(yAxis, zAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  mesh.setRotationFromMatrix(basis);
  mesh.userData[PIPE_LABEL_KEY] = true;
  mesh.userData[PIPE_MESH_KEY] = true;
  mesh.userData.isEdge = true;
  mesh.raycast = () => {};
  mesh.renderOrder = 3;
  return mesh;
}

/**
 * geom 순서 기준 옆면 외곽선 + 라벨(우측 10px에 → 흐름 표기).
 */
function createSideFlowOutline(
  curve: THREE.CatmullRomCurve3,
  outerR: number,
  labelText: string
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'pipeSideFlow';
  root.userData[PIPE_MESH_KEY] = true;
  root.raycast = () => {};

  const len = Math.max(0.2, curve.getLength());
  const segs = Math.max(8, Math.min(80, Math.ceil(len / 0.4)));
  const sidePts: THREE.Vector3[] = [];
  const samples: { p: THREE.Vector3; t: THREE.Vector3; out: THREE.Vector3 }[] = [];

  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const out = horizontalPerp(t);
    sidePts.push(p.clone().addScaledVector(out, outerR + 0.015));
    samples.push({ p, t, out });
  }

  if (sidePts.length >= 2) {
    const lineGeo = new THREE.BufferGeometry().setFromPoints(sidePts);
    const line = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({
        color: EDGE_COLOR,
        depthTest: true,
        transparent: true,
        opacity: 0.95,
      })
    );
    line.userData.isEdge = true;
    line.userData[PIPE_MESH_KEY] = true;
    line.raycast = () => {};
    root.add(line);
  }

  // 옆면 라벨 + → (geom 진행 방향)
  const mid = samples[Math.floor(samples.length / 2)] ?? samples[0];
  if (mid) {
    root.add(createSideLabelPlane(labelText, mid.p, mid.t, mid.out, outerR));
  }

  return root;
}

function mercatorToLocal(
  x3857: number,
  y3857: number,
  centerX: number,
  centerY: number,
  meterToProj: number
): { x: number; z: number } {
  return {
    x: (x3857 - centerX) / meterToProj,
    z: -(y3857 - centerY) / meterToProj,
  };
}

function meterToProjAtY3857(y3857: number): number {
  const latRad = 2 * Math.atan(Math.exp(y3857 / 6378137)) - Math.PI / 2;
  const cosLat = Math.cos(latRad);
  if (!Number.isFinite(cosLat) || cosLat < 0.2) return 1;
  return 1 / cosLat;
}

export type CreatePipesOverlayOpts = {
  centerX: number;
  centerY: number;
  pipes: PipeSegment[];
  color?: string;
  opacity?: number;
  /**
   * zero: 지표 Y=0, 관 중심 Y=−심도
   * field: 고도장 표고(해발) − 심도 (지형과 동시 표시)
   */
  surface?: 'zero' | 'field';
  field?: GroundHeightField | null;
};

/**
 * 상수관로 선 → 중공 TubeGeometry (외경 + 내경 BackSide).
 * 심도: 지표↔관 세로 치수. 라벨·흐름: 옆면 외곽선.
 */
export function createPipesOverlay(opts: CreatePipesOverlayOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'pipes';
  root.userData[PIPE_MESH_KEY] = true;
  const pipes = opts.pipes;
  if (!pipes?.length) return root;

  const m2p = meterToProjAtY3857(opts.centerY);
  const surfaceMode = opts.surface ?? (opts.field ? 'field' : 'zero');
  const opacity = Math.max(0.05, Math.min(1, opts.opacity ?? 0.92));
  const fallbackColor = opts.color || '#F44336';
  const opaque = opacity >= 0.85;
  const makeMat = (hex: string, side: THREE.Side, inner = false) => {
    const pipeColor = new THREE.Color(hex || fallbackColor);
    const mat = new THREE.MeshStandardMaterial({
      color: pipeColor,
      emissive: pipeColor.clone().multiplyScalar(inner ? 0.12 : 0.28),
      metalness: 0.2,
      roughness: 0.5,
      transparent: !opaque,
      opacity,
      side,
      depthWrite: true,
      depthTest: true,
    });
    if (inner) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = 1;
      mat.polygonOffsetUnits = 1;
    }
    return mat;
  };

  type DipEnd = {
    pipeId: string;
    pos: THREE.Vector3;
    tangent: THREE.Vector3;
    radius: number;
    label: string;
  };
  const dipEnds: DipEnd[] = [];
  const END_SNAP_M = 0.4;
  /** 관로 지반고 — 고도 차가 나는 관만 */
  const shownPipeElevs: number[] = [];

  for (const pipe of pipes) {
    if (!pipe.coords3857 || pipe.coords3857.length < 2) continue;
    const pts: THREE.Vector3[] = [];
    for (const [x, y] of pipe.coords3857) {
      const { x: lx, z: lz } = mercatorToLocal(x, y, opts.centerX, opts.centerY, m2p);
      const depth = Math.max(0.05, pipe.depthM);
      const surfY = resolvePipeSurfaceY(pipe, lx, lz, surfaceMode, opts.field);
      pts.push(new THREE.Vector3(lx, surfY - depth, lz));
    }
    if (pts.length < 2) continue;

    const cleaned: THREE.Vector3[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (cleaned[cleaned.length - 1].distanceToSquared(pts[i]) > 1e-8) {
        cleaned.push(pts[i]);
      }
    }
    if (cleaned.length < 2) continue;

    const outerR = Math.max(0.04, pipe.diameterM / 2);
    const wallM = pipeWallThicknessM(pipe.diameterM);
    const innerR = Math.max(0.008, Math.min(outerR - wallM, outerR * 0.92));
    const segColor = pipe.color || fallbackColor;
    try {
      const curve = new THREE.CatmullRomCurve3(cleaned, false, 'centripetal');
      const tubular = Math.max(8, Math.min(64, cleaned.length * 4));
      const radial = 16;

      const outerGeo = new THREE.TubeGeometry(curve, tubular, outerR, radial, false);
      outerGeo.computeBoundingSphere();
      const outerMesh = new THREE.Mesh(outerGeo, makeMat(segColor, THREE.DoubleSide));
      outerMesh.userData[PIPE_MESH_KEY] = true;
      outerMesh.userData.isFill = true;
      outerMesh.userData.pipeId = pipe.id;
      outerMesh.userData.pipeWallM = wallM;
      outerMesh.userData.pipeInnerR = innerR;
      outerMesh.renderOrder = 2;
      root.add(outerMesh);

      const innerGeo = new THREE.TubeGeometry(curve, tubular, innerR, radial, false);
      innerGeo.computeBoundingSphere();
      const innerMesh = new THREE.Mesh(innerGeo, makeMat(segColor, THREE.BackSide, true));
      innerMesh.userData[PIPE_MESH_KEY] = true;
      innerMesh.userData.isInner = true;
      innerMesh.userData.pipeId = pipe.id;
      innerMesh.renderOrder = 2;
      root.add(innerMesh);

      // 옆면 외곽선(흐름 화살표) + 라벨
      const side = createSideFlowOutline(
        curve,
        outerR,
        (pipe.label && pipe.label.trim()) || '관로'
      );
      side.userData.pipeId = pipe.id;
      root.add(side);

      // 심도: 지형↔관 세로 바
      const mid = curve.getPoint(0.5);
      const midT = curve.getTangent(0.5);
      const midSurf =
        resolvePipeSurfaceY(pipe, mid.x, mid.z, surfaceMode, opts.field) ||
        mid.y + Math.max(0.05, pipe.depthM);
      const depthBar = createDepthBar(
        mid,
        midSurf,
        pipe.depthM,
        midT,
        outerR,
        shownPipeElevs
      );
      depthBar.userData.pipeId = pipe.id;
      root.add(depthBar);

      const dipLabel = `⌀${fmtDipMm(pipe.diameterM)}mm`;
      dipEnds.push({
        pipeId: pipe.id,
        pos: curve.getPoint(0),
        tangent: curve.getTangent(0),
        radius: outerR,
        label: dipLabel,
      });
      dipEnds.push({
        pipeId: pipe.id,
        pos: curve.getPoint(1),
        tangent: curve.getTangent(1),
        radius: outerR,
        label: dipLabel,
      });
    } catch {
      /* skip */
    }
  }

  const linked = new Array(dipEnds.length).fill(false);
  for (let i = 0; i < dipEnds.length; i++) {
    for (let j = i + 1; j < dipEnds.length; j++) {
      if (dipEnds[i].pipeId === dipEnds[j].pipeId) continue;
      if (dipEnds[i].pos.distanceTo(dipEnds[j].pos) <= END_SNAP_M) {
        linked[i] = true;
        linked[j] = true;
      }
    }
  }
  for (let i = 0; i < dipEnds.length; i++) {
    if (linked[i]) continue;
    const e = dipEnds[i];
    const dim = createDiameterDimAtEnd(e.pos, e.tangent, e.radius, e.label);
    dim.userData.pipeId = e.pipeId;
    root.add(dim);
  }

  return root;
}

/** @deprecated createPipesOverlay 사용 */
export function createGroundPipesOverlay(
  field: GroundHeightField,
  pipes: PipeSegment[]
): THREE.Group {
  return createPipesOverlay({
    centerX: field.centerX,
    centerY: field.centerY,
    pipes,
    field,
    surface: 'field',
  });
}
