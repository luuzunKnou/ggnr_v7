'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Feature from 'ol/Feature';
import type { Geometry } from 'ol/geom';
import LineString from 'ol/geom/LineString';
import type { Extent } from 'ol/extent';
import { createEmpty, extend, isEmpty } from 'ol/extent';
import Polygon from 'ol/geom/Polygon';
import VectorLayer from 'ol/layer/Vector';
import { transformExtent } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Stroke, Style } from 'ol/style';
import { call } from '@/lib/api';
import { DXF_LABEL, dxfStringToOlFeatures } from '@/lib/dxfToOpenLayers';
import { GEOM_STACK_UI_ZINDEX_MIN } from '@/lib/mapLayerGeometryOrder';
import { scaleMetersFromZoom } from '../../_mapComponents/hooks/mapScale';
import { useMapContext } from '../../_mapComponents/MapContext';
import '../../_mapComponents/config/projections';
import {
  DRAWING_CRS_OPTIONS,
  DRAWING_DEFAULT_CRS,
  type DrawingCrsCode,
} from '../drawingDisplay/drawingDisplayConfig';
import { useDrawingDisplayLayer } from '../drawingDisplay/useDrawingDisplayLayer';
import {
  DIGITAL_MAP_DEFAULT_CRS,
  DIGITAL_MAP_FETCH_CONCURRENCY,
  DIGITAL_MAP_FOOTPRINT_STROKE,
  DIGITAL_MAP_FOOTPRINT_WIDTH,
  DIGITAL_MAP_SHEET_CACHE_MAX,
  resolveDigitalMapDetailLevel,
  type DigitalMapDetailLevel,
} from './digitalMapConfig';

