import * as THREE from 'three';
import type { ShapeProps } from './shapeTypes';

export const CAD_DIM_KEY = 'ggnrCadDim';

const DIM_COLOR = 0x38bdf8;
const LABEL_SCALE = 0.28;

function fmt(n: number): string {
  const v = Math.round(n * 100) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function makeLabelSprite(text: string): THREE.Sprite {
  const pad = 6;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.Sprite(new THREE.SpriteMaterial({ color: DIM_COLOR }));
  }
  ctx.font = 'bold 28px sans-serif';
  const metrics = ctx.measureText(text);
  const tw = Math.ceil(metrics.width);
  const th = 34;
  canvas.width = tw + pad * 2;
  canvas.height = th + pad * 2;
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  const r = 6;
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
  ctx.fillStyle = '#e0f2fe';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  const aspect = w / h;
  sprite.scale.set(LABEL_SCALE * aspect, LABEL_SCALE, 1);
  sprite.userData.isCadLabel = true;
  sprite.raycast = () => {};
  return sprite;
}

type DimSpec = {
  /** 치수선 시작 */
  a: THREE.Vector3;
  /** 치수선 끝 */
  b: THREE.Vector3;
  /** 치수선이 객체에서 떨어지는 방향(단위) */
  offsetDir: THREE.Vector3;
  offset: number;
  label: string;
};

function appendDimLines(
  positions: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  offsetDir: THREE.Vector3,
  offset: number
): THREE.Vector3 {
  const n = offsetDir.clone().normalize();
  const a0 = a.clone();
  const b0 = b.clone();
  const a1 = a.clone().addScaledVector(n, offset);
  const b1 = b.clone().addScaledVector(n, offset);
  // 보조선
  positions.push(a0.x, a0.y, a0.z, a1.x, a1.y, a1.z);
  positions.push(b0.x, b0.y, b0.z, b1.x, b1.y, b1.z);
  // 치수선
  positions.push(a1.x, a1.y, a1.z, b1.x, b1.y, b1.z);
  // 양끝 틱 (치수선에 수직)
  const along = b1.clone().sub(a1);
  if (along.lengthSq() > 1e-8) {
    const tick = new THREE.Vector3().crossVectors(along, n).normalize();
    if (tick.lengthSq() < 1e-8) {
      tick.crossVectors(along, new THREE.Vector3(0, 1, 0)).normalize();
    }
    if (tick.lengthSq() < 1e-8) {
      tick.set(1, 0, 0);
    }
    const t = 0.06;
    positions.push(
      a1.x - tick.x * t,
      a1.y - tick.y * t,
      a1.z - tick.z * t,
      a1.x + tick.x * t,
      a1.y + tick.y * t,
      a1.z + tick.z * t
    );
    positions.push(
      b1.x - tick.x * t,
      b1.y - tick.y * t,
      b1.z - tick.z * t,
      b1.x + tick.x * t,
      b1.y + tick.y * t,
      b1.z + tick.z * t
    );
  }
  return a1.clone().add(b1).multiplyScalar(0.5).addScaledVector(n, 0.08);
}

