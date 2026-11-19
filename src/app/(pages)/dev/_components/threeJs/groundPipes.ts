import * as THREE from 'three';
import type { GroundHeightField, PipeSegment } from './shapeTypes';
import { elevToSceneY, GROUND_SCENE_M_PER_UNIT } from './shapeTypes';
import { sampleSurfaceY } from './groundSteppedMesh';

/**
 * 제어점을 벗어나지 않는 폴리라인 곡선.
 * CatmullRom 끝점 오버슈트 방지(범위·단면 공통).
 */
function makePolylineCurve(pts: THREE.Vector3[]): THREE.Curve<THREE.Vector3> {
  if (pts.length === 2) {
    return new THREE.LineCurve3(pts[0]!, pts[1]!);
  }
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i < pts.length - 1; i++) {
    path.add(new THREE.LineCurve3(pts[i]!, pts[i + 1]!));
  }
  return path;
}

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

/**
 * 입·출구 원형 단면 관경 치수 — 토피와 동일 색·스프라이트.
 * 기본 숨김(호버). 화면 가까운 끝만 호버 로직에서 킴.
 */
function createDiameterBarAtEnd(
  center: THREE.Vector3,
  axisDir: THREE.Vector3,
  outerR: number,
  diameterM: number
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'pipeDipBar';
  root.userData[PIPE_MESH_KEY] = true;
  root.userData.isDipDim = true;
  root.visible = false;
  root.raycast = () => {};

  const r = Math.max(0.01, outerR);
  const axis = axisDir.clone().normalize();
  let radial = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0));
  if (radial.lengthSq() < 1e-8) {
    radial = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(1, 0, 0));
  }
  radial.normalize();
  const offsetDir = new THREE.Vector3().crossVectors(radial, axis).normalize();
  if (offsetDir.lengthSq() < 1e-8) offsetDir.set(0, 1, 0);

  const gap = 0.22;
  const a = center.clone().addScaledVector(radial, -r);
  const b = center.clone().addScaledVector(radial, r);
  const a1 = a.clone().addScaledVector(offsetDir, gap);
  const b1 = b.clone().addScaledVector(offsetDir, gap);
  const tick = 0.07;
  const tickA = offsetDir.clone().cross(axis).normalize();
  if (tickA.lengthSq() < 1e-8) tickA.copy(radial);
  const positions = [
    a.x, a.y, a.z, a1.x, a1.y, a1.z,
    b.x, b.y, b.z, b1.x, b1.y, b1.z,
    a1.x, a1.y, a1.z, b1.x, b1.y, b1.z,
    a1.x - tickA.x * tick, a1.y - tickA.y * tick, a1.z - tickA.z * tick,
    a1.x + tickA.x * tick, a1.y + tickA.y * tick, a1.z + tickA.z * tick,
    b1.x - tickA.x * tick, b1.y - tickA.y * tick, b1.z - tickA.z * tick,
    b1.x + tickA.x * tick, b1.y + tickA.y * tick, b1.z + tickA.z * tick,
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

  const sprite = makeDepthValueSprite(`관경 ${fmtDipMm(diameterM)}mm`);
  sprite.position.set(
    (a1.x + b1.x) / 2 + offsetDir.x * 0.12,
    (a1.y + b1.y) / 2 + offsetDir.y * 0.12,
    (a1.z + b1.z) / 2 + offsetDir.z * 0.12
  );
  root.add(sprite);
  return root;
}

/**
 * 지형(지표) ↔ 관 윗면 토피 치수.
 * 토피 = 지표면 → 관 외경 상단 (심도−관반경). 심도 DB는 관 중심 기준.
 * 관경은 입·출구 원형 단면(createDiameterBarAtEnd) — 호버·가까운 끝만.
 */
