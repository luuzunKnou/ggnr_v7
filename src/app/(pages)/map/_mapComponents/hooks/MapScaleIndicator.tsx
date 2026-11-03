'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type Map from 'ol/Map';
import { applyScaleMeters, formatScaleFromMap, parseScaleInput } from './mapScale';
import './mapScaleLine.css';

/** 사이드바·목록 패널 오른쪽 여백(px) — 기존 left:81 = 65+16 과 동일 */
const SCALE_GAP_AFTER_PANEL_PX = 16;

type Props = {
  map: Map | null;
  mapReady: boolean;
  /** true면 값을 고쳐 줌을 맞출 수 있음 */
  editable?: boolean;
  /** overlay: 지도 위 막대 / toolbar: 도구줄 입력 */
  variant?: 'overlay' | 'toolbar';
  className?: string;
  /**
   * 사이드바+목록 패널 폭. 있으면 body 포털·fixed로 목록(z-10) 위·지도 좌하단에 표시.
   * 인쇄 푸터 등 인라인 배치에서는 생략.
   */
  mapPaddingLeft?: number;
};

/**
 * 지도 좌측 하단 축척 — 줌에 따라 거리 표시 (글자 + 얇은 밑선).
 */
export function MapScaleIndicator({
  map,
  mapReady,
  editable = false,
  variant = 'overlay',
  className,
  mapPaddingLeft,
}: Props) {
  const [text, setText] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [portalReady, setPortalReady] = useState(false);
  const editingRef = useRef(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!mapReady || !map) {
      setText(null);
      setDraft('');
      return;
    }
    const view = map.getView();
    const update = () => {
      if (editingRef.current) return;
      const next = formatScaleFromMap(map);
      setText(next);
      setDraft(next ?? '');
    };
    update();
    view.on('change:resolution', update);
    map.on('moveend', update);
    return () => {
      view.un('change:resolution', update);
      map.un('moveend', update);
    };
  }, [map, mapReady]);

  const commit = () => {
    editingRef.current = false;
    if (!map) return;
    const meters = parseScaleInput(draft, text);
    if (meters == null || !applyScaleMeters(map, meters)) {
      setDraft(text ?? '');
    }
  };

  if (!text && !editable) return null;

  const inner = editable ? (
    <input
      className="ggnr-scale-bar-input"
      type="text"
      inputMode="decimal"
      value={draft}
      aria-label="축척"
      placeholder="예: 3.84km"
      title="축척을 입력하세요. 예: 3.84km. Enter로 적용"
      onFocus={() => {
        editingRef.current = true;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          editingRef.current = false;
          setDraft(text ?? '');
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  ) : (
    text
  );

  const dockToMap =
    variant === 'overlay' && mapPaddingLeft != null && portalReady;

  const bar = (
    <div
      className={`ggnr-scale-bar ggnr-scale-bar-${variant}${dockToMap ? ' ggnr-scale-bar-fixed' : ''}${editable ? ' is-editable' : ''}${className ? ` ${className}` : ''}`}
      style={
        dockToMap
          ? { left: Math.max(0, mapPaddingLeft) + SCALE_GAP_AFTER_PANEL_PX }
          : undefined
      }
    >
      <div className="ggnr-scale-bar-inner">{inner}</div>
    </div>
  );

  if (dockToMap) {
    return createPortal(bar, document.body);
  }
  return bar;
}
