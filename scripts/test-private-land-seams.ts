/**
 * 사유지분석 — 접선(도형끼리 맞닿은 경계)에 시작·끝선을 맞추는 경우별 회귀 검사.
 * 실행: npm run test:private-land
 * 새 경우를 고칠 때 여기에 경우를 추가하고, 기존 경우가 모두 통과하는지 확인한다.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Coordinate } from 'ol/coordinate';
import Polygon from 'ol/geom/Polygon';
import {
  collectSegments,
  seamChordNear,
  shortestChordAt,
  type Chord,
  type Seam,
} from '../src/app/(pages)/map/_mapContents/privateLandAnalysis/privateLandAnalysisGeom';

const SNAP = 3;

/** 합친 바깥 면(꼭짓점 목록)과 접선으로 커서 위치에서 맞춘 선 */
function snap(outer: Coordinate[], seams: Seam[], cursor: Coordinate, minEdgeTol = 0): Chord | null {
  const geom = new Polygon([[...outer, outer[0]]]);
  const segs = collectSegments(geom);
  const width = shortestChordAt(geom, segs, cursor);
  return seamChordNear(seams, cursor, SNAP, width, segs, minEdgeTol);
}

/** 접선을 n 토막으로 끊음 — 실데이터에서 이웃 도형 꼭짓점이 어긋나 접선이 여러 토막으로 나뉘는 경우 */
function splitSeam(line: Seam, n: number): Seam[] {
  const out: Seam[] = [];
  for (const [i, a] of line.slice(0, -1).entries()) {
    const b = line[i + 1];
    let prev = a;
    for (let k = 1; k <= n; k += 1) {
      const q: Coordinate = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      out.push([prev, q]);
      prev = q;
    }
  }
  return out;
}

function pts(c: Chord): Coordinate[] {
  return c.path ?? [c[0], c[1]];
}

function near(a: Coordinate, b: Coordinate, tol = 0.01): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
}

function assertEnds(c: Chord | null, a: Coordinate, b: Coordinate) {
  assert.ok(c, '접선에 맞춘 선이 없음');
  const ok = (near(c[0], a) && near(c[1], b)) || (near(c[0], b) && near(c[1], a));
  assert.ok(ok, `양끝 ${JSON.stringify([c[0], c[1]])} — 기대 ${JSON.stringify([a, b])}`);
}

test('곧은 접선 — 둑에 수직으로 닿으면 접선 양끝 그대로, 늘이지 않음', () => {
  const outer: Coordinate[] = [[0, 0], [20, 0], [20, 100], [0, 100]];
  const c = snap(outer, [[[0, 50], [20, 50]]], [10, 51]);
  assertEnds(c, [0, 50], [20, 50]);
  assert.equal(pts(c!).length, 2);
});

test('이웃 도형이 먼저 끝남 — 바깥 경계가 곧게 이어지면 꺾이는 곳까지 따라 늘임', () => {
  /** 위 도형 폭 40, 아래 도형 폭 20 — 접선은 0~20, 위 도형 아래 경계는 40까지 */
  const outer: Coordinate[] = [[0, 0], [20, 0], [20, 50], [40, 50], [40, 100], [0, 100]];
  const c = snap(outer, [[[0, 50], [20, 50]]], [10, 51]);
  assertEnds(c, [0, 50], [40, 50]);
});

test('이웃 도형이 먼저 끝남 — 늘일 길이가 접선보다 2배 넘게 길어도 따라감', () => {
  /** 아래 도형 폭 10, 위 도형 폭 35 — 화면 사례처럼 접선보다 늘이는 구간이 김 */
  const outer: Coordinate[] = [[0, 0], [10, 0], [10, 50], [35, 50], [35, 100], [0, 100]];
  const c = snap(outer, [[[0, 50], [10, 50]]], [5, 51]);
  assertEnds(c, [0, 50], [35, 50]);
});

test('세 도형이 만나는 점 — 가장 곧게 이어지는 토막을 이음', () => {
  const outer: Coordinate[] = [[0, 0], [20, 0], [20, 100], [0, 100]];
  const seams: Seam[] = [
    [[0, 50], [8, 50]],
    [[8, 0], [8, 50]],
    [[8, 50], [20, 50]],
  ];
  const c = snap(outer, seams, [4, 51]);
  assertEnds(c, [0, 50], [20, 50]);
});

