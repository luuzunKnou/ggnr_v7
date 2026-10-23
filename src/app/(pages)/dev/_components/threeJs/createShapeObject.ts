import * as THREE from 'three';
import { createCadDimensions, setCadDimensionsVisible } from './cadDimensions';
import { createGroundContourOverlay } from './groundContours';
import { createGroundRiverOverlay } from './groundRivers';
import { createPipesOverlay } from './groundPipes';
import { createInterpolatedGroundParts } from './groundInterpolatedMesh';
import { shapeHalfExtentY } from './shapeCatalog';
import type { ShapeProps } from './shapeTypes';
import {
  elevToSceneY,
  GROUND_DEFAULT_RADIUS_M,
  GROUND_SCENE_M_PER_UNIT,
  PIPE_DEFAULT_RADIUS_M,
  SHAPE_NAME_KEY,
  SHAPE_PROPS_KEY,
  SHAPE_USER_DATA_KEY,
} from './shapeTypes';

function clampInner(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.min(0.95, ratio);
}

function fillMaterial(color: string, opacity: number, side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial {
  const o = Math.max(0, Math.min(1, opacity));
  return new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: o,
    depthWrite: o > 0.01,
    side,
    metalness: 0.1,
    roughness: 0.55,
  });
}

function edgeColor(colorHex: string): THREE.Color {
  return new THREE.Color(colorHex).offsetHSL(0, 0, 0.35);
}

function disposeObject3D(obj: THREE.Object3D): void {
  const seenMat = new Set<THREE.Material>();
  obj.traverse((child) => {
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.LineSegments ||
      child instanceof THREE.LineLoop ||
      child instanceof THREE.Sprite
    ) {
      if ('geometry' in child && child.geometry) child.geometry.dispose();
      const mat = child.material;
      const list = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const m of list) {
        if (seenMat.has(m)) continue;
        seenMat.add(m);
        if (m instanceof THREE.SpriteMaterial && m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

/** 외곽선은 레이캐스트 제외 — 드래그 시 채움과 분리되는 것 방지 */
function markEdgeOnly(obj: THREE.Object3D): void {
  obj.userData.isEdge = true;
  obj.raycast = () => {};
}

function addEdges(parent: THREE.Object3D, geometry: THREE.BufferGeometry, colorHex: string): void {
  const edges = new THREE.EdgesGeometry(geometry);
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: edgeColor(colorHex) })
  );
  markEdgeOnly(line);
  parent.add(line);
}

/** 원기둥용 — 위·아래 링 + 세로선 4개. 내경 있으면 안쪽 링·세로선 */
function addCylinderOutline(
  parent: THREE.Object3D,
  radius: number,
  height: number,
  colorHex: string,
  innerRadius = 0
): void {
  const mat = new THREE.LineBasicMaterial({ color: edgeColor(colorHex) });
  const yTop = height / 2;
  const yBot = -height / 2;
  const ringSegs = 64;

  const addRing = (r: number, y: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < ringSegs; i++) {
      const a = (i / ringSegs) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const loop = new THREE.LineLoop(geo, mat);
    markEdgeOnly(loop);
    parent.add(loop);
  };

  addRing(radius, yTop);
  addRing(radius, yBot);
  if (innerRadius > 0) {
    addRing(innerRadius, yTop);
    addRing(innerRadius, yBot);
  }

  // 세로 모서리 4개(바깥) + 내경 있으면 4개
  const verts: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    verts.push(x, yBot, z, x, yTop, z);
    if (innerRadius > 0) {
      const ix = Math.cos(a) * innerRadius;
      const iz = Math.sin(a) * innerRadius;
      verts.push(ix, yBot, iz, ix, yTop, iz);
    }
  }
  const vertGeo = new THREE.BufferGeometry();
  vertGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const vertLines = new THREE.LineSegments(vertGeo, mat);
  markEdgeOnly(vertLines);
  parent.add(vertLines);
}

