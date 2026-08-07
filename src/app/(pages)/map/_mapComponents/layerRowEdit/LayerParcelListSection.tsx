"use client";

import { cn } from "@/lib/utils";
import type { LayerRowParcelItem } from "./types";

type Props = {
  parcels: LayerRowParcelItem[];
  movingParcelIdx: number | null;
  onParcelClick: (item: LayerRowParcelItem, idx: number) => void;
};

export function LayerParcelListSection({ parcels, movingParcelIdx, onParcelClick }: Props) {
  return (
    <>
      <div className="mt-4 mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        필지목록
        {parcels.length > 0 ? (
          <span className="ml-1 font-normal normal-case text-slate-400">({parcels.length})</span>
        ) : null}
      </div>
      {parcels.length === 0 ? (
        <div className="rounded border border-dashed border-slate-200 bg-slate-50/80 px-2 py-3 text-slate-500">
          등록된 필지가 없습니다.
        </div>
      ) : (
        <ul className="max-h-48 list-none space-y-0 overflow-y-auto overscroll-contain rounded border border-slate-200 bg-white scrollbar-hide">
          {parcels.map((item, i) => (
            <li
              key={`${i}-${item.address.slice(0, 24)}`}
              className="border-b border-slate-100 px-2 py-1.5 text-slate-800 last:border-b-0 break-words"
            >
              <button
                type="button"
                className={cn(
                  "w-full text-left text-slate-800 hover:text-primary",
                  "disabled:opacity-70 disabled:cursor-default"
                )}
                disabled={!item.extent3857}
                onClick={() => onParcelClick(item, i)}
                title={item.extent3857 ? "클릭 시 위치 이동" : "위치 정보 없음"}
              >
                <span className="mr-2 tabular-nums text-slate-400">{i + 1}.</span>
                {item.address}
                {movingParcelIdx === i && <span className="ml-2 text-[11px] text-slate-500">이동 중…</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
