'use client';

import { useEffect } from 'react';
import { applyHangulBackspace, applyHangulKey } from '@/lib/hangulIme';

const HANGUL_FIELD_HINT = /검색|주소|지번|도로명|장소/;

function isHangulSearchField(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false;
  if (target.readOnly || target.disabled) return false;
  if (target.dataset.hangulIme === 'off') return false;
  if (target instanceof HTMLInputElement) {
    const type = (target.type || 'text').toLowerCase();
    if (type !== 'text' && type !== 'search') return false;
  }
  const hint = `${target.placeholder} ${target.getAttribute('aria-label') ?? ''} ${target.title}`;
  return HANGUL_FIELD_HINT.test(hint);
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
}

function commitEdit(el: HTMLInputElement | HTMLTextAreaElement, value: string, cursor: number) {
  setNativeValue(el, value);
  el.setSelectionRange(cursor, cursor);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const restore = () => {
    if (document.activeElement === el) el.setSelectionRange(cursor, cursor);
  };
  queueMicrotask(restore);
  requestAnimationFrame(restore);
}

/** 주소·통합검색 칸에서 영문 자판 입력을 한글로 바꾼다. 한글 입력기가 이미 켜져 있으면 그대로 둔다. */
export function HangulSearchIme() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const el = event.target;
      if (!isHangulSearchField(el)) return;

      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;

      if (event.key === 'Backspace') {
        const next = applyHangulBackspace(el.value, start, end);
        if (!next) return;
        event.preventDefault();
        commitEdit(el, next.value, next.cursor);
        return;
      }

      if (event.key.length !== 1) return;
      const next = applyHangulKey(el.value, start, end, event.key);
      if (!next) return;
      event.preventDefault();
      commitEdit(el, next.value, next.cursor);
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return null;
}
