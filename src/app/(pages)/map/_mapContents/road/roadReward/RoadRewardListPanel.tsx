"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { call } from "@/lib/api";
import { LayerRowAddButton } from "../../../_mapComponents/layerRowEdit";
import type { RoadRewardCase } from "./roadRewardMock";
import {
  ROAD_REWARD_NEW_ID,
  isNewRoadRewardCaseId,
  mapRoadRewardDtoToCase,
  type RoadRewardCaseDtoClient,
} from "./roadRewardApi";

type Props = {
  cases: RoadRewardCase[];
  selectedId: string | null;
  onCasesChange: Dispatch<SetStateAction<RoadRewardCase[]>>;
  onSelectId: (id: string) => void;
  onAdd?: () => void;
  onClose: () => void;
};

export function RoadRewardListPanel({
  cases,
  selectedId,
  onCasesChange,
  onSelectId,
  onAdd,
  onClose,
}: Props) {
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const initialLoadDoneRef = useRef(false);
  const selectSeqRef = useRef(0);

  const loadRows = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    setListError(null);
    try {
      const res = await call("", "POST", {
        service: "roadRewardService",
        action: "listRows",
        params: { fillPnuGeom: true },
      });
      const data = res?.data ?? res;
      if (data?.error) {
        setListError(String(data.error));
        return;
      }
      const raw = Array.isArray(data?.rows) ? (data.rows as RoadRewardCaseDtoClient[]) : [];
      const mapped = raw.map(mapRoadRewardDtoToCase);
      // 서버 목록이 기준. 선택 행의 예전 도형·필지를 덮어쓰지 않음(깜빡·이전 도형 잔존 방지)
      onCasesChange(mapped);
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [onCasesChange]);

  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;
    void loadRows();
  }, [loadRows]);

  const filtered = useMemo(() => {
    // 미저장 신규는 목록 행으로 넣지 않음
    const saved = cases.filter((c) => !isNewRoadRewardCaseId(c.id));
    const kw = keyword.trim().toLowerCase();
    if (!kw) return saved;
    return saved.filter((c) => c.name.toLowerCase().includes(kw));
  }, [cases, keyword]);

  const handleAdd = () => {
    // 목록·DB에 행을 만들지 않고 등록 패널만 연다
    onSelectId(ROAD_REWARD_NEW_ID);
    onAdd?.();
  };

  const handleSelect = async (id: string) => {
    onSelectId(id);
    if (isNewRoadRewardCaseId(id)) return;
    const seq = ++selectSeqRef.current;
    try {
      const res = await call("", "POST", {
        service: "roadRewardService",
        action: "getDetailByOgcFid",
        params: { ogcFid: Number(id), fillPnuGeom: true },
      });
      if (seq !== selectSeqRef.current) return;
      const data = res?.data ?? res;
      if (data?.error || !data?.row) return;
      const mapped = mapRoadRewardDtoToCase(data.row as RoadRewardCaseDtoClient);
      onCasesChange((prev) => {
        const idx = prev.findIndex((c) => c.id === id);
        if (idx < 0) return [...prev, mapped];
        return prev.map((c) => (c.id === id ? mapped : c));
      });
    } catch {
      /* 상세 보강 실패 시 목록 행으로 표시 */
    }
  };

  return (
    <div className="flex min-h-0 h-full flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="text-sm font-semibold text-slate-800">보상편입용지</span>
        <div className="flex items-center gap-1">
          <LayerRowAddButton
            onClick={handleAdd}
            disabled={selectedId === ROAD_REWARD_NEW_ID}
          />
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-slate-100 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="검색 (건명)"
            className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            불러오는 중…
          </div>
        ) : listError ? (
          <div className="px-3 py-8 text-center text-xs text-red-600">{listError}</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">
            {cases.length === 0 ? "등록된 건이 없습니다." : "검색 결과가 없습니다."}
          </div>
        ) : (
          <ul className="list-none divide-y divide-slate-100">
            {filtered.map((c) => {
              const isSelected = c.id === selectedId;
              const parcelCount = c.parcels.length || c.parcelCount || 0;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void handleSelect(c.id)}
                    className={cn(
                      "w-full px-3 py-2 text-left text-xs transition-colors hover:bg-slate-50",
                      isSelected && "bg-primary/10"
                    )}
                  >
                    <div className="truncate font-medium text-slate-800">{c.name || "(건명 없음)"}</div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500">
                      필지 {parcelCount.toLocaleString()}건
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!!cases.length && !loading && (
        <div className="shrink-0 border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
          {filtered.length.toLocaleString()}건
        </div>
      )}
    </div>
  );
}
