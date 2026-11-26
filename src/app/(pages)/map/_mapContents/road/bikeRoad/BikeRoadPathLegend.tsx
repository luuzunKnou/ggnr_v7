"use client";

import { cn } from "@/lib/utils";
import { BIKE_ROAD_PATH_LEGEND_TABLE } from "./bikeRoadMock";
import {
  BIKE_FORM_BORDER,
  BIKE_FORM_TH_BG,
  bikeFormTableClass,
} from "./bikeRoadFormUi";

type Props = {
  className?: string;
  /** 어두운 지도 위 */
  onMap?: boolean;
};

/**
 * 범례 표(소형) — 제목만 강조, 구분·현황.
 * 관리카드 표 톤, 지도·위치도를 가리지 않게 작게.
 */
export function BikeRoadPathLegend({ className, onMap = false }: Props) {
  const t = BIKE_ROAD_PATH_LEGEND_TABLE;
  const cell = cn(
    "box-border",
    BIKE_FORM_BORDER,
    "px-1 py-0.5 align-middle text-[9px] leading-tight"
  );
  const th = cn(cell, BIKE_FORM_TH_BG, "text-center font-medium text-muted-foreground");
  const td = cn(cell, "bg-background text-foreground");

  return (
    <div
      className={cn(
        "pointer-events-none select-none overflow-hidden bg-background/95 shadow-sm",
        onMap ? "text-[#111827]" : "text-foreground",
        className
      )}
      aria-hidden
    >
      <table className={cn(bikeFormTableClass, "w-auto min-w-[9.5rem]")}>
        <thead>
          <tr>
            <th
              colSpan={3}
              className={cn(
                cell,
                "bg-primary/15 py-1 text-center text-[10px] font-semibold text-primary"
              )}
            >
              {t.title}
            </th>
          </tr>
          <tr>
            <th colSpan={2} className={th}>
              {t.colGroup}
            </th>
            <th className={cn(th, "min-w-[2.25rem]")}>{t.colStatus}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={2} className={cn(td, "text-center font-medium")}>
              {t.dedicated.group}
            </td>
            <td className={cn(td, "text-center")}>
              <span
                className="mx-auto inline-block h-[2.5px] w-6"
                style={{ backgroundColor: t.dedicated.color }}
              />
            </td>
          </tr>
          {t.shared.map((row, i) => (
            <tr key={row.key}>
              {i === 0 ? (
                <td
                  rowSpan={t.shared.length}
                  className={cn(
                    td,
                    "max-w-[4.25rem] px-0.5 text-center font-medium leading-snug"
                  )}
                >
                  <span className="inline-block">
                    자전거 보행자
                    <br />
                    겸용도로
                  </span>
                </td>
              ) : null}
              <td className={cn(td, "whitespace-nowrap text-center")}>{row.sub}</td>
              <td className={cn(td, "text-center")}>
                <span
                  className="mx-auto inline-block h-[2.5px] w-6"
                  style={{ backgroundColor: row.color }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
