'use client';

import { Globe, Move, X } from 'lucide-react';
import type { MapSplitControlItem } from '../../_mapComponents/mapSplit/MapSplitterGutter';
import { MAP_SPLIT_GUTTER_ICON_COLOR } from '../../_mapComponents/mapSplit/mapSplitGutterIconColor';

type MapSplitSplitterControlsArgs = {
  mapSync: boolean;
  onMapSyncChange: (next: boolean) => void;
  basemapSync: boolean;
  onBasemapSyncChange: (next: boolean) => void;
  onExit: () => void;
};

/** 분할선 컨트롤 — 이동 싱크 · 배경 싱크 · 분할 종료 */
export function MapSplitSplitterControls({
  mapSync,
  onMapSyncChange,
  basemapSync,
  onBasemapSyncChange,
  onExit,
}: MapSplitSplitterControlsArgs): MapSplitControlItem[] {
  return [
    {
      key: 'basemap-sync',
      title: basemapSync ? '배경지도 동기화 끄기' : '배경지도 동기화 켜기',
      active: basemapSync,
      iconActiveColor: MAP_SPLIT_GUTTER_ICON_COLOR.basemapSync.active,
      iconInactiveColor: MAP_SPLIT_GUTTER_ICON_COLOR.basemapSync.inactive,
      onClick: () => onBasemapSyncChange(!basemapSync),
      icon: <Globe className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />,
    },
    {
      key: 'map-sync',
      title: mapSync ? '이동 동기화 끄기' : '이동 동기화 켜기',
      active: mapSync,
      iconActiveColor: MAP_SPLIT_GUTTER_ICON_COLOR.mapSync.active,
      iconInactiveColor: MAP_SPLIT_GUTTER_ICON_COLOR.mapSync.inactive,
      onClick: () => onMapSyncChange(!mapSync),
      icon: <Move className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />,
    },
    {
      key: 'exit',
      title: '분할 종료',
      active: false,
      iconActiveColor: MAP_SPLIT_GUTTER_ICON_COLOR.exit.active,
      iconInactiveColor: MAP_SPLIT_GUTTER_ICON_COLOR.exit.inactive,
      onClick: onExit,
      icon: <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />,
    },
  ];
}
