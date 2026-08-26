/**
 * 변동이력 — GeoServer CSS 스타일(레이어 관리와 동일) + 심볼 URL 캐시.
 * 변경 후: 원색 · 변경 전: 회색(심볼은 캔버스 회색 tint)
 */
'use client';

import { Circle as CircleStyle, Fill, Icon, Stroke, Style } from 'ol/style';
import type { StyleLike } from 'ol/style/Style';

import { call } from '@/lib/api';
import {
  parseSimpleStyleFromCss,
  toPublicSymbolPreviewUrl,
  type GeometryType,
  type StyleProps,
} from '@/lib/geoserverStyleUtils';
import { getGeoServerBase } from '@/lib/geoserverUrl';

const GEOSERVER_DEFAULT_URL = getGeoServerBase();

/** 변경 전 — 항공 배경 대비: 밝은 면 + 검정 점선 */
const GREY_FILL = '#cbd5e1';
const GREY_STROKE = '#111111';
/** 변경 전 면 채움 알파 (0~1) */
const BEFORE_FILL_OPACITY = 0.5;
/** 변경 전 선 굵기 배수 (변경 후 대비) */
const BEFORE_STROKE_MULT = 1.85;

type CachedStyleInfo = {
  styleProps: StyleProps;
  geometryType: GeometryType;
};

/** 테이블명 → 파싱된 스타일 */
const styleInfoCache = new Map<string, CachedStyleInfo | null>();
const styleInflight = new Map<string, Promise<CachedStyleInfo | null>>();

/** 원본 심볼 URL → 회색 data URL (실패도 null로 캐시해 재시도 폭주 방지). v3=밝은 슬레이트 tint */
const greyIconCache = new Map<string, string | null>();
const greyIconInflight = new Map<string, Promise<string | null>>();
const GREY_ICON_CACHE_VER = 'v3';

function greyIconCacheKey(src: string): string {
  return `${GREY_ICON_CACHE_VER}:${src}`;
}

function unwrapPayload<T>(res: { data?: unknown }): T | null {
  const outer = res.data as { data?: T; success?: boolean } | T | undefined;
  if (outer && typeof outer === 'object' && 'data' in (outer as object) && 'success' in (outer as object)) {
    return (outer as { data: T }).data ?? null;
  }
  return (outer as T) ?? null;
}

/** 로드 실패한 심볼 URL — Icon 대신 원으로 */
const missingIconUrls = new Set<string>();
/** 로드 성공한 심볼 URL */
const okIconUrls = new Set<string>();

const DEFAULT_POINT_STYLE: CachedStyleInfo = {
  geometryType: 'POINT',
  styleProps: {
    fillColor: '#2563eb',
    strokeColor: '#1d4ed8',
    strokeWidth: 1.5,
    opacity: 0.9,
    size: 12,
  },
};

async function fetchStyleInfo(tableName: string): Promise<CachedStyleInfo | null> {
  const key = tableName.toLowerCase();
  if (styleInfoCache.has(key)) return styleInfoCache.get(key) ?? null;
  const pending = styleInflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const res = await call('', 'POST', {
        service: 'devTestService',
        action: 'getGeoServerStyle',
        params: { url: GEOSERVER_DEFAULT_URL, name: tableName },
      });
      const data = unwrapPayload<{
        success?: boolean;
        body?: string;
        styleProps?: StyleProps;
        geometryType?: GeometryType;
        editable?: boolean;
      }>(res);
      if (!data || data.success === false) {
        styleInfoCache.set(key, DEFAULT_POINT_STYLE);
        return DEFAULT_POINT_STYLE;
      }
      let styleProps = data.styleProps;
      let geometryType = data.geometryType;
      if ((!styleProps || !geometryType) && data.body) {
        const parsed = parseSimpleStyleFromCss(data.body);
        styleProps = parsed.styleProps;
        geometryType = parsed.geometryType;
      }
      if (!styleProps || !geometryType) {
        // SLD/CSS·심볼 없음 → 원(점) 기본 스타일
        styleInfoCache.set(key, DEFAULT_POINT_STYLE);
        return DEFAULT_POINT_STYLE;
      }
      if (styleProps.symbolUrl?.trim()) {
        const pub = toPublicSymbolPreviewUrl(styleProps.symbolUrl) ?? styleProps.symbolUrl.trim();
        styleProps = { ...styleProps, symbolUrl: pub };
      }
      const info: CachedStyleInfo = { styleProps, geometryType };
      styleInfoCache.set(key, info);
      return info;
    } catch {
      styleInfoCache.set(key, DEFAULT_POINT_STYLE);
      return DEFAULT_POINT_STYLE;
    } finally {
      styleInflight.delete(key);
    }
  })();

  styleInflight.set(key, p);
  return p;
}

