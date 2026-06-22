'use client';

import { useEffect, useState } from 'react';
import { call } from '@/lib/api';
import type { ShapeEditorLayerGroup, ShapeEditorLayerItem, LayerSchemaTable } from '../types';

type TableMeta = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
  define_table_schema?: string;
  define_table_shp_type?: string;
  define_table_parents_layer?: string;
  define_table_div_query?: string;
};

/** 데이터조회(AttributeQueryUI)와 동일한 layer 카탈로그 — 편집 대상 레이어 선택용 */
export function useShapeEditorLayerCatalog() {
  const [layerGroups, setLayerGroups] = useState<ShapeEditorLayerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const dbPromise = call('', 'POST', {
      service: 'devTestService',
      action: 'getLayerTableList',
      params: {},
    });
    const metaPromise = fetch('/api/config/defineLayer').then((r) => r.json());

    Promise.all([dbPromise, metaPromise])
      .then(([dbRes, metaRes]) => {
        if (cancelled) return;

        const dbData = dbRes?.data ?? dbRes;
        const tables: LayerSchemaTable[] = Array.isArray(dbData?.tables) ? dbData.tables : [];

        const dbSet = new Set(
          tables
            .filter((t) => (t.schema || 'layer').toLowerCase() === 'layer')
            .map((t) => t.table.toLowerCase())
        );

        const metaArr: TableMeta[] = Array.isArray(metaRes?.data) ? metaRes.data : [];
        const metaMap = new Map<string, TableMeta>();
        for (const m of metaArr) {
          const name = String(m.define_table_name ?? '').trim().toLowerCase();
          if (name && (m.define_table_schema || 'layer').toLowerCase() === 'layer') {
            metaMap.set(name, m);
          }
        }

        const groupMap = new Map<string, ShapeEditorLayerItem[]>();
        const groupOrder: string[] = [];

        const parentTablesWithSplitDefs = new Set<string>();
        for (const m of metaArr) {
          if ((m.define_table_schema || 'layer').toLowerCase() !== 'layer') continue;
          const p = String(m.define_table_parents_layer ?? '').trim().toLowerCase();
          const divQ = String(m.define_table_div_query ?? '').trim();
          if (p && divQ) parentTablesWithSplitDefs.add(p);
        }

        const pushLayer = (groupName: string, item: ShapeEditorLayerItem) => {
          if (!groupMap.has(groupName)) {
            groupMap.set(groupName, []);
            groupOrder.push(groupName);
          }
          groupMap.get(groupName)!.push(item);
        };

        for (const tblName of dbSet) {
          if (parentTablesWithSplitDefs.has(tblName)) continue;
          const meta = metaMap.get(tblName);
          const groupName = meta?.define_table_group?.trim() || '기타';
          const korName = meta?.define_table_kor_name?.trim() || tblName;
          pushLayer(groupName, {
            id: tblName,
            name: korName,
            tableName: tblName,
            schema: 'layer',
            physicalTableName: tblName,
            rowFilterSql: null,
            shpType: String(meta?.define_table_shp_type ?? 'POLYGON').trim() || 'POLYGON',
          });
        }

        for (const m of metaArr) {
          const schemaM = (m.define_table_schema || 'layer').toLowerCase();
          if (schemaM !== 'layer') continue;
          const eng = String(m.define_table_name ?? '').trim();
          if (!eng) continue;
          const engLower = eng.toLowerCase();
          const parent = String(m.define_table_parents_layer ?? '').trim();
          const divQ = String(m.define_table_div_query ?? '').trim();
          if (!parent || !divQ) continue;
          const parentLower = parent.toLowerCase();
          if (!dbSet.has(parentLower)) continue;
          if (dbSet.has(engLower)) continue;
          const groupName = String(m.define_table_group ?? '').trim() || '기타';
          const korName = String(m.define_table_kor_name ?? '').trim() || eng;
          pushLayer(groupName, {
            id: engLower,
            name: korName,
            tableName: engLower,
            schema: 'layer',
            physicalTableName: parentLower,
            rowFilterSql: divQ,
            shpType: String(m.define_table_shp_type ?? 'POLYGON').trim() || 'POLYGON',
          });
        }

        const groups: ShapeEditorLayerGroup[] = groupOrder.map((gName) => ({
          id: gName,
          name: gName,
          layers: groupMap.get(gName)!.sort((a, b) => a.name.localeCompare(b.name, 'ko')),
        }));

        setLayerGroups(groups);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLayerGroups([]);
          setLoading(false);
          setError('레이어 목록을 불러오지 못했습니다.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { layerGroups, loading, error };
}
