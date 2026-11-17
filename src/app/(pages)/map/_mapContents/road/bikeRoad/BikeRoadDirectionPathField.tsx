"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { bikeFormFieldClass } from "./bikeRoadFormUi";
import {
  joinDirectionParts,
  parseDirectionParts,
  titleFromDirection,
} from "./bikeRoadDirection";

type Props = {
  editing: boolean;
  value: string;
  onChange: (nextDirection: string, nextTitle: string) => void;
};

/**
 * 진행방향 — 자유 varchar 대신 구간을 칩으로 추가.
 * 목록명(title)은 첫·끝 칩으로 자동.
 */
export function BikeRoadDirectionPathField({ editing, value, onChange }: Props) {
  const parts = parseDirectionParts(value);
  const [draft, setDraft] = useState("");

  const commitParts = (next: string[]) => {
    const direction = joinDirectionParts(next);
    onChange(direction, titleFromDirection(next));
  };

  const addPart = () => {
    const t = draft.trim();
    if (!t) return;
    commitParts([...parts, t]);
    setDraft("");
  };

  const removeAt = (index: number) => {
    commitParts(parts.filter((_, i) => i !== index));
  };

  if (!editing) {
    const text = value.trim() || "—";
    return (
      <span
        className="block w-full min-w-0 whitespace-normal break-words text-[11px] leading-snug text-foreground"
        title={text === "—" ? undefined : text}
      >
        {text}
      </span>
    );
  }

  return (
    <div className="flex min-h-[22px] w-full min-w-0 flex-wrap items-center gap-1 py-0.5">
      {parts.map((p, i) => (
        <span key={`${p}-${i}`} className="inline-flex items-center gap-0.5">
          {i > 0 ? (
            <span className="px-0.5 text-[10px] text-muted-foreground" aria-hidden>
              →
            </span>
          ) : null}
          <span
            className={cn(
              "inline-flex max-w-[12rem] items-center gap-0.5 rounded bg-muted/70 px-1.5 py-0.5 text-[11px] leading-none text-foreground"
            )}
            title={p}
          >
            <span className="truncate">{p}</span>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
              aria-label={`${p} 삭제`}
              onClick={() => removeAt(i)}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </span>
      ))}
      <span className="inline-flex min-w-[8rem] flex-1 items-center gap-0.5">
        <input
          className={cn(bikeFormFieldClass, "min-w-[6rem] flex-1")}
          value={draft}
          placeholder={parts.length === 0 ? "첫 구간 입력 후 Enter" : "다음 구간 입력"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addPart();
            }
          }}
        />
        <button
          type="button"
          className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title="구간 추가"
          aria-label="구간 추가"
          onClick={addPart}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  );
}
