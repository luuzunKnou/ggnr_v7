'use client';

import React, { createContext, useContext, useRef, type RefObject } from 'react';
import type Map from 'ol/Map';

const MapContext = createContext<RefObject<Map | null> | null>(null);

export function MapContextProvider({ children }: { children: React.ReactNode }) {
  const mapInstanceRef = useRef<Map | null>(null);
  return (
    <MapContext.Provider value={mapInstanceRef}>
      {children}
    </MapContext.Provider>
  );
}

export function useMapContext(): RefObject<Map | null> | null {
  return useContext(MapContext);
}
