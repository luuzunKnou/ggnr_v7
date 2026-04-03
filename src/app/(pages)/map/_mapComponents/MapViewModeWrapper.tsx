'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import { Map, Box, Crosshair, Globe } from 'lucide-react';
import OpenLayersMap from './OpenLayersMap';
import type { CesiumMapRef } from '../../3dMap/CesiumMap';
import { useSearchBarOffset } from '../map-layout-client';
import { call } from '@/lib/api';

const CesiumMap = dynamic(() => import('../../3dMap/CesiumMap'), { ssr: false });

/** 3D 지도 타일셋 목록: service_data/3dtiles_pnts 하위 폴더명(tileset.json 있는 폴더만) */

function ViewModeButton({
  label,
  icon: Icon,
  isActive,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-0 shrink-0 box-border p-0 transition-colors',
        'hover:bg-slate-100 hover:text-blue-600',
        isActive && 'bg-slate-100 text-blue-600'
      )}
      style={{ width: 45, height: 45 }}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
      <span className="leading-tight text-center whitespace-nowrap overflow-hidden truncate" style={{ maxWidth: 45, fontSize: '9px' }}>{label}</span>
    </button>
  );
}

export default function MapViewModeWrapper() {
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [tilesetNames, setTilesetNames] = useState<string[]>([]);
  const [tilesetNamesLoading, setTilesetNamesLoading] = useState(false);
  const [tilesetEnabled, setTilesetEnabled] = useState<Record<string, boolean>>({});
  const [tilesetError, setTilesetError] = useState<string | null>(null);
  const [globeVisible, setGlobeVisible] = useState(true);
  const cesiumMapRef = useRef<CesiumMapRef>(null);
  const { leftPx, topPx } = useSearchBarOffset();

  const fetch3DTilesetDirs = useCallback(async () => {
    setTilesetNamesLoading(true);
    try {
      const res = await call('', 'POST', {
        service: 'fileManagerService',
        action: 'list3DTilesetDirs',
        params: {},
      });
      const data = res?.data ?? res;
      const dirs = Array.isArray(data?.directories) ? data.directories : [];
      setTilesetNames(dirs);
      setTilesetEnabled((prev) => {
        const next = { ...prev };
        dirs.forEach((name: string) => {
          if (next[name] === undefined) next[name] = true;
        });
        return next;
      });
    } catch {
      setTilesetNames([]);
    } finally {
      setTilesetNamesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewMode === '3d') fetch3DTilesetDirs();
  }, [viewMode, fetch3DTilesetDirs]);

  useEffect(() => {
    if (viewMode !== '3d') cesiumMapRef.current = null;
  }, [viewMode]);

  const visibleTilesetNames = tilesetNames.filter((name) => tilesetEnabled[name] ?? false);

  const handleTilesetLoadError = useCallback((_name: string, message: string) => {
    setTilesetError(message);
  }, []);

  const viewModeControls = (
    <ViewModeButton
      label="3D 지도"
      icon={Box}
      isActive={viewMode === '3d'}
      onClick={() => setViewMode('3d')}
    />
  );

  return (
    <div className="relative w-full h-full">
      {viewMode === '2d' && (
        <OpenLayersMap extraControls={viewModeControls} />
      )}

      {viewMode === '3d' && (
        <>
          <CesiumMap
            ref={cesiumMapRef}
            onReady={(api) => {
              cesiumMapRef.current = api;
            }}
            visibleTilesetNames={visibleTilesetNames}
            onTilesetLoadError={handleTilesetLoadError}
            globeVisible={globeVisible}
          />
          {/* 3D 전용 플로팅: 배경지도 + 타일셋 켜기/끄기 */}
          <div
            className={cn(
              'absolute z-20 w-56',
              'rounded border border-border bg-background/95 shadow-lg p-3'
            )}
            style={{ left: leftPx, top: topPx + 50 }}
          >
            <button
              type="button"
              onClick={() => setGlobeVisible((v) => !v)}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors mb-3',
                globeVisible
                  ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  : 'text-blue-600 bg-blue-50 hover:bg-blue-100'
              )}
              title={globeVisible ? '배경지도 끄기' : '배경지도 켜기'}
              aria-label={globeVisible ? '배경지도 끄기' : '배경지도 켜기'}
            >
              <Globe className="w-4 h-4 shrink-0" />
              {globeVisible ? '배경지도 끄기' : '배경지도 켜기'}
            </button>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="font-medium text-sm">3D 데이터</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={fetch3DTilesetDirs}
                  disabled={tilesetNamesLoading}
                  className="text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-50"
                  title="목록 새로고침 (3dtiles_pnts 폴더 기준)"
                >
                  새로고침
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  type="button"
                  onClick={() => setViewMode('2d')}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  2D 지도
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {tilesetNamesLoading ? (
                <p className="text-xs text-muted-foreground">목록 불러오는 중…</p>
              ) : tilesetNames.length === 0 ? (
                <p className="text-xs text-muted-foreground">PNTS 데이터가 없습니다. (3dtiles_pnts 폴더)</p>
              ) : (
                tilesetNames.map((name) => (
                  <div key={name} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`tileset-${name}`}
                      checked={tilesetEnabled[name] ?? false}
                      onChange={() => {
                        setTilesetEnabled((prev) => ({ ...prev, [name]: !(prev[name] ?? true) }));
                        setTilesetError(null);
                      }}
                      className="rounded"
                    />
                    <label
                      htmlFor={`tileset-${name}`}
                      className="text-sm cursor-pointer flex-1 min-w-0 truncate"
                    >
                      {name}
                    </label>
                    {(tilesetEnabled[name] ?? false) && (
                      <button
                        type="button"
                        onClick={() => cesiumMapRef.current?.flyToTileset(name)}
                        className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                        title="해당 위치로 이동"
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
            {tilesetError && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-2">{tilesetError}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
