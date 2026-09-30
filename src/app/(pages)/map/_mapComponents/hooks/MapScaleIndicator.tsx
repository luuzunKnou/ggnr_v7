'use client';

import { useEffect, useRef, useState } from 'react';
import type Map from 'ol/Map';
import { applyScaleMeters, formatScaleFromMap, parseScaleInput } from './mapScale';
import './mapScaleLine.css';

type Props = {
  map: Map | null;
  mapReady: boolean;
  /** true면 값을 고쳐 줌을 맞출 수 있음 */
  editable?: boolean;
  /** overlay: 지도 위 막대 / toolbar: 도구줄 입력 */
  variant?: 'overlay' | 'toolbar';
  className?: string;
};

/**
 * 지도 우측 하단 축척 — 줌에 따라 거리 표시 (글자 + 얇은 밑선).
 * editable이면 숫자를 입력해 축척을 맞춘다.
 */
export function MapScaleIndicator({
  map,
  mapReady,
  editable = false,
  variant = 'overlay',
  className,
}: Props) {
  const [text, setText] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const editingRef = useRef(false);

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

  return (
    <div
      className={`ggnr-scale-bar ggnr-scale-bar-${variant}${editable ? ' is-editable' : ''}${className ? ` ${className}` : ''}`}
    >
      <div className="ggnr-scale-bar-inner">{inner}</div>
    </div>
  );
}
