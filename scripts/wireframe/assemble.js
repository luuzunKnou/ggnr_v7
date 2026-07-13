// Assembles the combined wireframe HTML document from screens-meta.json +
// wf-<slug>.png files produced by extract.js / capture-and-crop.ps1.
//
// Usage: node assemble.js <scratchDir> <outHtmlPath> <docTitle> <sourceMdRelPath>

const fs = require('fs');
const path = require('path');

const [, , scratchDir, outHtmlPath, docTitle, sourceMdRelPath] = process.argv;
if (!scratchDir || !outHtmlPath || !docTitle) {
  console.error('Usage: node assemble.js <scratchDir> <outHtmlPath> <docTitle> <sourceMdRelPath>');
  process.exit(1);
}

const { intro, screens } = JSON.parse(fs.readFileSync(path.join(scratchDir, 'screens-meta.json'), 'utf8'));

function li(items) {
  return items.map(i => `        <li>${i}</li>`).join('\n');
}

function pngDims(p) {
  const b = fs.readFileSync(p);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const sections = screens.map((s, idx) => {
  const pngPath = path.join(scratchDir, `wf-${s.slug}.png`);
  const b64 = fs.readFileSync(pngPath).toString('base64');
  const [wpx, hpx] = pngDims(pngPath);
  // The capture was taken at --force-device-scale-factor=4, i.e. 4 source
  // px per CSS px. Displaying at that same 1:4 ratio (instead of stretching
  // to 100% of the panel, an arbitrary non-integer ratio that varies per
  // screen) keeps the downscale a clean integer factor, and the extra
  // source resolution gives any downstream PDF viewer's own re-zoom/resample
  // a lot more samples to work with, so its resampling artifacts (a PDF
  // viewer re-rasterizes the embedded image at whatever zoom level it's
  // showing, and that step is outside this pipeline's control) are far less
  // visible even though they can't be eliminated for an arbitrary zoom.
  const cssW = Math.round(wpx / 4);
  const cssH = Math.round(hpx / 4);

  return `
  <section class="screen" id="${s.slug}">
    <header>
      <div class="title-row">
        <h1>${s.title}</h1>
        <span class="screen-id">${s.id}</span>
      </div>
    </header>

    <div class="wireframe-panel">
      <div class="bar">
        <span>WIREFRAME</span>
      </div>
      <div class="scroll">
        <img src="data:image/png;base64,${b64}" alt="${s.id} ${s.title} 와이어프레임" width="${cssW}" height="${cssH}">
      </div>
    </div>

    <section class="notes">
      <div class="card">
        <h2>설명</h2>
        <ol>
${li(s.descItems)}
        </ol>
      </div>
      <div class="card">
        <h2>확인사항</h2>
        <ol>
${li(s.chkItems)}
        </ol>
      </div>
    </section>
  </section>`;
}).join('\n');

const toc = screens.map(s => `<a href="#${s.slug}">${s.id} · ${s.title}</a>`).join('\n      ');

const introHtml = intro ? `
  <div class="intro-page">
    <header class="doc-header">
      <h1>${intro.docTitle}</h1>
      ${intro.metaLine ? `<div class="doc-meta">${intro.metaLine}</div>` : ''}
      ${sourceMdRelPath ? `<div class="source">원본 문서: <code>${sourceMdRelPath}</code></div>` : ''}
    </header>
    ${intro.devGoal.length ? `
    <section class="intro-block">
      <h2>개발목표</h2>
      ${intro.devGoal.map(p => `<p>${p}</p>`).join('\n      ')}
    </section>` : ''}
    ${intro.flowchart ? `
    <section class="intro-block">
      <h2>플로우차트</h2>
      <pre class="flowchart">${intro.flowchart}</pre>
    </section>` : ''}
    <div class="toc">
      <h2>목차</h2>
      ${toc}
    </div>
  </div>` : `
  <div class="toc">
    <h2>목차</h2>
      ${toc}
  </div>`;

const html = `<title>${docTitle} · 와이어프레임</title>
<style>
  :root {
    --paper: #f2ede1;
    --ink: #1c2b4a;
    --ink-soft: #4a5878;
    --accent: #1e52c9;
    --accent-soft: #dbe6fb;
    --card: transparent;
    --card-border: #b0b0b0;
    --panel-bg: transparent;
    --panel-border: #b0b0b0;
    --tag-bg: #1e52c9;
    --tag-fg: #f2ede1;
  }

  :root[data-theme="dark"] {
    --paper: #0b1a33;
    --ink: #dce6fb;
    --ink-soft: #93a8d6;
    --accent: #5ab4ff;
    --accent-soft: #123262;
    --card: transparent;
    --card-border: #5a5a5a;
    --panel-bg: transparent;
    --panel-border: #5a5a5a;
    --tag-bg: #5ab4ff;
    --tag-fg: #06162e;
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #0b1a33;
      --ink: #dce6fb;
      --ink-soft: #93a8d6;
      --accent: #5ab4ff;
      --accent-soft: #123262;
      --card: transparent;
      --card-border: #5a5a5a;
      --panel-bg: transparent;
      --panel-border: #5a5a5a;
      --tag-bg: #5ab4ff;
      --tag-fg: #06162e;
    }
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 40px 24px 100px;
    background: var(--paper);
    color: var(--ink);
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    display: flex;
    justify-content: center;
  }

  .doc {
    width: 100%;
    max-width: 1180px;
    display: flex;
    flex-direction: column;
    gap: 56px;
  }

  .intro-page {
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .doc-header {
    padding-bottom: 20px;
    border-bottom: 2px solid var(--ink);
  }

  .doc-header h1 {
    margin: 0 0 8px;
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.01em;
    text-wrap: balance;
  }

  .doc-meta {
    font-size: 13px;
    color: var(--ink-soft);
  }

  .intro-block h2 {
    margin: 0 0 10px;
    font-size: 13px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .intro-block p {
    margin: 0 0 8px;
    font-size: 14px;
    line-height: 1.6;
    color: var(--ink);
  }

  .flowchart {
    margin: 0;
    padding: 16px 18px;
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: 6px;
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    color: var(--ink);
  }

  .toc {
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: 6px;
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .toc h2 {
    margin: 0 0 6px;
    font-size: 13px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .toc a {
    color: var(--ink);
    text-decoration: none;
    font-size: 14px;
    padding: 2px 0;
  }
  .toc a:hover { color: var(--accent); }

  .screen {
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding-top: 8px;
  }

  .screen + .screen {
    border-top: 1px dashed var(--card-border);
    padding-top: 56px;
  }

  header {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-bottom: 20px;
    border-bottom: 2px solid var(--ink);
  }

  .title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }

  .screen-id {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    padding: 3px 9px;
    background: var(--tag-bg);
    color: var(--tag-fg);
    border-radius: 3px;
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 12px;
    letter-spacing: 0.02em;
    font-weight: 600;
  }

  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.01em;
    text-wrap: balance;
  }

  .source {
    font-size: 13px;
    color: var(--ink-soft);
  }
  .source code {
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    background: var(--accent-soft);
    padding: 1px 6px;
    border-radius: 3px;
    color: var(--ink);
  }

  .wireframe-panel {
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    background: var(--panel-bg);
    overflow: hidden;
  }

  .wireframe-panel .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px;
    border-bottom: 1px solid var(--panel-border);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #4a5878;
  }

  .wireframe-panel .scroll {
    padding: 14px;
    background: var(--panel-bg);
  }

  .wireframe-panel img {
    display: block;
    max-width: 100%;
    height: auto;
  }

  section.notes {
    display: grid;
    grid-template-columns: 1fr;
    gap: 20px;
  }

  .card {
    padding: 0;
  }

  .card + .card {
    border-top: 1px solid var(--card-border);
    padding-top: 16px;
  }

  .card h2 {
    margin: 0 0 12px;
    font-size: 13px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .card ol {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .card li {
    font-size: 14px;
    line-height: 1.55;
    color: var(--ink);
  }

  .card li code {
    font-family: ui-monospace, Consolas, monospace;
    background: var(--accent-soft);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .card li strong { color: var(--ink); }

  .card li::marker {
    color: var(--ink-soft);
    font-family: ui-monospace, Consolas, monospace;
    font-size: 12px;
  }

  footer {
    font-size: 12px;
    color: var(--ink-soft);
    text-align: center;
  }

  @media print {
    body { background: #fff; padding: 0; }
    .intro-page { break-after: page; }
    .screen { padding-top: 0; }
    .screen + .screen {
      border-top: 2px solid var(--ink);
      padding-top: 32px;
      margin-top: 8px;
    }
    header { break-inside: avoid; break-after: avoid; }
    .wireframe-panel { break-inside: avoid; }
    .card { break-inside: avoid; }
    .intro-block { break-inside: avoid; }
  }
</style>

<div class="doc">
${introHtml}
${sections}

  <footer>${docTitle} 와이어프레임 전체 문서 · 와이어프레임을 PNG로 캡처해 임베드 (화면·인쇄 동일하게 보임)</footer>
</div>
`;

fs.writeFileSync(outHtmlPath, html, 'utf8');
console.log(`wrote ${outHtmlPath}, ${html.length} chars`);
