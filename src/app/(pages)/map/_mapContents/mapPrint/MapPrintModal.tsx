'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';
import tables from '@/config/defineLayer/tables.json';
import { BackgroundMapSelector, type BackgroundMapGroup } from '@/app/(pages)/map/_mapComponents/mapControlPanel/backgroundMapSelector';
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
import {
  MapPrintLayerPanel,
  type PrintControlLayerId,
} from './MapPrintLayerPanel';
import './mapPrint.css';

function setFromSnapshot(names: string[] | null | undefined): Set<string> {
  return new Set(names ?? []);
}

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
  const [visibleCadastral, setVisibleCadastral] = useState<Set<string>>(() =>
    setFromSnapshot(snapshot?.visibleCadastralLayerNames)
  );
  const [visibleBuildingRoad, setVisibleBuildingRoad] = useState<Set<string>>(() =>
    setFromSnapshot(snapshot?.visibleBuildingRoadLayerNames)
  );
  const [visibleJimok, setVisibleJimok] = useState<Set<string>>(() =>
    setFromSnapshot(snapshot?.visibleJimokLayerNames)
  );
  const [visibleLandown, setVisibleLandown] = useState<Set<string>>(() =>
    setFromSnapshot(snapshot?.visibleLandownLayerNames)
  );
  const [visibleThematic, setVisibleThematic] = useState<Set<string>>(() =>
    setFromSnapshot(snapshot?.visibleThematicLayerNames)
  );
  const [openControlId, setOpenControlId] = useState<PrintControlLayerId | null>(null);
  const [scaleText, setScaleText] = useState('—');
  const [printedAt, setPrintedAt] = useState(() => formatPrintDateTime());
  const [busy, setBusy] = useState(false);

  const syncControlActive = useCallback((controlId: string, selected: Set<string>) => {
    setActiveLayerControls((prev) => {
      if (selected.size === 0) return prev.filter((x) => x !== controlId);
      return prev.includes(controlId) ? prev : [...prev, controlId];
    });
  }, []);

  useEffect(() => {
    if (!open || !snapshot) return;
    setBackgroundMapId(snapshot.backgroundMapId);
    setVisibleNames(new Set(snapshot.visibleLayerNames));
    setVisibleCadastral(setFromSnapshot(snapshot.visibleCadastralLayerNames));
    setVisibleBuildingRoad(setFromSnapshot(snapshot.visibleBuildingRoadLayerNames));
    setVisibleJimok(setFromSnapshot(snapshot.visibleJimokLayerNames));
    setVisibleLandown(setFromSnapshot(snapshot.visibleLandownLayerNames));
    setVisibleThematic(setFromSnapshot(snapshot.visibleThematicLayerNames));
    // 메인에서 실제로 선택된 컨트롤만 유지 (null=전체 켜기 해석 금지)
    const nextControls = (snapshot.activeLayerControls ?? []).filter((id) => {
      if (id === 'basic-section') return true;
      if (id === 'cadastral') return (snapshot.visibleCadastralLayerNames?.length ?? 0) > 0;
      if (id === 'building-road') return (snapshot.visibleBuildingRoadLayerNames?.length ?? 0) > 0;
      if (id === 'land-category') return (snapshot.visibleJimokLayerNames?.length ?? 0) > 0;
      if (id === 'ownership') return (snapshot.visibleLandownLayerNames?.length ?? 0) > 0;
      if (id === 'thematic-map') return (snapshot.visibleThematicLayerNames?.length ?? 0) > 0;
      return true;
    });
    setActiveLayerControls(nextControls);
    setActiveTool(null);
    setSidePanel(null);
    setOpenControlId(null);
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

  const stopElevationTool = useCallback(() => {
    setActiveTool((prev) => (prev === 'elevation' ? null : prev));
  }, []);

  const { deleteSelected, undo, redo, clearAll, applyCoordInput5181 } = useMapPrintTools(
    map,
    activeTool,
    color,
    stopElevationTool
  );

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
    setVisibleCadastral(new Set());
    setVisibleBuildingRoad(new Set());
    setVisibleJimok(new Set());
    setVisibleLandown(new Set());
    setVisibleThematic(new Set());
    setOpenControlId(null);
  }, []);

  const handleCadastralChange = useCallback(
    (next: Set<string>) => {
      setVisibleCadastral(next);
      syncControlActive('cadastral', next);
    },
    [syncControlActive]
  );
  const handleBuildingRoadChange = useCallback(
    (next: Set<string>) => {
      setVisibleBuildingRoad(next);
      syncControlActive('building-road', next);
    },
    [syncControlActive]
  );
  const handleJimokChange = useCallback(
    (next: Set<string>) => {
      setVisibleJimok(next);
      syncControlActive('land-category', next);
    },
    [syncControlActive]
  );
  const handleLandownChange = useCallback(
    (next: Set<string>) => {
      setVisibleLandown(next);
      syncControlActive('ownership', next);
    },
    [syncControlActive]
  );
  const handleThematicChange = useCallback(
    (next: Set<string>) => {
      setVisibleThematic(next);
      syncControlActive('thematic-map', next);
    },
    [syncControlActive]
  );
  const handleToggleBasicSection = useCallback(() => {
    setActiveLayerControls((prev) =>
      prev.includes('basic-section')
        ? prev.filter((x) => x !== 'basic-section')
        : [...prev, 'basic-section']
    );
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
          onToggleLayers={() => {
            setSidePanel((p) => {
              if (p === 'layer') {
                setOpenControlId(null);
                return null;
              }
              return 'layer';
            });
          }}
          onToggleBackground={() => {
            setOpenControlId(null);
            setSidePanel((p) => (p === 'background' ? null : 'background'));
          }}
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
            <MapPrintLayerPanel
              layerList={layerList}
              visibleNames={visibleNames}
              onServiceSelectionChange={setVisibleNames}
              layerKorName={layerKorName}
              activeLayerControls={activeLayerControls}
              openControlId={openControlId}
              onOpenControl={setOpenControlId}
              visibleCadastral={visibleCadastral}
              visibleBuildingRoad={visibleBuildingRoad}
              visibleJimok={visibleJimok}
              visibleLandown={visibleLandown}
              visibleThematic={visibleThematic}
              onCadastralChange={handleCadastralChange}
              onBuildingRoadChange={handleBuildingRoadChange}
              onJimokChange={handleJimokChange}
              onLandownChange={handleLandownChange}
              onThematicChange={handleThematicChange}
              onToggleBasicSection={handleToggleBasicSection}
            />
          )}
          {sidePanel === 'coord' && (
            <div className="map-print-side-panel map-print-ignore" style={{ left: 12, right: 'auto' }}>
              <MapPrintCoordPanel
                onClose={() => setSidePanel(null)}
                onApplyCoords={applyCoordInput5181}
              />
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
