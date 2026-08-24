'use client';

import { useMemo } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CADASTRAL_LAYERS } from '@/app/(pages)/map/_mapComponents/layerFactory/boundaryLayerFactory';
import { JimokLandownLayerSelector } from '@/app/(pages)/map/_mapComponents/mapControlPanel/JimokLandownLayerSelector';
import { ThematicMapLayerSelector } from '@/app/(pages)/map/_mapComponents/mapControlPanel/ThematicMapLayerSelector';
import { useBuildingRoadCatalog } from '@/app/(pages)/map/_mapComponents/hooks/useBuildingRoadCatalog';
import { useJimokCatalog } from '@/app/(pages)/map/_mapComponents/hooks/useJimokCatalog';
import { useOwnershipCatalog } from '@/app/(pages)/map/_mapComponents/hooks/useOwnershipCatalog';
import { useThematicMapCatalog } from '@/app/(pages)/map/_mapComponents/hooks/useThematicMapCatalog';

export type PrintControlLayerId =
  | 'cadastral'
  | 'building-road'
  | 'basic-section'
  | 'land-category'
  | 'ownership'
  | 'thematic-map';

const CONTROL_ROWS: { id: PrintControlLayerId; label: string; opensList: boolean }[] = [
  { id: 'cadastral', label: '지적도', opensList: true },
  { id: 'building-road', label: '건물·도로', opensList: true },
  { id: 'basic-section', label: '기초구간', opensList: false },
  { id: 'land-category', label: '지목', opensList: true },
  { id: 'ownership', label: '소유구분', opensList: true },
  { id: 'thematic-map', label: '주제도', opensList: true },
];

type Props = {
  layerList: string[];
  visibleNames: Set<string>;
  onServiceSelectionChange: (next: Set<string>) => void;
  layerKorName: (name: string) => string;
  activeLayerControls: string[];
  openControlId: PrintControlLayerId | null;
  onOpenControl: (id: PrintControlLayerId | null) => void;
  visibleCadastral: Set<string>;
  visibleBuildingRoad: Set<string>;
  visibleJimok: Set<string>;
  visibleLandown: Set<string>;
  visibleThematic: Set<string>;
  onCadastralChange: (next: Set<string>) => void;
  onBuildingRoadChange: (next: Set<string>) => void;
  onJimokChange: (next: Set<string>) => void;
  onLandownChange: (next: Set<string>) => void;
  onThematicChange: (next: Set<string>) => void;
  onToggleBasicSection: () => void;
};

function selectedLabels(
  selected: Set<string>,
  options: { tableName: string; layerName: string }[]
): string[] {
  return options.filter((o) => selected.has(o.tableName)).map((o) => o.layerName);
}

