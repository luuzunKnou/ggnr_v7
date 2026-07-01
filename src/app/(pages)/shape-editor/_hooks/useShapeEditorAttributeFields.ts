'use client';

import { useEffect, useState } from 'react';
import { fetchFormAttributesForPreset } from '../../map/_mapComponents/layerRowEdit/buildFormAttributes';
import type { ShapeEditorLayerItem, ShapeEditorAttributeField } from '../types';

export function useShapeEditorAttributeFields(activeEditLayer: ShapeEditorLayerItem | null) {
  const [fields, setFields] = useState<ShapeEditorAttributeField[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeEditLayer) {
      setFields([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchFormAttributesForPreset({
      tableName: activeEditLayer.tableName,
      schema: activeEditLayer.schema,
    })
      .then((attrs) => {
        if (cancelled) return;
        setFields(
          attrs.map((a) => ({
            field: a.field,
            label: a.label,
          }))
        );
      })
      .catch(() => {
        if (!cancelled) setFields([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeEditLayer?.id, activeEditLayer?.tableName, activeEditLayer?.schema]);

  return { fields, loading };
}
