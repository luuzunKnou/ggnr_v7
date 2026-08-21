'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/app/shadcnComponents/ui/input';
import { cn } from '@/lib/utils';

const HANGUL_CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;

function toChoseongKey(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= HANGUL_BASE && code <= HANGUL_END) {
      out += HANGUL_CHOSEONG[Math.floor((code - HANGUL_BASE) / 588)] ?? '';
      continue;
    }
    if (HANGUL_CHOSEONG.includes(ch)) {
      out += ch;
      continue;
    }
    out += ch.toLowerCase();
  }
  return out;
}

function isChoseongOnlyQuery(q: string): boolean {
  return q.length > 0 && [...q].every((ch) => HANGUL_CHOSEONG.includes(ch));
}

function matchesSuggestQuery(label: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const lower = label.toLowerCase();
  const qLower = q.toLowerCase();
  if (lower.includes(qLower)) return true;
  const labelCho = toChoseongKey(label);
  const queryCho = toChoseongKey(q);
  if (labelCho.includes(queryCho)) return true;
  if (isChoseongOnlyQuery(q) && labelCho.startsWith(queryCho)) return true;
  return false;
}

type SuggestNameInputProps = {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  inputClassName?: string;
  className?: string;
  title?: string;
};

/** 직접 입력 + 목록 제안. 목록에 없는 값도 그대로 넣을 수 있다. */
export function SuggestNameInput({
  value,
  onChange,
  options,
  placeholder = '직접 입력 또는 선택',
  disabled = false,
  inputClassName,
  className,
  title,
}: SuggestNameInputProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const raw of options) {
      const name = raw.trim();
      if (!name || seen.has(name)) continue;
      if (!matchesSuggestQuery(name, value)) continue;
      seen.add(name);
      list.push(name);
    }
    return list.slice(0, 40);
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const hasValue = Boolean(value.trim()) && !disabled;

  return (
    <div className={cn('relative min-w-0 w-full', className)} ref={rootRef}>
      <Input
        type="text"
        value={value ?? ''}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        title={title ?? placeholder}
        className={cn(hasValue ? 'pr-8' : undefined, inputClassName)}
      />
      {hasValue ? (
        <button
          type="button"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange('');
            setOpen(true);
          }}
          title="지우기"
          aria-label="지우기"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {open && !disabled && suggestions.length > 0 ? (
        <ul
          className="absolute left-0 right-0 top-[calc(100%+2px)] z-50 max-h-44 overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md"
          role="listbox"
        >
          {suggestions.map((name) => (
            <li key={name}>
              <button
                type="button"
                role="option"
                aria-selected={name === value}
                className="flex w-full px-2.5 py-1.5 text-left text-sm hover:bg-muted"
                title={name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
