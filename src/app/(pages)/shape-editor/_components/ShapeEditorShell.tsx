'use client';

import { useEffect, useState } from 'react';
import { call } from '@/lib/api';
import { requestShapeEditorFullscreen } from '@/lib/shapeEditorWindow';
import { loadPersistedMapState } from '../../map/_mapComponents/hooks/useMapStatePersist';
import {
  defaultBackgroundMapGroups,
  type BackgroundMapGroup,
} from '../../map/_mapComponents/mapControlPanel/backgroundMapSelector';
import { useShapeEditorContext } from '../ShapeEditorContext';
import { useShapeEditorLayerCatalog } from '../_hooks/useShapeEditorLayerCatalog';
import { ShapeEditorMap } from '../ShapeEditorMap';
import { ShapeEditorTopBar } from './ShapeEditorTopBar';
import { ShapeEditorToolSidebar } from './ShapeEditorToolSidebar';
import { ShapeEditorRightPanel } from './ShapeEditorRightPanel';
import { ShapeEditorFloatingHint } from './ShapeEditorFloatingHint';

const DEFAULT_BACKGROUND = 'aerial-2022';

type ShapeEditorShellProps = {
  projectName: string;
  defaultCenter?: { lon: number; lat: number } | null;
};

export function ShapeEditorShell({ projectName, defaultCenter }: ShapeEditorShellProps) {
  const { activeEditLayer, toolMode, draft } = useShapeEditorContext();
  const { layerGroups, loading, error } = useShapeEditorLayerCatalog();

  const persistKey = `${projectName}:shape-editor`;
  const [backgroundMapId, setBackgroundMapId] = useState(DEFAULT_BACKGROUND);
  const [backgroundGroups, setBackgroundGroups] = useState<BackgroundMapGroup[]>(
    defaultBackgroundMapGroups
  );

  const showEditBorder =
    !!activeEditLayer && (toolMode === 'draw' || draft.hasGeometry);

  useEffect(() => {
    requestShapeEditorFullscreen();
  }, []);

  useEffect(() => {
    const persisted = loadPersistedMapState(persistKey);
    if (persisted?.backgroundMap) setBackgroundMapId(persisted.backgroundMap);
  }, [persistKey]);

  useEffect(() => {
    let cancelled = false;
    const buildLabelFromOrthoFolder = (id: string): string | null => {
      const m = /^satellite_(\d{4})(?:_([^_]+)(?:_(.+))?)?$/i.exec(id);
      if (!m) return null;
      const year = m[1];
      const seg3 = (m[2] ?? '').trim();
      const seg4 = (m[3] ?? '').trim();
      if (/^\d+$/.test(seg3)) return seg4 || `항공영상(${year})`;
      return seg3 || `항공영상(${year})`;
    };
    call('', 'POST', {
      service: 'orthophotoService',
      action: 'listOrthophotoTileOutputs',
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const d = (res?.data ?? res) as {
          groups?: { groupName: string; tileSetIds: string[] }[];
          legacyTileSetIds?: string[];
        };
        const idSet = new Set<string>();
        for (const id of d.legacyTileSetIds ?? []) idSet.add(id);
        for (const g of d.groups ?? []) idSet.add(g.groupName);
        const opts = Array.from(idSet)
          .map((id) => {
            const label = buildLabelFromOrthoFolder(id);
            return label ? { id, label } : null;
          })
          .filter((x): x is { id: string; label: string } => x != null)
          .sort((a, b) => b.id.localeCompare(a.id));
        if (opts.length === 0) return;
        setBackgroundGroups((prev) =>
          prev.map((g) => (g.id === 'custom-aerial' ? { ...g, options: opts } : g))
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-slate-100">
      <ShapeEditorTopBar
        layerGroups={layerGroups}
        layerLoading={loading}
        layerError={error}
      />

      <div className="flex min-h-0 flex-1">
        {/* 좌 48px 도구 */}
        <ShapeEditorToolSidebar
          backgroundMapId={backgroundMapId}
          onBackgroundMapChange={setBackgroundMapId}
          backgroundGroups={backgroundGroups}
        />

        {/* 중앙 지도 */}
        <div className="relative min-w-0 flex-1">
          <ShapeEditorMap
            projectName={projectName}
            defaultCenter={defaultCenter}
            backgroundMapId={backgroundMapId}
          />
          <ShapeEditorFloatingHint />
          {showEditBorder ? (
            <div
              className="pointer-events-none absolute inset-0 z-10 box-border border-2 border-red-500"
              aria-hidden
            />
          ) : null}
        </div>

        {/* 우 작업내역·스냅 */}
        <ShapeEditorRightPanel />
      </div>
    </div>
  );
}
