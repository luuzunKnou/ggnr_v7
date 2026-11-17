'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { call } from '@/lib/api';
import { DigitalMapListPanel } from './DigitalMapListPanel';
import {
  useDigitalMapTileLayer,
  type DigitalMapFolderLayerStatus,
  type DigitalMapFolderRow,
} from './useDigitalMapTileLayer';

type Props = {
  panelOpen: boolean;
  onClose: () => void;
  onCheckedCountChange: (count: number) => void;
  panelClassName?: string;
};

type HostProps = {
  row: DigitalMapFolderRow;
  onStatus: (folder: string, s: DigitalMapFolderLayerStatus) => void;
};

/** 폴더(PMTiles) 하나를 지도에 올리고 상태를 위로 알린다 */
function FolderLayerHost({ row, onStatus }: HostProps) {
  const status = useDigitalMapTileLayer(row, true);
  useEffect(() => {
    onStatus(row.name, status);
  }, [row.name, status, onStatus]);
  return null;
}

/**
 * 수치지형도 지도 제어 — 폴더(PMTiles) 체크·테두리/상세 표시.
 * 패널을 닫아도 체크한 폴더는 지도에 남는다.
 */
export function DigitalMapMapControl({ panelOpen, onClose, onCheckedCountChange, panelClassName }: Props) {
  const [everOpened, setEverOpened] = useState(panelOpen);
  const [prevOpen, setPrevOpen] = useState(panelOpen);
  const [folders, setFolders] = useState<DigitalMapFolderRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [checkedNames, setCheckedNames] = useState<string[]>([]);
  const [folderStatus, setFolderStatus] = useState<Record<string, DigitalMapFolderLayerStatus>>({});

  if (prevOpen !== panelOpen) {
    setPrevOpen(panelOpen);
    if (panelOpen) setEverOpened(true);
  }

  useEffect(() => {
    onCheckedCountChange(checkedNames.length);
  }, [checkedNames, onCheckedCountChange]);

  useEffect(() => {
    if (!everOpened) return;
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    void call('', 'POST', { service: 'digitalMapService', action: 'listFolders', params: {} })
      .then((res) => {
        if (cancelled) return;
        if (!res?.success) {
          setListError((res as { message?: string })?.message ?? '폴더 목록을 불러오지 못했습니다.');
          setFolders([]);
          return;
        }
        const data = (res.data ?? res) as { folders?: DigitalMapFolderRow[] };
        setFolders(Array.isArray(data.folders) ? data.folders : []);
      })
      .catch((e) => {
        if (cancelled) return;
        setListError(e instanceof Error ? e.message : String(e));
        setFolders([]);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [everOpened]);

  const checkedSet = useMemo(() => new Set(checkedNames), [checkedNames]);
  const checkedRows = useMemo(
    () => checkedNames.map((n) => folders.find((f) => f.name === n)).filter((r): r is DigitalMapFolderRow => !!r),
    [checkedNames, folders]
  );

  const handleChecked = useCallback((name: string, on: boolean) => {
    setCheckedNames((prev) => {
      if (on) return prev.includes(name) ? prev : [...prev, name];
      return prev.filter((x) => x !== name);
    });
    if (!on) {
      setFolderStatus((prev) => {
        if (!(name in prev)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  }, []);

  const handleStatus = useCallback((folder: string, s: DigitalMapFolderLayerStatus) => {
    setFolderStatus((prev) => {
      const cur = prev[folder];
      if (cur && cur.loading === s.loading && cur.outlineOnly === s.outlineOnly && cur.error === s.error) {
        return prev;
      }
      return { ...prev, [folder]: s };
    });
  }, []);

  const loadingFolders = useMemo(() => {
    const set = new Set<string>();
    for (const [k, v] of Object.entries(folderStatus)) {
      if (v.loading) set.add(k);
    }
    return set;
  }, [folderStatus]);

  const statusError = checkedNames.map((n) => folderStatus[n]?.error).find((e) => e) ?? null;

  return (
    <>
      {checkedRows.map((row) => (
        <FolderLayerHost key={row.name} row={row} onStatus={handleStatus} />
      ))}
      {panelOpen ? (
        <div data-map-control-expand-panel className={panelClassName}>
          <DigitalMapListPanel
            folders={folders}
            loading={listLoading}
            error={listError ?? statusError}
            checkedNames={checkedSet}
            loadingFolders={loadingFolders}
            onCheckedChange={handleChecked}
            onClose={onClose}
          />
        </div>
      ) : null}
    </>
  );
}
