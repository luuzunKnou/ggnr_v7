import { TextLayer, type PDFPageProxy, type PageViewport } from 'pdfjs-dist';
import {
  registerPdfTextLayerSelection,
  unregisterPdfTextLayerSelection,
} from './pdfTextLayerSelection';

type PageTextSource = PDFPageProxy & {
  streamTextContent?: (params?: {
    includeMarkedContent?: boolean;
    disableNormalization?: boolean;
  }) => ReadableStream;
};

const STREAM_TEXT_CONTENT_PARAMS = {
  includeMarkedContent: true,
  disableNormalization: true,
} as const;

/** canvas와 동일 viewport로 선택 가능한 TextLayer 렌더 */
export async function renderPdfTextLayer(params: {
  page: PDFPageProxy;
  viewport: PageViewport;
  container: HTMLElement;
  signal?: AbortSignal;
}): Promise<TextLayer> {
  if (params.signal?.aborted) {
    throw new DOMException('TextLayer render aborted', 'AbortError');
  }

  unregisterPdfTextLayerSelection(params.container);
  params.container.replaceChildren();
  params.container.style.setProperty('--scale-factor', String(params.viewport.scale));

  const page = params.page as PageTextSource;
  const textContentSource =
    typeof page.streamTextContent === 'function'
      ? page.streamTextContent(STREAM_TEXT_CONTENT_PARAMS)
      : await params.page.getTextContent();

  if (params.signal?.aborted) {
    throw new DOMException('TextLayer render aborted', 'AbortError');
  }

  const textLayer = new TextLayer({
    textContentSource,
    container: params.container,
    viewport: params.viewport,
  });

  params.signal?.addEventListener('abort', () => textLayer.cancel(), { once: true });
  await textLayer.render();

  if (params.signal?.aborted) {
    textLayer.cancel();
    throw new DOMException('TextLayer render aborted', 'AbortError');
  }

  registerPdfTextLayerSelection(params.container);
  return textLayer;
}

export function cancelPdfTextLayer(
  layer: TextLayer | null | undefined,
  container?: HTMLElement | null
): void {
  if (container) {
    unregisterPdfTextLayerSelection(container);
  }
  layer?.cancel();
}