export function MapPrintLayerPanel({
  layerList,
  visibleNames,
  onServiceSelectionChange,
  layerKorName,
  activeLayerControls,
  openControlId,
  onOpenControl,
  visibleCadastral,
  visibleBuildingRoad,
  visibleJimok,
  visibleLandown,
  visibleThematic,
  onCadastralChange,
  onBuildingRoadChange,
  onJimokChange,
  onLandownChange,
  onThematicChange,
  onToggleBasicSection,
}: Props) {
  const {
    layers: buildingRoadLayers,
    availableLayerTableNames: buildingRoadAvailable,
  } = useBuildingRoadCatalog();
  const { layers: jimokLayers, availableLayerTableNames: jimokAvailable } = useJimokCatalog();
  const {
    layers: ownershipLayers,
    availableLayerTableNames: ownershipAvailable,
  } = useOwnershipCatalog();
  const {
    groups: thematicGroups,
    availableLayerTableNames: thematicAvailable,
  } = useThematicMapCatalog();

  const buildingRoadPanelLayers = useMemo(
    () => buildingRoadLayers.filter((l) => buildingRoadAvailable.has(l.tableName)),
    [buildingRoadLayers, buildingRoadAvailable]
  );
  const jimokPanelLayers = useMemo(
    () => jimokLayers.filter((l) => jimokAvailable.has(l.tableName)),
    [jimokLayers, jimokAvailable]
  );
  const ownershipPanelLayers = useMemo(
    () => ownershipLayers.filter((l) => ownershipAvailable.has(l.tableName)),
    [ownershipLayers, ownershipAvailable]
  );
  const thematicPanelGroups = useMemo(
    () =>
      thematicGroups
        .map((g) => ({
          ...g,
          layers: g.layers.filter((l) => thematicAvailable.has(l.tableName)),
        }))
        .filter((g) => g.layers.length > 0),
    [thematicGroups, thematicAvailable]
  );
  const thematicFlat = useMemo(
    () => thematicPanelGroups.flatMap((g) => g.layers),
    [thematicPanelGroups]
  );

  /** 업무 레이어 — 메인 지도와 동일 JimokLandownLayerSelector 재사용 */
  const serviceLayerOptions = useMemo(
    () =>
      layerList.map((name) => ({
        tableName: name,
        layerName: layerKorName(name),
      })),
    [layerList, layerKorName]
  );

  const summaryById: Record<PrintControlLayerId, string[]> = {
    cadastral: selectedLabels(visibleCadastral, CADASTRAL_LAYERS),
    'building-road': selectedLabels(visibleBuildingRoad, buildingRoadPanelLayers),
    'basic-section': activeLayerControls.includes('basic-section') ? ['기초구간'] : [],
    'land-category': selectedLabels(visibleJimok, jimokPanelLayers),
    ownership: selectedLabels(visibleLandown, ownershipPanelLayers),
    'thematic-map': selectedLabels(visibleThematic, thematicFlat),
  };

  const handleControlClick = (id: PrintControlLayerId, opensList: boolean) => {
    if (!opensList) {
      onToggleBasicSection();
      onOpenControl(null);
      return;
    }
    onOpenControl(openControlId === id ? null : id);
  };

  const controlList =
    openControlId === 'cadastral' ? (
      <JimokLandownLayerSelector
        title="지적도"
        layers={CADASTRAL_LAYERS}
        selectedTableNames={visibleCadastral}
        onSelectionChange={onCadastralChange}
        onClose={() => onOpenControl(null)}
        className="map-print-layer-selector"
      />
    ) : openControlId === 'building-road' ? (
      <JimokLandownLayerSelector
        title="건물·도로"
        layers={buildingRoadPanelLayers}
        selectedTableNames={visibleBuildingRoad}
        onSelectionChange={(next) =>
          onBuildingRoadChange(new Set([...next].filter((t) => buildingRoadAvailable.has(t))))
        }
        onClose={() => onOpenControl(null)}
        className="map-print-layer-selector"
      />
    ) : openControlId === 'land-category' ? (
      <JimokLandownLayerSelector
        title="지목"
        layers={jimokPanelLayers}
        selectedTableNames={visibleJimok}
        onSelectionChange={(next) =>
          onJimokChange(new Set([...next].filter((t) => jimokAvailable.has(t))))
        }
        onClose={() => onOpenControl(null)}
        className="map-print-layer-selector"
      />
    ) : openControlId === 'ownership' ? (
      <JimokLandownLayerSelector
        title="소유구분"
        layers={ownershipPanelLayers}
        selectedTableNames={visibleLandown}
        onSelectionChange={(next) =>
          onLandownChange(new Set([...next].filter((t) => ownershipAvailable.has(t))))
        }
        onClose={() => onOpenControl(null)}
        className="map-print-layer-selector"
      />
    ) : openControlId === 'thematic-map' ? (
      <ThematicMapLayerSelector
        title="주제도"
        groups={thematicPanelGroups}
        selectedTableNames={visibleThematic}
        onSelectionChange={(next) =>
          onThematicChange(new Set([...next].filter((t) => thematicAvailable.has(t))))
        }
        onClose={() => onOpenControl(null)}
        className="map-print-layer-selector"
      />
    ) : null;

  return (
    <div className="map-print-layer-dock map-print-ignore">
      {controlList ? <div className="map-print-control-list">{controlList}</div> : null}

      <div className="flex w-56 flex-col gap-2">
        <JimokLandownLayerSelector
          title="업무 레이어"
          layers={serviceLayerOptions}
          selectedTableNames={visibleNames}
          onSelectionChange={onServiceSelectionChange}
          className="map-print-layer-selector map-print-service-layer-selector"
        />

        <div className="rounded-[5px] border border-border bg-card/95 p-2 shadow-xl">
          <p className="mb-1.5 px-1 text-[11px] text-muted-foreground">지도 컨트롤 레이어</p>
          <div className="flex flex-col gap-1">
            {CONTROL_ROWS.map(({ id, label, opensList }) => {
              const selected = summaryById[id];
              const isOpen = openControlId === id;
              const isOn =
                id === 'basic-section'
                  ? activeLayerControls.includes(id)
                  : selected.length > 0;
              return (
                <button
                  key={id}
                  type="button"
                  title={label}
                  onClick={() => handleControlClick(id, opensList)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 text-left transition-colors',
                    isOpen
                      ? 'border-primary/45 bg-primary/10 text-foreground shadow-sm'
                      : isOn
                        ? 'border-border bg-muted/60 text-foreground hover:border-border hover:bg-muted'
                        : 'border-border bg-card text-foreground/90 hover:border-border hover:bg-muted/50'
                  )}
                >
                  {opensList ? (
                    <ChevronLeft
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        isOpen ? 'text-primary' : 'text-muted-foreground'
                      )}
                      aria-hidden
                    />
                  ) : (
                    <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full',
                          isOn ? 'bg-primary' : 'bg-muted-foreground/40'
                        )}
                      />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">{label}</span>
                    {selected.length > 0 ? (
                      <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                        {selected.join(', ')}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