function createDepthBar(
  pipeCenter: THREE.Vector3,
  surfaceY: number,
  depthM: number,
  tangent: THREE.Vector3,
  outerR: number
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'pipeDepthBar';
  root.userData[PIPE_MESH_KEY] = true;
  root.userData.isDepthBar = true;
  // 기본 숨김 — 도형 호버 시에만 표시
  root.visible = false;
  root.raycast = () => {};

  const coverM = Math.max(0, depthM - outerR);
  const midPerp = horizontalPerp(tangent);
  const side = outerR + 0.35;
  // 지표 · 관 윗면(크라운) — 토피는 구간 중점에 고정
  const topOnSurf = new THREE.Vector3(pipeCenter.x, surfaceY, pipeCenter.z);
  const botOnCrown = new THREE.Vector3(
    pipeCenter.x,
    pipeCenter.y + outerR,
    pipeCenter.z
  );
  const top = topOnSurf.clone().addScaledVector(midPerp, side);
  const bot = botOnCrown.clone().addScaledVector(midPerp, side);

  const tick = 0.08;
  const topiPositions = [
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
    top.x - midPerp.x * tick,
    top.y,
    top.z - midPerp.z * tick,
    top.x + midPerp.x * tick,
    top.y,
    top.z + midPerp.z * tick,
    bot.x - midPerp.x * tick,
    bot.y,
    bot.z - midPerp.z * tick,
    bot.x + midPerp.x * tick,
    bot.y,
    bot.z + midPerp.z * tick,
  ];

  const topiGeo = new THREE.BufferGeometry();
  topiGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(topiPositions, 3)
  );
  const topiLines = new THREE.LineSegments(
    topiGeo,
    new THREE.LineBasicMaterial({
      color: DEPTH_COLOR,
      depthTest: true,
      transparent: true,
      opacity: 0.95,
    })
  );
  topiLines.userData.isEdge = true;
  topiLines.userData[PIPE_MESH_KEY] = true;
  topiLines.raycast = () => {};
  root.add(topiLines);

  const coverSprite = makeDepthValueSprite(`토피 ${fmtDepthM(coverM)}m`);
  coverSprite.position.set(
    (top.x + bot.x) / 2 + midPerp.x * 0.18,
    (top.y + bot.y) / 2,
    (top.z + bot.z) / 2 + midPerp.z * 0.18
  );
  root.add(coverSprite);

  return root;
}

function makeDepthValueSprite(text: string): THREE.Sprite {
  const pad = 4;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.Sprite(new THREE.SpriteMaterial({ color: DEPTH_COLOR }));
  }
  const fontCss = 'bold 18px "Malgun Gothic", "Nanum Gothic", sans-serif';
  ctx.font = fontCss;
  const tw = Math.ceil(ctx.measureText(text).width);
  const th = 22;
  canvas.width = tw + pad * 2;
  canvas.height = th + pad * 2;
  ctx.font = fontCss;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 1.25;
  const r = 3;
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
  sprite.scale.set(0.22 * aspect, 0.22, 1);
  sprite.raycast = () => {};
  sprite.userData[PIPE_LABEL_KEY] = true;
  sprite.userData[PIPE_MESH_KEY] = true;
  return sprite;
}

/** 관 옆면 라벨 — 관 진행 방향으로 붙는 평면 텍스트(외곽선 없음) */
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
      new THREE.MeshBasicMaterial({ color: 0xe0f2fe, side: THREE.DoubleSide })
    );
    fallback.position.copy(origin).addScaledVector(outward, outerR + 0.04);
    return fallback;
  }

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
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(origin).addScaledVector(outward, outerR + 0.08);
  const xAxis = tangent.clone();
  if (xAxis.lengthSq() < 1e-10) xAxis.set(1, 0, 0);
  else xAxis.normalize();
  const xFlat = xAxis.clone();
  xFlat.y = 0;
  if (xFlat.lengthSq() > 1e-8) xFlat.normalize();
  else xFlat.set(1, 0, 0);
  const zAxis = outward.clone();
  zAxis.y = 0;
  if (zAxis.lengthSq() < 1e-10) zAxis.copy(horizontalPerp(xFlat));
  else zAxis.normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xFlat).normalize();
  if (yAxis.lengthSq() < 1e-8) yAxis.set(0, 1, 0);
  xFlat.crossVectors(yAxis, zAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(xFlat, yAxis, zAxis);
  mesh.setRotationFromMatrix(basis);
  mesh.userData[PIPE_LABEL_KEY] = true;
  mesh.userData[PIPE_MESH_KEY] = true;
  mesh.userData.isEdge = true;
  mesh.raycast = () => {};
  mesh.renderOrder = 4;
  return mesh;
}

