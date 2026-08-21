'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  onClose: () => void;
  /** EPSG:5181 점 목록 — 1개 점 / 2개 이상 점+선 */
  onApplyCoords: (coords5181: [number, number][]) => void;
};

/**
 * 숫자 토큰을 짝으로 묶어 EPSG:5181 좌표 목록.
 * 한 줄·여러 줄·쉼표 구분 모두 허용. 타이핑 중 홀수 개는 무시.
 */
function parseCoords5181List(raw: string): {
  coords: [number, number][];
  rejectedWgs84: boolean;
  incomplete: boolean;
} {
  const tokens = raw
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (tokens.length === 0) {
    return { coords: [], rejectedWgs84: false, incomplete: false };
  }
  if (tokens.length % 2 !== 0) {
    return { coords: [], rejectedWgs84: false, incomplete: true };
  }

  const coords: [number, number][] = [];
  let rejectedWgs84 = false;
  for (let i = 0; i < tokens.length; i += 2) {
    const x = Number(tokens[i]);
    const y = Number(tokens[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { coords: [], rejectedWgs84: false, incomplete: true };
    }
    if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
      rejectedWgs84 = true;
      continue;
    }
    coords.push([x, y]);
  }
  return { coords, rejectedWgs84, incomplete: false };
}

const AUTO_APPLY_MS = 400;

export function MapPrintCoordPanel({ onClose, onApplyCoords }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [appliedHint, setAppliedHint] = useState<string | null>(null);
  const lastAppliedRef = useRef('');
  const onApplyRef = useRef(onApplyCoords);
  onApplyRef.current = onApplyCoords;

  useEffect(() => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError(null);
      setAppliedHint(null);
      if (lastAppliedRef.current !== '') {
        lastAppliedRef.current = '';
        onApplyRef.current([]);
      }
      return;
    }

    const t = window.setTimeout(() => {
      const { coords, rejectedWgs84, incomplete } = parseCoords5181List(trimmed);
      if (incomplete) {
        setError(null);
        setAppliedHint(null);
        return;
      }
      if (coords.length === 0) {
        setError(
          rejectedWgs84
            ? '경위도가 아닌 EPSG:5181 좌표를 입력하세요.'
            : 'EPSG:5181 좌표를 입력하세요. 예: 418091.2282 372519.5629'
        );
        setAppliedHint(null);
        return;
      }
      if (trimmed === lastAppliedRef.current) return;

      setError(null);
      onApplyRef.current(coords);
      lastAppliedRef.current = trimmed;
      setAppliedHint(
        coords.length === 1
          ? `점 1개 (${coords[0][0].toFixed(2)}, ${coords[0][1].toFixed(2)})`
          : `점 ${coords.length}개 · 선으로 연결`
      );
    }, AUTO_APPLY_MS);

    return () => window.clearTimeout(t);
  }, [text]);

  return (
    <div className="map-print-coord-panel map-print-ignore">
      <div className="mb-2 font-medium text-foreground">좌표 입력 (EPSG:5181)</div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        X Y 한 쌍이면 점, 여러 쌍이면 점으로 찍고 선으로 연결합니다. 입력 시 자동 적용됩니다.
      </p>
      <textarea
        className="mb-2 h-28 w-full resize-y rounded border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'예:\n418091.2282 372519.5629\n420100.0 373200.0'}
        spellCheck={false}
      />
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      {!error && appliedHint && <p className="mb-2 text-xs text-primary">{appliedHint}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          title="닫기"
          className="cursor-pointer rounded border border-border px-3 py-1 text-sm text-foreground hover:bg-muted"
          onClick={onClose}
        >
          닫기
        </button>
      </div>
    </div>
  );
}
