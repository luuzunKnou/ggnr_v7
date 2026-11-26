'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, X } from 'lucide-react';
import { withBasePath } from '@/lib/basePath';
import { MAP_UI_Z_CLASS } from '@/lib/mapUiZIndex';
import { cn, copyTextToClipboard } from '@/lib/utils';
import { useSearchBarOffset } from '../../searchBarOffsetContext';
import { useMapContext } from '../MapContext';
import { transformCoordinate } from '../services/coordinateService';
import { COORDINATE_SYSTEM_OPTIONS, openExternalMapByAddress } from '../landInfo/shared';
import { openEumLand, openEumMap, openEumUrbanPlan } from './openEumExternal';

const COPY_LABEL = '[ 복사 ]';
const TOAST_AUTO_HIDE_MS = 2000;

const ADDRESS_FETCH_ERROR_MSG = '주소 정보를 불러오지 못했습니다.';
const ROAD_MISSING_MSG = '해당 위치에 도로명 주소가 없습니다.';

function canCopyText(value: string | null | undefined): boolean {
  const t = String(value ?? '').trim();
  return Boolean(t) && t !== '-';
}

/**
 * 보이는 지도 중앙.
 * OL viewport는 전체 화면이라 쓰지 않고, 송수경로 토스트와 같이 leftPx로 왼쪽을 잡는다.
 * 우측 필지정보 패널이 있으면 그 왼쪽 끝을 오른쪽 경계로 쓴다.
 */
function measureVisibleMapCenter(leftPx: number): { x: number; y: number } {
  const mapLeft = Math.max(0, leftPx - 20);
  let mapRight = Math.max(mapLeft + 1, window.innerWidth - 16);

  document.querySelectorAll('[data-address-info-panel]').forEach((node) => {
    const r = (node as HTMLElement).getBoundingClientRect();
    if (r.width < 40 || r.height < 80) return;
    if (Math.abs(r.right - window.innerWidth) <= 8 && r.left > mapLeft && r.left < mapRight) {
      mapRight = r.left;
    }
  });

  if (mapRight <= mapLeft + 1) mapRight = mapLeft + 1;
  return { x: (mapLeft + mapRight) / 2, y: window.innerHeight / 2 };
}

const ROW_HOVER =
  'w-full cursor-pointer border-b border-[#e6e6e6] text-left hover:bg-primary/5';

const ICON_BTN =
  'flex h-11 min-w-0 flex-1 basis-0 items-center justify-center hover:bg-primary/5 disabled:opacity-40';

const COORD_LABEL_BADGE =
  'inline-flex h-5 shrink-0 items-center px-2.5 text-[12px] font-normal';

