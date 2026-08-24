"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { call } from "@/lib/api";

type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
};

type Rect = { left: number; top: number; width: number };

/**
 * 하천명 검색·선택 입력 — 하천구역·소하천구역이 있으면 그 목록을 쓰고,
 * 없으면 하천기본계획 하천명을 보여준다. 목록에 없는 값도 직접 입력할 수 있다.
 */
export function RiverNameSelect({ value, onChange, className, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncRect = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 2, width: r.width });
  };

  const openDropdown = () => {
    syncRect();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      call("", "POST", {
        service: "consDataAsService",
        action: "listRiverNamesFromZones",
        params: { keyword: value.trim() },
      })
        .then((res) => {
          const data = res?.data ?? res;
          setOptions(Array.isArray(data?.rivers) ? data.rivers : []);
          setListError(typeof data?.error === "string" && data.error.trim() ? data.error : null);
        })
        .catch(() => {
          setOptions([]);
          setListError("하천 목록을 불러오지 못했습니다.");
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (inputRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("scroll", syncRect, true);
    window.addEventListener("resize", syncRect);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("scroll", syncRect, true);
      window.removeEventListener("resize", syncRect);
    };
  }, [open]);

  return (
    <>
      <input
        ref={inputRef}
        className={className}
        value={value}
        placeholder={placeholder ?? "하천명 검색"}
        onChange={(e) => onChange(e.target.value)}
        onFocus={openDropdown}
      />
      {open && rect
        ? createPortal(
            <div
              ref={dropdownRef}
              className="fixed z-[9999] max-h-48 overflow-y-auto rounded border border-border bg-background shadow-lg"
              style={{ left: rect.left, top: rect.top, width: rect.width }}
            >
              {loading ? (
                <p className="px-2 py-1.5 text-[11px] text-muted-foreground">검색 중…</p>
              ) : options.length === 0 ? (
                <p className="px-2 py-1.5 text-[11px] text-slate-400">
                  {listError || "일치하는 하천이 없습니다."}
                </p>
              ) : (
                options.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="block w-full truncate px-2 py-1.5 text-left text-[11px] text-foreground/90 hover:bg-muted"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange(name);
                      setOpen(false);
                    }}
                  >
                    {name}
                  </button>
                ))
              )}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
