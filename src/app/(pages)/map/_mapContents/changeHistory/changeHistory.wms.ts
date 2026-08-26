/**
 * 변동이력 결과 지도 — ImageWMS (콤마 LAYERS + CQL).
 * - 메인 지도 serviceLayer / GeoServer 발행 설정을 수정하지 않음 (GetMap 파라미터만).
 * - 시점(as-of) CQL은 이력 뷰/칼럼 확정 전 INCLUDE 자리만 두고, 영역 INTERSECTS만 적용.
 */
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import type ImageWrapper from 'ol/Image';
import { getGeoServerBase } from '@/lib/geoserverUrl';

const WORKSPACE = 'ggnr';
const WMS_VIEWPORT_IMAGE_RATIO = 1.5;
/** 날짜·레이어 연속 변경 시 GetMap 폭주 완화 */
export const CHANGE_HISTORY_WMS_DEBOUNCE_MS = 220;

export function isChangeHistoryWmsTable(tableName: string): boolean {
  const t = tableName.trim().toLowerCase();
  if (!t) return false;
  if (t.endsWith('_dummy')) return false;
  return true;
}

function imageLoadFunctionPost(image: ImageWrapper, src: string): void {
  const img = image.getImage() as HTMLImageElement;
  try {
    const url = new URL(src);
    const baseUrl = url.origin + url.pathname;
    const body = url.search.startsWith('?') ? url.search.slice(1) : url.search;
    fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        // 예외 XML·텍스트면 이미지로 넣지 않음(하얀 오류 화면 방지)
        if (contentType.includes('xml') || contentType.includes('text')) {
          throw new Error('wms-exception');
        }
        return res.blob();
      })
      .then((blob) => {
        if (!blob.type.startsWith('image/')) {
          throw new Error('wms-not-image');
        }
        const blobUrl = URL.createObjectURL(blob);
        img.onload = () => URL.revokeObjectURL(blobUrl);
        img.onerror = () => URL.revokeObjectURL(blobUrl);
        img.src = blobUrl;
      })
      .catch(() => {
        // 빈 src는 하얀 플레이스홀더를 남길 수 있음 → 1x1 투명 PNG
        img.src =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      });
  } catch {
    img.src =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  }
}

/** 선택 레이어 중 WMS에 올릴 테이블명만 */
export function filterWmsTableNames(tableNames: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tableNames) {
    const t = String(raw ?? '').trim().toLowerCase();
    if (!isChangeHistoryWmsTable(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * 레이어별 CQL.
 * - 영역: INTERSECTS(geom, wkt)
 * - 시점: 이력 발행 뷰가 생기면 `asOfCqlFragment`로 교체. 지금은 자리만(INCLUDE).
 */
export function buildChangeHistoryLayerCql(args: {
  areaWkt5181: string | null | undefined;
  selectedDate: string;
  /** 이력 뷰 확정 후: 예) applied_at <= '2026-03-20' — 현재는 미사용 */
  asOfCqlFragment?: string | null;
}): string {
  const parts: string[] = [];
  const wkt = typeof args.areaWkt5181 === 'string' ? args.areaWkt5181.trim() : '';
  if (wkt) {
    parts.push(`INTERSECTS(geom, ${wkt})`);
  }
  const asOf = args.asOfCqlFragment?.trim();
  if (asOf) {
    parts.push(asOf);
  }
  // selectedDate는 이력 뷰 연동 시 asOfCqlFragment에 녹임 — 운영 테이블에 임의 날짜 칼럼을 가정하지 않음
  void args.selectedDate;
  return parts.length === 0 ? 'INCLUDE' : parts.join(' AND ');
}

export type ChangeHistoryWmsParams = {
  LAYERS: string;
  STYLES: string;
  CQL_FILTER: string;
  visible: boolean;
};

export function buildChangeHistoryWmsParams(args: {
  tableNames: string[];
  areaWkt5181: string | null | undefined;
  selectedDate: string;
  asOfCqlFragment?: string | null;
}): ChangeHistoryWmsParams {
  const names = filterWmsTableNames(args.tableNames);
  if (names.length === 0) {
    return { LAYERS: '', STYLES: '', CQL_FILTER: '', visible: false };
  }
  const cqlOne = buildChangeHistoryLayerCql({
    areaWkt5181: args.areaWkt5181,
    selectedDate: args.selectedDate,
    asOfCqlFragment: args.asOfCqlFragment,
  });
  return {
    LAYERS: names.map((n) => `${WORKSPACE}:${n}`).join(','),
    STYLES: names.map(() => '').join(','),
    CQL_FILTER: names.map(() => cqlOne).join(';'),
    visible: true,
  };
}

/**
 * 결과 모달 전용 ImageWMS — 메인 지도 serviceLayer와 별개 인스턴스.
 * GeoServer 레이어 정의·발행을 바꾸지 않음.
 * EXCEPTIONS는 xml — inimage면 오류 시 하얀 이미지가 배경을 통째로 가린다.
 */
export function createChangeHistoryWmsLayer(): ImageLayer<ImageWMS> {
  const wmsUrl = `${getGeoServerBase()}/${WORKSPACE}/wms`;
  const layer = new ImageLayer({
    visible: false,
    opacity: 1,
    zIndex: 1,
    source: new ImageWMS({
      url: wmsUrl,
      params: {
        LAYERS: '',
        STYLES: '',
        FORMAT: 'image/png',
        TRANSPARENT: true,
        VERSION: '1.1.1',
        EXCEPTIONS: 'application/vnd.ogc.se_xml',
      },
      serverType: 'geoserver',
      ratio: WMS_VIEWPORT_IMAGE_RATIO,
      imageLoadFunction: imageLoadFunctionPost,
    }),
  });
  layer.set('name', 'changeHistoryWms');
  layer.set('changeHistoryWms', true);

  const source = layer.getSource();
  source?.on('imageloaderror', () => {
    layer.setVisible(false);
  });

  return layer;
}

export function applyChangeHistoryWmsParams(
  layer: ImageLayer<ImageWMS>,
  params: ChangeHistoryWmsParams
): void {
  const source = layer.getSource();
  if (!source) return;
  const p = source.getParams();
  p.LAYERS = params.LAYERS;
  p.STYLES = params.STYLES;
  p.FORMAT = 'image/png';
  p.TRANSPARENT = true;
  p.EXCEPTIONS = 'application/vnd.ogc.se_xml';
  if (params.visible && params.CQL_FILTER) {
    p.CQL_FILTER = params.CQL_FILTER;
  } else {
    delete p.CQL_FILTER;
  }
  const show = params.visible && Boolean(params.LAYERS);
  layer.setVisible(show);
  if (show) {
    source.updateParams({ ...p });
  }
}
