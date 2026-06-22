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
      <div className="mt-4 mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">필지목록</div>
      {parcels.length === 0 ? (
        <div className="rounded border border-dashed border-slate-200 bg-slate-50/80 px-2 py-3 text-slate-500">
          등록된 필지가 없습니다.
        </div>
      ) : (
        <ul className="list-none space-y-0 rounded border border-slate-200 bg-white">
          {parcels.map((item, i) => (
            <li
              key={`${i}-${item.address.slice(0, 24)}`}
              className="border-b border-slate-100 px-2 py-2 text-slate-800 last:border-b-0 break-words"
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
