'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EmdRiOption } from './parcelAnalysisTypes';
import {
  clearEmdRiOptionsCache,
  fetchEmdRiOptionsCached,
  getCachedEmdRiOptions,
} from './parcelAnalysisBoundaryCatalogCache';

export function useParcelAnalysisBoundaryCatalog(isOpen: boolean) {
  const [emdOptions, setEmdOptions] = useState<EmdRiOption[]>(() => getCachedEmdRiOptions()?.emd ?? []);
  const [emdLoading, setEmdLoading] = useState(false);
  const [emdError, setEmdError] = useState<string | null>(() => getCachedEmdRiOptions()?.error ?? null);

  const applyResult = useCallback((result: { emd: EmdRiOption[]; error?: string }) => {
    setEmdOptions(result.emd);
    setEmdError(result.error ?? null);
  }, []);

  const syncEmdFromCache = useCallback(() => {
    const hit = getCachedEmdRiOptions();
    if (!hit?.emd?.length) return false;
    applyResult(hit);
    setEmdLoading(false);
    return true;
  }, [applyResult]);

  const reloadEmdOptions = useCallback(() => {
    clearEmdRiOptionsCache();
    setEmdLoading(true);
    setEmdError(null);
    return fetchEmdRiOptionsCached(true)
      .then(applyResult)
      .finally(() => setEmdLoading(false));
  }, [applyResult]);

  useEffect(() => {
    if (!isOpen) {
      setEmdLoading(false);
      return;
    }

    if (syncEmdFromCache()) return;

    let cancelled = false;
    setEmdLoading(true);
    setEmdError(null);

    void fetchEmdRiOptionsCached()
      .then((result) => {
        if (!cancelled) applyResult(result);
      })
      .finally(() => {
        if (!cancelled) setEmdLoading(false);
      });

    return () => {
      cancelled = true;
      setEmdLoading(false);
    };
  }, [isOpen, applyResult, syncEmdFromCache]);

  return { emdOptions, emdLoading, emdError, reloadEmdOptions, syncEmdFromCache };
}
