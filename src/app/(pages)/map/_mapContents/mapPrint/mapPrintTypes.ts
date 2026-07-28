export type MapPrintTool =
  | 'symbol'
  | 'comment'
  | 'distance'
  | 'area'
  | 'elevation'
  | 'slope'
  | 'point'
  | 'line'
  | 'box'
  | 'polygon'
  | 'square'
  | 'circle'
  | 'select'
  | null;

export type MapPrintSidePanel = 'layer' | 'background' | 'coord' | null;

export type MapPrintSnapshot = {
  center: [number, number];
  zoom: number;
  backgroundMapId: string;
  visibleLayerNames: string[];
  activeLayerControls: string[];
  visibleCadastralLayerNames: string[] | null;
  visibleBuildingRoadLayerNames: string[] | null;
  visibleJimokLayerNames: string[] | null;
  visibleLandownLayerNames: string[] | null;
  visibleThematicLayerNames: string[] | null;
};

export const DEFAULT_PRINT_COLOR = '#3399CC';
