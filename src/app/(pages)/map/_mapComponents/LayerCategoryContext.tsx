'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

type LayerCategoryContextValue = {
  activeCategories: string[];
  toggleCategory: (cat: string) => void;
};

const LayerCategoryContext = createContext<LayerCategoryContextValue | null>(null);

export function LayerCategoryProvider({ children }: { children: React.ReactNode }) {
  const [activeCategories, setActiveCategories] = useState<string[]>([]);

  const toggleCategory = useCallback((cat: string) => {
    setActiveCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }, []);

  return (
    <LayerCategoryContext.Provider value={{ activeCategories, toggleCategory }}>
      {children}
    </LayerCategoryContext.Provider>
  );
}

export function useLayerCategory(): LayerCategoryContextValue | null {
  return useContext(LayerCategoryContext);
}
