'use client';

import { useEffect } from 'react';
import { getBasePath, resolveFetchInput, withBasePath } from '@/lib/basePath';

let fetchPatched = false;
let imageSrcPatched = false;

function shouldRewritePublicSrc(src: string, base: string): boolean {
  if (!src.startsWith('/') || src.startsWith(`${base}/`) || src === base) return false;
  return (
    src.startsWith('/symbol') ||
    src.startsWith('/image') ||
    src.startsWith('/proxy') ||
    src.startsWith('/cesiumStatic') ||
    src.startsWith('/font') ||
    src.startsWith('/favicon') ||
    src.startsWith('/file.svg') ||
    src.startsWith('/globe.svg') ||
    src.startsWith('/window.svg') ||
    src.startsWith('/ggnr_ai.svg')
  );
}

/**
 * 게이트(dggskorea/[프로젝트]) basePath 환경에서
 * - raw fetch('/api/...') 보정
 * - img / OL Icon(Image.src) 의 /symbol·/image 보정
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
      const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      if (desc?.set && desc?.get) {
        const rawSet = desc.set;
        const rawGet = desc.get;
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
          configurable: true,
          enumerable: desc.enumerable,
          get() {
            return rawGet.call(this);
          },
          set(value: string) {
            const next =
              typeof value === 'string' && shouldRewritePublicSrc(value, base)
                ? withBasePath(value)
                : value;
            rawSet.call(this, next);
          },
        });
      }
    }

    const rewriteImg = (img: HTMLImageElement) => {
      const src = img.getAttribute('src');
      if (!src || !shouldRewritePublicSrc(src, base)) return;
      img.setAttribute('src', withBasePath(src));
    };

    document.querySelectorAll('img[src^="/"]').forEach((el) => rewriteImg(el as HTMLImageElement));

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node instanceof HTMLImageElement) rewriteImg(node);
          node.querySelectorAll?.('img[src^="/"]').forEach((el) => rewriteImg(el as HTMLImageElement));
        });
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    return () => mo.disconnect();
  }, []);

  return null;
}
