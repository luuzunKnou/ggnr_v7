import type { RoadLedgerVideoItem } from "./RoadLedgerVideoViewer";
import type { RoadLedgerVideoTrack } from "./roadLedgerVideoTrack";

export type RoadVideoDirGroup = "up" | "down" | "other";

export type RoadLedgerVideoPlaylist = {
  /** 탭·칩 표시 (상행 / 하행 / 파일명) */
  label: string;
  group: RoadVideoDirGroup;
  /** 분할 번호 오름차순 (1, 2, …) */
  parts: RoadLedgerVideoItem[];
  /** 분석·메타에서 아는 각 파트 길이(초) — 이어붙인 타임라인 힌트 */
  durationHints?: number[];
};

export function parseRoadVideoDirGroup(fileName: string): {
  group: RoadVideoDirGroup;
  part: number;
  label: string;
} {
  if (/상행/.test(fileName)) {
    const m = fileName.match(/상행\s*(\d+)/);
    return { group: "up", part: m ? Number(m[1]) : 1, label: "상행" };
  }
  if (/하행/.test(fileName)) {
    const m = fileName.match(/하행\s*(\d+)/);
    return { group: "down", part: m ? Number(m[1]) : 1, label: "하행" };
  }
  const base = fileName.replace(/\.[^.]+$/, "");
  return { group: "other", part: 1, label: base || fileName };
}

/**
 * 같은 방향(상행·하행) 분할 영상을 하나의 재생 목록으로 묶는다.
 * 예: 상행1+상행2 → «상행», 하행1+하행2 → «하행»
 */
export function groupRoadLedgerVideoPlaylists(
  items: RoadLedgerVideoItem[]
): RoadLedgerVideoPlaylist[] {
  const buckets = new Map<string, { meta: ReturnType<typeof parseRoadVideoDirGroup>; parts: RoadLedgerVideoItem[] }>();
  for (const it of items) {
    const meta = parseRoadVideoDirGroup(it.fileName);
    const key =
      meta.group === "other" ? `other:${it.fileName}` : meta.group;
    const cur = buckets.get(key);
    if (cur) cur.parts.push(it);
    else buckets.set(key, { meta, parts: [it] });
  }
  const order = (g: RoadVideoDirGroup) => (g === "up" ? 0 : g === "down" ? 1 : 2);
  return [...buckets.values()]
    .map(({ meta, parts }) => {
      const sorted = [...parts].sort((a, b) => {
        const pa = parseRoadVideoDirGroup(a.fileName).part;
        const pb = parseRoadVideoDirGroup(b.fileName).part;
        if (pa !== pb) return pa - pb;
        return a.fileName.localeCompare(b.fileName, "ko");
      });
      return {
        label: meta.label,
        group: meta.group,
        parts: sorted,
      } satisfies RoadLedgerVideoPlaylist;
    })
    .sort((a, b) => {
      const d = order(a.group) - order(b.group);
      if (d !== 0) return d;
      return a.label.localeCompare(b.label, "ko");
    });
}

/** 누적 시작 시각 (초) — offsets[i] = part i 시작 */
export function roadVideoPartOffsets(partDurations: number[]): number[] {
  const offsets = [0];
  for (let i = 0; i < partDurations.length; i += 1) {
    offsets.push(offsets[i]! + Math.max(0, partDurations[i] ?? 0));
  }
  return offsets;
}

export function roadVideoGlobalToPart(
  globalSec: number,
  partDurations: number[]
): { partIndex: number; localSec: number } {
  if (partDurations.length === 0) return { partIndex: 0, localSec: 0 };
  const offsets = roadVideoPartOffsets(partDurations);
  const total = offsets[offsets.length - 1]!;
  const t = Math.min(Math.max(0, globalSec), Math.max(0, total));
  for (let i = 0; i < partDurations.length; i += 1) {
    const start = offsets[i]!;
    const end = offsets[i + 1]!;
    if (t < end || i === partDurations.length - 1) {
      return { partIndex: i, localSec: Math.min(Math.max(0, t - start), partDurations[i] ?? 0) };
    }
  }
  const last = partDurations.length - 1;
  return { partIndex: last, localSec: partDurations[last] ?? 0 };
}

/**
 * 분할 분석 결과를 이어붙인 하나의 트랙으로 — 지도 맞춤·탐색에 쓴다.
 * durationSec 는 각 part 트랙 길이(없으면 0) 합.
 */
export function mergeRoadLedgerVideoPartTracks(
  parts: Array<{ track: RoadLedgerVideoTrack | null; durationSec: number }>
): RoadLedgerVideoTrack | null {
  if (parts.length === 0) return null;
  const base = parts.find((p) => p.track)?.track ?? null;
  if (!base) return null;
  if (parts.length === 1) {
    const only = parts[0]!;
    const t = only.track!;
    return {
      ...t,
      durationSec: only.durationSec || t.durationSec,
    };
  }

  let offset = 0;
  const anchors: [number, number][] = [];
  const fronts: number[] = [];
  const loops: [number, number][] = [];
  let hasFront = false;
  let queued = false;
  let status: RoadLedgerVideoTrack["status"] = "done";
  let message: string | undefined;
  let direction = base.direction;
  let analyzedAt = base.analyzedAt;

  for (const part of parts) {
    const t = part.track;
    const dur = Math.max(0, part.durationSec || t?.durationSec || 0);
    if (!t) {
      status = status === "done" ? "none" : status;
      offset += dur;
      continue;
    }
    if (t.queued) queued = true;
    if (t.status === "failed") {
      status = "failed";
      message = t.message ?? message;
    } else if (t.status !== "done" && status === "done") {
      status = t.status;
    }
    if (t.direction) direction = t.direction;
    if (t.analyzedAt) analyzedAt = t.analyzedAt;

    if (t.status === "done" && t.anchors.length >= 2) {
      for (const a of t.anchors) {
        anchors.push([Math.round((a[0] + offset) * 100) / 100, a[1]]);
      }
      if (t.fronts && t.fronts.length === t.anchors.length) {
        hasFront = true;
        fronts.push(...t.fronts);
      } else if (hasFront) {
        for (let i = 0; i < t.anchors.length; i += 1) fronts.push(0);
      }
      for (const [a, b] of t.loops ?? []) {
        loops.push([
          Math.round((a + offset) * 100) / 100,
          Math.round((b + offset) * 100) / 100,
        ]);
      }
    }
    offset += dur;
  }

  if (status === "done" && anchors.length < 2) {
    return {
      ...base,
      status: "none",
      queued,
      durationSec: offset || base.durationSec,
      anchors: [],
      fronts: undefined,
      loops: [],
      message,
    };
  }

  return {
    status,
    queued,
    direction,
    durationSec: offset || base.durationSec,
    routeLengthM: base.routeLengthM,
    line: base.line,
    anchors,
    fronts: hasFront && fronts.length === anchors.length ? fronts : undefined,
    loops,
    message,
    analyzedAt,
  };
}