function buildBox(props: ShapeProps): THREE.Group {
  const group = new THREE.Group();
  const w = Math.max(0.05, props.width);
  const h = Math.max(0.05, props.height);
  const d = Math.max(0.05, props.depth);
  const inner = clampInner(props.innerRatio);

  const outerGeo = new THREE.BoxGeometry(w, h, d);
  const outer = new THREE.Mesh(outerGeo, fillMaterial(props.color, props.opacity));
  outer.userData.isFill = true;
  group.add(outer);
  addEdges(outer, outerGeo, props.color);

  if (inner > 0) {
    const iw = w * inner;
    const ih = h * inner;
    const id = d * inner;
    const innerGeo = new THREE.BoxGeometry(iw, ih, id);
    const innerMesh = new THREE.Mesh(
      innerGeo,
      fillMaterial(props.color, Math.max(props.opacity, 0.15), THREE.BackSide)
    );
    innerMesh.userData.isInner = true;
    group.add(innerMesh);
  }

  return group;
}

function buildSphere(props: ShapeProps): THREE.Group {
  const group = new THREE.Group();
  const r = Math.max(0.05, props.radius);
  const inner = clampInner(props.innerRatio);
  const segs = 32;

  const outerGeo = new THREE.SphereGeometry(r, segs, segs);
  const outer = new THREE.Mesh(outerGeo, fillMaterial(props.color, props.opacity));
  outer.userData.isFill = true;
  group.add(outer);
  addEdges(outer, new THREE.SphereGeometry(r, 16, 12), props.color);

  if (inner > 0) {
    const ir = r * inner;
    const innerGeo = new THREE.SphereGeometry(ir, segs, segs);
    const innerMesh = new THREE.Mesh(
      innerGeo,
      fillMaterial(props.color, Math.max(props.opacity, 0.15), THREE.BackSide)
    );
    innerMesh.userData.isInner = true;
    group.add(innerMesh);
  }

  return group;
}

function buildCylinder(props: ShapeProps): THREE.Group {
  const group = new THREE.Group();
  const r = Math.max(0.05, props.radius);
  const h = Math.max(0.05, props.height);
  const inner = clampInner(props.innerRatio);
  const radial = 48;

  if (inner <= 0) {
    const geo = new THREE.CylinderGeometry(r, r, h, radial);
    const mesh = new THREE.Mesh(geo, fillMaterial(props.color, props.opacity));
    mesh.userData.isFill = true;
    addCylinderOutline(mesh, r, h, props.color, 0);
    group.add(mesh);
    return group;
  }

  const ir = Math.max(0.01, r * inner);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, r, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, ir, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h,
    bevelEnabled: false,
    curveSegments: radial,
  });
  // 압출 0~h → Y축으로 세운 뒤 중심이 원점이 되도록 -h/2
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -h / 2, 0);

  const mesh = new THREE.Mesh(geo, fillMaterial(props.color, props.opacity, THREE.DoubleSide));
  mesh.userData.isFill = true;
  addCylinderOutline(mesh, r, h, props.color, ir);
  group.add(mesh);
  return group;
}

