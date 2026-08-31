/** pdf.js text_layer_builder.js — endOfContent·selectionchange·copy 경량 이식 */

type TextLayerEntry = {
  endOfContent: HTMLDivElement;
  onCopy: (event: ClipboardEvent) => void;
};

const textLayers = new Map<HTMLElement, TextLayerEntry>();
let abortController: AbortController | null = null;
let isPointerDown = false;
let prevRange: Range | null = null;

function resetEndOfContent(end: HTMLDivElement, textLayer: HTMLElement): void {
  textLayer.append(end);
  end.style.width = '';
  end.style.height = '';
  textLayer.classList.remove('selecting');
}

function stripNullChars(text: string): string {
  return text.replace(/\0/g, '');
}

/** 선택 HTML — span inline font-family·font-size를 computed 값으로 고정(Word 등 붙여넣기) */
function buildSelectionHtml(range: Range): string {
  const holder = document.createElement('div');
  holder.appendChild(range.cloneContents());
  holder.querySelectorAll<HTMLElement>('span').forEach((span) => {
    const computed = window.getComputedStyle(span);
    if (computed.fontFamily) span.style.fontFamily = computed.fontFamily;
    if (computed.fontSize) span.style.fontSize = computed.fontSize;
    span.style.color = computed.color === 'transparent' ? '' : computed.color;
  });
  return holder.innerHTML;
}

function handleTextLayerCopy(textLayerDiv: HTMLElement, event: ClipboardEvent): void {
  const selection = document.getSelection();
  const data = event.clipboardData;
  if (!selection || selection.isCollapsed || !data) return;
  const anchor = selection.anchorNode;
  const focus = selection.focusNode ?? anchor;
  if (!anchor || !focus || !textLayerDiv.contains(anchor) || !textLayerDiv.contains(focus)) return;

  event.preventDefault();
  event.stopPropagation();

  const plain = stripNullChars(selection.toString());
  data.setData('text/plain', plain);

  if (selection.rangeCount > 0) {
    const html = buildSelectionHtml(selection.getRangeAt(0));
    if (html.trim()) {
      data.setData('text/html', html);
    }
  }
}

function ensureGlobalListeners(): void {
  if (abortController) return;
  abortController = new AbortController();
  const { signal } = abortController;

  document.addEventListener(
    'pointerdown',
    () => {
      isPointerDown = true;
    },
    { signal }
  );
  document.addEventListener(
    'pointerup',
    () => {
      isPointerDown = false;
      textLayers.forEach(({ endOfContent }, textLayer) => resetEndOfContent(endOfContent, textLayer));
    },
    { signal }
  );
  window.addEventListener(
    'blur',
    () => {
      isPointerDown = false;
      textLayers.forEach(({ endOfContent }, textLayer) => resetEndOfContent(endOfContent, textLayer));
    },
    { signal }
  );
  document.addEventListener(
    'keyup',
    () => {
      if (!isPointerDown) {
        textLayers.forEach(({ endOfContent }, textLayer) => resetEndOfContent(endOfContent, textLayer));
      }
    },
    { signal }
  );

  document.addEventListener(
    'selectionchange',
    () => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        textLayers.forEach(({ endOfContent }, textLayer) => resetEndOfContent(endOfContent, textLayer));
        return;
      }

      const activeTextLayers = new Set<HTMLElement>();
      for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i);
        for (const textLayerDiv of textLayers.keys()) {
          if (!activeTextLayers.has(textLayerDiv) && range.intersectsNode(textLayerDiv)) {
            activeTextLayers.add(textLayerDiv);
          }
        }
      }

      for (const [textLayerDiv, { endOfContent }] of textLayers) {
        if (activeTextLayers.has(textLayerDiv)) {
          textLayerDiv.classList.add('selecting');
        } else {
          resetEndOfContent(endOfContent, textLayerDiv);
        }
      }

      const range = selection.getRangeAt(0);
      const modifyStart =
        prevRange != null &&
        (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
          range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
      let anchor: Node = modifyStart ? range.startContainer : range.endContainer;
      if (anchor.nodeType === Node.TEXT_NODE) {
        anchor = anchor.parentNode as Node;
      }
      const parentTextLayer = (anchor as HTMLElement).parentElement?.closest('.textLayer') as HTMLElement | null;
      const entry = parentTextLayer ? textLayers.get(parentTextLayer) : undefined;
      if (entry && parentTextLayer) {
        entry.endOfContent.style.width = parentTextLayer.style.width;
        entry.endOfContent.style.height = parentTextLayer.style.height;
        (anchor as HTMLElement).parentElement?.insertBefore(
          entry.endOfContent,
          modifyStart ? anchor : anchor.nextSibling
        );
      }
      prevRange = range.cloneRange();
    },
    { signal }
  );
}

function teardownGlobalListenersIfEmpty(): void {
  if (textLayers.size > 0) return;
  abortController?.abort();
  abortController = null;
  isPointerDown = false;
  prevRange = null;
}

/** TextLayer 렌더 후 endOfContent·선택 UX 등록 */
export function registerPdfTextLayerSelection(textLayerDiv: HTMLElement): void {
  if (textLayers.has(textLayerDiv)) return;

  const endOfContent = document.createElement('div');
  endOfContent.className = 'endOfContent';
  textLayerDiv.append(endOfContent);

  textLayerDiv.addEventListener('mousedown', () => {
    textLayerDiv.classList.add('selecting');
  });

  const onCopy = (event: ClipboardEvent) => handleTextLayerCopy(textLayerDiv, event);
  textLayerDiv.addEventListener('copy', onCopy);

  textLayers.set(textLayerDiv, { endOfContent, onCopy });
  ensureGlobalListeners();
}

export function unregisterPdfTextLayerSelection(textLayerDiv: HTMLElement): void {
  const entry = textLayers.get(textLayerDiv);
  if (!entry) return;
  textLayers.delete(textLayerDiv);
  textLayerDiv.classList.remove('selecting');
  textLayerDiv.removeEventListener('copy', entry.onCopy);
  entry.endOfContent.remove();
  teardownGlobalListenersIfEmpty();
}
