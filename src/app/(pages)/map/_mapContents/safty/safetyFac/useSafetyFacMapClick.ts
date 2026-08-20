'use client';

import { useEffect, useRef } from 'react';
import type { Map, MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import { easeOut } from 'ol/easing';
import { transform } from 'ol/proj';
import { call } from '@/lib/api';
import { prepareMapForPanelAwareNavigation } from '../../../_mapComponents/config/mapAutoNavigation';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { SAFETY_FAC_PANEL_GEO_TABLE_NAMES } from '../../../_mapComponents/layerFactory/safetydataMapLayerFactory';
import { defineFieldFlagTrue, isDefineFieldCodeType, pickSafetyFacAttr, resolveDefineCodeLabel } from './safetyFacDetailConfig';
import { getSafetyFacGeomJson } from './useSafetyFacMapHighlight';
import {
  SAFETY_FAC_TABLE_TO_SUBTYPE,
  type SafetyFacFacilityRow,
  type SafetyFacSubtypeId,
} from './safetyFacSymbols';

/** d = 300000 * 0.54^z  (z = zoom level) — 일반 식별과 동일 */
function zoomToBuffer(zoom: number): number {
  return 300_000 * Math.pow(0.54, zoom);
}

const GEOM_KEYS = new Set(['geom', 'geometry', 'the_geom', 'wkb_geometry', 'shape', 'geojson']);

function stripGeom(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (GEOM_KEYS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

function parseCoord(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? Number(v) : Number(String(v).trim());
  return Number.isFinite(n) ? n : undefined;
}

function pickLonLat(row: Record<string, unknown>): { lon?: number; lat?: number } {
  const lonKeys = ['lo', 'lot', 'lon', 'xcord', 'longitude'];
  const latKeys = ['la', 'lat', 'ycord', 'latitude'];
  let lon: number | undefined;
  let lat: number | undefined;
  for (const k of lonKeys) {
    const n = parseCoord(pickSafetyFacAttr(row, k));
    if (n != null) {
      lon = n;
      break;
    }
  }
  for (const k of latKeys) {
    const n = parseCoord(pickSafetyFacAttr(row, k));
    if (n != null) {
      lat = n;
      break;
    }
  }
  return { lon, lat };
}

async function resolveIdentifyTitle(opts: {
  table: string;
  titleField?: string | null;
  titleValue: string;
  row: Record<string, unknown>;
}): Promise<string> {
  const fieldName = String(opts.titleField ?? '').trim();
  const raw =
    opts.titleValue.trim() ||
    (fieldName ? String(pickSafetyFacAttr(opts.row, fieldName) ?? '').trim() : '');
  if (!raw || !fieldName) return raw;
  try {
    const fres = await fetch(`/api/config/defineLayer/fields/${encodeURIComponent(opts.table)}`);
    const fjson = (await fres.json()) as { data?: Record<string, unknown>[] };
    const fields = Array.isArray(fjson?.data) ? fjson.data : [];
    const field = fields.find(
      (f) => String(f.define_field_name ?? '').trim().toLowerCase() === fieldName.toLowerCase()
    );
    if (!field || !isDefineFieldCodeType(field)) return raw;
    const name = String(field.define_field_name ?? '').trim();
    const cres = await fetch(
      `/api/config/defineLayer/codes/${encodeURIComponent(`${opts.table}__${name}`)}`
    );
    const cjson = (await cres.json()) as { data?: { define_code_name?: string; define_code_kor_name?: string }[] };
    const codes = Array.isArray(cjson?.data) ? cjson.data : [];
    return resolveDefineCodeLabel(codes, raw);
  } catch {
    return raw;
  }
}

async function keyFieldName(table: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/config/defineLayer/fields/${encodeURIComponent(table)}`);
    const json = (await res.json()) as { data?: Record<string, unknown>[] };
    const fields = Array.isArray(json?.data) ? json.data : [];
    const key = fields.find((f) => defineFieldFlagTrue(f.define_field_is_key));
    const name = key ? String(key.define_field_name ?? '').trim() : '';
    return name || null;
  } catch {
    return null;
  }
}

function facilityFromIdentify(opts: {
  table: string;
  subtype: SafetyFacSubtypeId;
  data: Record<string, unknown>;
  titleValue: string;
  id: string;
}): SafetyFacFacilityRow {
  const { lon, lat } = pickLonLat(opts.data);
  const geomJson = getSafetyFacGeomJson(opts.data);
  return {
    id: opts.id,
    table: opts.table,
    subtype: opts.subtype,
    name: opts.titleValue.trim() || '(이름 없음)',
    address: '—',
    detailAttrs: stripGeom(opts.data),
    ...(geomJson != null ? { geomJson } : {}),
    ...(lon != null && lat != null ? { lon, lat } : {}),
  };
}

type Props = {
  enabled: boolean;
  facilities: SafetyFacFacilityRow[];
  onSelectFacility: (facility: SafetyFacFacilityRow | null) => void;
};

const SAFETY_FAC_CLICK_ZOOM = 16;
const SAFETY_FAC_FLY_MS = 600;

function lonLatFromFacility(f: SafetyFacFacilityRow): { lon: number; lat: number } | null {
  const asNum = (v: unknown): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v == null) return undefined;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : undefined;
  };
  const lon = asNum(f.lon);
  const lat = asNum(f.lat);
  if (lon != null && lat != null) return { lon, lat };

  const tryPoint = (g: unknown): { lon: number; lat: number } | null => {
    if (!g || typeof g !== 'object') return null;
    const rec = g as { type?: unknown; coordinates?: unknown };
    if (rec.type === 'Point' && Array.isArray(rec.coordinates) && rec.coordinates.length >= 2) {
      const x = asNum(rec.coordinates[0]);
      const y = asNum(rec.coordinates[1]);
      if (x != null && y != null) return { lon: x, lat: y };
    }
    return null;
  };

  const fromGeom = tryPoint(f.geomJson);
  if (fromGeom) return fromGeom;
  if (f.geomJson && typeof f.geomJson === 'string') {
    try {
      return tryPoint(JSON.parse(f.geomJson) as unknown);
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** 해당 좌표가 보이는 지도 중앙이 되도록 이동·확대 (패널 padding 반영, easeOut) */
export function animateSafetyFacToCenter3857(
  map: Map,
  center3857: [number, number],
  applyMapViewPadding?: (() => void) | null
) {
  const run = () => {
    // 호출 시점의 apply가 아니라 실행 시점 콜백을 존중 (상세 패널 padding 반영)
    prepareMapForPanelAwareNavigation(map, applyMapViewPadding);
    const view = map.getView();
    view.cancelAnimations();
    const zoom = Math.max(view.getZoom() ?? SAFETY_FAC_CLICK_ZOOM, SAFETY_FAC_CLICK_ZOOM);
    view.animate({
      center: center3857,
      zoom,
      duration: SAFETY_FAC_FLY_MS,
      easing: easeOut,
    });
  };
  queueMicrotask(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
  });
}

export function animateSafetyFacToFacility(
  map: Map,
  f: SafetyFacFacilityRow,
  applyMapViewPadding?: (() => void) | null
) {
  const ll = lonLatFromFacility(f);
  if (!ll) return;
  const c = transform([ll.lon, ll.lat], 'EPSG:4326', 'EPSG:3857') as [number, number];
  animateSafetyFacToCenter3857(map, c, applyMapViewPadding);
}

/**
 * 재난대응시설 패널이 열린 동안 켜진 시설 레이어만 식별.
 * 키 값이 목록에 있으면 그 행을 선택하고, 없어도 식별 결과로 상세를 연다.
 */
export function useSafetyFacMapClick({ enabled, facilities, onSelectFacility }: Props) {
  const mapContext = useMapContext();
  const facilitiesRef = useRef(facilities);
  facilitiesRef.current = facilities;
  const onSelectRef = useRef(onSelectFacility);
  onSelectRef.current = onSelectFacility;
  const visRef = useRef(mapContext?.safetyMapLayerVisibility ?? {});
  visRef.current = mapContext?.safetyMapLayerVisibility ?? {};

  useEffect(() => {
    if (!enabled) return;
    const map = mapContext?.mapInstanceRef?.current;
    const mapReady = mapContext?.mapReady;
    if (!mapReady || !map) return;

    const handleClick = async (evt: MapBrowserEvent<PointerEvent>) => {
      if (!evt.map) return;
      if (mapContext?.spatialDrawRequest) return;
      if (mapContext?.mapMeasureTool) return;
      if (mapContext?.mapDrawInputSuspended) return;
      if (mapContext?.layerRowGeomEdit) return;

      const vis = visRef.current;
      const tables = SAFETY_FAC_PANEL_GEO_TABLE_NAMES.filter((t) => vis[t] === true);
      if (tables.length === 0) return;

      const zoom = evt.map.getView().getZoom() ?? 10;
      const bufferMeters = zoomToBuffer(zoom);
      const [x, y] = evt.coordinate as [number, number];

      try {
        const res = await call('', 'POST', {
          service: 'standardService',
          action: 'identifyFeatures',
          params: { x, y, buffer: bufferMeters, tables, schema: 'layer' },
        });
        const data = res?.data ?? res;
        const results = Array.isArray(data?.results) ? data.results : [];
        const first = results[0] as
          | {
              tableName?: string;
              titleField?: string | null;
              features?: { titleValue?: string; data?: Record<string, unknown> }[];
            }
          | undefined;
        const feat = first?.features?.[0];
        const row = feat?.data;
        const table = String(first?.tableName ?? '')
          .trim()
          .toLowerCase();
        const subtype = SAFETY_FAC_TABLE_TO_SUBTYPE[table];
        if (!row || !subtype) return;

        const kf = await keyFieldName(table);
        const keyRaw = kf ? pickSafetyFacAttr(row, kf) : pickSafetyFacAttr(row, 'ogc_fid');
        const id =
          keyRaw != null && String(keyRaw).trim() !== ''
            ? String(keyRaw).trim()
            : `${table}-map`;

        const flyFromClick = (fallback: SafetyFacFacilityRow) => {
          const coord = evt.coordinate as [number, number];
          const pad = () => {
            mapContext?.applyMapViewPaddingRef?.current?.();
          };
          if (Number.isFinite(coord[0]) && Number.isFinite(coord[1])) {
            animateSafetyFacToCenter3857(evt.map, coord, pad);
          } else {
            animateSafetyFacToFacility(evt.map, fallback, pad);
          }
        };

        const listHit = facilitiesRef.current.find((f) => f.table === table && f.id === id);
        const geomJson = getSafetyFacGeomJson(row);
        if (listHit) {
          const selected = {
            ...listHit,
            ...(geomJson != null && listHit.geomJson == null ? { geomJson } : {}),
          };
          onSelectRef.current(selected);
          flyFromClick(selected);
          return;
        }

        const titleValue = await resolveIdentifyTitle({
          table,
          titleField: first?.titleField,
          titleValue: String(feat?.titleValue ?? '').trim(),
          row,
        });
        const fromIdentify = facilityFromIdentify({ table, subtype, data: row, titleValue, id });
        onSelectRef.current(fromIdentify);
        flyFromClick(fromIdentify);
      } catch {
        /* 클릭 식별 실패는 무시 */
      }
    };

    const key = map.on('singleclick', handleClick as never);
    return () => {
      if (key) unByKey(key);
    };
  }, [
    enabled,
    mapContext?.mapInstanceRef,
    mapContext?.mapReady,
    mapContext?.spatialDrawRequest,
    mapContext?.mapMeasureTool,
    mapContext?.mapDrawInputSuspended,
    mapContext?.layerRowGeomEdit,
    mapContext?.applyMapViewPaddingRef,
  ]);
}