function buildGround(props: ShapeProps): THREE.Group {
  const group = new THREE.Group();
  const field = props.groundHeightField;
  const scale = GROUND_SCENE_M_PER_UNIT;
  const radiusM = props.groundRadiusM ?? field?.radiusM ?? GROUND_DEFAULT_RADIUS_M;
  const halfU = radiusM / scale;

  if (!field || !field.heights?.length || field.size < 2) {
    // 미생성 플레이스홀더 — 정사각 판 + 외곽선
    const plate = new THREE.PlaneGeometry(halfU * 2, halfU * 2);
    plate.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(
      plate,
      fillMaterial(props.color || '#84cc16', Math.max(props.opacity, 0.15), THREE.DoubleSide)
    );
    mesh.userData.isFill = true;
    group.add(mesh);
    const rimPts = [
      new THREE.Vector3(-halfU, 0.01, -halfU),
      new THREE.Vector3(halfU, 0.01, -halfU),
      new THREE.Vector3(halfU, 0.01, halfU),
      new THREE.Vector3(-halfU, 0.01, halfU),
    ];
    const rim = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(rimPts),
      new THREE.LineBasicMaterial({ color: edgeColor(props.color || '#84cc16') })
    );
    markEdgeOnly(rim);
    group.add(rim);
    return group;
  }

  // 윗면만 색상 채움 + 아랫면·옆면 외곽선
  const thicknessM = Math.max(0, props.height ?? 0);
  const parts = createInterpolatedGroundParts(field, thicknessM);
  if (!parts) {
    return group;
  }

  const colorHex = props.color || '#84cc16';
  const groundOpacity = Math.max(0, Math.min(1, props.opacity ?? 0.35));
  const topMat = fillMaterial(
    colorHex,
    groundOpacity > 0 ? groundOpacity : 0.01,
    THREE.DoubleSide
  );
  topMat.wireframe = false;
  const topMesh = new THREE.Mesh(parts.topGeo, topMat);
  topMesh.userData.isFill = true;
  group.add(topMesh);

  if (parts.outlinePositions.length >= 6) {
    const outlineGeo = new THREE.BufferGeometry();
    outlineGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(parts.outlinePositions, 3)
    );
    const outline = new THREE.LineSegments(
      outlineGeo,
      new THREE.LineBasicMaterial({
        color: edgeColor(colorHex),
        depthTest: true,
      })
    );
    markEdgeOnly(outline);
    group.add(outline);
  }

  // 등고선·높이는 지형 표면 위
  group.add(createGroundContourOverlay(field));
  // 지방하천·소하천 구역 (색·불투명도 분리)
  group.add(
    createGroundRiverOverlay(field, {
      color: props.riverColor || '#2563eb',
      opacity: props.riverOpacity ?? 0.4,
    })
  );

  return group;
}

/** 관로 — 고도장이 있으면 해발 지표−심도, 없으면 Y=0 기준 */
function buildPipe(props: ShapeProps): THREE.Group {
  const group = new THREE.Group();
  const radiusM = props.pipeRadiusM ?? PIPE_DEFAULT_RADIUS_M;
  const halfU = radiusM / GROUND_SCENE_M_PER_UNIT;
  const cx = props.pipeCenterX;
  const cy = props.pipeCenterY;
  const field = props.pipeHeightField;
  const hasField = !!(field && field.heights?.length && field.size >= 2);
  // 범위 안내 판: 고도장 최저 · 없으면 관 지표 평균
  let plateY = 0;
  if (hasField) {
    plateY = elevToSceneY(field!.baseElevM);
  } else if (props.pipeSegments?.length) {
    const elevs = props.pipeSegments
      .map((p) => p.surfaceElevM)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (elevs.length) {
      plateY = elevToSceneY(elevs.reduce((a, b) => a + b, 0) / elevs.length);
    }
  }

  // 범위 안내 판 — 지표 높이, depthWrite off
  const plate = new THREE.PlaneGeometry(halfU * 2, halfU * 2);
  plate.rotateX(-Math.PI / 2);
  const plateMat = fillMaterial(props.color || '#38bdf8', 0.08, THREE.DoubleSide);
  plateMat.depthWrite = false;
  const plateMesh = new THREE.Mesh(plate, plateMat);
  plateMesh.position.y = plateY;
  plateMesh.userData.isFill = true;
  group.add(plateMesh);

  const rim = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-halfU, plateY + 0.02, -halfU),
      new THREE.Vector3(halfU, plateY + 0.02, -halfU),
      new THREE.Vector3(halfU, plateY + 0.02, halfU),
      new THREE.Vector3(-halfU, plateY + 0.02, halfU),
    ]),
    new THREE.LineBasicMaterial({ color: edgeColor(props.color || '#38bdf8') })
  );
  markEdgeOnly(rim);
  group.add(rim);

  if (props.pipeSegments?.length && cx != null && cy != null) {
    group.add(
      createPipesOverlay({
        centerX: cx,
        centerY: cy,
        pipes: props.pipeSegments,
        color: props.color || '#38bdf8',
        opacity: props.opacity ?? 0.92,
        surface: hasField ? 'field' : 'zero',
        field: hasField ? field : null,
      })
    );
  }

  return group;
}

