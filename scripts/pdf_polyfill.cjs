/** Node 20.14 polyfill + pdfjs 필수 browser globals (@napi-rs/canvas) */
const nodeModule = require('module');

if (typeof process.getBuiltinModule !== 'function') {
  process.getBuiltinModule = (name) => {
    if (name === 'module') return nodeModule;
    try {
      return require(name);
    } catch {
      return undefined;
    }
  };
}

try {
  const canvas = require('@napi-rs/canvas');
  if (!globalThis.DOMMatrix && canvas.DOMMatrix) globalThis.DOMMatrix = canvas.DOMMatrix;
  if (!globalThis.Path2D && canvas.Path2D) globalThis.Path2D = canvas.Path2D;
  if (!globalThis.ImageData && canvas.ImageData) globalThis.ImageData = canvas.ImageData;
} catch (err) {
  console.warn('[pdf_polyfill] @napi-rs/canvas preload failed:', err instanceof Error ? err.message : String(err));
}