type Sheet = {
  file: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type FolderIndex = {
  folder: string;
  sheets: Sheet[];
  crs?: string;
};

const DRAWING_CRS_SET = new Set<string>(DRAWING_CRS_OPTIONS.map((o) => o.code));

function asDrawingCrs(raw: string | undefined | null): DrawingCrsCode {
  const code = String(raw ?? '').trim();
  if (DRAWING_CRS_SET.has(code)) return code as DrawingCrsCode;
  if (DRAWING_CRS_SET.has(DIGITAL_MAP_DEFAULT_CRS)) return DIGITAL_MAP_DEFAULT_CRS;
  return DRAWING_DEFAULT_CRS;
}

function intersects(a: Extent, b: Extent): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function sheetExtent(s: Sheet): Extent {
  return [s.minX, s.minY, s.maxX, s.maxY];
}

function unionSheets(sheets: Sheet[]): Extent | null {
  if (!sheets.length) return null;
  const e = createEmpty();
  for (const s of sheets) extend(e, sheetExtent(s));
  return isEmpty(e) ? null : e;
}

/** 화면과 겹치는 도엽 전부 (중심 편향·개수 제한 없음) */
function pickSheets(sheets: Sheet[], viewSrc: Extent): Sheet[] {
  return sheets.filter((s) => intersects(viewSrc, sheetExtent(s)));
}

function geomSpan(f: Feature<Geometry>): number {
  const g = f.getGeometry();
  if (!g) return 0;
  if (g.getType() === 'LineString') return (g as LineString).getLength();
  const e = g.getExtent();
  if (!e) return 0;
  return Math.hypot(e[2] - e[0], e[3] - e[1]);
}

/**
 * 도엽 도곽에 가까운 가로·세로 긴 선.
 * LOD에서 길이순만 자르면 도엽마다 세로선이 들쭉날쭉해지므로 우선 포함.
 */
function isSheetFrameLine(f: Feature<Geometry>, sheet: Extent): boolean {
  const g = f.getGeometry();
  if (!g || g.getType() !== 'LineString') return false;
  const coords = (g as LineString).getCoordinates();
  if (!coords || coords.length < 2) return false;
  const [x0, y0] = coords[0];
  const [x1, y1] = coords[coords.length - 1];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sheetW = Math.max(1e-6, sheet[2] - sheet[0]);
  const sheetH = Math.max(1e-6, sheet[3] - sheet[1]);
  const vertical = dy >= sheetH * 0.35 && dx <= sheetW * 0.08;
  const horizontal = dx >= sheetW * 0.35 && dy <= sheetH * 0.08;
  if (!vertical && !horizontal) return false;
  const tol = Math.max(sheetW, sheetH) * 0.04;
  const nearEdge =
    Math.min(x0, x1) <= sheet[0] + tol ||
    Math.max(x0, x1) >= sheet[2] - tol ||
    Math.min(y0, y1) <= sheet[1] + tol ||
    Math.max(y0, y1) >= sheet[3] - tol;
  // 도엽을 가로·세로로 가로지르는 긴 축선도 도곽류로 본다
  const spansSheet = vertical
    ? dy >= sheetH * 0.7
    : dx >= sheetW * 0.7;
  return nearEdge || spansSheet;
}

function labelInView(f: Feature<Geometry>, view: Extent): boolean {
  const g = f.getGeometry();
  if (!g) return false;
  const e = g.getExtent();
  if (!e) return false;
  // 살짝 여유 — 화면 가장자리 글자도 포함
  const padX = (view[2] - view[0]) * 0.05;
  const padY = (view[3] - view[1]) * 0.05;
  return (
    e[0] <= view[2] + padX &&
    e[2] >= view[0] - padX &&
    e[1] <= view[3] + padY &&
    e[3] >= view[1] - padY
  );
}

/** 도엽당: 도곽 가로·세로 먼저, 나머지는 긴 선·화면 안 글자 */
function sampleFeaturesForLevel(
  features: Feature<Geometry>[],
  viewW: number,
  level: DigitalMapDetailLevel,
  sheet: Extent,
  viewSrc: Extent
): Feature<Geometry>[] {
  const minLen = viewW > 0 ? viewW * (level.minSpanRatio || 0) : 0;
  const lineCap = Math.max(0, level.maxFeaturesPerSheet);
  const labelCap = level.showLabels ? Math.max(0, level.maxLabelsPerSheet) : 0;
  if (lineCap <= 0 && labelCap <= 0) return [];

  const frame: Feature<Geometry>[] = [];
  const allLines: Feature<Geometry>[] = [];
  const labels: Feature<Geometry>[] = [];
  const wantFrame = level.includeSheetFrame === true;
  for (const f of features) {
    if (f.get(DXF_LABEL) != null) {
      if (String(f.get(DXF_LABEL) ?? '').trim()) labels.push(f);
      continue;
    }
    if (isSheetFrameLine(f, sheet)) {
      // 240 단계: 도곽 가로·세로 제외. 120부터만 표시
      if (wantFrame) frame.push(f);
      continue;
    }
    allLines.push(f);
  }
  frame.sort((a, b) => geomSpan(b) - geomSpan(a));
  allLines.sort((a, b) => geomSpan(b) - geomSpan(a));
  let rest =
    minLen > 0 ? allLines.filter((f) => geomSpan(f) >= minLen) : allLines;
  if (!rest.length && allLines.length) rest = allLines;

  const out: Feature<Geometry>[] = [];
  const frameKeep = wantFrame ? frame.slice(0, 16) : [];
  for (const f of frameKeep) out.push(f);
  const restBudget = Math.max(0, lineCap);
  for (let i = 0; i < rest.length && out.length < frameKeep.length + restBudget; i++) {
    out.push(rest[i]);
  }
  if (labelCap > 0) {
    // 화면 안 글자 우선, 그다음 긴 문구
    labels.sort((a, b) => {
      const aIn = labelInView(a, viewSrc) ? 0 : 1;
      const bIn = labelInView(b, viewSrc) ? 0 : 1;
      if (aIn !== bIn) return aIn - bIn;
      return (
        String(b.get(DXF_LABEL) ?? '').trim().length -
        String(a.get(DXF_LABEL) ?? '').trim().length
      );
    });
    for (let i = 0; i < labels.length && i < labelCap; i++) {
      out.push(labels[i]);
    }
  }
  return out;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

const EMPTY_HIDDEN = new Set<string>();
const indexCache = new Map<string, FolderIndex>();

async function loadFolderIndex(folder: string): Promise<FolderIndex> {
  const hit = indexCache.get(folder);
  if (hit?.crs && hit.sheets.length > 0) return hit;
  const res = await call('', 'POST', {
    service: 'digitalMapService',
    action: 'getFolderIndex',
    params: { folder },
  });
  if (!res?.success) {
    throw new Error((res as { message?: string })?.message ?? '도엽 목록을 불러오지 못했습니다.');
  }
  const data = (res.data ?? res) as FolderIndex;
  const index: FolderIndex = {
    folder: data.folder ?? folder,
    sheets: Array.isArray(data.sheets) ? data.sheets : [],
    crs: data.crs,
  };
  indexCache.set(folder, index);
  return index;
}

async function fetchDxfText(folder: string, file: string): Promise<string> {
  const q = new URLSearchParams({ folder, file });
  const res = await fetch(`/api/digitalMap/dxf?${q.toString()}`, { credentials: 'include' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `도엽 읽기 실패 (${res.status})`);
  }
  return res.text();
}

function makeFootprintFeature(sheet: Sheet, srcCode: string, mapCode: string): Feature<Polygon> | null {
  const ringSrc: [number, number][] = [
    [sheet.minX, sheet.minY],
    [sheet.maxX, sheet.minY],
    [sheet.maxX, sheet.maxY],
    [sheet.minX, sheet.maxY],
    [sheet.minX, sheet.minY],
  ];
  let ring = ringSrc;
  if (srcCode !== mapCode) {
    try {
      const ext = transformExtent(sheetExtent(sheet), srcCode, mapCode);
      ring = [
        [ext[0], ext[1]],
        [ext[2], ext[1]],
        [ext[2], ext[3]],
        [ext[0], ext[3]],
        [ext[0], ext[1]],
      ];
    } catch {
      return null;
    }
  }
  const f = new Feature({ geometry: new Polygon([ring]) });
  f.set('sheetFile', sheet.file);
  return f;
}

export type DigitalMapFolderLayerStatus = {
  loading: boolean;
  /** true면 축소 상태 — 테두리만, 상세 DXF 없음 */
  outlineOnly: boolean;
  sheetCount: number;
  footprintCount: number;
  error: string | null;
};

/**
 * 폴더 하나 — 축소: 도엽 테두리 / 확대: 화면 안 DXF 상세.
 * 켠 직후 화면에 도엽이 없으면 전체 범위로 맞춘다.
 */
export function useDigitalMapFolderLayer(
  folder: string | null,
  enabled: boolean
): DigitalMapFolderLayerStatus {
  const mapContext = useMapContext();
  const mapRef = mapContext?.mapInstanceRef;
  const [features, setFeatures] = useState<Feature<Geometry>[] | null>(null);
  const [crs, setCrs] = useState<DrawingCrsCode>(DIGITAL_MAP_DEFAULT_CRS ?? DRAWING_DEFAULT_CRS);
  const crsRef = useRef<DrawingCrsCode>(crs);
  crsRef.current = crs;
  const [loading, setLoading] = useState(false);
  const [outlineOnly, setOutlineOnly] = useState(true);
  const [sheetCount, setSheetCount] = useState(0);
  const [footprintCount, setFootprintCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const loadedKeyRef = useRef('');
  const inflightKeyRef = useRef('');
  const fittedRef = useRef(false);
  const detailedFilesRef = useRef<Set<string>>(new Set());
  /** 도엽 파일 → 파싱 Feature (이동 시 재파싱·깜빡임 완화) */
  const sheetFeatCacheRef = useRef(new Map<string, Feature<Geometry>[]>());
  const footprintSourceRef = useRef(new VectorSource({ useSpatialIndex: true }));
  const footprintLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const indexRef = useRef<FolderIndex | null>(null);

  const layerOpts = useMemo(
    () =>
      folder
        ? {
            layerKey: `digital-map-${folder}`,
            imageKey: `digital-map-overview-${folder}`,
            fitView: false as const,
            disableLod: true as const,
          }
        : undefined,
    [folder]
  );

  useDrawingDisplayLayer(
    Boolean(enabled && folder && features?.length),
    enabled && folder ? features : null,
    crs,
    EMPTY_HIDDEN,
    layerOpts
  );

  /** 테두리 레이어 생성·제거 */
  useEffect(() => {
    const map = mapRef?.current;
    if (!map || !enabled || !folder) {
      if (footprintLayerRef.current && mapRef?.current) {
        mapRef.current.removeLayer(footprintLayerRef.current);
      }
      footprintLayerRef.current = null;
      footprintSourceRef.current.clear();
      return;
    }

    if (!footprintLayerRef.current) {
      footprintLayerRef.current = new VectorLayer({
        source: footprintSourceRef.current,
        zIndex: GEOM_STACK_UI_ZINDEX_MIN + 4,
        properties: { id: `digital-map-footprint-${folder}`, geomStackSkip: true },
        style: new Style({
          stroke: new Stroke({
            color: DIGITAL_MAP_FOOTPRINT_STROKE,
            width: DIGITAL_MAP_FOOTPRINT_WIDTH,
          }),
        }),
      });
    }

    const layer = footprintLayerRef.current;
    if (!map.getLayers().getArray().includes(layer)) map.addLayer(layer);

    return () => {
      map.removeLayer(layer);
      footprintSourceRef.current.clear();
      footprintLayerRef.current = null;
    };
  }, [mapRef, enabled, folder]);

  useEffect(() => {
    if (!enabled || !folder || !mapRef) {
      setFeatures(null);
      setLoading(false);
      setOutlineOnly(true);
      setSheetCount(0);
      setFootprintCount(0);
      setError(null);
      loadedKeyRef.current = '';
      fittedRef.current = false;
      detailedFilesRef.current = new Set();
      sheetFeatCacheRef.current.clear();
      indexRef.current = null;
      return;
    }

    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;
    let debounce: number | undefined;
    fittedRef.current = false;

    const rebuildFootprints = (sheets: Sheet[], crsCode: DrawingCrsCode) => {
      const mapCode = map.getView().getProjection().getCode();
      const srcCode = `EPSG:${crsCode}`;
      const feats: Feature<Polygon>[] = [];
      for (const s of sheets) {
        const f = makeFootprintFeature(s, srcCode, mapCode);
        if (f) feats.push(f);
      }
      footprintSourceRef.current.clear(true);
      if (feats.length) footprintSourceRef.current.addFeatures(feats);
      setFootprintCount(feats.length);
      footprintLayerRef.current?.changed();
    };

    const fitIfNeeded = (sheets: Sheet[], viewSrc: Extent, crsCode: DrawingCrsCode) => {
      if (fittedRef.current || !sheets.length) return;
      const hit = sheets.some((s) => intersects(viewSrc, sheetExtent(s)));
      if (hit) {
        fittedRef.current = true;
        return;
      }
      const union = unionSheets(sheets);
      if (!union) return;
      const mapCode = map.getView().getProjection().getCode();
      const srcCode = `EPSG:${crsCode}`;
      let target = union;
      if (srcCode !== mapCode) {
        try {
          target = transformExtent(union, srcCode, mapCode);
        } catch {
          return;
        }
      }
      fittedRef.current = true;
      map.getView().fit(target, { padding: [72, 72, 72, 72], maxZoom: 16, duration: 450 });
    };

    const run = async () => {
      const seq = ++seqRef.current;
      const view = map.getView();
      const size = map.getSize();
      if (!size) return;

      try {
        let index = indexRef.current;
        const needIndex = !index;
        if (needIndex) setLoading(true);
        if (!index) {
          index = await loadFolderIndex(folder);
          if (cancelled || seq !== seqRef.current) return;
          indexRef.current = index;
        }

        const crsCode = asDrawingCrs(index.crs);
        if (crsRef.current !== crsCode) {
          crsRef.current = crsCode;
          setCrs(crsCode);
          loadedKeyRef.current = '';
          detailedFilesRef.current = new Set();
          sheetFeatCacheRef.current.clear();
          setFeatures(null);
          footprintSourceRef.current.clear(true);
        }

        const mapCode = view.getProjection().getCode();
        const srcCode = `EPSG:${crsCode}`;
        const viewMap = view.calculateExtent(size);
        let viewSrc: Extent;
        try {
          viewSrc = transformExtent(viewMap, mapCode, srcCode);
        } catch {
          viewSrc = viewMap;
        }
        const viewW = viewSrc[2] - viewSrc[0];
        const zoom = view.getZoom();
        const scaleBarM =
          zoom != null && Number.isFinite(zoom) ? scaleMetersFromZoom(zoom) : null;
        const resolved =
          scaleBarM != null ? resolveDigitalMapDetailLevel(scaleBarM) : null;

        if (footprintSourceRef.current.getFeatures().length === 0) {
          rebuildFootprints(index.sheets, crsCode);
          fitIfNeeded(index.sheets, viewSrc, crsCode);
        }

        const outlineOnlyNow = resolved == null;
        setOutlineOnly((prev) => (prev === outlineOnlyNow ? prev : outlineOnlyNow));

        if (outlineOnlyNow) {
          const outlineKey = `${folder}|outline`;
          if (loadedKeyRef.current !== outlineKey) {
            loadedKeyRef.current = outlineKey;
            detailedFilesRef.current = new Set();
            setFeatures(null);
            setSheetCount(0);
            footprintLayerRef.current?.changed();
          }
          setError(null);
          return;
        }

        const { level, index: levelIndex } = resolved;
        const picked = pickSheets(index.sheets, viewSrc);
        // 화면 격자 — 패닝 시 화면 안 글자를 다시 고르기 위함(도엽 재다운로드 없음)
        const viewCell = `${Math.round(viewSrc[0] / 80)}_${Math.round(viewSrc[1] / 80)}`;
        const key = `${folder}|L${levelIndex}|p${level.maxFeaturesPerSheet}|lb${level.maxLabelsPerSheet}|s${level.minSpanRatio}|fr${
          level.includeSheetFrame ? 1 : 0
        }|${viewCell}|${picked
          .map((p) => p.file)
          .sort()
          .join(',')}`;
        if (key === loadedKeyRef.current || key === inflightKeyRef.current) {
          return;
        }
        inflightKeyRef.current = key;

        if (picked.length === 0) {
          loadedKeyRef.current = key;
          inflightKeyRef.current = '';
          detailedFilesRef.current = new Set();
          setFeatures([]);
          setSheetCount(0);
          footprintLayerRef.current?.changed();
          setError(null);
          return;
        }

        const cache = sheetFeatCacheRef.current;
        const missing = picked.filter((s) => !cache.has(s.file));

        const publishFromCache = () => {
          if (cancelled || seq !== seqRef.current) return;
          const merged: Feature<Geometry>[] = [];
          let ready = 0;
          for (const sheet of picked) {
            const feats = cache.get(sheet.file);
            if (!feats?.length) continue;
            ready += 1;
            for (const f of sampleFeaturesForLevel(
              feats,
              viewW,
              level,
              sheetExtent(sheet),
              viewSrc
            )) {
              merged.push(f);
            }
          }
          detailedFilesRef.current = new Set(
            picked.filter((s) => cache.has(s.file)).map((p) => p.file)
          );
          setFeatures(merged);
          setSheetCount(ready);
          footprintLayerRef.current?.changed();
        };

        // 캐시된 도엽은 확대 직후 바로 표시
        publishFromCache();

        if (missing.length) {
          setLoading(true);
          let fetched = 0;
          await mapPool(missing, DIGITAL_MAP_FETCH_CONCURRENCY, async (sheet) => {
            const text = await fetchDxfText(folder, sheet.file);
            const { features: parsed } = dxfStringToOlFeatures(text);
            cache.set(sheet.file, parsed);
            fetched += 1;
            // 도엽이 끝나는 대로 바로 반영 (첫 장부터 선이 보이게)
            if (fetched === 1 || fetched % 3 === 0 || fetched === missing.length) {
              publishFromCache();
            }
            return sheet.file;
          });
        }
        if (cancelled || seq !== seqRef.current) return;

        if (cache.size > DIGITAL_MAP_SHEET_CACHE_MAX) {
          const keep = new Set(picked.map((p) => p.file));
          for (const file of [...cache.keys()]) {
            if (!keep.has(file)) cache.delete(file);
          }
        }

        loadedKeyRef.current = key;
        inflightKeyRef.current = '';
        publishFromCache();
        setError(null);
      } catch (e) {
        inflightKeyRef.current = '';
        if (cancelled || seq !== seqRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setFeatures(null);
        setSheetCount(0);
      } finally {
        if (!cancelled && seq === seqRef.current) setLoading(false);
      }
    };

    const schedule = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        void run();
      }, 60);
    };

    schedule();
    map.on('moveend', schedule);
    return () => {
      cancelled = true;
      map.un('moveend', schedule);
      window.clearTimeout(debounce);
    };
  }, [enabled, folder, mapRef]);

  return { loading, outlineOnly, sheetCount, footprintCount, error };
}
