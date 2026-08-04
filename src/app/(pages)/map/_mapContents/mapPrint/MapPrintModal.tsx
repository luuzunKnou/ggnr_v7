'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';
import tables from '@/config/defineLayer/tables.json';
import { BackgroundMapSelector, type BackgroundMapGroup } from '@/app/(pages)/map/_mapComponents/mapControlPanel/backgroundMapSelector';
import { getLegendGraphicUrl } from '@/app/(pages)/map/_mapComponents/layerFactory/serviceLayerFactory';
import {
  DEFAULT_PRINT_COLOR,
  type MapPrintSidePanel,
  type MapPrintSnapshot,
  type MapPrintTool,
} from './mapPrintTypes';
import { downloadMapPrintImage, formatPrintDateTime, formatPrintScaleMeters, printMapPrintPaper } from './mapPrintCapture';
import { useMapPrintMap } from './useMapPrintMap';
import { useMapPrintTools } from './useMapPrintTools';
import { MapPrintToolbar } from './MapPrintToolbar';
import { MapPrintCoordPanel } from './MapPrintCoordPanel';
import './mapPrint.css';

type DefineTableRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
};

const TABLE_KOR_BY_NAME: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const row of tables as DefineTableRow[]) {
    const name = String(row.define_table_name ?? '').trim();
    if (!name) continue;
    const kor = String(row.define_table_kor_name ?? '').trim();
    map[name] = kor || name;
  }
  return map;
})();

function layerKorName(tableName: string): string {
  return TABLE_KOR_BY_NAME[tableName] ?? tableName;
}

type Props = {
  open: boolean;
  onClose: () => void;
  snapshot: MapPrintSnapshot | null;
  backgroundMapGroups: BackgroundMapGroup[];
};

