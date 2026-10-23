import * as THREE from 'three';
import { SCENE_COMPASS_KEY } from './sceneCompass';

/** 화면 썸네일과 별도 — 새 탭에서 크게 보기용 고해상도 */
export const ORTHO_SNAP_W = 1600;
export const ORTHO_SNAP_H = 1200;
const SNAP_W = ORTHO_SNAP_W;
const SNAP_H = ORTHO_SNAP_H;
const BG = 0x1a1a1e;

type ViewKind = 'front' | 'top' | 'side';

function fitOrthoCamera(
  cam: THREE.OrthographicCamera,
  box: THREE.Box3,
  view: ViewKind,
  pad = 1.25
): void {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.5);
  const dist = maxDim * 2.5;

  // 씬: +X=동, −Z=북
  // 정면도=정북(+Z에서 −Z), 평면도=북이 화면 위, 측면도=동에서 서를 봄
  if (view === 'front') {
    cam.position.set(center.x, center.y, center.z + dist);
    cam.up.set(0, 1, 0);
  } else if (view === 'top') {
    cam.position.set(center.x, center.y + dist, center.z);
    cam.up.set(0, 0, -1);
  } else {
    cam.position.set(center.x + dist, center.y, center.z);
    cam.up.set(0, 1, 0);
  }
  cam.lookAt(center);
  cam.updateMatrixWorld();

  let viewW = maxDim;
  let viewH = maxDim;
  if (view === 'front') {
    // 정북: 가로=동서(X), 세로=높이(Y)
    viewW = size.x;
    viewH = size.y;
  } else if (view === 'top') {
    // 북이 위: 가로=동서(X), 세로=남북(Z)
    viewW = size.x;
    viewH = size.z;
  } else {
    // 동→서: 가로=남북(Z), 세로=높이(Y)
    viewW = size.z;
    viewH = size.y;
  }
  viewW = Math.max(viewW * pad, 0.8);
  viewH = Math.max(viewH * pad, 0.8);
  const aspect = SNAP_W / SNAP_H;
  if (viewW / viewH > aspect) {
    const half = viewW / 2;
    cam.left = -half;
    cam.right = half;
    cam.top = half / aspect;
    cam.bottom = -half / aspect;
  } else {
    const half = viewH / 2;
    cam.top = half;
    cam.bottom = -half;
    cam.left = -half * aspect;
    cam.right = half * aspect;
  }
  cam.near = 0.01;
  cam.far = dist * 4;
  cam.updateProjectionMatrix();
}

function renderOne(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  view: ViewKind,
  box: THREE.Box3
): string {
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 500);
  fitOrthoCamera(cam, box, view);
  renderer.render(scene, cam);
  return renderer.domElement.toDataURL('image/png');
}

const EMPTY_PNG =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect fill="#1a1a1e" width="100%" height="100%"/><text x="50%" y="50%" fill="#666" font-size="12" text-anchor="middle" dominant-baseline="middle">도형 없음</text></svg>'
  );

export type OrthoViewImages = {
  front: string;
  top: string;
  side: string;
};

let snapRenderer: THREE.WebGLRenderer | null = null;

function getSnapRenderer(): THREE.WebGLRenderer {
  if (!snapRenderer) {
    snapRenderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false,
    });
    snapRenderer.setPixelRatio(1);
  }
  snapRenderer.setSize(SNAP_W, SNAP_H);
  return snapRenderer;
}

/** 씬을 정면도·평면도·측면도 시점으로 렌더해 PNG data URL 반환 */
export function captureOrthoViews(scene: THREE.Scene, shapesRoot: THREE.Object3D): OrthoViewImages {
  const box = new THREE.Box3();
  for (const child of shapesRoot.children) {
    box.expandByObject(child);
  }
  if (box.isEmpty()) {
    return { front: EMPTY_PNG, top: EMPTY_PNG, side: EMPTY_PNG };
  }

  const renderer = getSnapRenderer();
  const prevBg = scene.background;
  scene.background = new THREE.Color(BG);

  const grid = scene.children.find((c) => c instanceof THREE.GridHelper);
  const gridVisible = grid?.visible ?? true;
  if (grid) grid.visible = false;

  const compass = scene.children.find((c) => c.userData?.[SCENE_COMPASS_KEY]);
  const compassVisible = compass?.visible ?? true;
  if (compass) compass.visible = false;

  // 치수는 위치만 조정해 캡처에 포함(정면도 등에서 외곽선과 겹치지 않도록 cadDimensions에서 배치)
  const front = renderOne(renderer, scene, 'front', box);
  const top = renderOne(renderer, scene, 'top', box);
  const side = renderOne(renderer, scene, 'side', box);

  if (grid) grid.visible = gridVisible;
  if (compass) compass.visible = compassVisible;
  scene.background = prevBg;

  return { front, top, side };
}
