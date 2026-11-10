import * as THREE from 'three';

export const SCENE_COMPASS_KEY = 'ggnrSceneCompass';

const LABEL_SCALE = 0.55;

/** 씬: +X=동, -X=서, -Z=북, +Z=남 */
const CARDINALS: { text: string; x: number; z: number }[] = [
  { text: '북', x: 0, z: -1 },
  { text: '남', x: 0, z: 1 },
  { text: '동', x: 1, z: 0 },
  { text: '서', x: -1, z: 0 },
];

function makeCompassSprite(text: string): THREE.Sprite {
  const pad = 8;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xfbbf24 }));
  }
  ctx.font = 'bold 36px "Malgun Gothic", "Nanum Gothic", sans-serif';
  const metrics = ctx.measureText(text);
  const tw = Math.ceil(metrics.width);
  const th = 40;
  canvas.width = tw + pad * 2;
  canvas.height = th + pad * 2;
  ctx.font = 'bold 36px "Malgun Gothic", "Nanum Gothic", sans-serif';
  ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  const r = 8;
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
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(LABEL_SCALE * (w / h), LABEL_SCALE, 1);
  sprite.raycast = () => {};
  return sprite;
}

/**
 * 바닥 격자 가장자리에 동서남북 표기 (월드 고정, 카메라 따라 회전하지 않음).
 * @param gridSize GridHelper size (한 변 길이)
 */
export function createSceneCompass(gridSize = 16): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sceneCompass';
  group.userData[SCENE_COMPASS_KEY] = true;
  const edge = gridSize / 2 + 0.7;
  const y = 0.08;
  for (const c of CARDINALS) {
    const sprite = makeCompassSprite(c.text);
    sprite.position.set(c.x * edge, y, c.z * edge);
    group.add(sprite);
  }
  return group;
}
