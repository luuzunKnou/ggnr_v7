'use client';

import React, { createContext, useContext, useRef, type RefObject } from 'react';
import type maplibregl from 'maplibre-gl';

/** MapLibre Map 인스턴스를 담을 ref */
const MapContext = createContext<RefObject<maplibregl.Map | null> | null>(null);

export function MapContextProvider({ children }: { children: React.ReactNode }) {
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  return (
    <MapContext.Provider value={mapInstanceRef}>
      {children}
    </MapContext.Provider>
  );
}

export function useMapContext(): RefObject<maplibregl.Map | null> | null {
  return useContext(MapContext);
}
