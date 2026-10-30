'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DragControls } from 'three/addons/controls/DragControls.js';
import { Plus } from 'lucide-react';
import { call } from '@/lib/api';
import { getWtlLayerShapeDef, isWtlLayerShapeKind } from '@/lib/wtlLayerShapeDefs';
import {
  SHAPE_MODULES,
  cloneDefaults,
  emptyKindCounters,
  getShapeModule,
  shapeHalfExtentY,
} from './threeJs/shapeCatalog';
import {
  createShapeObject,
  disposeShapeGroup,
  findShapeGroup,
  getShapeProps,
  rebuildShapeObject,
  setShapeSelected,
} from './threeJs/createShapeObject';
import { ThreeJsShapeEditModal } from './threeJs/ThreeJsShapeEditModal';
import { ThreeJsGroundEditModal } from './threeJs/ThreeJsGroundEditModal';
import { ThreeJsPipeEditModal } from './threeJs/ThreeJsPipeEditModal';
import { ThreeJsManholeEditModal } from './threeJs/ThreeJsManholeEditModal';
import { LayerShapesFromGroundModal } from './threeJs/LayerShapesFromGroundModal';
import { openOrthoImageInNewTab } from './threeJs/openOrthoImageTab';
import { captureOrthoViews, type OrthoViewImages } from './threeJs/orthoViewCapture';
import type {
  GroundLayerShapeKind,
  ManholeFeature,
  PipeSegment,
  RegisteredShapeRow,
  ShapeKind,
  ShapeProps,
} from './threeJs/shapeTypes';
import {
  GROUND_DEFAULT_RADIUS_M,
  isLineLayerShape,
  isMapAnchoredShape,
  isPointLayerShape,
  MANH_DEFAULT_RADIUS_M,
  PIPE_DEFAULT_RADIUS_M,
  SHAPE_NAME_KEY,
  SHAPE_PROPS_KEY,
  SHAPE_USER_DATA_KEY,
} from './threeJs/shapeTypes';
import { createSceneCompass, SCENE_COMPASS_KEY } from './threeJs/sceneCompass';
import { ViewportCompass } from './threeJs/ViewportCompass';
import { ViewportCameraHud } from './threeJs/ViewportCameraHud';
import { fitGroundCamera, fitObjectInView } from './threeJs/fitGroundCamera';
import {
  sectionCoverRadiusM,
  sectionRectCenter3857,
  sectionRectRing3857,
} from './threeJs/groundSection';

const EMPTY_ORTHO: OrthoViewImages = {
  front: '',
  top: '',
  side: '',
  cross: '',
  long: '',
};

type SceneApi = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  orbit: OrbitControls;
  drag: DragControls;
  shapesRoot: THREE.Object3D;
};

let shapeSeq = 0;

function nextShapeId(): string {
  shapeSeq += 1;
  return `shape-${Date.now()}-${shapeSeq}`;
}