/** 옆면 라벨만(하늘색 외곽선 없음). 가장 긴 구간 중점. */
function createSideFlowLabel(
  curve: THREE.Curve<THREE.Vector3>,
  outerR: number,
  labelText: string
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'pipeSideLabel';
  root.userData[PIPE_MESH_KEY] = true;
  root.raycast = () => {};

  const len = Math.max(0.2, curve.getLength());
  const segs = Math.max(8, Math.min(80, Math.ceil(len / 0.4)));
  const samples: { p: THREE.Vector3; t: THREE.Vector3; out: THREE.Vector3 }[] =
    [];

  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const out = horizontalPerp(t);
    samples.push({ p, t, out });
  }

  let best = samples[Math.floor(samples.length / 2)] ?? samples[0];
  let bestLen = -1;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const segLen = a.p.distanceTo(b.p);
    if (segLen > bestLen) {
      bestLen = segLen;
      const t = b.t.clone().add(a.t);
      if (t.lengthSq() < 1e-10) t.copy(b.t);
      else t.normalize();
      best = {
        p: a.p.clone().lerp(b.p, 0.5),
        t,
        out: horizontalPerp(t),
      };
    }
  }
  if (best) {
    root.add(createSideLabelPlane(labelText, best.p, best.t, best.out, outerR));
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
  const scale = GROUND_SCENE_M_PER_UNIT;
  return {
    x: (x3857 - centerX) / meterToProj / scale,
    z: -(y3857 - centerY) / meterToProj / scale,
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
  /** 호버 툴팁용 레이어 한글명 */
  layerKorName?: string;
};

/**
 * 상수관로 선 → 중공 TubeGeometry (외경 + 내경 BackSide).
 * 옆면 라벨만(외곽선 없음). 심도·관경은 호버.
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
  const layerKor = String(opts.layerKorName ?? '').trim();
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

  for (const pipe of pipes) {
    if (!pipe.coords3857 || pipe.coords3857.length < 2) continue;
    // 관경(m) — 결측·비정상은 100mm. 최소 반경 클램프를 낮춰 구간별 차이가 보이게
    const diameterM = Math.max(
      0.02,
      Number.isFinite(pipe.diameterM) && pipe.diameterM > 0 ? pipe.diameterM : 0.1
    );
    const outerR = diameterM / 2;
    // 심도 0·결측이어도 관 전체가 지면 아래 (중심 ≥ 반경+5cm)
    const minBurialM = outerR + 0.05;
    const fallbackDepthM = Math.max(
      minBurialM,
      Number.isFinite(pipe.depthM) && pipe.depthM > 0 ? pipe.depthM : 1.2
    );

    const pts: THREE.Vector3[] = [];
    for (let vi = 0; vi < pipe.coords3857.length; vi++) {
      const [x, y] = pipe.coords3857[vi]!;
      const { x: lx, z: lz } = mercatorToLocal(x, y, opts.centerX, opts.centerY, m2p);
      const depthRaw =
        pipe.depthsM && pipe.depthsM.length === pipe.coords3857.length
          ? pipe.depthsM[vi]
          : pipe.depthM;
      const depthNum = Number(depthRaw);
      const depth = Math.max(
        minBurialM,
        Number.isFinite(depthNum) && depthNum > 0 ? depthNum : fallbackDepthM
      );
      const surfY = resolvePipeSurfaceY(pipe, lx, lz, surfaceMode, opts.field);
      pts.push(new THREE.Vector3(lx, surfY - depth, lz));
    }
    if (pts.length < 2) continue;

    const cleaned: THREE.Vector3[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (cleaned[cleaned.length - 1]!.distanceToSquared(pts[i]!) > 1e-8) {
        cleaned.push(pts[i]!);
      }
    }
    if (cleaned.length < 2) continue;

    // 범위(사각형)과 동일 — API(ST_Intersection) 좌표 그대로 (클라이언트 재클립 없음)
    const pathRuns = [cleaned];

    const wallM = pipeWallThicknessM(diameterM);
    const innerR = Math.max(0.008, Math.min(outerR - wallM, outerR * 0.92));
    const segColor = pipe.color || fallbackColor;

    for (let runIdx = 0; runIdx < pathRuns.length; runIdx++) {
      const run = pathRuns[runIdx]!;
      if (run.length < 2) continue;
      try {
      const curve = makePolylineCurve(run);
      const tubular = Math.max(8, Math.min(64, run.length * 4));
      const radial = 16;
      const runId = pathRuns.length > 1 ? `${pipe.id}#${runIdx}` : pipe.id;

      const outerGeo = new THREE.TubeGeometry(curve, tubular, outerR, radial, false);
      outerGeo.computeBoundingSphere();
      const outerMesh = new THREE.Mesh(outerGeo, makeMat(segColor, THREE.DoubleSide));
      outerMesh.userData[PIPE_MESH_KEY] = true;
      outerMesh.userData.isFill = true;
      outerMesh.userData.pipeId = runId;
      outerMesh.userData.featureId = pipe.id;
      outerMesh.userData.pipeWallM = wallM;
      outerMesh.userData.pipeInnerR = innerR;
      outerMesh.userData.tooltipLayer =
        String(pipe.layerKorName ?? '').trim() || layerKor || '관로';
      outerMesh.userData.tooltipLabel =
        (pipe.label && pipe.label.trim()) || pipe.id;
      outerMesh.userData.tooltipProps = pipe.props ?? null;
      outerMesh.userData.tooltipFieldsTable =
        pipe.fieldsTable || null;
      outerMesh.renderOrder = 2;
      root.add(outerMesh);

      const innerGeo = new THREE.TubeGeometry(curve, tubular, innerR, radial, false);
      innerGeo.computeBoundingSphere();
      const innerMesh = new THREE.Mesh(innerGeo, makeMat(segColor, THREE.BackSide, true));
      innerMesh.userData[PIPE_MESH_KEY] = true;
      innerMesh.userData.isInner = true;
      innerMesh.userData.pipeId = runId;
      innerMesh.userData.featureId = pipe.id;
      innerMesh.renderOrder = 2;
      root.add(innerMesh);

      // 옆면 라벨(흐름 →) — 하늘색 외곽선 없음
      const side = createSideFlowLabel(
        curve,
        outerR,
        (pipe.label && pipe.label.trim()) || '관로'
      );
      side.userData.pipeId = runId;
      side.userData.featureId = pipe.id;
      side.userData.isEdge = true;
      side.traverse((c) => {
        c.userData.pipeId = runId;
        c.userData.featureId = pipe.id;
        c.userData.isEdge = true;
      });
      root.add(side);

      // 심도: 지형↔관 세로 바
      const mid = curve.getPoint(0.5);
      const midT = curve.getTangent(0.5);
      const midDepth = Math.max(minBurialM, fallbackDepthM);
      const midSurf =
        resolvePipeSurfaceY(pipe, mid.x, mid.z, surfaceMode, opts.field) ||
        mid.y + midDepth;
      const depthBar = createDepthBar(mid, midSurf, midDepth, midT, outerR);
      depthBar.userData.pipeId = runId;
      depthBar.userData.featureId = pipe.id;
      depthBar.userData.isDepthBar = true;
      root.add(depthBar);

      // 관경 — 입·출구 원형 단면(토피 스타일). 호버 시 화면 가까운 끝만
      for (const t of [0, 1] as const) {
        const dim = createDiameterBarAtEnd(
          curve.getPoint(t),
          curve.getTangent(t),
          outerR,
          diameterM
        );
        dim.userData.pipeId = runId;
        dim.userData.featureId = pipe.id;
        dim.userData.isDipDim = true;
        root.add(dim);
      }
      } catch {
        /* skip */
      }
    }
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
