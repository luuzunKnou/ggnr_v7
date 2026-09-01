'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchLandInfoConfig,
  normalizePnu,
  resolveParcelIdentityLikeMapClick,
} from '../../landInfo/api';
import { searchAddress } from '../../addressSearch/vworldAddressSearch';
import { coordinate3857FromComplaint } from './complaintLandUtils';

export type ComplaintLandLookupError = 'no_location' | 'no_coordinate' | 'no_parcel' | null;

type ComplaintLandContextValue = {
  address: string;
  pnu: string | null;
  jibunFromParcel: string | null;
  coordinate3857: [number, number] | null;
  vworldKey: string;
  lookupLoading: boolean;
  lookupError: ComplaintLandLookupError;
};

const ComplaintLandContext = createContext<ComplaintLandContextValue | null>(null);

export function useComplaintLandContext(): ComplaintLandContextValue {
  const ctx = useContext(ComplaintLandContext);
  if (!ctx) {
    throw new Error('useComplaintLandContext must be used within ComplaintLandProvider');
  }
  return ctx;
}

type ProviderProps = {
  compKey: number;
  address: string | null;
  geomGeoJson4326?: Record<string, unknown> | null;
  extent3857?: [number, number, number, number] | null;
  /** 필지·건축물 탭이 열려 있을 때만 PNU 조회 */
  lookupEnabled: boolean;
  children: ReactNode;
};

export function ComplaintLandProvider({
  compKey,
  address,
  geomGeoJson4326,
  extent3857,
  lookupEnabled,
  children,
}: ProviderProps) {
  const addressText = String(address ?? '').trim();
  const geomKey = useMemo(() => {
    const g = geomGeoJson4326;
    if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) return '';
    return `${g.coordinates[0]},${g.coordinates[1]}`;
  }, [geomGeoJson4326]);
  const extentKey = extent3857?.join(',') ?? '';
  const hasStoredLocation = Boolean(geomKey || extentKey);

  const [vworldKey, setVworldKey] = useState('');
  const [pnu, setPnu] = useState<string | null>(null);
  const [jibunFromParcel, setJibunFromParcel] = useState<string | null>(null);
  const [coordinate3857, setCoordinate3857] = useState<[number, number] | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<ComplaintLandLookupError>(null);

  useEffect(() => {
    let alive = true;
    fetchLandInfoConfig().then((cfg) => {
      if (alive) setVworldKey(cfg.vworldKey);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!lookupEnabled) {
      setLookupLoading(false);
      return;
    }
    if (!addressText && !hasStoredLocation) {
      setPnu(null);
      setJibunFromParcel(null);
      setCoordinate3857(null);
      setLookupError('no_location');
      setLookupLoading(false);
      return;
    }

    let alive = true;
    setLookupLoading(true);
    setLookupError(null);
    setPnu(null);
    setJibunFromParcel(null);

    void (async () => {
      try {
        let coord3857 = coordinate3857FromComplaint({ geomGeoJson4326, extent3857 });
        let searchPnu: string | null = null;
        let searchJibun: string | null = null;

        if (!coord3857 && addressText && vworldKey) {
          const results = await searchAddress(addressText, { apiKey: vworldKey, maxResults: 1 });
          const item = results[0];
          if (item) {
            searchPnu = normalizePnu(item.id);
            searchJibun = String(item.jibunAddress ?? '').trim() || null;
            const lon = Number(item.point?.x);
            const lat = Number(item.point?.y);
            if (Number.isFinite(lon) && Number.isFinite(lat)) {
              coord3857 = coordinate3857FromComplaint({ lon, lat });
            }
          }
        }

        if (!alive) return;
        if (!coord3857) {
          setCoordinate3857(null);
          setLookupError('no_coordinate');
          setLookupLoading(false);
          return;
        }
        setCoordinate3857(coord3857);

        const identity = await resolveParcelIdentityLikeMapClick({
          coordinate3857: coord3857,
          vworldKey,
          addressHint: addressText,
        });
        if (!alive) return;

        const resolvedPnu = identity.pnu ?? searchPnu;
        const resolvedJibun = identity.jibunFromParcel ?? searchJibun;

        if (!resolvedPnu) {
          setPnu(null);
          setJibunFromParcel(resolvedJibun);
          setLookupError('no_parcel');
          setLookupLoading(false);
          return;
        }

        setPnu(resolvedPnu);
        setJibunFromParcel(resolvedJibun);
        setLookupError(null);
      } catch {
        if (!alive) return;
        setPnu(null);
        setJibunFromParcel(null);
        setLookupError('no_parcel');
      } finally {
        if (alive) setLookupLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [
    lookupEnabled,
    addressText,
    hasStoredLocation,
    compKey,
    geomKey,
    extentKey,
    extent3857,
    geomGeoJson4326,
    vworldKey,
  ]);

  const value = useMemo(
    () => ({
      address: addressText,
      pnu,
      jibunFromParcel,
      coordinate3857,
      vworldKey,
      lookupLoading,
      lookupError,
    }),
    [addressText, pnu, jibunFromParcel, coordinate3857, vworldKey, lookupLoading, lookupError]
  );

  return <ComplaintLandContext.Provider value={value}>{children}</ComplaintLandContext.Provider>;
}
