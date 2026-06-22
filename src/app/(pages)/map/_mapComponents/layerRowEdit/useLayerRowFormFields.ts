"use client";

import { useEffect, useState } from "react";
import { fetchFormAttributesForPreset } from "./buildFormAttributes";
import type { LayerRowDetailAttr, LayerRowEditPreset } from "./types";

export function useLayerRowFormFields(preset: LayerRowEditPreset, enabled: boolean) {
  const [formAttributes, setFormAttributes] = useState<LayerRowDetailAttr[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setFormAttributes([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchFormAttributesForPreset(preset)
      .then((attrs) => {
        if (!cancelled) setFormAttributes(attrs);
      })
      .catch(() => {
        if (!cancelled) setFormAttributes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, preset]);

  return { formAttributes, formFieldsLoading: loading };
}