export default function MapRightClickMenu() {
  const mapContext = useMapContext();
  const menu = mapContext?.mapRightClickMenu ?? null;
  const setMenu = mapContext?.setMapRightClickMenu;
  const setAddressInfoDetail = mapContext?.setAddressInfoDetail;
  const [portalReady, setPortalReady] = useState(false);
  const [selectedCrs, setSelectedCrs] = useState('EPSG:5181');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastCenter, setToastCenter] = useState({ x: 0, y: 0 });
  const { leftPx } = useSearchBarOffset();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = window.setTimeout(() => setToastMsg(null), TOAST_AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
  }, [toastMsg]);

  useLayoutEffect(() => {
    if (!toastMsg) return;
    const update = () => setToastCenter(measureVisibleMapCenter(leftPx));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [toastMsg, leftPx]);

  useEffect(() => {
    if (!menu) return;
    setSelectedCrs('EPSG:5181');
  }, [menu?.coordinate?.[0], menu?.coordinate?.[1], menu?.viewProjection]);

  const xy = useMemo(() => {
    if (!menu) return null;
    const transformed = transformCoordinate(menu.coordinate, menu.viewProjection, selectedCrs);
    if (!transformed) return null;
    return { x: transformed[0], y: transformed[1] };
  }, [menu, selectedCrs]);

  const jibun = menu?.jibun?.trim() || '';
  const road = menu?.road?.trim() || '';
  const addressError = Boolean(menu?.addressError);
  const pnu = String(menu?.pnu ?? '').replace(/\D/g, '');
  const eumReady = /^\d{19}$/.test(pnu);
  const jibunReady = canCopyText(jibun);
  const roadReady = canCopyText(road);

  const externalQuery = useMemo(() => {
    if (jibun) return jibun;
    if (road) return road;
    return '';
  }, [jibun, road]);

  const mapsDisabled = !externalQuery;
  const eumDisabled = !eumReady;

  useLayoutEffect(() => {
    if (!menu || !rootRef.current) return;
    const el = rootRef.current;
    const pad = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = menu.screenX + 12;
    let top = menu.screenY;
    left = Math.min(Math.max(pad, left), window.innerWidth - w - pad);
    top = Math.min(Math.max(pad, top), window.innerHeight - h - pad);
    setPos({ left, top });
  }, [menu, jibun, road, addressError, selectedCrs, xy?.x, xy?.y]);

  useEffect(() => {
    if (!menu || !setMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (target.tagName === 'SELECT' || target.tagName === 'OPTION') return;
      setMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menu, setMenu]);

  if (!portalReady) return null;

  const closeMenu = () => setMenu?.(null);

  const copyAndClose = async (text: string) => {
    if (!canCopyText(text) || !setMenu) return;
    const ok = await copyTextToClipboard(text.trim());
    if (!ok) return;
    setToastCenter(measureVisibleMapCenter(leftPx));
    setMenu(null);
    setToastMsg('복사되었습니다.');
  };

  const openDetail = () => {
    if (!menu || !setAddressInfoDetail || !setMenu) return;
    setAddressInfoDetail({
      coordinate: menu.coordinate,
      viewProjection: menu.viewProjection,
      loading: false,
      pnu: menu.pnu,
      jibun: menu.jibun,
      road: menu.road,
      buildingName: menu.buildingName,
      ...(menu.geomSeedAt != null ? { geomSeedAt: menu.geomSeedAt } : {}),
    });
    setMenu(null);
  };

  const coordText = xy ? `${xy.x}, ${xy.y}` : '';

  const toastPortal =
    toastMsg != null
      ? createPortal(
          // FMS와 동일 파란 토스트 · 위치는 보이는 지도 중앙(우측 필지정보 패널 제외)
          <div
            className="pointer-events-none fixed z-[200]"
            style={{
              top: toastCenter.y,
              left: toastCenter.x,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div
              className="pointer-events-none inline-block max-w-[min(420px,calc(100vw-2rem))] px-4 py-2 text-sm text-white shadow-md"
              style={{ backgroundColor: '#5191e4', borderRadius: 3 }}
              role="status"
            >
              {toastMsg}
            </div>
          </div>,
          document.body
        )
      : null;

  if (!menu || !setMenu) return toastPortal;

  return (
    <>
      {createPortal(
        <div
          ref={rootRef}
          data-map-right-click-menu=""
          className={cn(
            MAP_UI_Z_CLASS.addressInfo,
            'pointer-events-auto fixed flex items-start overflow-visible text-[12px] text-[#333]'
          )}
          style={{ left: pos.left, top: pos.top, fontSize: 12 }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            onClick={closeMenu}
            className="mt-0 flex h-[32px] w-[30px] shrink-0 items-center justify-center bg-[#8B8B8B] hover:bg-[#B7B7B7]"
            style={{ backgroundColor: '#8B8B8B', color: '#fff' }}
            aria-label="닫기"
            title="닫기"
          >
            <X className="w-[20px]" color="#fff" strokeWidth={1.5} />
          </button>

          <div className="w-[min(460px,calc(100vw-48px))] overflow-hidden rounded-[5px] border border-[#c8c8c8] bg-white shadow-[2px_4px_6px_rgba(0,0,0,0.2)]">
            {/* 1. 주소정보 + 상세보기 */}
            <button
              type="button"
              onClick={openDetail}
              className={cn(ROW_HOVER, 'flex items-center justify-between gap-3 px-2.5 py-2.5')}
            >
              <span className="flex min-w-0 items-center gap-1">
                <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                <span className="font-medium text-[#333]">주소정보</span>
              </span>
              <span
                className="inline-flex shrink-0 items-center px-2.5 py-1 text-[12px] font-medium"
                style={{ backgroundColor: '#043E6C', color: '#fff' }}
              >
                상세보기
              </span>
            </button>

            {/* 2. 지번 행 — 있으면 복사, 실패·없음은 안내만 */}
            {jibunReady ? (
              <button
                type="button"
                onClick={() => void copyAndClose(jibun)}
                className={cn(ROW_HOVER, 'flex items-center gap-2 border-b-0 px-2.5 py-2')}
              >
                <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[12px] font-semibold text-emerald-700">
                  지번
                </span>
                <span className="min-w-0 flex-1 break-all font-medium">{jibun}</span>
                <span className="shrink-0 text-[12px] text-[#767676]">{COPY_LABEL}</span>
              </button>
            ) : (
              <div className="flex w-full items-center gap-2 border-b-0 px-2.5 py-2 text-left">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[12px] font-semibold text-muted-foreground">
                  지번
                </span>
                <span className="min-w-0 flex-1 break-all font-medium text-muted-foreground">
                  {addressError ? ADDRESS_FETCH_ERROR_MSG : '해당 위치에 지번 주소가 없습니다.'}
                </span>
              </div>
            )}

            {/* 3. 도로명 행 — 있으면 복사, 실패·없음은 안내만(hover 없음) */}
            {roadReady ? (
              <button
                type="button"
                onClick={() => void copyAndClose(road)}
                className={cn(ROW_HOVER, 'flex items-center gap-2 border-[#c8c8c8] px-2.5 py-2')}
              >
                <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[12px] font-semibold text-blue-700">
                  도로명
                </span>
                <span className="min-w-0 flex-1 break-all font-medium">{road}</span>
                <span className="shrink-0 text-[12px] text-[#767676]">{COPY_LABEL}</span>
              </button>
            ) : (
              <div className="flex w-full items-center gap-2 border-b border-[#c8c8c8] px-2.5 py-2 text-left">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[12px] font-semibold text-muted-foreground">
                  도로명
                </span>
                <span className="min-w-0 flex-1 break-all font-medium text-muted-foreground">
                  {addressError ? ADDRESS_FETCH_ERROR_MSG : ROAD_MISSING_MSG}
                </span>
              </div>
            )}

            {/* 4. 위치정보 + X/Y 좌표 — 한 덩어리, 클릭 시 좌표 복사 */}
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => {
                const t = e.target as HTMLElement;
                if (t.tagName === 'SELECT' || t.closest('select')) return;
                void copyAndClose(coordText);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                const t = e.target as HTMLElement;
                if (t.tagName === 'SELECT' || t.closest('select')) return;
                e.preventDefault();
                void copyAndClose(coordText);
              }}
              className={cn(
                ROW_HOVER,
                'block border-[#c8c8c8]',
                !canCopyText(coordText) && 'cursor-default hover:bg-transparent'
              )}
            >
              <div className="flex items-center justify-between gap-6 px-2.5 py-2.5">
                <div className="flex min-w-0 items-center gap-1 pr-4">
                  <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                  <span className="shrink-0 font-medium text-[#333]">위치정보</span>
                  <select
                    value={selectedCrs}
                    onChange={(e) => setSelectedCrs(e.target.value)}
                    className="ml-1 w-[270px] shrink-0 truncate border border-[#c8c8c8] bg-white px-1.5 py-0.5 text-[12px] leading-normal focus-visible:outline-none"
                    title="좌표계"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {COORDINATE_SYSTEM_OPTIONS.map((opt) => (
                      <option key={opt.code} value={opt.code}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <span className="shrink-0 pl-2 text-[12px] text-[#767676]">{COPY_LABEL}</span>
              </div>
              <div className="pb-1">
                <div className="flex items-center gap-2.5 px-2.5 py-1.5 font-medium">
                  <span
                    className={COORD_LABEL_BADGE}
                    style={{ backgroundColor: '#b7b7b7', color: '#fff' }}
                  >
                    X 좌표
                  </span>
                  <span className="tabular-nums text-[12px]">{xy ? String(xy.x) : '-'}</span>
                </div>
                <div className="flex items-center gap-2.5 px-2.5 py-1.5 font-medium">
                  <span
                    className={COORD_LABEL_BADGE}
                    style={{ backgroundColor: '#b7b7b7', color: '#fff' }}
                  >
                    Y 좌표
                  </span>
                  <span className="tabular-nums text-[12px]">{xy ? String(xy.y) : '-'}</span>
                </div>
              </div>
            </div>

            {/* 5. 아이콘 — 각각 hover/클릭 (조회 중 opacity 깜빡임 없음) */}
            <div className="flex w-full items-center">
              <button
                type="button"
                title="카카오맵"
                disabled={mapsDisabled}
                className={ICON_BTN}
                onClick={() => {
                  if (!externalQuery) return;
                  openExternalMapByAddress('kakao', externalQuery);
                }}
              >
                <img
                  src={withBasePath('/image/addressInfoIcon/kakaoMap_icon.svg')}
                  alt=""
                  className="h-6 w-6 object-contain"
                />
              </button>
              <button
                type="button"
                title="네이버지도"
                disabled={mapsDisabled}
                className={ICON_BTN}
                onClick={() => {
                  if (!externalQuery) return;
                  openExternalMapByAddress('naver', externalQuery);
                }}
              >
                <img
                  src={withBasePath('/image/addressInfoIcon/naverMap_icon.svg')}
                  alt=""
                  className="h-6 w-6 object-contain"
                />
              </button>
              <button
                type="button"
                title="구글지도"
                disabled={mapsDisabled}
                className={ICON_BTN}
                onClick={() => {
                  if (!externalQuery) return;
                  openExternalMapByAddress('google', externalQuery);
                }}
              >
                <img
                  src={withBasePath('/image/addressInfoIcon/googleMap_icon.svg')}
                  alt=""
                  className="h-6 w-6 object-contain"
                />
              </button>
              <button
                type="button"
                title="토지이음"
                disabled={eumDisabled}
                className={ICON_BTN}
                onClick={() => {
                  if (!eumReady) return;
                  openEumLand(pnu);
                }}
              >
                <img
                  src={withBasePath('/image/addressInfoIcon/landEum_icon.png')}
                  alt=""
                  className="h-6 w-6 object-contain"
                />
              </button>
              <button
                type="button"
                title="이음지도"
                disabled={eumDisabled}
                className={ICON_BTN}
                onClick={() => {
                  if (!eumReady) return;
                  openEumMap(pnu);
                }}
              >
                <img
                  src={withBasePath('/image/addressInfoIcon/eumMap_icon.svg')}
                  alt=""
                  className="h-6 w-[28px] object-contain"
                />
              </button>
              <button
                type="button"
                title="도시계획도"
                disabled={eumDisabled}
                className={ICON_BTN}
                onClick={() => {
                  if (!eumReady) return;
                  openEumUrbanPlan(pnu);
                }}
              >
                <img
                  src={withBasePath('/image/addressInfoIcon/urbanPlan_icon.svg')}
                  alt=""
                  className="h-6 w-6 object-contain"
                />
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {toastPortal}
    </>
  );
}
