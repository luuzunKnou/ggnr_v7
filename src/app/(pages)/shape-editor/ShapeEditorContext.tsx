'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Map as OLMap } from 'ol';
import type {
  ShapeEditorDraftState,
  ShapeEditorEditMode,
  ShapeEditorLayerItem,
  ShapeEditorToolMode,
} from './types';

type ShapeEditorContextValue = {
  mapInstanceRef: RefObject<OLMap | null>;
  mapReady: boolean;
  setMapReady: (ready: boolean) => void;
  registerMap: (map: OLMap | null) => void;
  activeEditLayer: ShapeEditorLayerItem | null;
  setActiveEditLayer: (layer: ShapeEditorLayerItem | null) => void;
  visibleLayerNames: Set<string>;
  toolMode: ShapeEditorToolMode;
  setToolMode: (mode: ShapeEditorToolMode) => void;
  editMode: ShapeEditorEditMode;
  setEditMode: (mode: ShapeEditorEditMode) => void;
  rightPanelOpen: boolean;
  setRightPanelOpen: (open: boolean) => void;
  draft: ShapeEditorDraftState;
  setDraft: (patch: Partial<ShapeEditorDraftState>) => void;
  refreshWms: () => void;
  wmsRefreshToken: number;
};

const ShapeEditorContext = createContext<ShapeEditorContextValue | null>(null);

const initialDraft: ShapeEditorDraftState = {
  hasGeometry: false,
  wkt5181: null,
  saving: false,
  saveMessage: null,
};

export function ShapeEditorProvider({ children }: { children: ReactNode }) {
  const mapInstanceRef = useRef<OLMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [activeEditLayer, setActiveEditLayerState] = useState<ShapeEditorLayerItem | null>(null);
  const [toolMode, setToolMode] = useState<ShapeEditorToolMode>('select');
  const [editMode, setEditModeState] = useState<ShapeEditorEditMode>('new');
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [draft, setDraftState] = useState<ShapeEditorDraftState>(initialDraft);
  const [wmsRefreshToken, setWmsRefreshToken] = useState(0);

  const registerMap = useCallback((map: OLMap | null) => {
    mapInstanceRef.current = map;
    setMapReady(map != null);
  }, []);

  const setActiveEditLayer = useCallback((layer: ShapeEditorLayerItem | null) => {
    setActiveEditLayerState(layer);
    setToolMode('select');
    setEditModeState('new');
    setDraftState(initialDraft);
  }, []);

  const setEditMode = useCallback((mode: ShapeEditorEditMode) => {
    setEditModeState(mode);
    setToolMode('select');
  }, []);

  const setDraft = useCallback((patch: Partial<ShapeEditorDraftState>) => {
    setDraftState((prev) => ({ ...prev, ...patch }));
  }, []);

  const refreshWms = useCallback(() => {
    setWmsRefreshToken((t) => t + 1);
  }, []);

  const visibleLayerNames = useMemo(() => {
    if (!activeEditLayer) return new Set<string>();
    return new Set([activeEditLayer.tableName]);
  }, [activeEditLayer]);

  const value = useMemo(
    () => ({
      mapInstanceRef,
      mapReady,
      setMapReady,
      registerMap,
      activeEditLayer,
      setActiveEditLayer,
      visibleLayerNames,
      toolMode,
      setToolMode,
      editMode,
      setEditMode,
      rightPanelOpen,
      setRightPanelOpen,
      draft,
      setDraft,
      refreshWms,
      wmsRefreshToken,
    }),
    [
      mapReady,
      registerMap,
      activeEditLayer,
      visibleLayerNames,
      toolMode,
      editMode,
      rightPanelOpen,
      draft,
      setDraft,
      refreshWms,
      wmsRefreshToken,
    ]
  );

  return <ShapeEditorContext.Provider value={value}>{children}</ShapeEditorContext.Provider>;
}

export function useShapeEditorContext(): ShapeEditorContextValue {
  const ctx = useContext(ShapeEditorContext);
  if (!ctx) throw new Error('useShapeEditorContext must be used within ShapeEditorProvider');
  return ctx;
}