export function applyShapeTransform(group: THREE.Group, props: ShapeProps): void {
  if (props.kind === 'ground' || props.kind === 'pipe') {
    group.rotation.set(0, 0, 0);
    // 지형·관로 씬 원점 고정
    group.position.set(0, 0, 0);
    return;
  }
  group.rotation.set(
    THREE.MathUtils.degToRad(props.rotX ?? 0),
    THREE.MathUtils.degToRad(props.rotY ?? 0),
    THREE.MathUtils.degToRad(props.rotZ ?? 0)
  );
  const half = shapeHalfExtentY(props);
  const floor = Math.max(0, props.floorHeight ?? 0);
  group.position.set(props.posX ?? 0, floor + half, props.posZ ?? 0);
}

export function createShapeObject(id: string, props: ShapeProps): THREE.Group {
  let group: THREE.Group;
  switch (props.kind) {
    case 'box':
      group = buildBox(props);
      break;
    case 'sphere':
      group = buildSphere(props);
      break;
    case 'cylinder':
      group = buildCylinder(props);
      break;
    case 'ground':
      group = buildGround(props);
      break;
    case 'pipe':
      group = buildPipe(props);
      break;
    default:
      group = buildBox(props);
  }

  group.name = `shape:${props.kind}`;
  group.userData[SHAPE_USER_DATA_KEY] = id;
  group.userData[SHAPE_PROPS_KEY] = { ...props };
  group.add(createCadDimensions(props));
  applyShapeTransform(group, props);
  group.userData.draggable = true;
  return group;
}

/** @deprecated applyShapeTransform 사용 */
export function applyShapeRotation(group: THREE.Group, props: ShapeProps): void {
  applyShapeTransform(group, props);
}

export function rebuildShapeObject(group: THREE.Group, props: ShapeProps): void {
  const id = String(group.userData[SHAPE_USER_DATA_KEY] ?? '');
  const name = group.userData[SHAPE_NAME_KEY];
  const children = [...group.children];
  for (const child of children) {
    group.remove(child);
    disposeObject3D(child);
  }
  const rebuilt = createShapeObject(id, props);
  for (const child of [...rebuilt.children]) {
    group.add(child);
  }
  disposeObject3D(rebuilt);
  group.userData[SHAPE_PROPS_KEY] = { ...props };
  if (name != null) group.userData[SHAPE_NAME_KEY] = name;
  applyShapeTransform(group, props);
}

export function getShapeProps(group: THREE.Group): ShapeProps | null {
  const raw = group.userData[SHAPE_PROPS_KEY];
  if (!raw || typeof raw !== 'object') return null;
  return { ...(raw as ShapeProps) };
}

export function getShapeId(obj: THREE.Object3D): string | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const id = cur.userData?.[SHAPE_USER_DATA_KEY];
    if (typeof id === 'string' && id) return id;
    cur = cur.parent;
  }
  return null;
}

export function findShapeGroup(root: THREE.Object3D, id: string): THREE.Group | null {
  let found: THREE.Group | null = null;
  root.traverse((obj) => {
    if (found) return;
    if (obj instanceof THREE.Group && obj.userData?.[SHAPE_USER_DATA_KEY] === id) {
      found = obj;
    }
  });
  return found;
}

export function disposeShapeGroup(group: THREE.Group): void {
  disposeObject3D(group);
}

/** 외곽선 강조(선택) + CAD 치수 표시 */
export function setShapeSelected(group: THREE.Group, selected: boolean): void {
  const props = getShapeProps(group);
  const base = props?.color ? edgeColor(props.color) : new THREE.Color(0xffffff);
  group.traverse((child) => {
    if (
      (child instanceof THREE.LineSegments || child instanceof THREE.LineLoop) &&
      child.userData.isEdge
    ) {
      const mat = child.material as THREE.LineBasicMaterial;
      mat.color.copy(selected ? new THREE.Color(0xfbbf24) : base);
    }
  });
  setCadDimensionsVisible(group, selected);
}
