'use client';

import { useEffect, useState } from 'react';
import { call } from '@/lib/api';
import { requestShapeEditorFullscreen } from '@/lib/shapeEditorWindow';
import {
  defaultBackgroundMapGroups,
  buildCustomAerialBackgroundOptions,
  FALLBACK_BACKGROUND_MAP_ID,
  pickLatestCustomAerialBackgroundId,
  type BackgroundMapGroup,
} from '../../map/_mapComponents/mapControlPanel/backgroundMapSelector';
import { loadPersistedMapState } from '../../map/_mapComponents/hooks/useMapStatePersist';
import { useShapeEditorLayerCatalog } from '../_hooks/useShapeEditorLayerCatalog';
import { useShapeEditorOverlayControls } from '../_hooks/useShapeEditorOverlayControls';
import { ShapeEditorMap } from '../ShapeEditorMap';
import { ShapeEditorTopBar } from './ShapeEditorTopBar';
import { ShapeEditorLayerPanel } from './ShapeEditorLayerPanel';
import { ShapeEditorRightPanel } from './ShapeEditorRightPanel';
import { ShapeEditorFloatingHint } from './ShapeEditorFloatingHint';

const DEFAULT_BACKGROUND = FALLBACK_BACKGROUND_MAP_ID;

type ShapeEditorShellProps = {
  projectName: string;
  defaultCenter?: { lon: number; lat: number } | null;
};

export function ShapeEditorShell({ projectName, defaultCenter }: ShapeEditorShellProps) {
  const { layerGroups, loading, error } = useShapeEditorLayerCatalog();
  const overlayControls = useShapeEditorOverlayControls();

  const persistKey = `${projectName}:shape-editor`;
  const [backgroundMapId, setBackgroundMapId] = useState(DEFAULT_BACKGROUND);
  const [backgroundGroups, setBackgroundGroups] = useState<BackgroundMapGroup[]>(
    defaultBackgroundMapGroups
  );

  useEffect(() => {
    requestShapeEditorFullscreen();
  }, []);

  useEffect(() => {
    const persisted = loadPersistedMapState(persistKey);
    if (persisted?.backgroundMap) setBackgroundMapId(persisted.backgroundMap);
  }, [persistKey]);

  useEffect(() => {
    let cancelled = false;
    call('', 'POST', {
      service: 'orthophotoService',
      action: 'listOrthophotoTileOutputs',
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const d = (res?.data ?? res) as Parameters<typeof buildCustomAerialBackgroundOptions>[0];
        const opts = buildCustomAerialBackgroundOptions(d);
        if (opts.length === 0) return;
        setBackgroundGroups((prev) =>
          prev.map((g) => (g.id === 'custom-aerial' ? { ...g, options: opts } : g))
        );
        const persisted = loadPersistedMapState(persistKey);
        if (!persisted?.backgroundMap) {
          const latest = pickLatestCustomAerialBackgroundId(d);
          if (latest) setBackgroundMapId(latest);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [persistKey]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-slate-100">
      <ShapeEditorTopBar overlayControls={overlayControls} />

      <div className="flex min-h-0 flex-1">
        <ShapeEditorLayerPanel
          layerGroups={layerGroups}
          layerLoading={loading}
          layerError={error}
          backgroundMapId={backgroundMapId}
          onBackgroundMapChange={setBackgroundMapId}
          backgroundGroups={backgroundGroups}
        />

        <div className="relative min-w-0 flex-1">
          <ShapeEditorMap
            projectName={projectName}
            defaultCenter={defaultCenter}
            backgroundMapId={backgroundMapId}
            overlayControls={overlayControls}
          />
          <ShapeEditorFloatingHint />
        </div>

        <ShapeEditorRightPanel />
      </div>
    </div>
  );
}
