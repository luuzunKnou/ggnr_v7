// Generic wireframe-doc extractor.
// Usage: node extract.js <mdPath> <scratchDir> <fontFaceCssPath>
//
// Parses "### <ID> <title>" sections that each contain:
//   - a fenced ``` wireframe block
//   - a "#### 설명" numbered list
//   - a "#### 확인사항" numbered list
// Writes one capture-<slug>.html per screen (ready for headless-Chrome
// screenshotting) plus screens-meta.json describing every screen.

const fs = require('fs');
const path = require('path');

const [, , mdPath, scratchDir, fontFaceCssPath] = process.argv;
if (!mdPath || !scratchDir || !fontFaceCssPath) {
  console.error('Usage: node extract.js <mdPath> <scratchDir> <fontFaceCssPath>');
  process.exit(1);
}

const raw = fs.readFileSync(mdPath, 'utf8');
const lines = raw.split(/\r?\n/);

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeInline(s) {
  let e = escapeHtml(s);
  e = e.replace(/`([^`]+)`/g, '<code>$1</code>');
  e = e.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return e;
}

function slugify(id) {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Find section boundaries: any "### " heading starts a screen; the next
// "## " or "### " heading (or EOF) ends it.
const headingRe = /^### (\S+)\s+(.*)$/;
const sectionStarts = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(headingRe);
  if (m) sectionStarts.push({ line: i, id: m[1], title: m[2].trim() });
}

function nextBoundary(fromLine) {
  for (let i = fromLine + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]) || /^###\s/.test(lines[i])) return i;
  }
  return lines.length;
}

function extractFencedBlock(start, end) {
  let fenceStart = -1;
  for (let i = start; i < end; i++) {
    if (lines[i].trim() === '```') { fenceStart = i; break; }
  }
  if (fenceStart === -1) return null;
  let fenceEnd = -1;
  for (let i = fenceStart + 1; i < end; i++) {
    if (lines[i].trim() === '```') { fenceEnd = i; break; }
  }
  if (fenceEnd === -1) return null;
  return lines.slice(fenceStart + 1, fenceEnd);
}

function extractNumberedListAfter(headingText, start, end) {
  let headingLine = -1;
  for (let i = start; i < end; i++) {
    if (lines[i].trim().replace(/^#+\s*/, '') === headingText) { headingLine = i; break; }
  }
  if (headingLine === -1) return [];
  let listEnd = end;
  for (let i = headingLine + 1; i < end; i++) {
    if (/^#{2,4}\s/.test(lines[i])) { listEnd = i; break; }
  }
  const items = [];
  for (let i = headingLine + 1; i < listEnd; i++) {
    const m = lines[i].match(/^\d+\.\s+(.*)$/);
    if (m) items.push(escapeInline(m[1].trim()));
  }
  return items;
}

// --- intro: title + 개발목표 + 플로우차트, rendered on page 1 above the TOC ---
function findLine(re, start, end) {
  for (let i = start; i < end; i++) if (re.test(lines[i])) return i;
  return -1;
}

function extractParagraphs(start, end) {
  const paras = [];
  let buf = [];
  for (let i = start; i < end; i++) {
    const l = lines[i];
    if (l.trim() === '') {
      if (buf.length) { paras.push(escapeInline(buf.join(' ').trim())); buf = []; }
    } else if (!/^#{1,6}\s/.test(l)) {
      buf.push(l.trim());
    }
  }
  if (buf.length) paras.push(escapeInline(buf.join(' ').trim()));
  return paras;
}

let intro = null;
const titleLine = findLine(/^# (.+)$/, 0, lines.length);
if (titleLine !== -1) {
  const docTitle = lines[titleLine].replace(/^# /, '').trim();
  const firstH2 = findLine(/^##\s/, titleLine + 1, lines.length);
  const metaLine = lines.slice(titleLine + 1, firstH2 === -1 ? lines.length : firstH2)
    .map(l => l.trim()).find(l => l !== '') || '';

  const goalHeadingLine = findLine(/^##\s+개발목표\s*$/, 0, lines.length);
  const goalEnd = goalHeadingLine === -1 ? -1 : nextBoundary(goalHeadingLine);
  const devGoal = goalHeadingLine === -1 ? [] : extractParagraphs(goalHeadingLine + 1, goalEnd);

  const flowHeadingLine = findLine(/^##\s+플로우차트\s*$/, 0, lines.length);
  const flowEnd = flowHeadingLine === -1 ? -1 : nextBoundary(flowHeadingLine);
  const flowLines = flowHeadingLine === -1 ? null : extractFencedBlock(flowHeadingLine, flowEnd);
  const flowchart = flowLines ? flowLines.map(escapeHtml).join('\n') : null;

  intro = { docTitle, metaLine: escapeHtml(metaLine), devGoal, flowchart };
}

const fontFace = fs.readFileSync(fontFaceCssPath, 'utf8');
const meta = [];

for (const s of sectionStarts) {
  const end = nextBoundary(s.line);
  const wfLines = extractFencedBlock(s.line, end);
  if (!wfLines) continue; // heading without a wireframe block isn't a screen section
  // em dash (—) isn't in the embedded monospace font's glyph subset, so the
  // browser falls back to a different font just for that character, which
  // renders at a different width and throws off column alignment for the
  // rest of that line. Swap it for a plain hyphen, which is guaranteed to be
  // in the subset (used throughout the box-drawing borders) and is exactly
  // 1 column wide, same as the em dash was meant to occupy.
  const wfText = wfLines.map(l => escapeHtml(l.replace(/—/g, '-'))).join('\n');
  const descItems = extractNumberedListAfter('설명', s.line, end);
  const chkItems = extractNumberedListAfter('확인사항', s.line, end);
  const slug = slugify(s.id);

  const captureHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>${fontFace}</style>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { display: inline-block; }
  .box {
    display: inline-block;
    padding: 20px 22px;
    background: #ffffff;
  }
  pre {
    margin: 0;
    font-family: "Nanum Gothic Coding", monospace;
    font-size: 12.5px;
    line-height: 1.55;
    white-space: pre;
    color: #22335c;
    font-variant-numeric: tabular-nums;
  }
</style>
</head>
<body>
<div class="box">
<pre>${wfText}</pre>
</div>
</body>
</html>
`;

  fs.writeFileSync(path.join(scratchDir, `capture-${slug}.html`), captureHtml, 'utf8');
  meta.push({ id: s.id, title: s.title, slug, descItems, chkItems });
}

fs.writeFileSync(path.join(scratchDir, 'screens-meta.json'), JSON.stringify({ intro, screens: meta }, null, 2), 'utf8');
console.log(`Wrote ${meta.length} capture files and screens-meta.json to ${scratchDir}`);
