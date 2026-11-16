import * as THREE from 'three';
import type { PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  GROUND_DEFAULT_RADIUS_M,
  SHAPE_PROPS_KEY,
  elevToSceneY,
  type ShapeProps,
} from './shapeTypes';
import {
  sectionAxesFromField,
  sectionSurfaceElevM,
} from './groundSection';

/**
 * 현재 타깃·거리·높이를 유지한 채 정북(−Z)을 바라보게 회전.
 * 씬 규약: +X=동, −Z=북 — 카메라는 +Z(남) 쪽에 둠.
 */
export function faceNorthView(
  camera: PerspectiveCamera,
  orbit: OrbitControls
): void {
  const target = orbit.target.clone();
  const offset = camera.position.clone().sub(target);
  const horiz = Math.hypot(offset.x, offset.z);
  const dist = Math.max(horiz, 1);
  const y = camera.position.y;
  camera.up.set(0, 1, 0);
  camera.position.set(target.x, y, target.z + dist);
  camera.updateProjectionMatrix();
  orbit.target.copy(target);
  orbit.update();
  camera.lookAt(orbit.target);
}

/**
 * 정면도(정북) — 카메라가 +Z(남)에 있어 −Z(북)를 바라봄.
 * 씬 규약: +X=동, −Z=북.
 */
export function fitFrontView(
  camera: PerspectiveCamera,
  orbit: OrbitControls,
  object?: THREE.Object3D | null,
  radiusM: number = GROUND_DEFAULT_RADIUS_M
): void {
  let center = new THREE.Vector3(0, 0, 0);
  let spanX = Math.max(4, radiusM * 2);
  let spanY = Math.max(2, radiusM * 0.4);

  if (object) {
    const box = new THREE.Box3().setFromObject(object);
    if (!box.isEmpty()) {
      center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      spanX = Math.max(size.x, 4);
      spanY = Math.max(size.y, 2);
    }
  }

  const fov = (camera.fov * Math.PI) / 180;
  const fitH = spanY / (2 * Math.tan(fov / 2));
  const fitW = spanX / (2 * Math.tan(fov / 2) * Math.max(0.2, camera.aspect || 1));
  const dist = Math.max(fitH, fitW) * 1.35;

  camera.near = 0.1;
  camera.far = Math.max(800, dist * 30);
  camera.up.set(0, 1, 0);
  // 남쪽(+Z)에서 북쪽(−Z)을 봄 = 정북 방향 정면도
  camera.position.set(center.x, center.y, center.z + dist);
  camera.updateProjectionMatrix();
  orbit.target.copy(center);
  orbit.update();
  camera.lookAt(orbit.target);
}

/**
 * 단면도 — 절단선이 화면 가로(정면)가 되도록 라인 수직 방향에서 봄.
 */
export function fitSectionLineView(
  camera: PerspectiveCamera,
  orbit: OrbitControls,
  object: THREE.Object3D,
  props: ShapeProps
): void {
  const field = props.groundHeightField;
  const line = props.groundSectionLine;
  if (!field || !line) {
    fitFrontView(camera, orbit, object);
    return;
  }
  const axes = sectionAxesFromField(field, line);
  if (!axes) {
    fitFrontView(camera, orbit, object);
    return;
  }

  const box = new THREE.Box3().setFromObject(object);
  const center = box.isEmpty()
    ? new THREE.Vector3(
        axes.midX,
        elevToSceneY(sectionSurfaceElevM(field, line)),
        axes.midZ
      )
    : box.getCenter(new THREE.Vector3());
  const size = box.isEmpty()
    ? new THREE.Vector3(axes.halfLenM * 2, 20, axes.halfWidthM * 2)
    : box.getSize(new THREE.Vector3());

  // 화면에 라인(along)이 가로로 → 카메라 시선 = 수평 perp
  const spanAlong = Math.max(size.x, size.z, axes.halfLenM * 2, 4);
  const spanY = Math.max(size.y, 4);
  const fov = (camera.fov * Math.PI) / 180;
  const fitH = spanY / (2 * Math.tan(fov / 2));
  const fitW = spanAlong / (2 * Math.tan(fov / 2) * Math.max(0.2, camera.aspect || 1));
  const dist = Math.max(fitH, fitW) * 1.4;

  camera.near = 0.1;
  camera.far = Math.max(800, dist * 30);
  camera.up.set(0, 1, 0);
  camera.position.set(
    center.x + axes.perpX * dist,
    center.y + dist * 0.12,
    center.z + axes.perpZ * dist
  );
  camera.updateProjectionMatrix();
  orbit.target.copy(center);
  orbit.update();
  camera.lookAt(orbit.target);
}

/** 지형 한 변이 화면에 들어오도록 — 초기에는 정북 정면도 + 약간 높은 시점 */
export function fitGroundCamera(
  camera: PerspectiveCamera,
  orbit: OrbitControls,
  radiusM: number = GROUND_DEFAULT_RADIUS_M
): void {
  const half = Math.max(4, radiusM);
  const dist = half * 2.8;
  camera.near = 0.1;
  camera.far = Math.max(800, dist * 25);
  camera.up.set(0, 1, 0);
  // 정북(+Z→−Z) 축 정렬, 높만 살짝 올려 지형 입체감
  camera.position.set(0, dist * 0.35, dist);
  camera.updateProjectionMatrix();
  orbit.target.set(0, -Math.min(3, half * 0.08), 0);
  orbit.update();
  camera.lookAt(orbit.target);
}

/**
 * 도형 bounding box에 맞춰 카메라 이동.
 * 지형 단면도면 절단선 정면, 그 외 정북 정면도.
 */
export function fitObjectInView(
  camera: PerspectiveCamera,
  orbit: OrbitControls,
  object: THREE.Object3D,
  _pad = 1.55
): void {
  const props = object.userData[SHAPE_PROPS_KEY] as ShapeProps | undefined;
  if (
    props?.kind === 'ground' &&
    props.groundDrawMode === 'section' &&
    props.groundSectionLine &&
    props.groundHeightField
  ) {
    fitSectionLineView(camera, orbit, object, props);
    return;
  }
  fitFrontView(camera, orbit, object);
}
