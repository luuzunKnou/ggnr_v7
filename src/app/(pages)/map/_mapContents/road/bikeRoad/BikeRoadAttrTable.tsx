"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  BIKE_FORM_LABEL_W,
  bikeFormFieldClass,
  bikeFormTableClass,
  bikeFormTdClass,
  bikeFormThClass,
} from "./bikeRoadFormUi";
import { BikeRoadDirectionPathField } from "./BikeRoadDirectionPathField";
import { BIKE_ROAD_KIND_OPTIONS } from "./bikeRoadMock";

export type BikeRoadAttrDraft = {
  title: string;
  kind: string;
  totalLength: string;
  direction: string;
  startPoint: string;
  endPoint: string;
  bridges: string;
  subway: string;
  remark: string;
};

type Props = {
  editing: boolean;
  values: BikeRoadAttrDraft;
  onChange?: <K extends keyof BikeRoadAttrDraft>(key: K, value: BikeRoadAttrDraft[K]) => void;
};

function Th({
  children,
  className,
  rowSpan,
}: {
  children: ReactNode;
  className?: string;
  rowSpan?: number;
}) {
  return (
    <th rowSpan={rowSpan} className={cn(bikeFormThClass, className)}>
      {children}
    </th>
  );
}

function Td({
  children,
  className,
  colSpan,
}: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={cn(bikeFormTdClass, className)}>
      {children}
    </td>
  );
}

function ViewText({ value, multiline }: { value: string; multiline?: boolean }) {
  const t = value.trim() || "—";
  return (
    <span
      className={cn(
        "block w-full min-w-0 text-[11px] leading-snug text-foreground",
        multiline ? "whitespace-normal break-words" : "truncate whitespace-nowrap"
      )}
      title={t === "—" ? undefined : t}
    >
      {t}
    </span>
  );
}

function CellInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      className={bikeFormFieldClass}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** 불법점용 관리카드형 속성 표 — 선이 이어지는 table-fixed */
export function BikeRoadAttrTable({ editing, values, onChange }: Props) {
  const set = <K extends keyof BikeRoadAttrDraft>(key: K, value: BikeRoadAttrDraft[K]) =>
    onChange?.(key, value);

  return (
    <table className={bikeFormTableClass}>
      <colgroup>
        <col style={{ width: BIKE_FORM_LABEL_W }} />
        <col />
        <col style={{ width: BIKE_FORM_LABEL_W }} />
        <col />
      </colgroup>
      <tbody>
        <tr>
          <Th>구분</Th>
          <Td>
            {editing ? (
              <select
                className={bikeFormFieldClass}
                value={values.kind}
                onChange={(e) => set("kind", e.target.value)}
              >
                {BIKE_ROAD_KIND_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <ViewText value={values.kind} />
            )}
          </Td>
          <Th>총 연장</Th>
          <Td>
            {editing ? (
              <CellInput
                value={values.totalLength}
                onChange={(v) => set("totalLength", v)}
                placeholder="예: 17.24"
              />
            ) : (
              <ViewText value={values.totalLength} />
            )}
          </Td>
        </tr>
        <tr>
          <Th>진행방향</Th>
          <Td colSpan={3} className={editing ? "h-auto min-h-[30px] py-0.5" : undefined}>
            <BikeRoadDirectionPathField
              editing={editing}
              value={values.direction}
              onChange={(direction, title) => {
                set("direction", direction);
                set("title", title);
              }}
            />
          </Td>
        </tr>
        <tr>
          <Th>시점</Th>
          <Td>
            {editing ? (
              <CellInput value={values.startPoint} onChange={(v) => set("startPoint", v)} />
            ) : (
              <ViewText value={values.startPoint} />
            )}
          </Td>
          <Th>종점</Th>
          <Td>
            {editing ? (
              <CellInput value={values.endPoint} onChange={(v) => set("endPoint", v)} />
            ) : (
              <ViewText value={values.endPoint} />
            )}
          </Td>
        </tr>
        <tr>
          <Th>교량</Th>
          <Td>
            {editing ? (
              <CellInput value={values.bridges} onChange={(v) => set("bridges", v)} />
            ) : (
              <ViewText value={values.bridges} />
            )}
          </Td>
          <Th>지하철역</Th>
          <Td>
            {editing ? (
              <CellInput value={values.subway} onChange={(v) => set("subway", v)} />
            ) : (
              <ViewText value={values.subway} />
            )}
          </Td>
        </tr>
        <tr>
          <Th>비고</Th>
          <Td colSpan={3}>
            {editing ? (
              <CellInput value={values.remark} onChange={(v) => set("remark", v)} />
            ) : (
              <ViewText value={values.remark} multiline />
            )}
          </Td>
        </tr>
      </tbody>
    </table>
  );
}
