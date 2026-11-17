'use client';

import { useEffect, useState } from 'react';
import {
  fetchBuildingRegisterDetail,
  fetchPermitRows,
  type BuildingLedgerRow,
  type BuildingPermitSource,
  type BuildingRegisterDetailResult,
} from '../../_mapComponents/landInfo/api';
import { BuildingPermitPanel, BuildingRegisterPanel } from '../../_mapComponents/landInfo/LandInfoBuildingPanels';

const EMPTY_REGISTER: BuildingRegisterDetailResult = { source: null, mode: null, buildings: [], children: [] };

/** 건물이 놓인 필지 기준 건축물대장·건물허가대장 — 우클릭 주소정보와 같은 조회 */
export function PrivateLandBuildingLedgers({
  pnu,
  jibun,
  dataPortalKey,
}: {
  pnu: string;
  jibun?: string;
  dataPortalKey: string;
}) {
  const [register, setRegister] = useState<BuildingRegisterDetailResult>(EMPTY_REGISTER);
  const [registerFetching, setRegisterFetching] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [permitRows, setPermitRows] = useState<BuildingLedgerRow[]>([]);
  const [permitSource, setPermitSource] = useState<BuildingPermitSource>(null);
  const [permitNotice, setPermitNotice] = useState<string | null>(null);
  const [permitFetching, setPermitFetching] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchBuildingRegisterDetail({ pnu, jibun })
      .then((res) => {
        if (alive) setRegister(res);
      })
      .catch(() => {
        if (alive) setRegister(EMPTY_REGISTER);
      })
      .finally(() => {
        if (alive) setRegisterFetching(false);
      });
    return () => {
      alive = false;
    };
  }, [pnu, jibun, reloadKey]);

  useEffect(() => {
    let alive = true;
    fetchPermitRows({ pnu, dataPortalKey })
      .then((res) => {
        if (!alive) return;
        setPermitRows(res.rows);
        setPermitSource(res.source);
        setPermitNotice(res.notice ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setPermitRows([]);
        setPermitSource(null);
        setPermitNotice(null);
      })
      .finally(() => {
        if (alive) setPermitFetching(false);
      });
    return () => {
      alive = false;
    };
  }, [pnu, dataPortalKey]);

  return (
    <>
      <section>
        <BuildingRegisterPanel
          pnu={pnu}
          fetching={registerFetching}
          notice={register.notice ?? null}
          source={register.source}
          mode={register.mode}
          buildings={register.buildings}
          childRows={register.children}
          onResetRoot={() => {
            setRegisterFetching(true);
            setReloadKey((k) => k + 1);
          }}
          narrow
        />
      </section>
      <section>
        <BuildingPermitPanel
          fetching={permitFetching}
          notice={permitNotice}
          source={permitSource}
          rows={permitRows}
          narrow
          title="건물허가대장"
        />
      </section>
    </>
  );
}
