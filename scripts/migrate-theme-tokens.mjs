import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 긴 패턴 우선 */
const REPLACEMENTS = [
  ['from-[#f0f9fc] to-white', 'from-primary/5 to-background'],
  ['from-[#f0f9fc] to-background', 'from-primary/5 to-background'],
  ['from-slate-50 via-white to-slate-50/80', 'from-primary/5 via-background to-muted/30'],
  ['from-slate-50/80 to-white', 'from-muted/30 to-background'],
  ['from-slate-50/80 to-background', 'from-muted/30 to-background'],
  ['bg-muted/30/50', 'bg-muted/50'],
  ['border-slate-200/90', 'border-border/90'],
  ['border-slate-200/80', 'border-border/80'],
  ['border-slate-300/80', 'border-border/80'],
  ['border-l-slate-200', 'border-l-border'],
  ['hover:bg-slate-50/80', 'hover:bg-muted/50'],
  ['hover:bg-slate-100/90', 'hover:bg-muted/50'],
  ['bg-slate-50/90', 'bg-muted/30'],
  ['bg-slate-50/80', 'bg-muted/30'],
  ['bg-slate-50/40', 'bg-muted/30'],
  ['bg-slate-200/90', 'bg-muted'],
  ['bg-white/95', 'bg-background/95'],
  ['bg-white/90', 'bg-background/90'],
  ['divide-slate-100', 'divide-border'],
  ['divide-slate-200', 'divide-border'],
  ['placeholder:text-slate-400', 'placeholder:text-muted-foreground'],
  ['placeholder:text-slate-500', 'placeholder:text-muted-foreground'],
  ['hover:text-slate-700', 'hover:text-foreground'],
  ['hover:text-slate-600', 'hover:text-foreground'],
  ['hover:border-slate-400', 'hover:border-border'],
  ['hover:border-slate-300', 'hover:border-border'],
  ['hover:bg-slate-100', 'hover:bg-muted/50'],
  ['hover:bg-slate-50', 'hover:bg-muted/50'],
  ['divide-slate-200', 'divide-border'],
  ['ring-slate-200', 'ring-border'],
  ['border-slate-800', 'border-foreground'],
  ['border-slate-300', 'border-border'],
  ['border-slate-200', 'border-border'],
  ['border-slate-100', 'border-border'],
  ['border-slate-50', 'border-border/50'],
  ['bg-slate-100', 'bg-muted/40'],
  ['bg-slate-50', 'bg-muted/30'],
  ['bg-slate-200', 'bg-muted'],
  ['text-slate-900', 'text-foreground'],
  ['text-slate-800', 'text-foreground'],
  ['text-slate-700', 'text-foreground'],
  ['text-slate-600', 'text-muted-foreground'],
  ['text-slate-500', 'text-muted-foreground'],
  ['text-slate-400', 'text-muted-foreground'],
  ['text-slate-300', 'text-muted-foreground/40'],
  ['text-[#666]', 'text-muted-foreground'],
  ['text-[#333]', 'text-foreground'],
  ['bg-white', 'bg-background'],
];

const TARGET_DIRS = [
  'src/app/(pages)/map/_mapContents/safty/safetyInfo',
  'src/app/(pages)/map/_mapContents/road/roadCCTV',
  'src/app/(pages)/map/_mapComponents/standard',
  'src/app/(pages)/map/_mapContents/memo',
  'src/app/(pages)/shape-editor',
  'src/app/(pages)/map/_mapContents/prototypes',
  'src/app/(pages)/map/_mapComponents/landInfo',
  'src/app/(pages)/map/_mapComponents/layerRowEdit',
  'src/app/(pages)/map/_mapComponents/complaint',
  'src/app/(pages)/map/_mapContents/shootingRequest',
];

const TARGET_FILES = [
  'src/app/(pages)/map/_mapComponents/AddressInfoDetail.tsx',
  'src/app/(pages)/map/_mapComponents/MapHitOverlapSelect.tsx',
  'src/app/(pages)/map/_mapComponents/FeatureIdentifyPopup.tsx',
  'src/app/(pages)/map/_mapComponents/parcelLandLinkageUi.tsx',
  'src/app/(pages)/map/_mapComponents/LayerManagementPanel.tsx',
  'src/app/(pages)/map/_mapComponents/MapFloatingPanel.tsx',
  'src/app/(pages)/map/_mapContents/road/roadLedger/RoadLedgerFacilityAttrModal.tsx',
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(full);
  }
  return out;
}

function migrateFile(filePath) {
  let text = fs.readFileSync(filePath, 'utf8');
  const before = text;
  for (const [from, to] of REPLACEMENTS) {
    text = text.split(from).join(to);
  }
  if (text !== before) {
    fs.writeFileSync(filePath, text, 'utf8');
    return true;
  }
  return false;
}

const files = new Set();
for (const rel of TARGET_DIRS) {
  for (const f of walk(path.join(root, rel))) files.add(f);
}
for (const rel of TARGET_FILES) {
  const full = path.join(root, rel);
  if (fs.existsSync(full)) files.add(full);
}

let changed = 0;
for (const f of [...files].sort()) {
  if (migrateFile(f)) {
    changed++;
    console.log('updated', path.relative(root, f));
  }
}
console.log(`Done: ${changed} files updated`);