function specsForProps(props: ShapeProps): DimSpec[] {
  const gap = 0.28;
  /** 바닥 높이 0이면 아래쪽 치수가 밑면 외곽선·다른 수치와 겹침 → 전방(+Z)으로 뺌 */
  const floorClear = (props.floorHeight ?? 0) <= 0.001;
  if (props.kind === 'ground' || props.kind === 'pipe') return [];
  switch (props.kind) {
    case 'box': {
      const w = Math.max(0.05, props.width);
      const h = Math.max(0.05, props.height);
      const d = Math.max(0.05, props.depth);
      const hx = w / 2;
      const hy = h / 2;
      const hz = d / 2;
      // 가로·세로는 밑면이 아닌 전방/측면으로 띄워 외곽선과 분리
      const yFront = floorClear ? 0 : -hy;
      const specs: DimSpec[] = [
        {
          a: new THREE.Vector3(-hx, yFront, hz),
          b: new THREE.Vector3(hx, yFront, hz),
          offsetDir: new THREE.Vector3(0, 0, 1),
          offset: gap,
          label: fmt(w),
        },
        {
          a: new THREE.Vector3(hx, yFront, -hz),
          b: new THREE.Vector3(hx, yFront, hz),
          offsetDir: new THREE.Vector3(1, 0, 0),
          offset: gap,
          label: fmt(d),
        },
        {
          a: new THREE.Vector3(hx, -hy, hz),
          b: new THREE.Vector3(hx, hy, hz),
          offsetDir: new THREE.Vector3(1, 0, 1).normalize(),
          offset: gap,
          label: fmt(h),
        },
      ];
      // 속이 빔: 안쪽 길이를 비율이 아닌 실제 치수로 표기
      if (props.innerRatio > 0) {
        const iw = w * props.innerRatio;
        const id = d * props.innerRatio;
        const ih = h * props.innerRatio;
        const iy = floorClear ? 0 : -ih / 2;
        specs.push(
          {
            a: new THREE.Vector3(-iw / 2, iy, hz + gap * 0.5),
            b: new THREE.Vector3(iw / 2, iy, hz + gap * 0.5),
            offsetDir: new THREE.Vector3(0, 0, 1),
            offset: gap * 1.6,
            label: fmt(iw),
          },
          {
            a: new THREE.Vector3(hx + gap * 0.5, -ih / 2, 0),
            b: new THREE.Vector3(hx + gap * 0.5, ih / 2, 0),
            offsetDir: new THREE.Vector3(1, 0, 0),
            offset: gap * 1.6,
            label: fmt(ih),
          },
          {
            a: new THREE.Vector3(0, iy, -id / 2),
            b: new THREE.Vector3(0, iy, id / 2),
            offsetDir: new THREE.Vector3(0, floorClear ? 1 : -1, 0),
            offset: gap * 1.2,
            label: fmt(id),
          }
        );
      }
      return specs;
    }
    case 'sphere': {
      const r = Math.max(0.05, props.radius);
      const specs: DimSpec[] = [
        {
          a: new THREE.Vector3(-r, 0, 0),
          b: new THREE.Vector3(r, 0, 0),
          offsetDir: new THREE.Vector3(0, 1, 0),
          offset: gap + r * 0.2,
          label: `⌀${fmt(r * 2)}`,
        },
        {
          a: new THREE.Vector3(0, 0, 0),
          b: new THREE.Vector3(r, 0, 0),
          offsetDir: new THREE.Vector3(0, 0, 1),
          offset: gap + 0.08,
          label: `R${fmt(r)}`,
        },
      ];
      if (props.innerRatio > 0) {
        const ir = Math.max(0.01, r * props.innerRatio);
        specs.push({
          a: new THREE.Vector3(-ir, 0, 0),
          b: new THREE.Vector3(ir, 0, 0),
          offsetDir: new THREE.Vector3(0, -1, 0),
          offset: gap + ir * 0.15,
          label: `⌀${fmt(ir * 2)}`,
        });
      }
      return specs;
    }
    case 'cylinder': {
      const r = Math.max(0.05, props.radius);
      const h = Math.max(0.05, props.height);
      const hy = h / 2;
      // 지름·내경 모두 실제 길이(⌀). 비율 값은 표기하지 않음
      const specs: DimSpec[] = [
        {
          a: new THREE.Vector3(-r, floorClear ? 0 : -hy, 0),
          b: new THREE.Vector3(r, floorClear ? 0 : -hy, 0),
          offsetDir: new THREE.Vector3(0, 0, 1),
          offset: gap,
          label: `⌀${fmt(r * 2)}`,
        },
        {
          a: new THREE.Vector3(r, -hy, 0),
          b: new THREE.Vector3(r, hy, 0),
          offsetDir: new THREE.Vector3(1, 0, 0),
          offset: gap,
          label: fmt(h),
        },
      ];
      if (props.innerRatio > 0) {
        const ir = Math.max(0.01, r * props.innerRatio);
        specs.push({
          a: new THREE.Vector3(-ir, hy, 0),
          b: new THREE.Vector3(ir, hy, 0),
          offsetDir: new THREE.Vector3(0, 1, 0),
          offset: gap,
          label: `⌀${fmt(ir * 2)}`,
        });
      }
      return specs;
    }
    default:
      return [];
  }
}

/**
 * 원기둥 입·출구와 동일 — 축에 수직인 지름 치수선 + ⌀ 라벨.
 * @param center 단면 중심
 * @param axisDir 관 진행 방향(접선)
 * @param radius 반지름
 * @param label 표기 문자열 (예: ⌀0.15)
 */
export function createDiameterDimAtEnd(
  center: THREE.Vector3,
  axisDir: THREE.Vector3,
  radius: number,
  label: string,
  gap = 0.28
): THREE.Group {
  const root = new THREE.Group();
  root.userData[CAD_DIM_KEY] = true;
  root.raycast = () => {};

  const r = Math.max(0.01, radius);
  const axis = axisDir.clone().normalize();
  let radial = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0));
  if (radial.lengthSq() < 1e-8) {
    radial = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(1, 0, 0));
  }
  radial.normalize();
  const offsetDir = new THREE.Vector3().crossVectors(radial, axis).normalize();
  if (offsetDir.lengthSq() < 1e-8) {
    offsetDir.set(0, 1, 0);
  }

  const a = center.clone().addScaledVector(radial, -r);
  const b = center.clone().addScaledVector(radial, r);
  const positions: number[] = [];
  const mid = appendDimLines(positions, a, b, offsetDir, gap + r * 0.15);

  if (positions.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        color: DIM_COLOR,
        depthTest: true,
        transparent: true,
        opacity: 0.95,
      })
    );
    lines.userData.isCadDim = true;
    lines.userData.isEdge = true;
    lines.raycast = () => {};
    root.add(lines);
  }

  const sprite = makeLabelSprite(label);
  sprite.position.copy(mid);
  root.add(sprite);
  // 원기둥 CAD와 동일 — 선택 시에만 표시
  root.visible = false;
  return root;
}

/** CAD 스타일 치수선·수치 라벨 그룹 (선택 시에만 표시) */
export function createCadDimensions(props: ShapeProps): THREE.Group {
  const root = new THREE.Group();
  root.name = 'cadDimensions';
  root.userData[CAD_DIM_KEY] = true;
  root.raycast = () => {};

  const positions: number[] = [];
  const labelPositions: { pos: THREE.Vector3; text: string }[] = [];

  for (const spec of specsForProps(props)) {
    const mid = appendDimLines(positions, spec.a, spec.b, spec.offsetDir, spec.offset);
    labelPositions.push({ pos: mid, text: spec.label });
  }

  if (positions.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        color: DIM_COLOR,
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      })
    );
    lines.userData.isCadDim = true;
    lines.raycast = () => {};
    root.add(lines);
  }

  for (const { pos, text } of labelPositions) {
    const sprite = makeLabelSprite(text);
    sprite.position.copy(pos);
    root.add(sprite);
  }

  root.visible = false;
  return root;
}

export function setCadDimensionsVisible(shapeGroup: THREE.Object3D, visible: boolean): void {
  shapeGroup.traverse((obj) => {
    if (obj.userData?.[CAD_DIM_KEY]) obj.visible = visible;
  });
}
