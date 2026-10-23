import * as THREE from 'three';
import type { PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GROUND_DEFAULT_RADIUS_M } from './shapeTypes';

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
 * 도형 bounding box에 맞춰 카메라 이동 (지하 관로 포함).
 * 기본은 정북 정면도.
 */
export function fitObjectInView(
  camera: PerspectiveCamera,
  orbit: OrbitControls,
  object: THREE.Object3D,
  _pad = 1.55
): void {
  fitFrontView(camera, orbit, object);
}
