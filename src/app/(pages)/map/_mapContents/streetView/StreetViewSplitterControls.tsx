'use client';

import { X } from 'lucide-react';
import type { MapSplitControlItem } from '../../_mapComponents/mapSplit/MapSplitterGutter';
import { MAP_SPLIT_GUTTER_ICON_COLOR } from '../../_mapComponents/mapSplit/mapSplitGutterIconColor';

type StreetViewSplitterControlsArgs = {
  onExit: () => void;
};

/** 분할선 컨트롤 — 거리뷰 닫기(접기 밖 고정) */
export function StreetViewSplitterControls({
  onExit,
}: StreetViewSplitterControlsArgs): MapSplitControlItem[] {
  return [
    {
      key: 'exit',
      title: '거리뷰 닫기',
      active: false,
      iconActiveColor: MAP_SPLIT_GUTTER_ICON_COLOR.exit.active,
      iconInactiveColor: MAP_SPLIT_GUTTER_ICON_COLOR.exit.inactive,
      onClick: onExit,
      icon: <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />,
    },
  ];
}