export function MapPrintModal({ open, onClose, snapshot, backgroundMapGroups }: Props) {
  const { data: session } = useSession();
  const paperRef = useRef<HTMLDivElement>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);

  const [color, setColor] = useState(DEFAULT_PRINT_COLOR);
  const [activeTool, setActiveTool] = useState<MapPrintTool>(null);
  const [sidePanel, setSidePanel] = useState<MapPrintSidePanel>(null);
  const [backgroundMapId, setBackgroundMapId] = useState(snapshot?.backgroundMapId ?? 'aerial-vworld');
  const [visibleNames, setVisibleNames] = useState<Set<string>>(
    () => new Set(snapshot?.visibleLayerNames ?? [])
  );
  const [activeLayerControls, setActiveLayerControls] = useState<string[]>(
    () => snapshot?.activeLayerControls ?? []
  );
  const [scaleText, setScaleText] = useState('—');
  const [printedAt, setPrintedAt] = useState(() => formatPrintDateTime());
  const [busy, setBusy] = useState(false);

  const visibleCadastral = useMemo(
    () => (snapshot?.visibleCadastralLayerNames ? new Set(snapshot.visibleCadastralLayerNames) : null),
    [snapshot]
  );
  const visibleBuildingRoad = useMemo(
    () =>
      snapshot?.visibleBuildingRoadLayerNames
        ? new Set(snapshot.visibleBuildingRoadLayerNames)
        : null,
    [snapshot]
  );
  const visibleJimok = useMemo(
    () => (snapshot?.visibleJimokLayerNames ? new Set(snapshot.visibleJimokLayerNames) : null),
    [snapshot]
  );
  const visibleLandown = useMemo(
    () => (snapshot?.visibleLandownLayerNames ? new Set(snapshot.visibleLandownLayerNames) : null),
    [snapshot]
  );
  const visibleThematic = useMemo(
    () =>
      snapshot?.visibleThematicLayerNames ? new Set(snapshot.visibleThematicLayerNames) : null,
    [snapshot]
  );

  useEffect(() => {
    if (!open || !snapshot) return;
    setBackgroundMapId(snapshot.backgroundMapId);
    setVisibleNames(new Set(snapshot.visibleLayerNames));
    setActiveLayerControls(snapshot.activeLayerControls);
    setActiveTool(null);
    setSidePanel(null);
    setColor(DEFAULT_PRINT_COLOR);
    setPrintedAt(formatPrintDateTime());
  }, [open, snapshot]);

  const { map } = useMapPrintMap(
    mapHostRef,
    open,
    snapshot,
    backgroundMapId,
    visibleNames,
    activeLayerControls,
    visibleCadastral,
    visibleBuildingRoad,
    visibleJimok,
    visibleLandown,
    visibleThematic
  );

  const { deleteSelected, undo, redo, clearAll } = useMapPrintTools(map, activeTool, color);

  useEffect(() => {
    if (!map) return;
    const update = () => setScaleText(formatPrintScaleMeters(map));
    update();
    map.on('moveend', update);
    return () => {
      map.un('moveend', update);
    };
  }, [map]);

  const userName = String(session?.user?.name ?? '').trim() || '게스트';

  const handleSaveImage = useCallback(async () => {
    if (!paperRef.current || busy) return;
    setBusy(true);
    setSidePanel(null);
    try {
      map?.renderSync();
      await downloadMapPrintImage(paperRef.current, map);
    } catch (e) {
      console.error(e);
      window.alert('이미지 저장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }, [busy, map]);

  const handlePrint = useCallback(() => {
    if (!paperRef.current) return;
    setSidePanel(null);
    setPrintedAt(formatPrintDateTime());
    map?.renderSync();
    window.setTimeout(() => {
      if (paperRef.current) printMapPrintPaper(paperRef.current);
    }, 100);
  }, [map]);

  const toggleLayerName = (name: string) => {
    setVisibleNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const layerList = useMemo(() => {
    const names = new Set(snapshot?.visibleLayerNames ?? []);
    visibleNames.forEach((n) => names.add(n));
    return Array.from(names).sort((a, b) =>
      layerKorName(a).localeCompare(layerKorName(b), 'ko')
    );
  }, [snapshot, visibleNames]);

  const clearAllLayers = useCallback(() => {
    setVisibleNames(new Set());
    setActiveLayerControls([]);
  }, []);

  if (!open || !snapshot) return null;

  return createPortal(
    <div
      className="map-print-root"
      role="dialog"
      aria-modal="true"
      aria-label="지도 인쇄"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={paperRef} className="map-print-paper" id="map-print-paper">
        <MapPrintToolbar
          color={color}
          onColorChange={setColor}
          activeTool={activeTool}
          onToolChange={setActiveTool}
          onCoordOpen={() => setSidePanel((p) => (p === 'coord' ? null : 'coord'))}
          onDeleteSelected={deleteSelected}
          onUndo={undo}
          onRedo={redo}
          onClear={clearAll}
          onSaveImage={() => void handleSaveImage()}
          onPrint={handlePrint}
          onClearLayers={clearAllLayers}
          onToggleLayers={() => setSidePanel((p) => (p === 'layer' ? null : 'layer'))}
          onToggleBackground={() => setSidePanel((p) => (p === 'background' ? null : 'background'))}
          onClose={onClose}
          layerPanelOpen={sidePanel === 'layer'}
          backgroundPanelOpen={sidePanel === 'background'}
        />

        <div className="map-print-map-host">
          <div ref={mapHostRef} className="absolute inset-0" />
          {sidePanel === 'background' && (
            <div className="map-print-side-panel map-print-ignore">
              <BackgroundMapSelector
                groups={backgroundMapGroups}
                value={backgroundMapId}
                onValueChange={setBackgroundMapId}
              />
            </div>
          )}
          {sidePanel === 'layer' && (
            <div className="map-print-side-panel map-print-ignore">
              <div className="w-56 rounded-[5px] bg-white/95 p-2 shadow-xl dark:bg-black/50">
                <div className="mb-2 flex gap-2 px-1">
                  <button
                    type="button"
                    className="text-xs text-blue-600"
                    onClick={() => setVisibleNames(new Set(layerList))}
                  >
                    전체 선택
                  </button>
                  <button
                    type="button"
                    className="text-xs text-slate-500"
                    onClick={() => setVisibleNames(new Set())}
                  >
                    전체 해제
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto scrollbar-thin">
                  {layerList.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-slate-500">켜진 업무 레이어가 없습니다.</p>
                  ) : (
                    layerList.map((name) => (
                      <label
                        key={name}
                        className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs hover:bg-slate-50"
                      >
                        <span className="h-4 w-4 shrink-0 overflow-hidden rounded-full bg-transparent">
                          <img
                            src={getLegendGraphicUrl(name)}
                            alt=""
                            className="h-full w-full object-contain"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        </span>
                        <span className="min-w-0 flex-1 truncate" title={name}>
                          {layerKorName(name)}
                        </span>
                        <input
                          type="checkbox"
                          checked={visibleNames.has(name)}
                          onChange={() => toggleLayerName(name)}
                          className="shrink-0"
                        />
                      </label>
                    ))
                  )}
                </div>
                <div className="mt-2 border-t border-slate-100 pt-2">
                  <p className="mb-1 px-1 text-[11px] text-slate-400">지도 컨트롤 레이어</p>
                  {(
                    [
                      ['cadastral', '지적도'],
                      ['building-road', '건물·도로'],
                      ['basic-section', '기초구간'],
                      ['land-category', '지목'],
                      ['ownership', '소유구분'],
                      ['thematic-map', '주제도'],
                    ] as const
                  ).map(([id, label]) => (
                    <label
                      key={id}
                      className="flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={activeLayerControls.includes(id)}
                        onChange={() => {
                          setActiveLayerControls((prev) =>
                            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                          );
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          {sidePanel === 'coord' && (
            <div className="map-print-side-panel map-print-ignore" style={{ left: 12, right: 'auto' }}>
              <MapPrintCoordPanel map={map} onClose={() => setSidePanel(null)} />
            </div>
          )}

          <div className="map-print-footer-left">
            본 지도는 참고용이며, 복제·배포 시 관련 규정을 확인하세요.
          </div>
          <div className="map-print-footer-right">
            <div>축척 {scaleText}</div>
            <div>담당자 : {userName}</div>
            <div>{printedAt}</div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
