'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { PannellumViewer, type PannellumViewerHandle } from './PannellumViewer';
import { PanoViewerNav } from './PanoViewerNav';
import { PanoViewerInsetMap } from './PanoViewerInsetMap';
import { AerialViewerMetaChip } from './AerialViewerMetaChip';
import type { WorkFileItem } from './aerialMediaTypes';

function mediaUrl(relativePath: string): string {
  return `/api/aerial/media?${new URLSearchParams({
    path: relativePath.replace(/\\/g, '/'),
  }).toString()}`;
}

/** 왼쪽 메뉴를 뺀 보이는 지도 칸. 항공뷰 화면과 같은 자리 */
function useVisibleMapBox() {
  const [box, setBox] = useState<{ top: number; left: number; width: string; height: number } | null>(
    null
  );

  useEffect(() => {
    const measure = () => {
      const aside = document.querySelector('aside');
      let left = aside ? Math.round(aside.getBoundingClientRect().right) : 0;
      document.querySelectorAll('.pointer-events-none.flex.h-full > .pointer-events-auto').forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width >= 80 && rect.left < window.innerWidth * 0.7) {
          left = Math.max(left, Math.round(rect.right));
        }
      });
      setBox({
        top: 0,
        left,
        width: `calc(100vw - ${left}px)`,
        height: window.innerHeight,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return box;
}

/** 오른쪽 항공뷰 점 — 목록 없이, 기존 항공뷰와 같은 영역·조작 막대·왼쪽 아래 지도 */
export function AerialPanoPointViewer({
  file,
  files,
  workName,
  shotDate,
  photographer,
  onClose,
  onSelect,
  onPickPoint,
}: {
  file: WorkFileItem;
  files: WorkFileItem[];
  workName?: string;
  shotDate?: string;
  photographer?: string;
  onClose: () => void;
  onSelect: (fileId: string) => void;
  onPickPoint: (unitId: string, fileId: string) => void;
}) {
  const [controls, setControls] = useState<PannellumViewerHandle | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const box = useVisibleMapBox();
  const index = files.findIndex((item) => item.id === file.id);
  const safeIndex = index >= 0 ? index : 0;
  const total = Math.max(files.length, 1);
  const prev = index > 0 ? files[index - 1] : null;
  const next = index >= 0 && index < files.length - 1 ? files[index + 1] : null;

  if (!box || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed z-[5] flex flex-col overflow-hidden bg-slate-900"
      style={box}
    >
      <div className="relative min-h-0 flex-1 bg-slate-900">
        {file.relativePath ? (
          <PannellumViewer
            key={file.id}
            imageUrl={mediaUrl(file.relativePath)}
            onControlsReady={(api) => {
              setControls(api);
              if (!api) setSceneReady(false);
            }}
            onSceneLoad={() => setSceneReady(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-slate-300">
            미리보기 경로가 없습니다
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="pointer-events-auto absolute right-4 top-4 z-40 inline-flex items-center gap-1 rounded-md bg-black/60 px-2.5 py-1.5 text-[12px] font-medium text-white shadow-md hover:bg-black/75"
          aria-label="닫기"
        >
          <X className="h-3.5 w-3.5" />
          닫기
        </button>
        <PanoViewerNav
          fileName={file.name}
          index={safeIndex}
          total={total}
          canPrev={prev != null}
          canNext={next != null}
          onPrev={() => {
            if (prev) onSelect(prev.id);
          }}
          onNext={() => {
            if (next) onSelect(next.id);
          }}
          onZoomIn={controls ? () => controls.zoomIn() : undefined}
          onZoomOut={controls ? () => controls.zoomOut() : undefined}
          onClose={onClose}
        />
        <AerialViewerMetaChip workName={workName} shotDate={shotDate} photographer={photographer} />
        {sceneReady ? <PanoViewerInsetMap file={file} onPick={onPickPoint} /> : null}
      </div>
    </div>,
    document.body
  );
}