/** 개발자 모드 Three.js 도형 편집·기능 테스트 */
export function ThreeJsContent() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<SceneApi | null>(null);
  const getCamera = useCallback(() => apiRef.current?.camera ?? null, []);
  const getOrbit = useCallback(() => apiRef.current?.orbit ?? null, []);
  const selectedIdRef = useRef<string | null>(null);
  const kindCountersRef = useRef<Record<ShapeKind, number>>(emptyKindCounters());

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editProps, setEditProps] = useState<ShapeProps | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [layerModalGroundId, setLayerModalGroundId] = useState<string | null>(null);
  const [registered, setRegistered] = useState<RegisteredShapeRow[]>([]);
  const [orthoViews, setOrthoViews] = useState<OrthoViewImages>(EMPTY_ORTHO);
  const orthoRefreshRef = useRef(0);
  const refreshOrthoFnRef = useRef<() => void>(() => {});

  /** 등록 목록에서 선택된 도형만 드래그 가능 */
  const syncDragTargets = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    api.drag.objects.length = 0;
    const id = selectedIdRef.current;
    if (!id) return;
    const group = findShapeGroup(api.shapesRoot, id);
    if (group) api.drag.objects.push(group);
  }, []);

  const highlightShape = useCallback(
    (id: string | null) => {
      const api = apiRef.current;
      if (!api) return;

      if (selectedIdRef.current) {
        const prev = findShapeGroup(api.shapesRoot, selectedIdRef.current);
        if (prev) setShapeSelected(prev, false);
      }

      selectedIdRef.current = id;
      setSelectedId(id);

      if (id) {
        const group = findShapeGroup(api.shapesRoot, id);
        if (group) setShapeSelected(group, true);
      }
      syncDragTargets();
    },
    [syncDragTargets]
  );

  const refreshOrthoViews = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    orthoRefreshRef.current += 1;
    const token = orthoRefreshRef.current;
    requestAnimationFrame(() => {
      if (token !== orthoRefreshRef.current) return;
      const cur = apiRef.current;
      if (!cur) return;
      setOrthoViews(captureOrthoViews(cur.scene, cur.shapesRoot));
    });
  }, []);

  refreshOrthoFnRef.current = refreshOrthoViews;

  const toggleSelectRegistered = useCallback(
    (id: string) => {
      if (selectedIdRef.current === id) {
        highlightShape(null);
      } else {
        highlightShape(id);
      }
    },
    [highlightShape]
  );

  const openEditModal = useCallback(
    (id: string) => {
      const api = apiRef.current;
      if (!api) return;
      const group = findShapeGroup(api.shapesRoot, id);
      if (!group) return;
      const props = getShapeProps(group);
      if (!props) return;
      let synced: ShapeProps;
      if (isMapAnchoredShape(props.kind)) {
        group.position.set(0, 0, 0);
        synced = {
          ...props,
          posX: 0,
          posZ: 0,
          floorHeight: 0,
        };
      } else {
        const half = shapeHalfExtentY(props);
        synced = {
          ...props,
          posX: group.position.x,
          posZ: group.position.z,
          floorHeight: Math.max(0, group.position.y - half),
        };
      }
      group.userData[SHAPE_PROPS_KEY] = synced;
      highlightShape(id);
      setEditProps(synced);
      setEditName(String(group.userData[SHAPE_NAME_KEY] ?? getShapeModule(props.kind).label));
      setModalOpen(true);
    },
    [highlightShape]
  );

  const addShape = useCallback(
    (kind: ShapeKind) => {
      const api = apiRef.current;
      if (!api) return;
      // 상수 레이어 도형: 지형 «레이어 도형 생성»만 허용
      if (isWtlLayerShapeKind(kind)) return;
      const id = nextShapeId();
      const n = api.shapesRoot.children.length;
      const props = cloneDefaults(kind);
      props.posX = (n % 4) * 1.4 - 2.1;
      props.posZ = 0;
      props.floorHeight = 0;
      if (kind === 'ground') {
        props.groundRadiusM = GROUND_DEFAULT_RADIUS_M;
        props.groundHeightField = null;
        props.posX = 0;
        props.posZ = 0;
      }
      if (isLineLayerShape(kind)) {
        props.pipeRadiusM = PIPE_DEFAULT_RADIUS_M;
        props.pipeSegments = null;
        props.posX = 0;
        props.posZ = 0;
      }
      if (isPointLayerShape(kind)) {
        props.manhRadiusM = MANH_DEFAULT_RADIUS_M;
        props.manholeFeatures = null;
        props.posX = 0;
        props.posZ = 0;
      }
      kindCountersRef.current[kind] += 1;
      const name = `${getShapeModule(kind).label}_${kindCountersRef.current[kind]}`;
      const group = createShapeObject(id, props);
      group.userData[SHAPE_NAME_KEY] = name;
      api.shapesRoot.add(group);
      setRegistered((prev) => [...prev, { id, kind, name }]);
      highlightShape(id);
      refreshOrthoViews();
    },
    [highlightShape, refreshOrthoViews]
  );

  const previewEdit = useCallback((next: ShapeProps) => {
    const api = apiRef.current;
    const id = selectedIdRef.current;
    if (!api || !id) return;
    const group = findShapeGroup(api.shapesRoot, id);
    if (!group) return;
    rebuildShapeObject(group, next);
    setShapeSelected(group, true);
    if (isMapAnchoredShape(next.kind)) {
      fitObjectInView(api.camera, api.orbit, group);
    }
    refreshOrthoViews();
  }, [refreshOrthoViews]);

  const saveEdit = useCallback(
    (next: ShapeProps) => {
      const api = apiRef.current;
      const id = selectedIdRef.current;
      if (!api || !id) return;
      const group = findShapeGroup(api.shapesRoot, id);
      if (!group) return;
      rebuildShapeObject(group, next);
      setShapeSelected(group, true);
      setEditProps({ ...next });
      if (isMapAnchoredShape(next.kind)) {
        fitObjectInView(api.camera, api.orbit, group);
      }
      syncDragTargets();
      refreshOrthoViews();
    },
    [syncDragTargets, refreshOrthoViews]
  );

  /** 등록 도형 bounding box로 뷰 이동 */
  const focusShape = useCallback((id: string) => {
    const api = apiRef.current;
    if (!api) return;
    const group = findShapeGroup(api.shapesRoot, id);
    if (!group) return;
    highlightShape(id);
    fitObjectInView(api.camera, api.orbit, group);
  }, [highlightShape]);

  /** 지형과 동일 범위로 선택한 레이어 도형 추가 */
  const addLayerShapesFromGround = useCallback(
    async (groundId: string, kinds: GroundLayerShapeKind[]) => {
      const api = apiRef.current;
      if (!api || !kinds.length) return;
      const groundGroup = findShapeGroup(api.shapesRoot, groundId);
      if (!groundGroup) return;
      const gProps = getShapeProps(groundGroup);
      if (!gProps || gProps.kind !== 'ground') return;

      const isSection =
        gProps.groundDrawMode === 'section' && gProps.groundSectionLine != null;
      const sectionLine = gProps.groundSectionLine ?? null;
      const heightField = gProps.groundHeightField
        ? (JSON.parse(JSON.stringify(gProps.groundHeightField)) as NonNullable<
            ShapeProps['groundHeightField']
          >)
        : null;

      // 지형 격자와 동일 원점 — 단면도에서도 field.center 사용 (덮는 정사각과 어긋나지 않게)
      let cx = heightField?.centerX ?? gProps.groundCenterX;
      let cy = heightField?.centerY ?? gProps.groundCenterY;
      let radiusM =
        heightField?.radiusM ??
        gProps.groundRadiusM ??
        PIPE_DEFAULT_RADIUS_M;
      let polygon3857: [number, number][] | undefined;

      if (isSection && sectionLine) {
        polygon3857 = sectionRectRing3857(sectionLine);
        if (cx == null || cy == null) {
          const center = sectionRectCenter3857(sectionLine);
          cx = center[0];
          cy = center[1];
        }
        if (!heightField?.radiusM) {
          radiusM = sectionCoverRadiusM(sectionLine);
        }
      }

      if (cx == null || cy == null || !Number.isFinite(cx) || !Number.isFinite(cy)) {
        window.alert('지형 범위를 먼저 생성한 뒤 레이어 도형을 추가하세요.');
        return;
      }

      const extentParams = {
        x: cx,
        y: cy,
        srid: 3857,
        radiusM,
        ...(polygon3857 ? { polygon3857 } : {}),
      };

      const notes: string[] = [];
      let lastId: string | null = null;

      for (const kind of kinds) {
        const def = getWtlLayerShapeDef(kind);
        if (!def) continue;
        try {
          if (isLineLayerShape(kind)) {
            const pipeRes = await call('', 'POST', {
              service: 'elevationService',
              action: 'getWtlLineLayerInExtent',
              params: { ...extentParams, table: kind },
            });
            const pipeData = (pipeRes?.data ?? pipeRes) as {
              success?: boolean;
              pipes?: PipeSegment[];
              error?: string;
            };
            if (!pipeData?.success) {
              notes.push(pipeData?.error ?? `${def.label} 조회 실패`);
              continue;
            }
            const pipes = Array.isArray(pipeData.pipes) ? pipeData.pipes : [];
            if (!pipes.length) {
              notes.push(`${def.label} 없음`);
              continue;
            }
            const id = nextShapeId();
            const props = cloneDefaults(kind);
            props.pipeCenterX = cx;
            props.pipeCenterY = cy;
            props.pipeRadiusM = radiusM;
            props.pipeSegments = pipes;
            props.pipeHeightField = heightField;
            props.groundDrawMode = isSection ? 'section' : 'extent';
            props.groundSectionLine = isSection ? sectionLine : null;
            props.posX = 0;
            props.posZ = 0;
            props.floorHeight = 0;
            kindCountersRef.current[kind] += 1;
            const name = `${getShapeModule(kind).label}_${kindCountersRef.current[kind]}`;
            const group = createShapeObject(id, props);
            group.userData[SHAPE_NAME_KEY] = name;
            api.shapesRoot.add(group);
            setRegistered((prev) => [...prev, { id, kind, name }]);
            lastId = id;
            notes.push(`${def.label} ${pipes.length}건`);
          } else if (isPointLayerShape(kind)) {
            const manhRes = await call('', 'POST', {
              service: 'elevationService',
              action: 'getWtlPointLayerInExtent',
              params: { ...extentParams, table: kind },
            });
            const manhData = (manhRes?.data ?? manhRes) as {
              success?: boolean;
              manholes?: ManholeFeature[];
              error?: string;
            };
            if (!manhData?.success) {
              notes.push(manhData?.error ?? `${def.label} 조회 실패`);
              continue;
            }
            const manholes = Array.isArray(manhData.manholes)
              ? manhData.manholes
              : [];
            if (!manholes.length) {
              notes.push(`${def.label} 없음`);
              continue;
            }
            const id = nextShapeId();
            const props = cloneDefaults(kind);
            props.manhCenterX = cx;
            props.manhCenterY = cy;
            props.manhRadiusM = radiusM;
            props.manholeFeatures = manholes;
            props.manhHeightField = heightField;
            props.groundDrawMode = isSection ? 'section' : 'extent';
            props.groundSectionLine = isSection ? sectionLine : null;
            props.posX = 0;
            props.posZ = 0;
            props.floorHeight = 0;
            kindCountersRef.current[kind] += 1;
            const name = `${getShapeModule(kind).label}_${kindCountersRef.current[kind]}`;
            const group = createShapeObject(id, props);
            group.userData[SHAPE_NAME_KEY] = name;
            api.shapesRoot.add(group);
            setRegistered((prev) => [...prev, { id, kind, name }]);
            lastId = id;
            notes.push(`${def.label} ${manholes.length}건`);
          }
        } catch (e) {
          notes.push(
            e instanceof Error ? e.message : `${def.label} 조회 오류`
          );
        }
      }

      if (lastId) {
        highlightShape(lastId);
        const g = findShapeGroup(api.shapesRoot, lastId);
        if (g) fitObjectInView(api.camera, api.orbit, g);
      }
      refreshOrthoViews();
      if (notes.length) window.alert(notes.join('\n'));
    },
    [highlightShape, refreshOrthoViews]
  );

  const rollbackEdit = useCallback((snapshot: ShapeProps) => {
    const api = apiRef.current;
    const id = selectedIdRef.current;
    if (!api || !id) return;
    const group = findShapeGroup(api.shapesRoot, id);
    if (!group) return;
    rebuildShapeObject(group, snapshot);
    setShapeSelected(group, true);
    setEditProps({ ...snapshot });
    refreshOrthoViews();
  }, [refreshOrthoViews]);

  const deleteSelected = useCallback(() => {
    const api = apiRef.current;
    const id = selectedIdRef.current;
    if (!api || !id) return;
    const group = findShapeGroup(api.shapesRoot, id);
    if (!group) return;
    api.shapesRoot.remove(group);
    disposeShapeGroup(group);
    selectedIdRef.current = null;
    setSelectedId(null);
    setEditProps(null);
    setModalOpen(false);
    setRegistered((prev) => prev.filter((r) => r.id !== id));
    syncDragTargets();
    refreshOrthoViews();
  }, [syncDragTargets, refreshOrthoViews]);

  const resetFrontView = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    // 선택 도형 우선(단면도=절단선 정면). 없으면 전체·정북.
    const id = selectedIdRef.current;
    if (id) {
      const group = findShapeGroup(api.shapesRoot, id);
      if (group) {
        fitObjectInView(api.camera, api.orbit, group);
        return;
      }
    }
    if (api.shapesRoot.children.length > 0) {
      fitObjectInView(api.camera, api.orbit, api.shapesRoot);
    } else {
      fitGroundCamera(api.camera, api.orbit, GROUND_DEFAULT_RADIUS_M);
    }
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const width = host.clientWidth || 640;
    const height = Math.max(host.clientHeight, 360);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1e);

    const gridSize = Math.max(20, GROUND_DEFAULT_RADIUS_M * 2);
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    host.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(5, 8, 3);
    // 반대편 보조광 — 정북 정면도 등에서 관로가 실루엣만 남는 현상 완화
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-4, 5, -6);
    scene.add(ambient, dir, fill);

    const grid = new THREE.GridHelper(gridSize, 20, 0x555555, 0x333333);
    scene.add(grid);

    const compass = createSceneCompass(gridSize);
    scene.add(compass);

    const shapesRoot = new THREE.Object3D();
    shapesRoot.name = 'shapesRoot';
    scene.add(shapesRoot);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    fitGroundCamera(camera, orbit, GROUND_DEFAULT_RADIUS_M);

    const drag = new DragControls([], camera, renderer.domElement);
    drag.recursive = true;
    drag.transformGroup = true;
    drag.addEventListener('dragstart', () => {
      orbit.enabled = false;
    });
    drag.addEventListener('drag', (ev) => {
      const obj = ev.object;
      if (!(obj instanceof THREE.Group)) return;
      const props = getShapeProps(obj);
      if (!props) return;
      if (isMapAnchoredShape(props.kind)) {
        obj.position.set(0, 0, 0);
        obj.userData[SHAPE_PROPS_KEY] = { ...props, posX: 0, posZ: 0 };
      } else {
        const half = shapeHalfExtentY(props);
        const floor = Math.max(0, props.floorHeight ?? 0);
        obj.position.y = floor + half;
        obj.userData[SHAPE_PROPS_KEY] = {
          ...props,
          posX: obj.position.x,
          posZ: obj.position.z,
        };
      }
    });
    drag.addEventListener('dragend', () => {
      orbit.enabled = true;
      refreshOrthoFnRef.current();
    });

    apiRef.current = {
      scene,
      camera,
      renderer,
      orbit,
      drag,
      shapesRoot,
    };

    let raf = 0;
    const tick = () => {
      orbit.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    const onResize = () => {
      if (!hostRef.current) return;
      const w = hostRef.current.clientWidth || width;
      const h = Math.max(hostRef.current.clientHeight, 360);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      drag.dispose();
      orbit.dispose();
      for (const child of [...shapesRoot.children]) {
        if (child instanceof THREE.Group) disposeShapeGroup(child);
        shapesRoot.remove(child);
      }
      compass.traverse((o) => {
        if (o instanceof THREE.Sprite) {
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
      scene.remove(compass);
      renderer.dispose();
      if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement);
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    refreshOrthoViews();
  }, [registered, refreshOrthoViews]);

  const orthoFrontSrc = orthoViews.front || undefined;
  const orthoTopSrc = orthoViews.top || undefined;
  const orthoSideSrc = orthoViews.side || undefined;
  const orthoCrossSrc = orthoViews.cross || undefined;
  const orthoLongSrc = orthoViews.long || undefined;

  return (
    <div className="flex min-h-0 flex-1 gap-2 p-2">
      <aside className="flex w-[22rem] shrink-0 flex-col gap-2 rounded border border-border bg-muted/20 p-2">
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
          <div className="flex min-h-0 flex-col gap-1">
            <p className="text-xs font-medium text-foreground">도형 목록</p>
            <ul className="flex flex-col gap-1">
              {SHAPE_MODULES.filter((mod) => !isWtlLayerShapeKind(mod.kind)).map(
                (mod) => (
                <li
                  key={mod.kind}
                  className="flex items-center justify-between gap-1 rounded border border-border/60 bg-background px-2 py-1.5"
                >
                  <span className="text-[12px] text-foreground">{mod.label}</span>
                  <button
                    type="button"
                    className="inline-flex cursor-pointer items-center gap-0.5 rounded px-1.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                    title="추가"
                    onClick={() => addShape(mod.kind)}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    추가
                  </button>
                </li>
              )
              )}
            </ul>
          </div>

          <div className="flex min-h-0 flex-col gap-1">
            <p className="text-xs font-medium text-foreground">등록 도형</p>
            <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
              {registered.length === 0 ? (
                <li className="px-1 text-[11px] text-muted-foreground">없음</li>
              ) : (
                registered.map((row) => (
                  <li
                    key={row.id}
                    className={`flex cursor-pointer items-center justify-between gap-1 rounded border px-2 py-1.5 ${
                      selectedId === row.id
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border/60 bg-background'
                    }`}
                    title={`${row.name} 선택`}
                    onClick={() => toggleSelectRegistered(row.id)}
                  >
                    <span className="min-w-0 truncate text-[12px] text-foreground" title={row.name}>
                      {row.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        className="inline-flex cursor-pointer items-center rounded px-1.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                        title="뷰 이동"
                        onClick={(e) => {
                          e.stopPropagation();
                          focusShape(row.id);
                        }}
                      >
                        뷰
                      </button>
                      {row.kind === 'ground' ? (
                        <button
                          type="button"
                          className="inline-flex cursor-pointer items-center rounded px-1.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                          title="레이어 도형 생성"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLayerModalGroundId(row.id);
                          }}
                        >
                          레이어 도형 생성
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="inline-flex cursor-pointer items-center rounded px-1.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                        title="수정"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditModal(row.id);
                        }}
                      >
                        수정
                      </button>
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        <button
          type="button"
          className="inline-flex cursor-pointer items-center justify-center rounded border border-primary bg-primary px-2 py-1.5 text-[11px] font-medium text-white hover:bg-primary/90"
          title="정면도(정북) 방향으로 보기"
          onClick={resetFrontView}
        >
          정면도 방향
        </button>

        <p className="text-[11px] leading-snug text-muted-foreground">
          등록 목록에서 선택·재선택(해제)하면 CAD 치수가 표시됩니다. 정면·평면·측면은 3D 직교.
          횡단면=절단선 원단면, 종단면=관로 진행 프로필입니다.
        </p>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <div className="grid shrink-0 grid-cols-5 gap-1.5">
          {(
            [
              { key: 'front', label: '정면도', src: orthoFrontSrc },
              { key: 'top', label: '평면도', src: orthoTopSrc },
              { key: 'side', label: '측면도', src: orthoSideSrc },
              { key: 'cross', label: '횡단면도', src: orthoCrossSrc },
              { key: 'long', label: '종단면도', src: orthoLongSrc },
            ] as const
          ).map((panel) => (
            <div
              key={panel.key}
              className="overflow-hidden rounded border border-border bg-muted/20"
            >
              <p className="border-b border-border bg-muted/40 px-2 py-0.5 text-center text-[10px] font-medium text-foreground">
                {panel.label}
              </p>
              {panel.src ? (
                <button
                  type="button"
                  className="block w-full cursor-pointer border-0 bg-transparent p-0"
                  title={`${panel.label} 새 탭에서 크게 보기`}
                  onClick={() => void openOrthoImageInNewTab(panel.src!, panel.label)}
                >
                  <img
                    src={panel.src}
                    alt={panel.label}
                    className="block h-[100px] w-full object-contain bg-[#1a1a1e] pointer-events-none"
                    draggable={false}
                  />
                </button>
              ) : (
                <div className="flex h-[100px] items-center justify-center text-[11px] text-muted-foreground">
                  —
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="relative min-h-[280px] min-w-0 flex-1 overflow-hidden rounded border border-border bg-muted/20">
          <div ref={hostRef} className="absolute inset-0" />
          <ViewportCameraHud getCamera={getCamera} getOrbit={getOrbit} />
          <ViewportCompass getCamera={getCamera} />
        </div>
      </div>

      {editProps?.kind === 'ground' ? (
        <ThreeJsGroundEditModal
          open={modalOpen}
          titleName={editName}
          props={editProps}
          onOpenChange={setModalOpen}
          onPreview={previewEdit}
          onSave={saveEdit}
          onRollback={rollbackEdit}
          onDelete={deleteSelected}
        />
      ) : editProps && isLineLayerShape(editProps.kind) ? (
        <ThreeJsPipeEditModal
          open={modalOpen}
          titleName={editName}
          props={editProps}
          onOpenChange={setModalOpen}
          onPreview={previewEdit}
          onSave={saveEdit}
          onRollback={rollbackEdit}
          onDelete={deleteSelected}
        />
      ) : editProps && isPointLayerShape(editProps.kind) ? (
        <ThreeJsManholeEditModal
          open={modalOpen}
          titleName={editName}
          props={editProps}
          onOpenChange={setModalOpen}
          onPreview={previewEdit}
          onSave={saveEdit}
          onRollback={rollbackEdit}
          onDelete={deleteSelected}
        />
      ) : (
        <ThreeJsShapeEditModal
          open={modalOpen}
          titleName={editName}
          props={editProps}
          onOpenChange={setModalOpen}
          onPreview={previewEdit}
          onSave={saveEdit}
          onRollback={rollbackEdit}
          onDelete={deleteSelected}
        />
      )}

      <LayerShapesFromGroundModal
        open={layerModalGroundId != null}
        groundName={
          layerModalGroundId
            ? registered.find((r) => r.id === layerModalGroundId)?.name
            : undefined
        }
        onOpenChange={(o) => {
          if (!o) setLayerModalGroundId(null);
        }}
        onCreate={async (kinds) => {
          if (!layerModalGroundId) return;
          await addLayerShapesFromGround(layerModalGroundId, kinds);
        }}
      />
    </div>
  );
}