async function ensureIconAvailable(src: string): Promise<boolean> {
  if (okIconUrls.has(src)) return true;
  if (missingIconUrls.has(src)) return false;
  try {
    await loadImage(src);
    okIconUrls.add(src);
    return true;
  } catch {
    missingIconUrls.add(src);
    return false;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`icon load fail: ${src}`));
    img.src = src;
  });
}

/** SVG/PNG → 회색조 data URL (모듈 캐시) */
async function getGreyIconDataUrl(src: string): Promise<string | null> {
  const cacheKey = greyIconCacheKey(src);
  if (greyIconCache.has(cacheKey)) {
    // has 이후 get — 성공 string / 실패 null 모두 유효 반환값 (non-null 단언 금지)
    return greyIconCache.get(cacheKey) as string | null;
  }
  const pending = greyIconInflight.get(cacheKey);
  if (pending) return pending;

  const p = (async (): Promise<string | null> => {
    try {
      const img = await loadImage(src);
      const w = Math.max(1, img.naturalWidth || img.width || 24);
      const h = Math.max(1, img.naturalHeight || img.height || 24);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        greyIconCache.set(cacheKey, null);
        return null;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a === 0) continue;
        const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        // 변경 전 심볼 — 밝은 슬레이트 톤 (면 채움과 맞춤)
        const dim = Math.round(90 + g * 0.35);
        d[i] = dim;
        d[i + 1] = dim;
        d[i + 2] = dim;
        d[i + 3] = a;
      }
      ctx.putImageData(imageData, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      greyIconCache.set(cacheKey, dataUrl);
      return dataUrl;
    } catch {
      greyIconCache.set(cacheKey, null);
      return null;
    } finally {
      greyIconInflight.delete(cacheKey);
    }
  })();

  greyIconInflight.set(cacheKey, p);
  return p;
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return `rgba(128,128,128,${alpha})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

/**
 * 실제 피처 도형 우선. 레이어 메타(POINT 등록인데 이력은 Polygon 등)로
 * 면·선에 점 스타일을 씌우지 않음 — 메인 WMS와 같이 보이는 종류로 그림.
 */
function resolveDrawKind(
  geomType: string | undefined,
  layerGeom: GeometryType
): 'point' | 'line' | 'polygon' {
  const g = String(geomType ?? '');
  if (g === 'Point' || g === 'MultiPoint') return 'point';
  if (g === 'LineString' || g === 'MultiLineString') return 'line';
  if (g === 'Polygon' || g === 'MultiPolygon') return 'polygon';
  if (layerGeom === 'POINT') return 'point';
  if (layerGeom === 'LINE') return 'line';
  return 'polygon';
}

function buildVectorStyle(
  info: CachedStyleInfo,
  side: 'before' | 'after',
  geomType: string | undefined,
  iconSrc: string | null
): Style {
  const grey = side === 'before';
  const zIndex = grey ? 1 : 2;
  const p = info.styleProps;
  const opacity = grey ? BEFORE_FILL_OPACITY : (p.opacity ?? 0.55);
  const strokeW = Math.max(1, p.strokeWidth ?? 2) * (grey ? BEFORE_STROKE_MULT : 1.15);
  const fillHex = grey ? GREY_FILL : (p.fillColor ?? '#808080');
  const strokeHex = grey ? GREY_STROKE : (p.strokeColor ?? p.fillColor ?? '#333333');
  const size = p.size ?? 14;
  const kind = resolveDrawKind(geomType, info.geometryType);

  if (kind === 'point') {
    if (iconSrc) {
      return new Style({
        zIndex,
        image: new Icon({
          src: iconSrc,
          scale: Math.max(0.4, size / 24),
          opacity: 1,
        }),
      });
    }
    return new Style({
      zIndex,
      image: new CircleStyle({
        radius: Math.max(4, size / 2),
        fill: new Fill({ color: hexToRgba(fillHex, 0.85) }),
        stroke: new Stroke({ color: strokeHex, width: grey ? 2.5 : 1.5 }),
      }),
    });
  }

  if (kind === 'line') {
    return new Style({
      zIndex,
      stroke: new Stroke({
        color: hexToRgba(strokeHex, grey ? 1 : 0.95),
        width: Math.max(strokeW, grey ? 3.5 : strokeW),
        lineDash: grey ? [8, 6] : undefined,
      }),
    });
  }

  return new Style({
    zIndex,
    fill: new Fill({ color: hexToRgba(fillHex, opacity) }),
    stroke: new Stroke({
      color: hexToRgba(strokeHex, grey ? 1 : 0.95),
      width: Math.max(strokeW, grey ? 3.2 : strokeW),
      lineDash: grey ? [6, 5] : undefined,
    }),
  });
}

const FALLBACK_BEFORE = new Style({
  zIndex: 1,
  stroke: new Stroke({ color: 'rgba(17,17,17,1)', width: 3.5, lineDash: [8, 6] }),
  fill: new Fill({ color: 'rgba(203,213,225,0.5)' }),
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: 'rgba(203,213,225,0.85)' }),
    stroke: new Stroke({ color: '#111111', width: 2.5 }),
  }),
});

const FALLBACK_AFTER = new Style({
  zIndex: 2,
  stroke: new Stroke({ color: 'rgba(37,99,235,0.9)', width: 2.5 }),
  fill: new Fill({ color: 'rgba(37,99,235,0.2)' }),
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: 'rgba(37,99,235,0.85)' }),
    stroke: new Stroke({ color: '#1d4ed8', width: 1.5 }),
  }),
});

/**
 * OL StyleFunction용. 캐시 미스 시 fallback 반환 후 로드·갱신.
 * @param onReady 스타일/아이콘 로드 후 레이어 changed()
 */
export function resolveCompareFeatureStyle(
  tableName: string,
  side: 'before' | 'after',
  geomType: string | undefined,
  onReady: () => void
): StyleLike {
  const key = tableName.toLowerCase();
  const info = styleInfoCache.get(key);

  if (info === null) {
    return side === 'before' ? FALLBACK_BEFORE : FALLBACK_AFTER;
  }

  if (!info) {
    void fetchStyleInfo(tableName).then(() => onReady());
    return side === 'before' ? FALLBACK_BEFORE : FALLBACK_AFTER;
  }

  const symbolUrl = info.styleProps.symbolUrl?.trim() || null;
  // 심볼은 실제 점 피처에만 (메타 POINT여도 면·선이면 미사용)
  const needIcon =
    (geomType === 'Point' || geomType === 'MultiPoint') && Boolean(symbolUrl);

  if (needIcon && symbolUrl) {
    if (missingIconUrls.has(symbolUrl)) {
      return buildVectorStyle(info, side, geomType, null);
    }
    if (side === 'before') {
      const grey = greyIconCache.get(greyIconCacheKey(symbolUrl));
      if (grey) return buildVectorStyle(info, side, geomType, grey);
      void getGreyIconDataUrl(symbolUrl).then((url) => {
        if (!url) missingIconUrls.add(symbolUrl);
        onReady();
      });
      return buildVectorStyle(info, side, geomType, null);
    }
    if (okIconUrls.has(symbolUrl)) {
      return buildVectorStyle(info, side, geomType, symbolUrl);
    }
    void ensureIconAvailable(symbolUrl).then(() => onReady());
    return buildVectorStyle(info, side, geomType, null);
  }

  return buildVectorStyle(info, side, geomType, null);
}

/** 사용할 테이블 스타일을 미리 로드 (선·면용). 점 심볼 404 요청은 하지 않음 */
export async function prefetchCompareStyles(tableNames: string[]): Promise<void> {
  const uniq = [...new Set(tableNames.map((t) => t.trim()).filter(Boolean))];
  await Promise.all(uniq.map((t) => fetchStyleInfo(t)));
}

/** 관련 레이어 칩 범례 — 변경 후(원색) 기준. 캐시 없으면 null */
export type ChangeHistoryLegendInfo = {
  kind: 'point' | 'line' | 'polygon';
  fillColor: string;
  strokeColor: string;
  /** GeoServer CSS mark url — 점이면 아이콘 */
  symbolUrl?: string | null;
};

export function peekCompareLegendInfo(tableName: string): ChangeHistoryLegendInfo | null {
  const raw = tableName.trim();
  if (!raw) return null;
  const info = styleInfoCache.get(raw.toLowerCase());
  if (!info) return null;
  const p = info.styleProps;
  return {
    kind: resolveDrawKind(undefined, info.geometryType),
    fillColor: p.fillColor ?? '#808080',
    strokeColor: p.strokeColor ?? p.fillColor ?? '#333333',
    symbolUrl: p.symbolUrl?.trim() || null,
  };
}