test('한 번 꺾인 접선(ㄴ자에 가까움) — 모양 그대로 선택, 늘이지 않음', () => {
  const outer: Coordinate[] = [[0, 0], [20, 0], [20, 100], [0, 100]];
  const c = snap(outer, [[[0, 50], [10, 45], [20, 50]]], [10, 46]);
  assertEnds(c, [0, 50], [20, 50]);
  assert.equal(pts(c!).length, 3);
});

test('지류 끝이 큰 하천 안으로 들어온 ㄷ자 접선 — 모양 그대로, 지류 둑으로 늘이지 않음', () => {
  /** 큰 하천 x 0~40 세로, 지류는 왼쪽에서 y 88~112 로 들어와 x 15 까지 끝이 들어옴 */
  const outer: Coordinate[] = [
    [0, 0], [40, 0], [40, 200], [0, 200], [0, 112], [-100, 112], [-100, 88], [0, 88],
  ];
  const u: Seam = [[0, 112], [15, 112], [15, 88], [0, 88]];
  const c = snap(outer, [u], [8, 113]);
  assertEnds(c, [0, 112], [0, 88]);
  assert.equal(pts(c!).length, 4);
});

test('합류부 꼭짓점 근처 — 커서 위치 폭이 짧아도 접선 선택', () => {
  /** 큰 하천 x 0~40 세로, 오른쪽 위로 지류가 갈라짐. 두 하천 사이 V자 꼭짓점 (40,120) */
  const outer: Coordinate[] = [
    [0, 0], [40, 0], [40, 100], [100, 160], [90, 170], [40, 120], [40, 200], [0, 200],
  ];
  const seam: Seam = [[40, 120], [50, 110], [40, 100]];
  const c = snap(outer, [seam], [41, 117]);
  assertEnds(c, [40, 120], [40, 100]);
});

/** 넓은 하천을 꺾이며 가로지르는 긴 접선, 위쪽 끝은 위로 이어진 수로 밑변을 따라 바깥 경계에 닿음 */
const WIDE_OUTER: Coordinate[] = [
  [0, 0], [400, 0], [400, 230], [185, 230], [185, 300], [90, 300], [90, 230], [0, 230],
];
const WIDE_SEAM: Seam = [[90, 230], [152, 232], [155, 170], [163, 90], [190, 80], [213, 0]];

test('넓은 하천을 꺾이며 가로지르는 긴 접선 — 모양 그대로 선택', () => {
  const c = snap(WIDE_OUTER, [WIDE_SEAM], [157, 150]);
  assertEnds(c, [90, 230], [213, 0]);
  assert.equal(pts(c!).length, WIDE_SEAM.length);
});

test('긴 접선이 여러 토막으로 끊겨 있어도 이어서 선택', () => {
  const c = snap(WIDE_OUTER, splitSeam(WIDE_SEAM, 4), [157, 150]);
  assertEnds(c, [90, 230], [213, 0]);
});

test('화면 축소로 단순화돼 접선 끝이 바깥 경계에서 살짝 떨어져도 선택', () => {
  /** 폭 20 하천, 접선 양끝이 경계에서 1.5 떨어짐 — 해상도 1 기준 단순화 오차 */
  const outer: Coordinate[] = [[0, 0], [20, 0], [20, 100], [0, 100]];
  const seam: Seam = [[1.5, 50], [18.5, 50]];
  assert.equal(snap(outer, [seam], [10, 51]), null);
  assertEnds(snap(outer, [seam], [10, 51], 2), [1.5, 50], [18.5, 50]);
});

test('하천을 따라 길게 난 경계 — 선택하지 않음', () => {
  const outer: Coordinate[] = [[0, 0], [20, 0], [20, 200], [0, 200]];
  const c = snap(outer, [[[10, 0], [10, 200]]], [10.5, 100]);
  assert.equal(c, null);
});

test('접선에서 먼 커서 — 선택하지 않음', () => {
  const outer: Coordinate[] = [[0, 0], [20, 0], [20, 100], [0, 100]];
  const c = snap(outer, [[[0, 50], [20, 50]]], [10, 70]);
  assert.equal(c, null);
});
