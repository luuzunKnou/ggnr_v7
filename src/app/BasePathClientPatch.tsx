'use client';

import { useEffect } from 'react';
import {
  getBasePath,
  resolveFetchInput,
  shouldPrefixAppPath,
  shouldPrefixNavPath,
  withBasePath,
  withBasePathNav,
} from '@/lib/basePath';

let fetchPatched = false;
let imageSrcPatched = false;
let videoSrcPatched = false;
let eventSourcePatched = false;
let windowOpenPatched = false;

function shouldRewritePublicSrc(src: string): boolean {
  return shouldPrefixAppPath(src);
}

function patchMediaSrc(Ctor: typeof HTMLImageElement | typeof HTMLVideoElement) {
  const desc = Object.getOwnPropertyDescriptor(Ctor.prototype, 'src');
  if (!desc?.set || !desc?.get) return;
  const rawSet = desc.set;
  const rawGet = desc.get;
  Object.defineProperty(Ctor.prototype, 'src', {
    configurable: true,
    enumerable: desc.enumerable,
    get() {
      return rawGet.call(this);
    },
    set(value: string) {
      const next =
        typeof value === 'string' && shouldRewritePublicSrc(value) ? withBasePath(value) : value;
      rawSet.call(this, next);
    },
  });
}

function rewriteMediaSrcAttr(el: HTMLImageElement | HTMLVideoElement | HTMLSourceElement) {
  const src = el.getAttribute('src');
  if (!src || !shouldRewritePublicSrc(src)) return;
  el.setAttribute('src', withBasePath(src));
}

function rewriteOpenUrl(url: string | URL | undefined | null): string | URL | undefined | null {
  if (url == null || url === '') return url;
  if (typeof url !== 'string') {
    if (url.origin === window.location.origin && shouldPrefixNavPath(url.pathname)) {
      return new URL(withBasePath(url.pathname) + url.search + url.hash, url.origin);
    }
    return url;
  }
  if (/^(blob:|data:|javascript:)/i.test(url)) return url;
  if (/^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      if (u.origin === window.location.origin) {
        return `${u.origin}${withBasePathNav(u.pathname + u.search + u.hash)}`;
      }
    } catch {
      /* keep */
    }
    return url;
  }
  if (url.startsWith('/') && !url.startsWith('//')) {
    return withBasePathNav(url);
  }
  return url;
}

/**
 * 게이트(dggskorea/[프로젝트]) basePath 환경에서
 * - raw fetch('/api/...') 보정
 * - img·video / OL Icon 의 /api·/symbol·/image 보정
 * - EventSource·window.open 앱 절대경로 보정
 */
export function BasePathClientPatch() {
  useEffect(() => {
    const base = getBasePath();
    if (!base || typeof window === 'undefined') return;

    if (!fetchPatched) {
      fetchPatched = true;
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
        originalFetch(resolveFetchInput(input), init);
    }

    if (!imageSrcPatched) {
      imageSrcPatched = true;
      patchMediaSrc(HTMLImageElement);
    }

    if (!videoSrcPatched) {
      videoSrcPatched = true;
      patchMediaSrc(HTMLVideoElement);
      const sourceDesc = Object.getOwnPropertyDescriptor(HTMLSourceElement.prototype, 'src');
      if (sourceDesc?.set && sourceDesc?.get) {
        const rawSet = sourceDesc.set;
        const rawGet = sourceDesc.get;
        Object.defineProperty(HTMLSourceElement.prototype, 'src', {
          configurable: true,
          enumerable: sourceDesc.enumerable,
          get() {
            return rawGet.call(this);
          },
          set(value: string) {
            const next =
              typeof value === 'string' && shouldRewritePublicSrc(value) ? withBasePath(value) : value;
            rawSet.call(this, next);
          },
        });
      }
    }

    if (!eventSourcePatched && typeof window.EventSource === 'function') {
      eventSourcePatched = true;
      const OriginalEventSource = window.EventSource;
      window.EventSource = class extends OriginalEventSource {
        constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
          const resolved = resolveFetchInput(url);
          super(resolved as string | URL, eventSourceInitDict);
        }
      } as typeof EventSource;
    }

    if (!windowOpenPatched) {
      windowOpenPatched = true;
      const originalOpen = window.open.bind(window);
      window.open = ((url?: string | URL, target?: string, features?: string) => {
        const next = rewriteOpenUrl(url ?? undefined);
        return originalOpen(next as string | undefined, target, features);
      }) as typeof window.open;
    }

    document.querySelectorAll('img[src^="/"]').forEach((el) => rewriteMediaSrcAttr(el as HTMLImageElement));
    document.querySelectorAll('video[src^="/"]').forEach((el) => rewriteMediaSrcAttr(el as HTMLVideoElement));
    document.querySelectorAll('source[src^="/"]').forEach((el) => rewriteMediaSrcAttr(el as HTMLSourceElement));

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node instanceof HTMLImageElement || node instanceof HTMLVideoElement || node instanceof HTMLSourceElement) {
            rewriteMediaSrcAttr(node);
          }
          node.querySelectorAll?.('img[src^="/"], video[src^="/"], source[src^="/"]').forEach((el) =>
            rewriteMediaSrcAttr(el as HTMLImageElement | HTMLVideoElement | HTMLSourceElement)
          );
        });
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    return () => mo.disconnect();
  }, []);

  return null;
}
