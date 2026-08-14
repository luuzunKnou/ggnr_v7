'use client';

import { useEffect, useState } from 'react';
import { fetchFormAttributesForPreset } from '../../map/_mapComponents/layerRowEdit/buildFormAttributes';
import type { ShapeEditorLayerItem, ShapeEditorAttributeField } from '../types';

function isDateFieldType(type?: string): boolean {
  const t = String(type ?? '').trim().toLowerCase();
  return t === 'date' || t === 'datetime' || t === 'timestamp' || t === 'timestamptz';
}

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
            type: a.type ?? 'text',
            readOnly: a.readOnly === true,
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

  return { fields, loading, isDateFieldType };
}
