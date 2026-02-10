'use client';

import React, { createContext, useContext, useRef, useState, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type Map from 'ol/Map';

export type MapContextValue = {
  mapInstanceRef: RefObject<Map | null>;
  showDebugUi: boolean;
  setShowDebugUi: Dispatch<SetStateAction<boolean>>;
  visibleLayerNames: Set<string>;
  setVisibleLayerNames: Dispatch<SetStateAction<Set<string>>>;
} | null;

const MapContext = createContext<MapContextValue>(null);

export function MapContextProvider({ children }: { children: React.ReactNode }) {
  const mapInstanceRef = useRef<Map | null>(null);
  const [showDebugUi, setShowDebugUi] = useState(false);
  const [visibleLayerNames, setVisibleLayerNames] = useState<Set<string>>(() => new Set());
  return (
    <MapContext.Provider value={{ mapInstanceRef, showDebugUi, setShowDebugUi, visibleLayerNames, setVisibleLayerNames }}>
      {children}
    </MapContext.Provider>
  );
}

export function useMapContext(): MapContextValue {
  return useContext(MapContext);
}
